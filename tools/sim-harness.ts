/**
 * Headless mission harness.
 *
 * Flies every mission's reference design through the complete simulation with
 * no rendering, and reports the numbers that decide whether the design is
 * balanced: liftoff thrust-to-weight, per-stage delta-v, peak dynamic pressure
 * and acceleration, where staging happened, whether orbit was reached, and how
 * the Mars entry, descent and landing turned out.
 *
 * This is the balance-tuning loop. It runs in a browser because part models are
 * real three.js geometry built against a canvas, but nothing is drawn.
 */
import { MISSIONS } from '../src/data/missions';
import { MissionSim } from '../src/simulation/MissionSim';
import { Vehicle } from '../src/vehicles/Vehicle';
import { stageDeltaV } from '../src/simulation/SystemCheck';
import { MissionState } from '../src/data/constants';

interface Result {
  mission: string;
  deployables?: string;
  parts: number;
  height: number;
  massT: number;
  twr: number;
  stageDv: number[];
  totalDv: number;
  launchable: boolean;
  warnings: string[];
  events: string[];
  finalState: string;
  failure: string | null;
  peakQ: number;
  peakG: number;
  peakAlt: number;
  apoapsis: number;
  periapsis: number;
  simSeconds: number;
  touchdown: number;
  marsAlt: number;
  marsSpeed: number;
  marsHeat: number;
  chute: number;
  descentLog: string[];
}

