/**
 * The mission state machine (spec §75) — the single authority on what is
 * happening, driving the cinematics, effects, audio and HUD.
 *
 * Crucially the simulation never stops running (spec §79). The cinematic camera
 * is scripted, but the vehicle it is pointing at is being integrated by the
 * physics the whole time: it is where it is because thrust, mass and drag put it
 * there. If the vehicle is badly built, the sequence changes or fails.
 */
import * as THREE from 'three';
import { EARTH, MARS, MissionState } from '../data/constants';
import type { MissionDef } from '../data/missions';
import { Vehicle } from '../vehicles/Vehicle';
import {
  FlightSimulator,
  type FlightTelemetry,
  type GuidanceCommand,
} from '../physics/FlightDynamics';
import { analyseVehicle, type VehicleAnalysis } from './SystemCheck';
import { clamp, lerp, Rng } from '../utils/math';
import { InterplanetaryTransfer } from './Transfer';
import { TelemetryRecorder } from './Telemetry';

/** Discrete things that happen, consumed by cinematics, effects and audio. */
export type MissionEventType =
  | 'countdown-tick'
  | 'systems-armed'
  | 'ignition-start'
  | 'ignition-full'
  | 'liftoff'
  | 'tower-clear'
  | 'max-q'
  | 'meco'
  | 'stage-separation'
  | 'stage-ignition'
  | 'fairing-jettison'
  | 'seco'
  | 'orbit-achieved'
  | 'payload-separation'
  | 'panels-deployed'
  | 'antenna-deployed'
  | 'transfer-burn'
  | 'cruise-begin'
  | 'mars-approach'
  | 'entry-interface'
  | 'peak-heating'
  | 'chute-deploy'
  | 'chute-full'
  | 'heatshield-jettison'
  | 'legs-deploy'
  | 'landing-burn'
  | 'touchdown'
  | 'dust-settled'
  | 'mission-complete'
  | 'mission-failed';

export interface MissionEvent {
  readonly type: MissionEventType;
  /** Mission elapsed time, s. */
  readonly time: number;
  readonly data?: Record<string, number | string>;
}

export interface FailureInfo {
  readonly code: string;
  readonly title: string;
  readonly explanation: string;
}

/** Debris: a separated stage that keeps existing in the world (spec §19). */
export interface Debris {
  readonly group: THREE.Group;
  velocity: THREE.Vector3;
  angularVelocity: THREE.Vector3;
  /** Seconds since separation. */
  age: number;
  /** Local-frame position, metres. */
  position: THREE.Vector3;
}

const COUNTDOWN_FROM = 10;
/** Engines spool from first ignition to full thrust over this many seconds. */
const IGNITION_RAMP = 2.6;
/** Hold-downs release once thrust exceeds weight by this margin. */
const HOLDDOWN_MARGIN = 1.02;
/**
 * Ceiling on physics substeps per rendered frame. This is what makes time warp
 * honest: during powered atmospheric flight the step size is small, so the
 * effective warp is capped rather than the integrator being allowed to take
 * strides it cannot resolve.
 */
const MAX_SUBSTEPS_PER_FRAME = 400;

/**
 * Altitude at which the lander lets go of its parachute and lights the descent
 * engine, metres. High enough that a canopy which has failed to slow the
 * vehicle still leaves room for the engine to try.
 */
const CHUTE_RELEASE_ALTITUDE = 3_500;

export class MissionSim {
  readonly mission: MissionDef;
  readonly vehicle: Vehicle;
  readonly flight: FlightSimulator;
  readonly analysis: VehicleAnalysis;
  readonly recorder = new TelemetryRecorder();

  state: MissionState = MissionState.CHECK;
  /** Mission elapsed time; negative during the countdown. */
  missionTime = -COUNTDOWN_FROM;
  timeScale = 1;
  paused = false;

  telemetry: FlightTelemetry;
  failure: FailureInfo | null = null;

  /** Separated stages still in the world. */
  readonly debris: Debris[] = [];

  /** 0..1 deployment progress for animated hardware. */
  deployment = {
    fairing: 0,
    legs: 0,
    panels: 0,
    antenna: 0,
    chute: 0,
  };

  /** Vibration amplitude for the camera and vehicle shake, metres. */
  shake = 0;

  /**
   * True while the vehicle is coasting up to apoapsis before its
   * circularisation burn. Surfaced so the HUD can explain the silence, and used
   * to take larger integration steps during an unpowered arc.
   */
  coasting = false;

  readonly transfer: InterplanetaryTransfer;

  private readonly listeners = new Set<(e: MissionEvent) => void>();
  private readonly fired = new Set<MissionEventType>();
  private readonly rng = new Rng(0x51ce);

  private lastCountdownTick = COUNTDOWN_FROM + 1;
  private ignitionTimer = 0;
  private maxQSeen = 0;
  private stagingTimer = 0;
  private landedTimer = 0;
  /** True once the parachute has been cut away for the powered descent. */
  private chuteReleased = false;
  private touchdownSpeed = 0;
  private padHeight = 0;

  constructor(mission: MissionDef, vehicle: Vehicle, padHeight = 0) {
    this.mission = mission;
    this.vehicle = vehicle;
    this.padHeight = padHeight;

    this.flight = new FlightSimulator(EARTH, vehicle, padHeight);
    this.analysis = analyseVehicle(
      vehicle,
      EARTH,
      mission.requiresLanding,
      mission.requiresDeepSpaceComms,
    );
    this.transfer = new InterplanetaryTransfer(EARTH, MARS);

    this.telemetry = this.flight.step(0, { mode: 'hold-vertical', throttle: 0 });
  }

