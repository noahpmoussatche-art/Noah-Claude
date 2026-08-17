/**
 * Scripted cinematic sequences (spec §25, §26, §33, §38, §65).
 *
 * The opening sequence exists to fix the prototype's two worst problems at
 * once: the ducks were absent from the cinematic, and the launch had no sense
 * of scale or force. So the sequence opens on the spaceport at dawn, walks both
 * characters into frame at the foot of a 55 m vehicle, plays their reaction in
 * over-the-shoulder coverage, and only then cuts low and tight for ignition.
 *
 * Nothing here fakes the vehicle. The countdown, ignition ramp, hold-down
 * release and liftoff all come from the simulation; the timeline is choosing
 * where the camera is when they happen.
 */
import * as THREE from 'three';
import type { MissionScene } from '../scenes/MissionScene';
import type { AudioEngine } from '../audio/AudioEngine';
import {
  CameraDirector,
  closeUpShot,
  craneShot,
  groundCameraShot,
  lowAngleShot,
  onboardShot,
  orbitShot,
  overShoulderShot,
  trackingShot,
} from './CameraDirector';
import { Timeline, type DialogueLine } from './Timeline';
import { MARS, MissionState, SPACE_VIEW_SCALE } from '../data/constants';
import { clamp } from '../utils/math';

export interface CinematicContext {
  readonly scene: MissionScene;
  readonly director: CameraDirector;
  readonly audio: AudioEngine;
  /** Shows a subtitle line. Text is secondary to the image (spec §27). */
  readonly say: (line: DialogueLine) => void;
  /** Shows a small corner slate, e.g. "ORBITAL SPACE AGENCY · PAD 1". */
  readonly slate: (title: string, subtitle?: string) => void;
  /** Fades the screen. 1 = black, 0 = clear. */
  readonly fade: (to: number, seconds: number) => void;
  /** Enables or disables the cinematic UI mode (spec §62, §63). */
  readonly setCinematicMode: (on: boolean) => void;
  /**
   * Starts the terminal count. The sequence calls this itself rather than the
   * game starting it on a wall-clock timer: tying it to the timeline is what
   * keeps ignition and liftoff landing on their intended beats on a slow
   * machine as well as a fast one.
   */
  readonly startCountdown: () => void;
}

/**
 * The first-launch sequence. Roughly 34 seconds of coverage ending at liftoff,
 * running in parallel with the real countdown.
 */
