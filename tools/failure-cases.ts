/**
 * Failure-case verification (spec §52, §69).
 *
 * The spec is explicit that a badly-built vehicle must behave badly: an
 * underpowered rocket should not leave the pad, one short on propellant should
 * fail during the mission, and an unstable one should lose control. These are
 * not scripted outcomes — each design below is flown through the same physics
 * as the reference vehicles, and the failure has to emerge from it.
 */
import { MISSIONS } from '../src/data/missions';
import { MissionSim } from '../src/simulation/MissionSim';
import { Vehicle } from '../src/vehicles/Vehicle';
import { MissionState } from '../src/data/constants';
import type { VehicleDesign } from '../src/vehicles/VehicleDesign';

interface Case {
  name: string;
  expectation: string;
  design: VehicleDesign;
}

const CASES: Case[] = [
  {
    name: 'Underpowered — huge tank, one small engine',
    expectation: 'must not leave the pad (TWR < 1)',
    design: {
      name: 'Leadfoot',
      stack: [
        { partId: 'eng-spark1', stage: 0 },
        { partId: 'tank-37-l', stage: 0 },
        { partId: 'avionics-37', stage: 0, radial: [{ partId: 'battery-pack', count: 1, heightFraction: 0.5 }] },
        { partId: 'antenna-whip', stage: 0 },
      ],
    },
  },
  {
    name: 'Insufficient propellant — big engines, tiny tank',
    expectation: 'must fail before orbit',
    design: {
      name: 'Sprinter',
      stack: [
        { partId: 'eng-vulcan9-x9', stage: 0 },
        { partId: 'tank-15-s', stage: 0 },
        { partId: 'avionics-24', stage: 0, radial: [{ partId: 'battery-pack', count: 1, heightFraction: 0.5 }] },
        { partId: 'antenna-whip', stage: 0 },
      ],
    },
  },
  {
    name: 'Aerodynamically unstable — nose-heavy drag, no fins, no gimbal',
    expectation: 'must lose control or fail to reach orbit',
    design: {
      name: 'Weathervane',
      stack: [
        // Plenty of thrust, so the failure mode on show is the instability
        // rather than simply not lifting.
        { partId: 'eng-vulcan9-x9', stage: 0 },
        { partId: 'tank-37-m', stage: 0 },
        { partId: 'heatshield-37', stage: 0 },
        { partId: 'avionics-37', stage: 0, radial: [{ partId: 'battery-pack', count: 1, heightFraction: 0.5 }] },
        { partId: 'antenna-whip', stage: 0 },
      ],
    },
  },
  {
    name: 'Chaos payload — refrigerators bolted to the outside',
    expectation: 'flies measurably worse than the clean vehicle',
    design: {
      name: 'Whitegoods Express',
      stack: [
        { partId: 'eng-vulcan9-x9', stage: 0 },
        {
          partId: 'tank-37-l',
          stage: 0,
          radial: [
            { partId: 'chaos-fridge', count: 8, heightFraction: 0.5 },
            { partId: 'chaos-couch', count: 4, heightFraction: 0.75 },
            { partId: 'fin-aero', count: 4, heightFraction: 0.06 },
          ],
        },
        { partId: 'interstage-37', stage: 0 },
        { partId: 'decoupler-37', stage: 0 },
        { partId: 'eng-vulcan-vac', stage: 1 },
        { partId: 'tank-37-s', stage: 1 },
        {
          partId: 'avionics-37',
          stage: 1,
          radial: [
            { partId: 'battery-pack', count: 2, heightFraction: 0.5 },
            { partId: 'antenna-whip', count: 1, heightFraction: 0.85 },
          ],
        },
      ],
    },
  },
  {
    name: 'Mars mission with no heat shield and no dish',
    expectation: 'pre-flight check must refuse it',
    design: {
      name: 'Optimist',
      stack: [
        { partId: 'eng-vulcan9-x9', stage: 0 },
        { partId: 'tank-37-l', stage: 0, radial: [{ partId: 'fin-aero', count: 4, heightFraction: 0.06 }] },
        { partId: 'decoupler-37', stage: 0 },
        { partId: 'eng-vulcan-vac', stage: 1 },
        { partId: 'tank-37-s', stage: 1 },
        {
          partId: 'avionics-37',
          stage: 1,
          radial: [
            { partId: 'battery-pack', count: 1, heightFraction: 0.5 },
            { partId: 'antenna-whip', count: 1, heightFraction: 0.85 },
          ],
        },
        { partId: 'rover-chassis', stage: 2 },
      ],
    },
  },
];

interface CaseResult {
  name: string;
  expectation: string;
  twr: number;
  totalMassT: number;
  staticMargin: number;
  launchable: boolean;
  warnings: string[];
  finalState: string;
  failure: string | null;
  peakAlt: number;
  periapsis: number;
}

function fly(c: Case, missionId: string): CaseResult {
  const mission = MISSIONS.find((m) => m.id === missionId)!;
  const vehicle = new Vehicle(c.design);
  const sim = new MissionSim(mission, vehicle, 8.6);

  const mp = vehicle.massProperties();
  const twr = vehicle.stageThrustSL(0) / (mp.totalMass * 9.80665);

  // Force the launch even when the checks say no — the point is to observe what
  // the physics does to a bad design, not to be protected from it.
  sim.beginCountdown(true);

  let peakAlt = 0;
  const step = 1 / 30;
  let elapsed = 0;
  while (elapsed < 1800 && !sim.isFinished()) {
    sim.timeScale = sim.state === MissionState.ASCENT ? 4 : 1;
    sim.update(step);
    elapsed += step;
    peakAlt = Math.max(peakAlt, sim.telemetry.altitude);
  }

  const out: CaseResult = {
    name: c.name,
    expectation: c.expectation,
    twr: Number(twr.toFixed(2)),
    totalMassT: Number((mp.totalMass / 1000).toFixed(1)),
    staticMargin: Number(mp.staticMargin.toFixed(2)),
    launchable: sim.analysis.launchable,
    warnings: sim.analysis.warnings.map((w) => `${w.severity}:${w.code}`),
    finalState: sim.state,
    failure: sim.failure ? `${sim.failure.code} — ${sim.failure.title}` : null,
    peakAlt: Math.round(peakAlt),
    periapsis: Math.round(sim.telemetry.periapsis),
  };
  vehicle.dispose();
  return out;
}

const results: CaseResult[] = [];
for (const c of CASES) {
  const missionId = c.name.includes('Mars') ? 'mars-landing' : 'first-flight';
  try {
    results.push(fly(c, missionId));
  } catch (err) {
    results.push({
      name: c.name,
      expectation: c.expectation,
      twr: 0,
      totalMassT: 0,
      staticMargin: 0,
      launchable: false,
      warnings: [`threw: ${String(err)}`],
      finalState: 'THREW',
      failure: String(err),
      peakAlt: 0,
      periapsis: 0,
    });
  }
}

document.getElementById('out')!.textContent = JSON.stringify(results, null, 2);
(window as unknown as { failureResults: CaseResult[] }).failureResults = results;
(window as unknown as { failureDone: boolean }).failureDone = true;