  // -------------------------------------------------------------------------
  // Events
  // -------------------------------------------------------------------------

  on(listener: (e: MissionEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(type: MissionEventType, data?: Record<string, number | string>): void {
    const event: MissionEvent = { type, time: this.missionTime, data };
    for (const l of this.listeners) l(event);
  }

  /** Emits an event at most once for the whole mission. */
  private emitOnce(type: MissionEventType, data?: Record<string, number | string>): void {
    if (this.fired.has(type)) return;
    this.fired.add(type);
    this.emit(type, data);
  }

  hasFired(type: MissionEventType): boolean {
    return this.fired.has(type);
  }

  // -------------------------------------------------------------------------
  // Main update
  // -------------------------------------------------------------------------

  /** Starts the countdown. Returns false if the vehicle failed its checks. */
  beginCountdown(force = false): boolean {
    if (!this.analysis.launchable && !force) return false;
    this.state = MissionState.COUNTDOWN;
    this.missionTime = -COUNTDOWN_FROM;
    this.emitOnce('systems-armed');
    return true;
  }

  /**
   * Advances the mission. `realDt` is wall-clock seconds; the mission consumes
   * realDt × timeScale of simulated time, sub-stepped so that even at 1000×
   * warp the vehicle is genuinely integrated rather than teleported (spec §50).
   */
  update(realDt: number): void {
    if (this.paused) return;
    if (
      this.state === MissionState.BUILD ||
      this.state === MissionState.CHECK ||
      this.state === MissionState.MISSION_COMPLETE ||
      this.state === MissionState.MISSION_FAILED
    ) {
      return;
    }

    const simDt = realDt * this.timeScale;

    // Powered atmospheric flight needs small steps; vacuum coast and
    // interplanetary cruise are smooth enough to take large ones.
    //
    // The step size is recomputed *inside* the loop, because a step can change
    // the mission phase. Choosing it once up front means the substep after a
    // transition still uses the old phase's size — and an hour-long cruise step
    // applied to an atmospheric entry throws the vehicle straight past the
    // planet.
    let remaining = simDt;
    let guard = 0;
    while (remaining > 1e-9 && guard < MAX_SUBSTEPS_PER_FRAME) {
      guard++;
      const dt = Math.min(remaining, this.maxIntegrationStep());
      this.stepOnce(dt);
      remaining -= dt;
      // stepOnce can end the mission; re-read through the helper so the compiler
      // does not treat the state as narrowed by the guard above.
      if (this.isFinished()) break;
    }

    this.updateDeployments(realDt);
    this.updateDebris(simDt);
    this.recorder.sample(this.missionTime, this.state, this.flight, this.telemetry);
  }

  /** True once the mission has reached a terminal state. */
  isFinished(): boolean {
    const s: MissionState = this.state;
    return s === MissionState.MISSION_COMPLETE || s === MissionState.MISSION_FAILED;
  }

  private maxIntegrationStep(): number {
    switch (this.state) {
      case MissionState.COUNTDOWN:
        return 0.25;
      case MissionState.IGNITION:
      case MissionState.LAUNCH:
      case MissionState.STAGING:
      case MissionState.ENTRY:
      case MissionState.DESCENT:
      case MissionState.LANDING:
        return 0.02;
      case MissionState.ASCENT:
        if (this.coasting) return 1;
        return this.telemetry.dynamicPressure > 500 ? 0.03 : 0.1;
      case MissionState.ORBIT:
        return 2;
      case MissionState.TRANSFER:
        return 3600;
      case MissionState.MARS_APPROACH:
        return 1;
      default:
        return 0.1;
    }
  }

  private stepOnce(dt: number): void {
    this.missionTime += dt;

    switch (this.state) {
      case MissionState.COUNTDOWN:
        this.stepCountdown(dt);
        break;
      case MissionState.IGNITION:
        this.stepIgnition(dt);
        break;
      case MissionState.LAUNCH:
      case MissionState.ASCENT:
      case MissionState.STAGING:
        this.stepAscent(dt);
        break;
      case MissionState.ORBIT:
        this.stepOrbit(dt);
        break;
      case MissionState.TRANSFER:
        this.stepTransfer(dt);
        break;
      case MissionState.MARS_APPROACH:
      case MissionState.ENTRY:
      case MissionState.DESCENT:
      case MissionState.LANDING:
        this.stepMarsDescent(dt);
        break;
      case MissionState.LANDED:
        this.stepLanded(dt);
        break;
      default:
        break;
    }
  }

  // -------------------------------------------------------------------------
  // Phases
  // -------------------------------------------------------------------------

  private stepCountdown(dt: number): void {
    // The vehicle sits on the pad; the physics still runs so it settles under
    // gravity against the hold-downs rather than hovering.
    this.telemetry = this.flight.step(dt, { mode: 'hold-vertical', throttle: 0 });
    this.flight.resolveGroundContact(this.padHeight);

    const secondsLeft = Math.ceil(-this.missionTime);
    if (secondsLeft < this.lastCountdownTick && secondsLeft >= 0) {
      this.lastCountdownTick = secondsLeft;
      this.emit('countdown-tick', { count: secondsLeft });
    }

    // Ignition commanded a few seconds before release, as on a real pad.
    if (this.missionTime >= -3.2) {
      this.state = MissionState.IGNITION;
      this.ignitionTimer = 0;
      this.emitOnce('ignition-start');
    }
  }

  private stepIgnition(dt: number): void {
    this.ignitionTimer += dt;
    const stage = this.vehicle.currentStage();
    const ramp = clamp(this.ignitionTimer / IGNITION_RAMP, 0, 1);
    // Thrust builds smoothly; the vehicle strains against the hold-downs.
    const throttle = ramp * ramp;

    for (const e of this.vehicle.activeEngines()) {
      if (e.stage === stage) e.throttle = throttle;
    }

    this.telemetry = this.flight.step(dt, { mode: 'hold-vertical', throttle });

    const mp = this.telemetry.massProperties;
    const weight = mp.totalMass * EARTH.g0;
    this.shake = ramp * 0.16;

    if (ramp >= 1) this.emitOnce('ignition-full');

    // Hold-downs release only once the engines are actually producing more
    // thrust than the vehicle weighs — a vehicle that cannot do this never
    // leaves the pad, which is exactly the failure the spec asks for.
    if (this.telemetry.thrust > weight * HOLDDOWN_MARGIN && this.missionTime >= 0) {
      this.state = MissionState.LAUNCH;
      this.emitOnce('liftoff');
    } else {
      this.flight.resolveGroundContact(this.padHeight);
      // If the countdown has run well past zero and it still cannot lift, fail.
      if (this.missionTime > 6) {
        this.fail(
          'LOW THRUST',
          'The vehicle never left the pad',
          `Engines reached full thrust of ${(this.telemetry.thrust / 1000).toFixed(0)} kN ` +
            `against a vehicle weighing ${(weight / 1000).toFixed(0)} kN. Thrust-to-weight ` +
            'below 1.0 means the rocket physically cannot rise. Add engines or remove mass.',
        );
      }
    }
  }

  private stepAscent(dt: number): void {
    const stage = this.vehicle.currentStage();
    const alt = this.flight.altitude();

    // ---- Throttle programme ----
    let throttle = 1;

    // Throttle down through the transonic region to limit dynamic pressure —
    // the real reason launch vehicles have a "throttle bucket" around max-Q.
    if (this.telemetry.dynamicPressure > 28_000) throttle = 0.7;
    else if (this.telemetry.dynamicPressure > 20_000) throttle = 0.85;

    // Acceleration limit. As propellant drains the vehicle gets very light and
    // acceleration would climb past anything the structure or payload tolerates,
    // so the guidance throttles back to hold roughly 4 g.
    // A near-empty upper stage under a full-thrust vacuum engine would pull well
    // past 10 g, so the floor has to be low enough for the limiter to actually
    // bite.
    const G_LIMIT = 4;
    if (this.telemetry.gForce > G_LIMIT && this.telemetry.thrust > 0) {
      throttle = clamp(throttle * (G_LIMIT / this.telemetry.gForce), 0.12, 1);
    }

    // ---- Guidance ----
    // Below the pitch-over point, hold vertical. Then fly the gravity turn until
    // apoapsis reaches the target, and switch to a horizontal circularisation
    // burn to lift periapsis out of the atmosphere. Cutting thrust as soon as
    // apoapsis is reached would leave the vehicle on a suborbital arc.
    const targetAlt = this.mission.targetAltitude;
    const apoapsisReached = this.telemetry.apoapsis > targetAlt * 0.97;
    // Periapsis can never rise above the altitude the vehicle is currently at —
    // once horizontal speed reaches circular velocity, the current point *is*
    // the periapsis. So the insertion target has to be reachable from where the
    // vehicle actually is.
    const periapsisReached =
      this.telemetry.periapsis > targetAlt * 0.75 ||
      (this.telemetry.periapsis > 150_000 && this.telemetry.periapsis > alt - 12_000);

    let mode: GuidanceCommand['mode'];
    if (alt < 250) {
      mode = 'hold-vertical';
    } else if (!apoapsisReached) {
      mode = 'gravity-turn';
    } else {
      mode = 'circularize';
    }

    // Insertion steering: hold a climb rate that carries the vehicle up to the
    // target altitude while the burn builds horizontal velocity, then level
    // off. This is what actually closes an orbit — burning flat at 150 km just
    // drives apoapsis to tens of thousands of kilometres while periapsis stays
    // pinned at the altitude the vehicle happens to be at.
    let pitchBias = 0;
    if (apoapsisReached) {
      if (periapsisReached) {
        // The orbit is closed.
        throttle = 0;
        this.coasting = false;
      } else if (this.telemetry.verticalSpeed > 40) {
        // Apoapsis is already at the target but the vehicle is still climbing
        // toward it. Thrusting here only pushes apoapsis higher — no pitch
        // angle can prevent that, because thrust adds energy wherever it is
        // applied. The efficient move is to shut down, coast up, and burn at
        // the top.
        throttle = 0;
        this.coasting = true;
      } else {
        // At apoapsis: burn horizontally to raise periapsis to meet it. A gentle
        // vertical-speed hold stops the vehicle sinking out of the burn.
        this.coasting = false;
        pitchBias = clamp(-this.telemetry.verticalSpeed * 0.0025, -0.1, 0.3);
      }
    }

    for (const e of this.vehicle.activeEngines()) {
      e.throttle = e.stage === stage ? throttle : 0;
    }

    const guidance: GuidanceCommand = {
      mode,
      throttle,
      pitchBias,
      turnEndAltitude: targetAlt,
    };

    this.telemetry = this.flight.step(dt, guidance);

    // Vibration scales with thrust and dynamic pressure — the vehicle is
    // working hardest low and fast (spec §13).
    this.shake =
      0.05 +
      0.11 * clamp(this.telemetry.thrust / 6e6, 0, 1) +
      0.14 * clamp(this.telemetry.dynamicPressure / 32_000, 0, 1);

    // ---- Milestones ----
    if (alt > 120 && !this.fired.has('tower-clear')) {
      this.emitOnce('tower-clear');
      this.state = MissionState.ASCENT;
    }

    if (this.telemetry.dynamicPressure > this.maxQSeen) {
      this.maxQSeen = this.telemetry.dynamicPressure;
    } else if (
      this.maxQSeen > 12_000 &&
      this.telemetry.dynamicPressure < this.maxQSeen * 0.86 &&
      !this.fired.has('max-q')
    ) {
      this.emitOnce('max-q', { q: Math.round(this.maxQSeen) });
    }

    // ---- Failure checks ----
    if (this.flight.state.destroyed) {
      this.fail(
        'VEHICLE BREAKUP',
        'The vehicle broke up during ascent',
        'The stack lost attitude control at high dynamic pressure and was torn ' +
          'apart by aerodynamic loads. This is what happens when the centre of ' +
          'pressure sits ahead of the centre of mass and there is not enough ' +
          'gimbal authority to hold the nose into the airflow. Add fins low on ' +
          'the vehicle, or move mass forward.',
      );
      return;
    }
    if (this.flight.state.tumbling && !this.fired.has('mission-failed')) {
      this.fail(
        'LOSS OF CONTROL',
        'The vehicle tumbled',
        'Angle of attack exceeded 80 degrees and the guidance system could not ' +
          'recover. Check the static margin in the diagnostic view: the centre of ' +
          'pressure must sit below the centre of mass.',
      );
      return;
    }

    // Falling back to the ground is an unambiguous failure.
    if (alt < this.padHeight + 1 && this.missionTime > 12 && this.telemetry.verticalSpeed < -3) {
      this.fail(
        'IMPACT',
        'The vehicle returned to the ground',
        'The vehicle never achieved a positive climb rate and fell back to the ' +
          'surface. It did not have the thrust or the propellant to reach orbit.',
      );
      return;
    }

    // ---- Staging ----
    this.handleStaging(dt, stage);

    // ---- Fairing jettison, once the air is thin enough to be harmless ----
    if (
      alt > 68_000 &&
      this.vehicle.fairingHalves.length > 0 &&
      !this.fired.has('fairing-jettison')
    ) {
      this.emitOnce('fairing-jettison');
      // The halves physically leave: their mass goes with them, and everything
      // they were shielding meets the airstream.
      this.vehicle.jettisonFairings();
    }

    // ---- Orbit insertion ----
    // A closed orbit means periapsis is clear of the atmosphere. Apoapsis being
    // higher than the target is fine — an elliptical parking orbit is still an
    // orbit — so the gate is on periapsis alone.
    if (periapsisReached && this.telemetry.periapsis > 145_000) {
      for (const e of this.vehicle.activeEngines()) e.throttle = 0;
      this.state = MissionState.ORBIT;
      // Drop out of time warp for the arrival on station. Reaching orbit is one
      // of the moments the mission exists for, and at fifty times real speed the
      // whole coast is over in half a second — the player would see a slate and
      // nothing else. They are free to warp straight back up.
      this.timeScale = 1;
      this.emitOnce('seco');
      this.emitOnce('orbit-achieved', {
        apoapsis: Math.round(this.telemetry.apoapsis),
        periapsis: Math.round(this.telemetry.periapsis),
      });
      return;
    }

    // ---- Out of propellant before orbit ----
    if (
      !this.vehicle.stageHasPropellant(stage) &&
      stage >= this.lastPoweredStage() &&
      this.telemetry.periapsis < 100_000
    ) {
      this.fail(
        'INSUFFICIENT FUEL',
        'Ran out of propellant before reaching orbit',
        `The vehicle burned its last propellant at ${(alt / 1000).toFixed(0)} km with a ` +
          `periapsis of ${(this.telemetry.periapsis / 1000).toFixed(0)} km — well below the ` +
          'atmosphere. It will fall back. Add propellant, add a stage, or cut payload mass.',
      );
    }
  }

  /**
   * True if a stage is the lander rather than an ascent stage.
   *
   * A lander carries its own descent engine, but that engine exists for the
   * arrival, not the launch. Without this distinction the ascent autopilot
   * would happily stage into the lander and burn its landing propellant trying
   * to reach orbit.
   */
  private isLanderStage(index: number): boolean {
    const stage = this.vehicle.stages.find((s) => s.index === index);
    if (!stage) return false;
    return stage.parts.some(
      (p) =>
        p.def.landing !== undefined ||
        (p.def.thermal?.coverage ?? 0) > 0 ||
        p.def.category === 'ROVER',
    );
  }

  /** Index of the highest ascent stage that actually has an engine. */
  private lastPoweredStage(): number {
    let last = 0;
    for (const s of this.vehicle.stages) {
      if (s.engines.length > 0 && !this.isLanderStage(s.index)) last = s.index;
    }
    return last;
  }

  private handleStaging(dt: number, stage: number): void {
    if (this.stagingTimer > 0) {
      this.stagingTimer -= dt;
      if (this.stagingTimer <= 0) {
        // Light the next stage a moment after separation, as real vehicles do.
        const next = this.vehicle.currentStage();
        if (this.vehicle.stages.some((s) => s.index === next && s.engines.length > 0)) {
          for (const e of this.vehicle.activeEngines()) {
            if (e.stage === next) e.throttle = 1;
          }
          this.emit('stage-ignition', { stage: next });
        }
        this.state = MissionState.ASCENT;
      }
      return;
    }

    const spent = !this.vehicle.stageHasPropellant(stage);
    // Only stage into another *ascent* stage. The lander's descent engine is
    // not available to the launch.
    const hasNextPowered = this.vehicle.stages.some(
      (s) => s.index > stage && s.engines.length > 0 && !this.isLanderStage(s.index),
    );

    if (spent && hasNextPowered) {
      for (const e of this.vehicle.activeEngines()) {
        if (e.stage === stage) e.throttle = 0;
      }
      this.emit('meco', { stage });

      const group = this.vehicle.separateStage(stage);
      if (group) {
        // The discarded stage inherits the vehicle's velocity plus the small
        // push from the separation pushers, then flies its own ballistic arc.
        const vel = this.flight.state.velocity.clone();
        const nose = new THREE.Vector3(0, 1, 0).applyQuaternion(this.flight.state.orientation);
        vel.addScaledVector(nose, -1.6);

        this.debris.push({
          group,
          velocity: vel,
          angularVelocity: new THREE.Vector3(
            this.rng.signed() * 0.05,
            this.rng.signed() * 0.02,
            this.rng.signed() * 0.05,
          ),
          age: 0,
          position: this.flight.renderPosition(new THREE.Vector3()),
        });

        this.emit('stage-separation', { stage });
        this.state = MissionState.STAGING;
        this.stagingTimer = 1.4;
      }
    }
  }

  private stepOrbit(dt: number): void {
    for (const e of this.vehicle.activeEngines()) e.throttle = 0;
    this.telemetry = this.flight.step(dt, { mode: 'prograde', throttle: 0 });
    this.shake = 0;

    // Satellite missions deploy their payload once on station.
    if (this.mission.destination === 'earth-orbit') {
      if (!this.fired.has('payload-separation') && this.missionTime > this.orbitTime() + 20) {
        this.emitOnce('payload-separation');
      }
      if (this.fired.has('payload-separation') && this.deployment.panels >= 1) {
        this.emitOnce('panels-deployed');
      }
      if (this.deployment.antenna >= 1) this.emitOnce('antenna-deployed');

      const done =
        this.mission.id === 'first-flight'
          ? true
          : this.deployment.panels >= 1 && this.deployment.antenna >= 1;

      if (done && this.missionTime > this.orbitTime() + 30) {
        this.complete();
      }
      return;
    }

    // Mars missions perform the injection burn after a short coast.
    if (this.mission.destination === 'mars-surface') {
      if (!this.fired.has('transfer-burn') && this.missionTime > this.orbitTime() + 45) {
        this.emitOnce('transfer-burn');
        this.state = MissionState.TRANSFER;
        this.transfer.begin(this.missionTime);
        this.emitOnce('cruise-begin');
        // Time warp is essential here; the cruise is eight months long.
        this.timeScale = Math.max(this.timeScale, 100);
      }
    }
  }

  private orbitTimeCache = -1;
  private orbitTime(): number {
    if (this.orbitTimeCache < 0) this.orbitTimeCache = this.missionTime;
    return this.orbitTimeCache;
  }

  private stepTransfer(dt: number): void {
    this.transfer.update(dt);
    this.shake = 0;

    if (this.transfer.progress > 0.985 && !this.fired.has('mars-approach')) {
      this.emitOnce('mars-approach');
      this.state = MissionState.MARS_APPROACH;
      this.timeScale = 1;
      this.beginMarsEntry();
    }
  }

  /** The Mars-side flight simulator, created when the cruise ends. */
  marsFlight: FlightSimulator | null = null;

  /**
   * Jettisons the cruise stage before entry.
   *
   * Everything below the lander — the spent upper stage, its tankage and
   * avionics — did its job at trans-Mars injection. Carrying it into the
   * atmosphere would triple the entry mass behind the same heat shield, which
   * is why every real Mars mission separates the cruise stage minutes before
   * entry interface.
   */
  private separateCruiseStage(): void {
    let landerStage = -1;
    for (const s of this.vehicle.stages) {
      if (!s.separated && this.isLanderStage(s.index)) {
        landerStage = s.index;
        break;
      }
    }
    if (landerStage < 0) return;

    for (const s of this.vehicle.stages) {
      if (s.separated || s.index >= landerStage) continue;
      const group = this.vehicle.separateStage(s.index);
      if (!group) continue;
      this.debris.push({
        group,
        velocity: new THREE.Vector3(0, -3, 0),
        angularVelocity: new THREE.Vector3(
          this.rng.signed() * 0.04,
          this.rng.signed() * 0.03,
          this.rng.signed() * 0.04,
        ),
        age: 0,
        position: new THREE.Vector3(0, 0, 0),
      });
      this.emit('stage-separation', { stage: s.index });
    }
  }

  private beginMarsEntry(): void {
    // Drop the cruise stage first, so the entry mass is the lander alone.
    this.separateCruiseStage();

    // Hand the vehicle to a fresh simulator at the Mars entry interface, on a
    // realistic arrival state: 125 km altitude, ~5.5 km/s, shallow flight path.
    const sim = new FlightSimulator(MARS, this.vehicle, MARS.atmosphereTop);
    const entrySpeed = 5_500;
    const flightPath = (-14 * Math.PI) / 180;

    const up = new THREE.Vector3(0, 1, 0);
    const horizontal = new THREE.Vector3(1, 0, 0);
    sim.state.velocity
      .copy(up)
      .multiplyScalar(Math.sin(flightPath) * entrySpeed)
      .addScaledVector(horizontal, Math.cos(flightPath) * entrySpeed);

    // Heat shield forward.
    sim.setAttitude(sim.state.velocity.clone().negate().normalize());
    sim.state.landed = false;

    this.marsFlight = sim;
    this.state = MissionState.ENTRY;
    // The fairing is long gone by now, so nothing on the lander is shielded.
    this.vehicle.jettisonFairings();
    this.emitOnce('entry-interface', { speed: entrySpeed });
  }

  private stepMarsDescent(dt: number): void {
    const sim = this.marsFlight;
    if (!sim) return;

    const alt = sim.altitude();

    // ---- Guidance and throttle per sub-phase ----
    let mode: GuidanceCommand['mode'] = 'entry-attitude';
    let throttle = 0;

    if (this.state === MissionState.ENTRY) {
      mode = 'entry-attitude';
      // Parachute deploys around Mach 2 at roughly 11 km, matching real
      // Mars entry profiles.
      if (alt < 11_000 && this.telemetry.mach < 2.3 && this.vehicle.parachuteArea() > 0) {
        this.emitOnce('chute-deploy');
        this.state = MissionState.DESCENT;
      } else if (alt < 9_000 && this.vehicle.parachuteArea() <= 0) {
        // No parachute: go straight to a propulsive descent.
        this.state = MissionState.DESCENT;
      }
    } else if (this.state === MissionState.DESCENT) {
      mode = 'retrograde';

      // Heat shield is dropped once the chute has the vehicle stabilised.
      if (this.deployment.chute > 0.85 && !this.fired.has('heatshield-jettison')) {
        this.emitOnce('heatshield-jettison');
        // The shield physically leaves: its mass and its drag go with it.
        this.vehicle.jettisonHeatShield();
      }

      // Start the landing burn when the remaining distance needs it.
      const vDown = this.telemetry.airspeed;
      const decel = this.availableDecel(sim);
      const stopDistance = decel > 0 ? (vDown * vDown) / (2 * decel) : Infinity;

      // Hold for the parachute. The stopping distance is computed from the
      // *current* speed, and at the moment the canopy opens the vehicle is
      // still doing Mach two — so the criterion below was satisfied instantly,
      // the burn lit at eleven kilometres and cut a parachute that had not yet
      // done any work. The canopy keeps the vehicle until the release altitude;
      // if it cannot slow it enough by then, the landing fails, which is the
      // honest outcome.
      const holdForChute =
        this.fired.has('chute-deploy') && !this.chuteReleased && alt > CHUTE_RELEASE_ALTITUDE;

      // Generous margin over the theoretical minimum: a suicide burn with no
      // margin leaves nothing for the throttle to correct with.
      if (!holdForChute && alt < stopDistance * 3.5 + 220 && vDown > 4) {
        this.emitOnce('landing-burn');
        this.state = MissionState.LANDING;
        // Cut the parachute as the engine lights, exactly as a real propulsive
        // lander does. A canopy still attached holds the vehicle vertical and
        // fights every attempt to point the engine along the velocity vector,
        // so the burn could never cancel horizontal drift.
        this.chuteReleased = true;
      }
    }

    if (this.state === MissionState.LANDING) {
      // A propulsive landing is two problems, and one engine cannot solve both
      // at once: the vehicle arrives with horizontal drift *and* descent rate,
      // and thrust only pushes one way. So the controller does what real
      // landers do — kill the sideways motion first while there is still
      // altitude to spare, then descend vertically onto the site.
      const up = sim.localUp();
      const vRel = sim.surfaceVelocity();
      const vUp = vRel.dot(up);
      const horizontal = vRel.clone().addScaledVector(up, -vUp).length();
      const vDown = -vUp;

      const safeDecel = Math.max(this.availableDecel(sim) * 0.8, 0.5);
      // The braking curve: fastest speed from which the engine can still stop
      // before the surface, held inside the limit so the controller keeps
      // authority in reserve. It converges on a walking-pace touchdown.
      const brakingCurve = (speedToKill: number): number => {
        const targetRate = Math.max(
          1.5,
          0.5 * Math.sqrt(2 * safeDecel * Math.max(alt - 6, 0)),
        );
        return clamp(0.2 + (speedToKill - targetRate) * 2.4, 0, 1);
      };

      if (horizontal > 1.2 && alt > 30) {
        // Phase one: retrograde, cancelling drift and descent together.
        mode = 'landing-burn';
        throttle = brakingCurve(vRel.length());
      } else {
        // Phase two: vertical. Hold the descent rate on the braking curve.
        mode = 'landing-vertical';
        throttle = brakingCurve(vDown);
      }

      if (alt < 60 && !this.fired.has('legs-deploy')) {
        this.emitOnce('legs-deploy');
      }
    }

    for (const e of this.vehicle.activeEngines()) {
      e.throttle = e.def.engine!.restartable ? throttle : 0;
    }

    // ---- Parachute drag, applied as extra drag area on the vehicle ----
    const chuteDrag = this.chuteReleased
      ? 0
      : this.deployment.chute * this.vehicle.parachuteArea() * 1.4;
    this.telemetry = this.stepWithExtraDrag(sim, dt, { mode, throttle }, chuteDrag);

    // ---- Heating and shield survival (spec §34) ----
    // Once the shield has been jettisoned its capacity leaves with it, so the
    // check only applies while it is still doing its job — by that point the
    // vehicle is subsonic and heating is negligible anyway.
    const shieldCapacity = this.vehicle.totalHeatCapacity();
    if (!this.fired.has('heatshield-jettison') && sim.state.heatLoad > shieldCapacity) {
      this.fail(
        'THERMAL FAILURE',
        'The vehicle burned up on entry',
        `Accumulated heat load reached ${(sim.state.heatLoad / 1e6).toFixed(0)} MJ/m² against ` +
          `a shield rated for ${(shieldCapacity / 1e6).toFixed(0)} MJ/m². Entering Mars from ` +
          'an interplanetary trajectory needs an aeroshell sized for the job.',
      );
      return;
    }

    if (
      !this.fired.has('peak-heating') &&
      this.telemetry.heatFlux > 0 &&
      sim.state.heatLoad > shieldCapacity * 0.28
    ) {
      this.emitOnce('peak-heating');
    }

    this.shake =
      clamp(this.telemetry.dynamicPressure / 3_000, 0, 1) * 0.22 +
      (throttle > 0 ? 0.08 : 0);

    // ---- Touchdown ----
    const contact = sim.resolveGroundContact(0);
    if (contact.touched) {
      this.touchdownSpeed = contact.speed;
      const limit = this.landingSpeedLimit();

      if (contact.speed > limit) {
        this.fail(
          'LANDING FAILURE',
          'The vehicle did not survive touchdown',
          `Touchdown at ${contact.speed.toFixed(1)} m/s against a landing system rated ` +
            `for ${limit.toFixed(1)} m/s. The gear collapsed. A deeper landing burn, or ` +
            'a larger parachute, would have taken that energy out.',
        );
        return;
      }

      for (const e of this.vehicle.activeEngines()) e.throttle = 0;
      this.state = MissionState.LANDED;
      this.landedTimer = 0;
      this.emitOnce('touchdown', { speed: Number(contact.speed.toFixed(2)) });
    }
  }

  /** Peak deceleration the descent engines can produce on Mars, m/s^2. */
  private availableDecel(sim: FlightSimulator): number {
    const mp = this.vehicle.massProperties();
    let thrust = 0;
    for (const e of this.vehicle.activeEngines()) {
      if (e.def.engine!.restartable) thrust += e.def.engine!.thrustVac;
    }
    void sim;
    return mp.totalMass > 0 ? thrust / mp.totalMass - MARS.g0 : 0;
  }

  private landingSpeedLimit(): number {
    const systems = this.vehicle.landingSystems();
    if (systems.length === 0) return 2;
    return Math.max(...systems.map((p) => p.def.landing!.maxTouchdownSpeed));
  }

  /**
   * Runs a flight step with additional drag area (from a deployed parachute).
   * The extra area is applied by temporarily inflating the vehicle's drag term,
   * which keeps the parachute inside the same physics rather than beside it.
   */
  private stepWithExtraDrag(
    sim: FlightSimulator,
    dt: number,
    guidance: GuidanceCommand,
    extraDragArea: number,
  ): FlightTelemetry {
    if (extraDragArea <= 0) return sim.step(dt, guidance);

    // Apply the chute as a decelerating impulse computed from the same
    // atmospheric state the integrator uses, then step normally.
    const before = sim.state.velocity.clone();
    const tel = sim.step(dt, guidance);
    const speed = before.length();
    if (speed > 1) {
      const rho = Math.max(tel.dynamicPressure / (0.5 * speed * speed), 0);
      const dragForce = 0.5 * rho * speed * speed * extraDragArea;
      const mass = Math.max(tel.massProperties.totalMass, 1);
      const dv = Math.min((dragForce / mass) * dt, speed * 0.9);
      sim.state.velocity.addScaledVector(before.normalize(), -dv);
    }
    return tel;
  }

  private stepLanded(dt: number): void {
    this.landedTimer += dt;
    this.shake = Math.max(0, this.shake - dt * 0.9);

    if (this.landedTimer > 4 && !this.fired.has('dust-settled')) {
      this.emitOnce('dust-settled');
    }
    if (this.landedTimer > 9) {
      this.complete();
    }
  }

  // -------------------------------------------------------------------------
  // Deployment animation state
  // -------------------------------------------------------------------------

  private updateDeployments(realDt: number): void {
    const advance = (current: number, seconds: number): number =>
      clamp(current + realDt / seconds, 0, 1);

    if (this.fired.has('fairing-jettison')) {
      this.deployment.fairing = advance(this.deployment.fairing, 2.2);
    }
    if (this.fired.has('legs-deploy')) {
      this.deployment.legs = advance(this.deployment.legs, 3);
    }
    if (this.fired.has('payload-separation')) {
      this.deployment.panels = advance(this.deployment.panels, 6);
    }
    if (this.deployment.panels > 0.5) {
      this.deployment.antenna = advance(this.deployment.antenna, 4);
    }
    if (this.chuteReleased) {
      // Cut away: the canopy falls behind and stops contributing.
      this.deployment.chute = Math.max(0, this.deployment.chute - realDt * 1.6);
    } else if (this.fired.has('chute-deploy')) {
      // Reefed stage first, then full inflation — a chute never simply appears.
      this.deployment.chute = advance(this.deployment.chute, 2.8);
      if (this.deployment.chute >= 1) this.emitOnce('chute-full');
    }

    this.vehicle.chuteDeployment = this.deployment.chute;
    this.applyDeployments();
  }

  /** Writes the deployment state onto the actual 3D hardware. */
  private applyDeployments(): void {
    const d = this.deployment;

    // Jettisoned hardware physically leaves. Its mass and drag were already
    // taken off the vehicle; without this its geometry stayed bolted on, so an
    // aeroshell that had been discarded at eleven kilometres was still riding
    // the lander to the surface. Fairing halves are the exception until their
    // swing-open animation has finished — that animation *is* them leaving.
    for (const p of this.vehicle.parts) {
      if (!p.object) continue;
      if (!p.jettisoned) continue;
      p.object.visible = p.def.enclosing ? d.fairing < 0.999 : false;
    }

    // Fairing halves swing open on their base hinge, then translate away.
    for (let i = 0; i < this.vehicle.fairingHalves.length; i++) {
      const half = this.vehicle.fairingHalves[i];
      const side = i % 2 === 0 ? 1 : -1;
      const t = d.fairing;
      half.rotation.z = side * t * 1.15;
      half.position.x = side * t * t * 26;
      half.position.y = -t * t * 8;
      half.visible = t < 0.995;
    }

    // Legs rotate down and lock.
    for (const pivot of this.vehicle.legPivots) {
      pivot.rotation.z = d.legs * 0.72;
    }

    // Solar wings unfold hinge by hinge, outboard panels trailing.
    const hinges = this.vehicle.panelHinges;
    for (let i = 0; i < hinges.length; i++) {
      // Stagger so the wing unrolls rather than snapping flat all at once.
      const stagger = clamp((d.panels - i * 0.12) / 0.6, 0, 1);
      const eased = stagger * stagger * (3 - 2 * stagger);
      hinges[i].rotation.z = lerp(Math.PI * 0.98, 0, eased);
    }

    // Antenna swings up from stowed and then holds its pointing.
    for (const pivot of this.vehicle.antennaPivots) {
      pivot.rotation.x = lerp(Math.PI * 0.48, 0, d.antenna);
    }

    // Parachute: reefed disc first, then full canopy.
    for (const canopy of this.vehicle.chuteCanopies) {
      if (d.chute <= 0.001) {
        canopy.visible = false;
        continue;
      }
      canopy.visible = true;
      // Reefed to about a third of diameter until 55 % of the sequence.
      const reefed = clamp(d.chute / 0.55, 0, 1);
      const full = clamp((d.chute - 0.55) / 0.45, 0, 1);
      const scale = lerp(0.05, 0.34, reefed) + lerp(0, 0.66, full);
      canopy.scale.setScalar(scale);
      // A little breathing so the canopy is alive rather than rigid.
      const breathe = 1 + Math.sin(this.missionTime * 3.1) * 0.03 * full;
      canopy.scale.multiplyScalar(breathe);
    }
  }

  // -------------------------------------------------------------------------
  // Debris
  // -------------------------------------------------------------------------

  private updateDebris(dt: number): void {
    for (const d of this.debris) {
      d.age += dt;
      // Jettisoned stages follow their own ballistic arc under gravity and drag.
      const alt = Math.max(d.position.y, 0);
      const g = EARTH.mu / Math.pow(EARTH.radius + alt, 2);
      d.velocity.y -= g * dt;
      d.position.addScaledVector(d.velocity, dt);

      d.group.position.copy(d.position);
      d.group.rotateX(d.angularVelocity.x * dt);
      d.group.rotateY(d.angularVelocity.y * dt);
      d.group.rotateZ(d.angularVelocity.z * dt);
    }

    // Retire debris only after it has been visible for a good while (spec §19).
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      if (d.age > 90 || d.position.y < -8_000) {
        d.group.removeFromParent();
        this.debris.splice(i, 1);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Outcomes
  // -------------------------------------------------------------------------

  private fail(code: string, title: string, explanation: string): void {
    if (this.state === MissionState.MISSION_FAILED) return;
    this.failure = { code, title, explanation };
    this.state = MissionState.MISSION_FAILED;
    for (const e of this.vehicle.engines) e.throttle = 0;
    this.shake = 0;
    this.emitOnce('mission-failed', { code });
  }

  private complete(): void {
    if (this.state === MissionState.MISSION_COMPLETE) return;
    this.state = MissionState.MISSION_COMPLETE;
    this.emitOnce('mission-complete');
  }

  /** The flight simulator currently in charge (Earth ascent or Mars descent). */
  activeFlight(): FlightSimulator {
    return this.marsFlight ?? this.flight;
  }

  /** True while the mission is on or around Mars. */
  atMars(): boolean {
    return (
      this.state === MissionState.MARS_APPROACH ||
      this.state === MissionState.ENTRY ||
      this.state === MissionState.DESCENT ||
      this.state === MissionState.LANDING ||
      this.state === MissionState.LANDED ||
      (this.state === MissionState.MISSION_COMPLETE && this.mission.requiresLanding) ||
      (this.state === MissionState.MISSION_FAILED && this.marsFlight !== null)
    );
  }

  touchdownVelocity(): number {
    return this.touchdownSpeed;
  }
}