export function createFirstLaunchCinematic(ctx: CinematicContext): Timeline {
  const { scene, director, audio, say, slate, fade, setCinematicMode, startCountdown } =
    ctx;
  const tl = new Timeline();

  const pad = scene.complex.padCentre;
  const vehicleHeight = scene.sim.vehicle.height;
  const { engineer, pilot } = scene.crew;

  // Subjects the camera can frame.
  const vehicleMid = (): THREE.Vector3 => scene.vehicleMidpoint(new THREE.Vector3());
  const vehicleBase = (): THREE.Vector3 => scene.vehicleBase(new THREE.Vector3());
  const engineerPos = (): THREE.Vector3 =>
    engineer.object.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.42, 0));
  const pilotPos = (): THREE.Vector3 =>
    pilot.object.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.42, 0));
  const crewMid = (): THREE.Vector3 =>
    engineerPos().add(pilotPos()).multiplyScalar(0.5);

  // Where the ducks start and where they walk to.
  //
  // Two constraints set these. A duck walks at about a metre a second and the
  // walk has six seconds of screen time, so it covers six metres — set further
  // out, the crew were still forty metres from the vehicle when the shot that
  // is supposed to sell its scale came up. And every mark has to be on the pad
  // deck, which is an octagon thirty metres across at eight and a half metres
  // up: a mark outside it left the ducks walking through mid-air.
  const inward = new THREE.Vector3(0.588, 0, 0.809);
  const across = new THREE.Vector3(0.809, 0, -0.588);
  const deckMark = (radius: number, side: number): THREE.Vector3 =>
    inward.clone().multiplyScalar(radius).addScaledVector(across, side).setY(pad.y);

  const startA = deckMark(26, 0);
  const startB = deckMark(26, 3);
  const markA = deckMark(20, 0);
  const markB = deckMark(20, 3);

  // ---- 0s: black, then fade up on the spaceport at dawn ----
  tl.at(0, () => {
    setCinematicMode(true);
    fade(1, 0);

    engineer.placeAt(startA.x, startA.y, startA.z, Math.PI * 0.85);
    pilot.placeAt(startB.x, startB.y, startB.z, Math.PI * 0.85);
    engineer.setPose('idle');
    pilot.setPose('idle');

    // Establishing wide: the whole complex, sun low, vehicle small in frame.
    director.play(
      craneShot(() => pad.clone(), {
        startOffset: new THREE.Vector3(210, 54, 235),
        endOffset: new THREE.Vector3(150, 40, 175),
        duration: 9,
        fov: 42,
        blend: 0,
        lookHeight: vehicleHeight * 0.4,
      }),
    );
    audio.setAmbience('pad');
  });

  tl.at(0.4, () => {
    fade(0, 3.2);
    slate('ORBITAL SPACE AGENCY', 'LAUNCH COMPLEX 1 · 05:41 LOCAL');
  });

  // ---- 5s: the crew arrive and start walking toward the pad ----
  tl.at(5, () => {
    engineer.walkTo(markA);
    pilot.walkTo(markB);
    engineer.lookAt(vehicleMid());
    pilot.lookAt(vehicleMid());
  });

  // Tracking shot alongside the walking ducks — low, at their eye height, so
  // the vehicle towers behind them.
  tl.at(6.5, () => {
    director.play(
      trackingShot(crewMid, new THREE.Vector3(7.5, 0.35, 7.5), {
        fov: 38,
        blend: 1.2,
        stiffness: 2.6,
      }),
    );
  }, true);

  tl.at(8.5, () => {
    say({ speaker: 'MAVIS', text: 'It is much bigger up close.', duration: 2.6 });
    audio.quack('pilot');
    pilot.speak(2.4);
  });

  // ---- 11s: they arrive; the scale shot ----
  tl.at(11.2, () => {
    engineer.stopWalking();
    pilot.stopWalking();
    engineer.faceToward(pad);
    pilot.faceToward(pad);
    engineer.setPose('inspect');
    pilot.setPose('look-up');
    pilot.lookAt(new THREE.Vector3(pad.x, pad.y + vehicleHeight * 0.95, pad.z));
  });

  // Over-the-shoulder from behind the pilot: the duck in the foreground, the
  // vehicle filling the frame behind. This is the shot that sells the scale.
  tl.at(11.6, () => {
    director.play(
      // The look-at sits low on the vehicle and the lens is wide, which is what
      // keeps the duck in frame at all: a camera three metres behind a
      // half-metre character cannot tilt up to a fifty-eight metre nose and
      // still hold the character. The vehicle running out of the top of the
      // frame is the point of the shot.
      overShoulderShot(pilotPos, () => new THREE.Vector3(pad.x, pad.y + 7, pad.z), {
        back: 3.0,
        up: 0.35,
        side: 1.1,
        fov: 60,
        blend: 1.0,
      }),
    );
  }, true);

  tl.at(13.4, () => {
    say({ speaker: 'QUILL', text: 'Fifty-five metres. Four hundred tonnes fuelled.', duration: 3 });
    audio.quack('engineer');
    engineer.speak(2.8);
  });

  tl.at(16.6, () => {
    pilot.setPose('point');
    say({ speaker: 'MAVIS', text: 'And we built it.', duration: 2.2 });
    audio.quack('pilot');
    pilot.speak(1.9);
  });

  // ---- 19s: tilt up the vehicle from the ducks' feet to the nose ----
  tl.at(19, () => {
    director.play({
      kind: 'low-angle',
      target: vehicleMid,
      fov: 30,
      blend: 1.1,
      duration: 6,
      stiffness: 4,
      handheld: 0.5,
      position: () => new THREE.Vector3(pad.x + 21, pad.y + 1.1, pad.z + 15),
      // The look-at climbs the vehicle over the shot: a real tilt-up.
      lookAt: (t: number) => {
        const k = Math.min(t / 5, 1);
        return new THREE.Vector3(pad.x, pad.y + 2 + k * vehicleHeight * 0.98, pad.z);
      },
    });
  }, true);

  // ---- 21s: systems come alive and the terminal count begins ----
  tl.at(21, () => {
    startCountdown();
    slate('SYSTEMS ARMED', 'TERMINAL COUNT');
    audio.commsChirp();
    say({ speaker: 'CONTROL', text: 'Terminal count. All stations go for launch.', duration: 3 });
  });

  tl.at(23.5, () => {
    engineer.setPose('idle');
    engineer.lookAt(vehicleMid());
    pilot.setPose('idle');
    pilot.lookAt(vehicleMid());
  });

  // ---- 24s: cut low and tight on the engines ----
  tl.at(24, () => {
    director.play(
      // Close, but outside the volume the pad cloud fills — a camera buried in
      // the exhaust sees nothing but white.
      lowAngleShot(vehicleBase, {
        distance: 44,
        height: 12,
        azimuth: 2.3,
        fov: 30,
        lookHeight: 9,
        blend: 0.35,
      }),
    );
  }, true);

  // ---- 27s: ignition. The sim is already ramping the engines here ----
  tl.at(27.2, () => {
    slate('IGNITION', '');
  });

  // ---- 29s: pull back to a low wide that holds the whole vehicle and the pad
  //      cloud, so the liftoff reads at full scale ----
  tl.at(29.4, () => {
    director.play(
      lowAngleShot(() => new THREE.Vector3(pad.x, pad.y, pad.z), {
        distance: 62,
        height: 14,
        azimuth: 2.1,
        fov: 44,
        lookHeight: vehicleHeight * 0.45,
        blend: 0.6,
      }),
    );
  }, true);

  // ---- 30.5s: the ducks react to the light and the noise ----
  tl.at(30.6, () => {
    pilot.setPose('flinch');
    engineer.setPose('flinch');
  }, true);

  tl.at(31.4, () => {
    pilot.setPose('cheer');
    engineer.setPose('look-up');
    audio.quack('pilot');
  }, true);

  // ---- 32s: hand over to live launch coverage ----
  tl.at(32.5, () => {
    slate('LIFTOFF', '');
    setCinematicMode(false);
  });

  return tl;
}

