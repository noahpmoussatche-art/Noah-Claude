/**
 * The game: screen flow, input, and the main loop.
 *
 * The intended experience (spec §78) is a single continuous chain — open the
 * game, meet the ducks, enter the agency, build a rocket, see it at scale, run
 * the check, launch, watch the ducks, count down, ignition, fire, smoke,
 * vibration, liftoff, ascent, separation, space, Earth, Sun, Mars, approach,
 * entry, heat, parachute, descent, dust, touchdown, silence, Mars, complete.
 * This class is what strings that chain together.
 */
import * as THREE from 'three';
import { CRUISE_TIME_SCALES, MissionState, TIME_SCALES } from '../data/constants';
import { Renderer } from './Renderer';
import { Interface } from '../ui/Interface';
import { Tutorial, type TutorialContext } from '../ui/Tutorial';
import { AudioEngine } from '../audio/AudioEngine';
import { CameraDirector, orbitShot } from '../cinematics/CameraDirector';
import {
  attachAscentCoverage,
  attachMarsCoverage,
  createFirstLaunchCinematic,
  type CinematicContext,
  type CoverageHandle,
} from '../cinematics/Sequences';
import { Timeline } from '../cinematics/Timeline';
import { BuildScene } from '../scenes/BuildScene';
import { MenuScene } from '../scenes/MenuScene';
import { MissionScene } from '../scenes/MissionScene';
import { MissionSim } from '../simulation/MissionSim';
import { analyseVehicle, type VehicleAnalysis } from '../simulation/SystemCheck';
import { Vehicle } from '../vehicles/Vehicle';
import type { StackItem, VehicleDesign } from '../vehicles/VehicleDesign';
import type { MissionDef } from '../data/missions';
import { EARTH } from '../data/constants';
import { DiagnosticOverlay } from '../ui/DiagnosticOverlay';
import { clamp } from '../utils/math';

type Screen = 'menu' | 'build' | 'mission';

export class Game {
  private readonly renderer: Renderer;
  private readonly ui: Interface;
  private readonly audio = new AudioEngine();
  private readonly director: CameraDirector;
  private readonly tutorial = new Tutorial();

  private screen: Screen = 'menu';
  private mission: MissionDef | null = null;

  /** The player's working design. */
  private design: VehicleDesign = { name: 'New Vehicle', stack: [] };
  private analysis: VehicleAnalysis | null = null;

  private buildScene: BuildScene | null = null;
  private menuScene: MenuScene | null = null;
  private missionScene: MissionScene | null = null;
  private sim: MissionSim | null = null;
  private missionDiagnostics: DiagnosticOverlay | null = null;
  /** Whether the flown trail has been restarted for the Martian frame. */
  private marsTrailReset = false;

  private cinematic: Timeline | null = null;
  private ascentCoverage: CoverageHandle | null = null;
  private marsCoverage: (() => void) | null = null;

  private diagnosticsOn = false;
  private checkOpened = false;
  private launched = false;

  private lastFrame = performance.now();
  private running = false;

  /** Set while a mission replay is playing back recorded telemetry. */
  private replayTicker: ((dt: number) => void) | null = null;