function flyMission(missionId: string): Result {
  const mission = MISSIONS.find((m) => m.id === missionId)!;
  const vehicle = new Vehicle(mission.referenceDesign);
  const sim = new MissionSim(mission, vehicle, 8.6);

  const events: string[] = [];
  sim.on((e) => {
    if (e.type === 'countdown-tick') return;
    events.push(`${e.time.toFixed(1)}s ${e.type}`);
  });

  const mp = vehicle.massProperties();
  const dv = stageDeltaV(vehicle);

  // Deployable hardware the animation drives. A count of zero means the 3D
  // model exists but nothing will ever unhide it — invisible in a physics-only
  // run, and on screen a parachute that never appears.
  const deployables =
    `chutes ${vehicle.chuteCanopies.length} legs ${vehicle.legPivots.length} ` +
    `panels ${vehicle.panelHinges.length} fairings ${vehicle.fairingHalves.length}`;

  sim.beginCountdown(true);

  let peakQ = 0;
  let peakG = 0;
  let peakAlt = 0;
  const descentLog: string[] = [];
  let lastLog = Infinity;

  // Fly with a fixed wall-clock step. The simulation sub-steps internally, so
  // this only controls how fast the harness gets through the mission.
  const step = 1 / 30;
  let elapsed = 0;
  const limit = 60 * 60 * 2; // harness budget in simulated wall-clock seconds

  while (elapsed < limit && !sim.isFinished()) {
    // Warp hard through the phases where nothing needs fine resolution.
    sim.timeScale =
      sim.state === MissionState.TRANSFER
        ? 200_000
        : sim.state === MissionState.ORBIT
          ? 20
          : sim.state === MissionState.ASCENT
            ? 3
            : sim.state === MissionState.ENTRY
              ? 5
              : 1;

    sim.update(step);
    elapsed += step;

    // Sample the last kilometre of descent so the landing controller can be
    // debugged from the numbers rather than guessed at.
    if (sim.marsFlight) {
      const a = sim.marsFlight.altitude();
      // Canopy state while it should be flying the vehicle. Logged from the
      // real objects, so "the chute is not on screen" can be told apart from
      // "the chute is not where the camera is looking".
      if (a > 3000 && a < 11_000 && lastLog - a > 900) {
        lastLog = a;
        const c = sim.vehicle.chuteCanopies[0];
        descentLog.push(
          c
            ? `[chute] alt ${a.toFixed(0)}m deploy ${sim.deployment.chute.toFixed(2)} ` +
              `visible ${c.visible} scale ${c.scale.x.toFixed(3)} ` +
              `local y ${c.position.y.toFixed(2)} parentVisible ${c.parent?.visible}`
            : `[chute] alt ${a.toFixed(0)}m — no canopy object`,
        );
      }
      if (a < 2500 && (lastLog - a > 40 || a < 60)) {
        lastLog = a;
        const thr = sim.vehicle
          .activeEngines()
          .reduce((m, e) => Math.max(m, e.throttle), 0);
        const prop = sim.vehicle.tanks.reduce((x, t) => x + t.remaining, 0);
        descentLog.push(
          `[${sim.state}] alt ${a.toFixed(0)}m v ${sim.telemetry.airspeed.toFixed(1)} thr ${thr.toFixed(2)} ` +
            `T ${(sim.telemetry.thrust / 1000).toFixed(0)}kN m ${(sim.telemetry.massProperties.totalMass / 1000).toFixed(2)}t prop ${prop.toFixed(0)}kg`,
        );
      }
    }

    peakQ = Math.max(peakQ, sim.telemetry.dynamicPressure);
    peakG = Math.max(peakG, sim.telemetry.gForce);
    peakAlt = Math.max(peakAlt, sim.telemetry.altitude);
  }

  const firstStage = vehicle.stages.length > 0 ? vehicle.stages[0].index : 0;
  const twr =
    (vehicle.stageThrustSL(firstStage) / (mp.totalMass * 9.80665)) || 0;

  const result: Result = {
    mission: mission.name,
    deployables,
    parts: vehicle.parts.length,
    height: Number(vehicle.height.toFixed(1)),
    massT: Number((mp.totalMass / 1000).toFixed(1)),
    twr: Number(twr.toFixed(2)),
    stageDv: dv.map((x) => Math.round(x)),
    totalDv: Math.round(dv.reduce((a, b) => a + b, 0)),
    launchable: sim.analysis.launchable,
    warnings: sim.analysis.warnings.map((w) => `${w.severity}: ${w.code}`),
    events,
    finalState: sim.state,
    failure: sim.failure ? `${sim.failure.code} — ${sim.failure.title}` : null,
    peakQ: Math.round(peakQ),
    peakG: Number(peakG.toFixed(1)),
    peakAlt: Math.round(peakAlt),
    apoapsis: Math.round(sim.telemetry.apoapsis),
    periapsis: Math.round(sim.telemetry.periapsis),
    simSeconds: Math.round(sim.missionTime),
    touchdown: Number(sim.touchdownVelocity().toFixed(2)),
    marsAlt: sim.marsFlight ? Math.round(sim.marsFlight.altitude()) : -1,
    marsSpeed: sim.marsFlight ? Math.round(sim.telemetry.airspeed) : -1,
    marsHeat: sim.marsFlight ? Math.round(sim.marsFlight.state.heatLoad / 1e6) : -1,
    chute: Number(sim.deployment.chute.toFixed(2)),
    descentLog,
  };

  vehicle.dispose();
  return result;
}

const results: Result[] = [];
for (const m of MISSIONS) {
  try {
    results.push(flyMission(m.id));
  } catch (err) {
    results.push({
      mission: m.name,
      parts: 0,
      height: 0,
      massT: 0,
      twr: 0,
      stageDv: [],
      totalDv: 0,
      launchable: false,
      warnings: [`threw: ${String(err)}`],
      events: [],
      finalState: 'THREW',
      failure: String(err),
      peakQ: 0,
      peakG: 0,
      peakAlt: 0,
      apoapsis: 0,
      periapsis: 0,
      simSeconds: 0,
      touchdown: 0,
      marsAlt: -1,
      marsSpeed: -1,
      marsHeat: -1,
      chute: 0,
      descentLog: [],
    });
  }
}

document.getElementById('out')!.textContent = JSON.stringify(results, null, 2);
(window as unknown as { harnessResults: Result[] }).harnessResults = results;
(window as unknown as { harnessDone: boolean }).harnessDone = true;