/**
 * Live launch coverage. Rather than a fixed timeline this reacts to mission
 * events, so the cut list follows what the vehicle actually does — if staging
 * happens late because the vehicle is heavy, the camera cuts late too.
 */
export interface CoverageHandle {
  /** Call each frame so periodic re-framing can run. */
  readonly tick: (dt: number) => void;
  /** Stops listening for mission events. */
  readonly stop: () => void;
}

export function attachAscentCoverage(ctx: CinematicContext): CoverageHandle {
  const { scene, director, audio, slate } = ctx;
  const sim = scene.sim;
  const pad = scene.complex.padCentre;

  const vehicle = (): THREE.Vector3 => scene.vehiclePosition(new THREE.Vector3());
  const vehicleMid = (): THREE.Vector3 => scene.vehicleMidpoint(new THREE.Vector3());

  // A ground camera at the perimeter, on a long lens, that stays put while the
  // vehicle climbs away — the classic pad-cam.
  const groundCam = new THREE.Vector3(pad.x + 130, 6, pad.z + 110);

  let coverageTimer = 0;
  let shotIndex = 0;
  let lastCutAltitude = 0;

  const unsubscribe = sim.on((e) => {
    switch (e.type) {
      case 'liftoff':
        audio.ignition();
        director.play(
          lowAngleShot(vehicle, {
            distance: 58,
            height: 14,
            azimuth: 2.1,
            fov: 46,
            lookHeight: 22,
            blend: 0.5,
          }),
        );
        break;

      case 'tower-clear':
        slate('TOWER CLEAR', '');
        audio.commsChirp();
        director.play(
          groundCameraShot(groundCam, vehicleMid, { fov: 20, blend: 0.9 }),
        );
        break;

      case 'max-q':
        slate('MAX Q', `${Math.round(Number(e.data?.q ?? 0) / 1000)} kPa`);
        audio.commsChirp();
        // Onboard camera looking back down the vehicle at max dynamic pressure.
        director.play(
          onboardShot(
            () => scene.vehicleMount(),
            new THREE.Vector3(scene.sim.vehicle.maxDiameter * 0.9, 6, 0),
            new THREE.Vector3(-0.35, -1, 0),
            { fov: 68, blend: 0.7 },
          ),
        );
        break;

      case 'meco':
        slate('MECO', 'MAIN ENGINE CUTOFF');
        audio.commsChirp();
        break;

      case 'stage-separation':
        audio.separation();
        // Onboard camera watching the booster fall away (spec §19).
        director.play(
          onboardShot(
            () => scene.vehicleMount(),
            new THREE.Vector3(scene.sim.vehicle.maxDiameter * 1.1, 2, 0),
            new THREE.Vector3(-0.4, -1, 0),
            { fov: 72, blend: 0.25 },
          ),
        );
        slate('STAGE SEPARATION', '');
        break;

      case 'stage-ignition':
        audio.ignition();
        director.play(
          trackingShot(vehicleMid, new THREE.Vector3(26, 6, 30), {
            fov: 34,
            blend: 0.8,
            stiffness: 2.2,
          }),
        );
        break;

      case 'fairing-jettison':
        audio.fairingJettison();
        slate('FAIRING JETTISON', '');
        director.play(
          trackingShot(vehicleMid, new THREE.Vector3(14, 3, 16), {
            fov: 40,
            blend: 0.6,
            stiffness: 3,
          }),
        );
        break;

      case 'seco':
        slate('SECO', 'SECOND ENGINE CUTOFF');
        audio.commsChirp();
        break;

      case 'orbit-achieved': {
        audio.success();
        const apo = Math.round(Number(e.data?.apoapsis ?? 0) / 1000);
        const peri = Math.round(Number(e.data?.periapsis ?? 0) / 1000);
        slate('ORBIT', `${peri} × ${apo} km`);
        // Slow hero orbit around the vehicle against the Earth limb.
        director.play(
          orbitShot(vehicleMid, {
            distance: scene.sim.vehicle.height * 1.5,
            height: scene.sim.vehicle.height * 0.35,
            angularSpeed: 0.08,
            fov: 38,
            blend: 1.6,
          }),
        );
        scene.crew.pilot.setPose('cheer');
        scene.crew.engineer.setPose('cheer');
        break;
      }

      case 'payload-separation':
        audio.separation();
        slate('PAYLOAD SEPARATION', '');
        break;

      case 'panels-deployed':
        audio.servo(2.5);
        slate('ARRAYS DEPLOYED', '');
        break;

      case 'antenna-deployed':
        audio.servo(1.8);
        slate('HIGH-GAIN DEPLOYED', '');
        break;

      case 'transfer-burn':
        audio.ignition();
        slate('MARS INJECTION BURN', '');
        break;

      case 'cruise-begin': {
        // The cruise is a map view spanning two planetary orbits, so the camera
        // has to pull back by eight orders of magnitude and the clip range has
        // to follow it.
        const fov = 44;
        // Stand back far enough to hold Mars's whole orbit. Looking down from
        // 36 degrees above the ecliptic the orbits project as ellipses squashed
        // by the sine of that angle, and it is that squashed height the frame
        // has to contain — with margin, because the near half of an orbit is
        // closer to the camera and therefore drawn larger.
        const elevation = 0.63;
        // The 1.6 is not slack: the near half of the orbit sits closer to the
        // camera than the projection's sine term assumes and lands lower in
        // frame than the far half. Measured against the rendered map, not
        // guessed — at 1.45 the near limb of Mars's orbit fell clean out of frame,
        // and at 1.6 the planet itself sat on the bottom edge.
        const halfHeight = MARS.orbitRadius * SPACE_VIEW_SCALE * Math.sin(elevation) * 1.75;
        const distance = halfHeight / Math.tan(THREE.MathUtils.degToRad(fov / 2));
        director.setClipRange(distance * 0.01, distance * 20);
        director.play({
          kind: 'orbital',
          target: () => new THREE.Vector3(0, 0, 0),
          fov,
          blend: 3,
          stiffness: 0.9,
          handheld: 0.05,
          position: (t: number) => {
            // A very slow drift around the system, so the map is never static.
            const a = 0.7 + t * 0.012;
            const ground = distance * Math.cos(elevation);
            return new THREE.Vector3(
              Math.sin(a) * ground,
              distance * Math.sin(elevation),
              Math.cos(a) * ground,
            );
          },
        });
        slate('TRANS-MARS INJECTION', 'CRUISE · 258 DAYS');
        break;
      }

      default:
        break;
    }
  });

  // A periodic re-frame during the long ascent, so a single shot never sits
  // unchanged for minutes (spec §28: during launch, the camera should change).
  const tick = (dt: number): void => {
    if (sim.state !== MissionState.ASCENT) return;
    const alt = sim.telemetry.altitude;

    // Re-frame on wall-clock time *or* on progress up the trajectory, whichever
    // comes first. Wall clock alone is not enough: under time warp the vehicle
    // can go from the tower to orbit inside a couple of real seconds, and a
    // cadence measured in real seconds would leave a fixed pad camera pointed at
    // a two-pixel dot ten kilometres up for the whole climb.
    coverageTimer += dt;
    const climbed = alt > lastCutAltitude * 2.4 + 1_200;
    if (coverageTimer < 6 && !climbed) return;
    coverageTimer = 0;
    lastCutAltitude = alt;
    shotIndex++;

    const spread = 18 + alt * 0.0009;

    switch (shotIndex % 3) {
      case 0:
        director.play(
          trackingShot(vehicleMid, new THREE.Vector3(spread, spread * 0.3, spread), {
            fov: 36,
            blend: 1.4,
            stiffness: 2,
          }),
        );
        break;
      case 1:
        director.play(
          onboardShot(
            () => scene.vehicleMount(),
            new THREE.Vector3(scene.sim.vehicle.maxDiameter * 0.85, 10, 0),
            new THREE.Vector3(-0.3, -1, 0),
            { fov: 66, blend: 1.2 },
          ),
        );
        break;
      default:
        director.play(
          trackingShot(vehicleMid, new THREE.Vector3(-spread * 0.7, spread * 0.5, spread * 1.2), {
            fov: 32,
            blend: 1.4,
            stiffness: 2,
          }),
        );
        break;
    }
  };

  return { tick, stop: unsubscribe };
}