  // Input state.
  private pointerDown = false;
  private lastPointer = { x: 0, y: 0 };

  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement) {
    this.renderer = new Renderer(canvas);
    this.director = new CameraDirector(this.renderer.aspect);

    this.ui = new Interface(uiRoot, {
      onMissionSelected: (m) => void this.selectMission(m),
      onAddPart: (id, stage) => this.addPart(id, stage),
      onRemovePart: (i) => this.removePart(i),
      onSetStage: (i, s) => this.setStage(i, s),
      onLoadReference: () => this.loadReference(),
      onClearDesign: () => this.clearDesign(),
      onOpenCheck: () => this.openCheck(),
      onCloseCheck: () => this.ui.hideSystemCheck(),
      onLaunch: () => void this.launch(),
      onToggleDiagnostics: () => this.toggleDiagnostics(),
      onSetTimeScale: (s) => this.setTimeScale(s),
      onTogglePause: () => this.togglePause(),
      onSkipCinematic: () => this.skipCinematic(),
      onTutorialAdvance: () => this.advanceTutorial(),
      onTutorialBack: () => this.tutorial.back(),
      onTutorialSkip: () => this.tutorial.skip(),
      onReplay: () => this.startReplay(),
      onReturnToBuild: () => this.returnToBuild(),
      onReturnToMenu: () => this.returnToMenu(),
      onToggleMute: () => this.toggleMute(),
    });

    this.attachInput(canvas);
    window.addEventListener('resize', () => this.renderer.resize());
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  start(): void {
    this.ui.hideLoading();
    this.enterMenu();
    this.running = true;
    this.lastFrame = performance.now();
    requestAnimationFrame(this.loop);
  }

  /**
   * Shows the title screen. The menu is a real 3D shot of the two characters
   * (spec §24, §78) rather than a pair of emoji over a black page, so entering
   * it means building and framing a scene, not just unhiding a panel.
   */
  private enterMenu(): void {
    this.screen = 'menu';
    if (!this.menuScene) this.menuScene = new MenuScene();

    const scene = this.menuScene;
    this.director.setClipRange(0.05, 20_000);
    this.director.play({
      kind: 'wide',
      target: () => scene.focusPoint(new THREE.Vector3()),
      position: () => scene.cameraPosition(new THREE.Vector3()),
      fov: 34,
      blend: 0,
      stiffness: 5,
      handheld: 0.3,
    });
    this.ui.showMenu(true);
  }

  private readonly loop = (now: number): void => {
    if (!this.running) return;
    // Clamp only enough to survive a backgrounded tab. Clamping tightly (say to
    // one 60 Hz frame) would silently put the whole game into slow motion on a
    // slower machine — cinematics, countdown and physics would all drift out of
    // step with the wall clock. The mission simulation sub-steps internally, so
    // a large frame stays stable.
    const dt = clamp((now - this.lastFrame) / 1000, 0, 0.25);
    this.lastFrame = now;

    this.update(dt);
    this.renderer.adaptQuality(dt);
    requestAnimationFrame(this.loop);
  };

  private update(dt: number): void {
    this.ui.update(dt);

    switch (this.screen) {
      case 'build':
        this.updateBuild(dt);
        break;
      case 'mission':
        this.updateMission(dt);
        break;
      case 'menu':
        this.menuScene?.update(dt);
        break;
      default:
        break;
    }

    this.director.update(dt, this.renderer.aspect);

    const scene =
      this.screen === 'mission'
        ? this.missionScene?.scene
        : this.screen === 'build'
          ? this.buildScene?.scene
          : this.menuScene?.scene;

    if (scene) {
      const farScale =
        this.screen === 'mission' ? (this.missionScene?.farSpaceScale() ?? 0) : 0;
      this.renderer.render(scene, this.director.camera, farScale);
    }
  }

  // -------------------------------------------------------------------------
  // Menu → build
  // -------------------------------------------------------------------------

  private async selectMission(mission: MissionDef): Promise<void> {
    this.mission = mission;
    await this.audio.start();
    this.audio.click();

    this.ui.showMenu(false);
    this.enterBuild();

    // The tutorial runs on the first mission only.
    if (mission.id === 'first-flight' && !this.tutorial.isComplete) {
      this.tutorial.start();
    }
  }

  private enterBuild(): void {
    this.screen = 'build';
    this.launched = false;
    this.checkOpened = false;

    this.teardownMission();

    if (!this.buildScene) {
      this.buildScene = new BuildScene();
    }
    this.buildScene.setDesign(this.design);
    this.buildScene.setDiagnosticsEnabled(this.diagnosticsOn);

    this.ui.showBuild(true);
    this.ui.showHud(false);
    this.ui.setCinematicMode(false);
    this.ui.hideResult();
    this.audio.setAmbience('workshop');

    // Frame the vehicle in the bay.
    //
    // The camera has to sit *inside* the hall. The bay is 58 m across and its
    // wall columns run floor to roof, so a camera parked 38 m off the centre
    // line was outside the building looking at the vehicle through a picket
    // fence of structural steel. This viewpoint is in the aisle, and the lens
    // is wide enough to hold a tall stack from a distance the walls allow.
    const focus = this.buildScene.focusPoint(new THREE.Vector3());
    const distance = this.buildScene.framingDistance();
    // The lens has to make up for the room: since the camera cannot back away
    // far enough, widen it until the stack fits from where it can stand.
    const fov = clamp(
      THREE.MathUtils.radToDeg(
        2 * Math.atan((this.buildScene.vehicleHeight * 0.55) / distance),
      ),
      38,
      68,
    );
    this.director.setClipRange(0.35, 12_000);
    this.director.snapTo(
      focus.clone().add(new THREE.Vector3(0.45, 0.2, 0.87).normalize().multiplyScalar(distance)),
      focus,
      fov,
    );
    this.director.setFreeFov(fov);
    this.director.enterFreeCamera(
      () => this.buildScene!.focusPoint(new THREE.Vector3()),
      distance,
    );

    this.refreshAnalysis();
  }

  private updateBuild(dt: number): void {
    const scene = this.buildScene;
    if (!scene) return;
    scene.update(dt);

    // Keep the tutorial reacting to what the player has actually built.
    this.ui.updateTutorial(this.tutorial, this.tutorialContext());

    // A tutorial step can ask for the diagnostic gizmos (spec §48).
    if (this.tutorial.wantsDiagnostics() && !this.diagnosticsOn) {
      // Don't force it on — the step's objective is for the player to enable it.
    }
  }

  private tutorialContext(): TutorialContext {
    return {
      design: this.design,
      analysis: this.analysis,
      diagnosticsOn: this.diagnosticsOn,
      checkOpened: this.checkOpened,
      launched: this.launched,
    };
  }

  private advanceTutorial(): void {
    this.audio.click();
    this.tutorial.tryAdvance(this.tutorialContext());
    this.ui.updateTutorial(this.tutorial, this.tutorialContext());
  }

  // -------------------------------------------------------------------------
  // Design editing
  // -------------------------------------------------------------------------

  private addPart(partId: string, stage: number): void {
    this.audio.click();
    const item: StackItem = { partId, stage };
    this.design = { ...this.design, stack: [...this.design.stack, item] };
    this.onDesignChanged();
  }

  private removePart(index: number): void {
    this.audio.click();
    const stack = [...this.design.stack];
    stack.splice(index, 1);
    this.design = { ...this.design, stack };
    this.onDesignChanged();
  }

  private setStage(index: number, stage: number): void {
    this.audio.click();
    const stack = [...this.design.stack];
    stack[index] = { ...stack[index], stage };
    this.design = { ...this.design, stack };
    this.onDesignChanged();
  }

  private loadReference(): void {
    if (!this.mission) return;
    this.audio.confirm();
    this.design = this.mission.referenceDesign;
    this.onDesignChanged();
  }

  private clearDesign(): void {
    this.audio.click();
    this.design = { name: 'New Vehicle', stack: [] };
    this.onDesignChanged();
  }

  private onDesignChanged(): void {
    this.buildScene?.setDesign(this.design);
    this.buildScene?.setDiagnosticsEnabled(this.diagnosticsOn);
    this.refreshAnalysis();

    // Re-frame for the new vehicle size, so a growing stack stays in shot. The
    // bay caps how far back the camera can go, so past a certain height the
    // lens has to widen instead of the camera retreating.
    if (this.buildScene) {
      const distance = this.buildScene.framingDistance();
      this.director.setOrbitDistance(distance);
      this.director.setFreeFov(
        clamp(
          THREE.MathUtils.radToDeg(
            2 * Math.atan((this.buildScene.vehicleHeight * 0.55) / distance),
          ),
          38,
          68,
        ),
      );
    }
    this.ui.updateTutorial(this.tutorial, this.tutorialContext());
  }

  private refreshAnalysis(): void {
    if (!this.mission || this.design.stack.length === 0) {
      this.analysis = null;
      this.ui.refreshVehicle(this.design, null);
      return;
    }

    // Build a throwaway vehicle purely to compute mass properties, so the
    // analysis is always derived from the real assembled geometry.
    const probe = new Vehicle(this.design);
    this.analysis = analyseVehicle(
      probe,
      EARTH,
      this.mission.requiresLanding,
      this.mission.requiresDeepSpaceComms,
    );
    probe.dispose();

    this.ui.refreshVehicle(this.design, this.analysis);
    this.ui.updateWarnings(this.analysis.warnings);
  }

  private openCheck(): void {
    if (!this.mission) return;
    this.refreshAnalysis();
    if (!this.analysis) return;
    this.checkOpened = true;
    this.audio.confirm();
    this.ui.showSystemCheck(this.analysis, this.mission);
    this.ui.updateTutorial(this.tutorial, this.tutorialContext());
  }

  private toggleDiagnostics(): void {
    this.diagnosticsOn = !this.diagnosticsOn;
    this.audio.click();
    this.buildScene?.setDiagnosticsEnabled(this.diagnosticsOn);
    this.missionDiagnostics?.setEnabled(this.diagnosticsOn);
    this.ui.setDiagnosticsButtonActive(this.diagnosticsOn);
    this.ui.updateTutorial(this.tutorial, this.tutorialContext());
  }

  // -------------------------------------------------------------------------
  // Launch
  // -------------------------------------------------------------------------

  private async launch(): Promise<void> {
    if (!this.mission || this.design.stack.length === 0) return;
    await this.audio.start();

    this.ui.hideSystemCheck();
    this.ui.showBuild(false);
    this.launched = true;
    this.tutorial.tryAdvance(this.tutorialContext());

    this.screen = 'mission';

    // ---- Build the mission ----
    const vehicle = new Vehicle(this.design);
    const scene = new MissionScene(
      new MissionSim(this.mission, vehicle, 8.6),
    );
    this.missionScene = scene;
    this.sim = scene.sim;

    // Diagnostics carry over into flight, so the player can watch the centre of
    // mass migrate as propellant drains (spec §15).
    this.missionDiagnostics = new DiagnosticOverlay(vehicle);
    vehicle.root.add(this.missionDiagnostics.group);
    scene.scene.add(this.missionDiagnostics.trajectoryObject);
    this.missionDiagnostics.setEnabled(this.diagnosticsOn);

    this.ui.showHud(true);
    this.ui.hideResult();
    this.director.setClipRange(0.4, 4_000_000);

    // ---- Wire the cinematic context ----
    const ctx: CinematicContext = {
      scene,
      director: this.director,
      audio: this.audio,
      say: (line) => this.ui.say(line),
      slate: (title, sub) => this.ui.slate(title, sub),
      fade: (to, secs) => this.ui.fade(to, secs),
      setCinematicMode: (on) => this.ui.setCinematicMode(on),
      // `force` because the player may deliberately fly a vehicle that failed
      // its checks — the spec wants that to be possible and instructive.
      startCountdown: () => {
        this.sim?.beginCountdown(true);
      },
    };

    this.ascentCoverage = attachAscentCoverage(ctx);
    this.marsCoverage = attachMarsCoverage(ctx);

    this.wireMissionAudio();

    // ---- The opening sequence, and the countdown that runs beneath it ----
    this.cinematic = createFirstLaunchCinematic(ctx);
    this.cinematic.onFinished(() => {
      this.cinematic = null;
      this.ui.setCinematicMode(false);
    });
    this.cinematic.start();

  }

  private wireMissionAudio(): void {
    const sim = this.sim;
    if (!sim) return;

    sim.on((e) => {
      switch (e.type) {
        case 'countdown-tick': {
          const n = Number(e.data?.count ?? 0);
          this.ui.showCountdown(n);
          this.audio.countdownBeep(n === 0);
          break;
        }
        case 'mission-complete':
        case 'mission-failed':
          // Give the closing shot a moment before the result card appears.
          window.setTimeout(() => this.ui.showResult(sim), 4_200);
          break;
        default:
          break;
      }
    });
  }

  private updateMission(dt: number): void {
    const sim = this.sim;
    const scene = this.missionScene;
    if (!sim || !scene) return;

    // ---- Simulation ----
    sim.update(dt);

    // ---- Scene ----
    scene.setCameraPosition(this.director.camera.position);
    scene.update(dt);

    // ---- Cinematics ----
    this.cinematic?.update(dt);
    this.ascentCoverage?.tick(dt);
    this.replayTicker?.(dt);

    // Once the opening sequence is done and no shot is queued, hand the camera
    // to the player (spec §49) framing the vehicle.
    if (!this.cinematic && !this.director.activeShot && !this.director.isFree) {
      // Frame what is still attached, at a distance set by its size — not the
      // launch stack's origin at the launch stack's height. After staging those
      // are two different places and two very different scales.
      this.director.enterFreeCamera(
        () => scene.vehicleCentre(new THREE.Vector3()),
        clamp(scene.framingRadius() * 3.2, 12, 600),
      );
    }

    // ---- Camera shake from the vehicle, attenuated by distance ----
    const camDist = this.director.camera.position.distanceTo(
      scene.vehiclePosition(new THREE.Vector3()),
    );
    this.director.setShake(sim.shake * clamp(120 / Math.max(camDist, 40), 0.15, 1.4));

    // ---- Diagnostics ----
    if (this.missionDiagnostics) {
      this.missionDiagnostics.update(dt, sim.vehicle, sim.activeFlight());
      // The flown trail is in launch-site metres. In the heliocentric map view
      // those coordinates mean nothing, and the line was drawing itself across
      // the solar system — so it is dropped for the duration of the cruise and
      // restarted at Mars.
      this.missionDiagnostics.setTrajectoryVisible(scene.currentMode !== 'cruise');
      if (scene.currentMode === 'mars' && !this.marsTrailReset) {
        this.marsTrailReset = true;
        this.missionDiagnostics.clearTrajectory();
      }
    }

    // ---- Audio ----
    this.audio.updateEngine(scene.plumeIntensity(), scene.airDensityFactor(), camDist);
    this.audio.updateWind(sim.telemetry.dynamicPressure, scene.airDensityFactor());
    if (scene.consumeSupersonicEvent()) {
      // The boom reaches the observer a moment after the vehicle passes Mach 1.
      window.setTimeout(() => this.audio.sonicBoom(), 1_400);
    }

    // ---- HUD ----
    this.ui.updateTelemetry(sim, sim.telemetry);
    this.ui.updateMissionState(sim);
    this.ui.updateDiagnostics(sim, this.diagnosticsOn);
    this.ui.updateTimeControls(
      sim.timeScale,
      sim.paused,
      this.audio.isMuted,
      this.availableTimeScales(),
    );
  }

  /**
   * Warp range for the current phase. A cruise gets a much larger range than
   * powered flight, because it is measured in months rather than minutes.
   */
  private availableTimeScales(): readonly number[] {
    const s = this.sim?.state;
    return s === MissionState.TRANSFER || s === MissionState.ORBIT
      ? CRUISE_TIME_SCALES
      : TIME_SCALES;
  }

  // -------------------------------------------------------------------------
  // Mission controls
  // -------------------------------------------------------------------------

  private setTimeScale(scale: number): void {
    if (!this.sim) return;
    this.audio.click();
    this.sim.timeScale = scale;
    this.ui.updateTimeControls(
      scale,
      this.sim.paused,
      this.audio.isMuted,
      this.availableTimeScales(),
    );
  }

  private togglePause(): void {
    if (!this.sim) return;
    this.audio.click();
    this.sim.paused = !this.sim.paused;
    this.ui.updateTimeControls(
      this.sim.timeScale,
      this.sim.paused,
      this.audio.isMuted,
      this.availableTimeScales(),
    );
  }

  /** Render-frame state for the headless visual harness (tools/visual-test.mjs). */
  debugSnapshot(): Record<string, unknown> | null {
    if (!this.missionScene) return null;
    // Where the vehicle lands on screen, in normalised device coordinates:
    // |x| and |y| under 1 means it is inside the frame. A screenshot can show
    // that a frame is empty; this says whether the subject was even pointed at.
    const ndc = this.missionScene
      .vehiclePosition(new THREE.Vector3())
      .project(this.director.camera);

    // Past staging the launch vehicle's origin is not what the cameras frame —
    // the surviving hardware is (MissionScene.vehicleCentre). Reporting only the
    // origin made the Martian phases look like framing failures when the camera
    // was pointed correctly, and would hide a real one. Both are reported.
    const centre = this.missionScene.vehicleCentre(new THREE.Vector3());
    const centreWorld = centre.clone();
    const centreNdc = centre.project(this.director.camera);

    return {
      ...this.missionScene.debugSnapshot(),
      screen: [Math.round(ndc.x * 100) / 100, Math.round(ndc.y * 100) / 100],
      inFrame: Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1 && ndc.z < 1,
      centre: centreWorld.toArray().map((v) => Math.round(v * 100) / 100),
      centreScreen: [
        Math.round(centreNdc.x * 100) / 100,
        Math.round(centreNdc.y * 100) / 100,
      ],
      centreInFrame:
        Math.abs(centreNdc.x) <= 1 && Math.abs(centreNdc.y) <= 1 && centreNdc.z < 1,
      cameraToCentre: Math.round(this.director.camera.position.distanceTo(centreWorld)),
      // The harness samples the opening sequence by *its* clock rather than by
      // wall clock: a software renderer runs the game at a fraction of real
      // speed, and a fixed wall-clock delay would photograph the wrong shot.
      cinematicTime: this.cinematic ? Math.round(this.cinematic.time * 10) / 10 : null,
    };
  }

  private toggleMute(): void {
    this.audio.setMuted(!this.audio.isMuted);
    if (this.sim) {
      this.ui.updateTimeControls(
        this.sim.timeScale,
        this.sim.paused,
        this.audio.isMuted,
        this.availableTimeScales(),
      );
    }
  }

  private skipCinematic(): void {
    if (this.cinematic) {
      this.cinematic.skip();
      this.cinematic = null;
      this.ui.setCinematicMode(false);
    }
  }

  /**
   * Mission replay (spec §51): rewinds the camera through the recorded flight.
   * The recording is of the real simulated state, so the replay is what
   * happened, not a re-run.
   */
  private startReplay(): void {
    const sim = this.sim;
    const scene = this.missionScene;
    if (!sim || !scene || sim.recorder.count === 0) return;

    this.audio.click();
    this.ui.hideResult();
    this.ui.setCinematicMode(true);
    this.ui.slate('MISSION REPLAY', sim.mission.name);

    const start = sim.recorder.startTime;
    const duration = sim.recorder.duration;
    let replayTime = 0;
    // Compress the replay into roughly half a minute of screen time.
    const rate = Math.max(duration / 30, 1);

    const marker = new THREE.Group();
    scene.scene.add(marker);

    const tick = (dt: number): void => {
      replayTime += dt * rate;
      const sample = sim.recorder.at(start + replayTime);
      if (sample) {
        marker.position.copy(sample.position);
        marker.quaternion.copy(sample.orientation);
      }
      if (replayTime >= duration) {
        this.replayTicker = null;
        marker.removeFromParent();
        this.ui.setCinematicMode(false);
        this.ui.showResult(sim);
      }
    };

    // Follow the recorded path with a tracking camera.
    this.director.play(
      orbitShot(() => marker.position.clone(), {
        distance: Math.max(sim.vehicle.height * 2.2, 60),
        height: sim.vehicle.height * 0.4,
        angularSpeed: 0.22,
        fov: 40,
        blend: 1.5,
      }),
    );

    this.replayTicker = tick;
  }

  // -------------------------------------------------------------------------
  // Teardown
  // -------------------------------------------------------------------------

  private teardownMission(): void {
    this.ascentCoverage?.stop();
    this.ascentCoverage = null;
    this.marsCoverage?.();
    this.marsCoverage = null;
    this.cinematic?.stop();
    this.cinematic = null;
    this.replayTicker = null;

    this.marsTrailReset = false;
    this.missionDiagnostics?.dispose();
    this.missionDiagnostics = null;

    if (this.missionScene) {
      this.missionScene.dispose();
      this.missionScene.sim.vehicle.dispose();
      this.missionScene = null;
    }
    this.sim = null;
  }

  private returnToBuild(): void {
    this.audio.click();
    this.ui.hideResult();
    this.enterBuild();
  }

  private returnToMenu(): void {
    this.audio.click();
    this.teardownMission();
    this.ui.hideResult();
    this.ui.showBuild(false);
    this.ui.showHud(false);
    this.ui.setCinematicMode(false);
    this.audio.setAmbience('none');
    this.enterMenu();
  }

  // -------------------------------------------------------------------------
  // Input (spec §49: camera, zoom, pause, time — never piloting)
  // -------------------------------------------------------------------------

  private attachInput(canvas: HTMLCanvasElement): void {
    canvas.addEventListener('pointerdown', (e) => {
      this.pointerDown = true;
      this.lastPointer = { x: e.clientX, y: e.clientY };
      canvas.setPointerCapture(e.pointerId);

      // Any drag hands the camera to the player, interrupting automatic
      // coverage — but never interrupts the opening cinematic.
      if (!this.cinematic && this.screen === 'mission' && this.missionScene) {
        const scene = this.missionScene;
        if (!this.director.isFree) {
          this.director.enterFreeCamera(
            () => scene.vehicleCentre(new THREE.Vector3()),
            clamp(scene.framingRadius() * 3.2, 12, 600),
          );
        }
      }
    });

    canvas.addEventListener('pointerup', (e) => {
      this.pointerDown = false;
      canvas.releasePointerCapture(e.pointerId);
    });

    canvas.addEventListener('pointermove', (e) => {
      if (!this.pointerDown) return;
      const dx = e.clientX - this.lastPointer.x;
      const dy = e.clientY - this.lastPointer.y;
      this.lastPointer = { x: e.clientX, y: e.clientY };
      this.director.orbit(dx * 0.006, dy * 0.005);
    });

    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.director.zoom(e.deltaY > 0 ? 1.12 : 0.89);
      },
      { passive: false },
    );

    window.addEventListener('keydown', (e) => {
      switch (e.code) {
        case 'Space':
          e.preventDefault();
          if (this.screen === 'mission') this.togglePause();
          break;
        case 'KeyD':
          this.toggleDiagnostics();
          break;
        case 'KeyM':
          this.toggleMute();
          break;
        case 'Escape':
          if (this.cinematic) this.skipCinematic();
          else if (this.ui.isSystemCheckOpen) this.ui.hideSystemCheck();
          break;
        case 'BracketRight': {
          if (!this.sim) break;
          const set = this.availableTimeScales();
          const i = set.indexOf(this.sim.timeScale);
          this.setTimeScale(set[Math.min(Math.max(i, 0) + 1, set.length - 1)]);
          break;
        }
        case 'BracketLeft': {
          if (!this.sim) break;
          const set = this.availableTimeScales();
          const i = set.indexOf(this.sim.timeScale);
          this.setTimeScale(set[Math.max(Math.max(i, 0) - 1, 0)]);
          break;
        }
        default:
          break;
      }
    });
  }

  dispose(): void {
    this.running = false;
    this.teardownMission();
    this.buildScene?.dispose();
    this.audio.dispose();
    this.renderer.dispose();
  }
}