/**
 * Mars arrival, entry, descent and landing coverage (spec §33–§38, §65).
 *
 * Again event-driven: the parachute shot fires when the parachute actually
 * deploys, which depends on the vehicle reaching the right Mach number at the
 * right altitude.
 */
export function attachMarsCoverage(ctx: CinematicContext): () => void {
  const { scene, director, audio, say, slate, setCinematicMode } = ctx;
  const sim = scene.sim;

  const vehicle = (): THREE.Vector3 => scene.vehiclePosition(new THREE.Vector3());
  const vehicleMid = (): THREE.Vector3 => scene.vehicleMidpoint(new THREE.Vector3());

  const unsubscribe = sim.on((e) => {
    switch (e.type) {
      case 'mars-approach':
        setCinematicMode(true);
        audio.setAmbience('mars');
        // Back to metre scale for the arrival.
        director.setClipRange(0.4, 4_000_000);
        slate('MARS ARRIVAL', 'ENTRY INTERFACE IN 00:40');
        // Wide shot with the planet filling frame behind the vehicle (spec §33).
        director.play(
          trackingShot(vehicleMid, new THREE.Vector3(26, 10, 34), {
            fov: 42,
            blend: 2.2,
            stiffness: 1.6,
          }),
        );
        break;

      case 'entry-interface':
        slate('ENTRY INTERFACE', `${Math.round(Number(e.data?.speed ?? 0))} m/s`);
        audio.commsChirp();
        // Trailing shot down the wake, so the plasma is between camera and ship.
        director.play(
          // Close enough that a four-metre aeroshell reads as a vehicle: at the
          // old sixty-odd metres it was a speck with a glow around it.
          trackingShot(vehicle, new THREE.Vector3(4, 9, 22), {
            fov: 38,
            blend: 1.4,
            stiffness: 1.9,
          }),
        );
        break;

      case 'peak-heating':
        slate('PEAK HEATING', '');
        say({ speaker: 'QUILL', text: 'Shield is holding.', duration: 2.4 });
        scene.crew.engineer.speak(2.2);
        // Close on the heat shield, plasma washing over the camera.
        director.play(
          closeUpShot(vehicle, new THREE.Vector3(16, 4, 20), { fov: 30, blend: 1.1 }),
        );
        break;

      case 'chute-deploy':
        audio.chuteDeploy();
        slate('PARACHUTE DEPLOY', '');
        // Pull back so the canopy has room to inflate in frame (spec §35), and
        // sit above the vehicle looking down, so Mars is underneath it rather
        // than off-camera — the shot has to say "descending toward a planet".
        director.play(
          trackingShot(vehicleMid, new THREE.Vector3(36, 30, 44), {
            fov: 46,
            blend: 0.5,
            stiffness: 2.6,
          }),
        );
        break;

      case 'chute-full':
        slate('CANOPY FULL', '');
        break;

      case 'heatshield-jettison':
        audio.separation();
        slate('HEAT SHIELD JETTISON', '');
        break;

      case 'landing-burn':
        audio.ignition();
        slate('POWERED DESCENT', '');
        // From the surface, watching the lander come down on its engine — the
        // shot that makes the landing feel like a landing.
        //
        // The burn starts around 900 m up, so a camera parked 30 m from the
        // touchdown point would spend the whole descent pointing at empty sky.
        // Instead it stands back roughly as far as the lander is high, which
        // keeps the vehicle and the horizon in the same frame the whole way
        // down, and closes to a low hero angle as the lander arrives.
        director.play({
          kind: 'ground',
          target: vehicle,
          fov: 36,
          blend: 1.0,
          stiffness: 2.2,
          handheld: 0.7,
          position: () => {
            const v = vehicle();
            const alt = Math.max(sim.marsFlight?.altitude() ?? 0, 0);
            const back = clamp(alt * 0.95, 38, 900);
            const x = v.x + back * 0.78;
            const z = v.z + back * 0.62;
            return new THREE.Vector3(x, scene.groundHeightAt(x, z) + 2.4 + alt * 0.06, z);
          },
        });
        break;

      case 'legs-deploy':
        audio.servo(2.2);
        slate('GEAR DOWN', '');
        break;

      case 'touchdown': {
        const speed = Number(e.data?.speed ?? 0);
        audio.touchdown(speed > 3);
        slate('TOUCHDOWN', `${speed.toFixed(1)} m/s`);
        break;
      }

      case 'dust-settled':
        // Silence, dust settling, the vehicle standing on Mars (spec §38).
        say({ speaker: null, text: '', duration: 0.1 });
        director.play(
          orbitShot(vehicleMid, {
            distance: 26,
            height: 7,
            angularSpeed: 0.11,
            fov: 36,
            blend: 3.2,
          }),
        );
        scene.crew.engineer.setPose('cheer');
        scene.crew.pilot.setPose('cheer');
        break;

      case 'mission-complete':
        audio.success();
        setCinematicMode(true);
        slate('MISSION COMPLETE', '');
        // Final wide: the lander small against the Martian horizon.
        director.play({
          kind: 'wide',
          target: vehicleMid,
          fov: 30,
          blend: 3.5,
          stiffness: 1.1,
          handheld: 0.12,
          position: () => {
            const v = vehicle();
            return new THREE.Vector3(
              v.x + 78,
              scene.groundHeightAt(v.x + 78, v.z + 54) + 12,
              v.z + 54,
            );
          },
        });
        break;

      case 'mission-failed':
        audio.alarm();
        audio.failure();
        setCinematicMode(false);
        break;

      default:
        break;
    }
  });

  return unsubscribe;
}
