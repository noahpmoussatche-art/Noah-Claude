/**
 * Pre-flight diagnostics (spec §53, §54).
 *
 * Every check here is derived from the same numbers the physics uses, so a
 * "LOW THRUST" warning is a genuine prediction that the vehicle will not fly,
 * not a cosmetic label. The checks are also the game's teaching surface: each
 * one explains the engineering reason it failed.
 */
import type { PlanetConstants } from '../data/constants';
import { G0_ISP } from '../data/constants';
import type { Vehicle } from '../vehicles/Vehicle';
import { PartCategory } from '../parts/PartDef';

export type CheckStatus = 'nominal' | 'caution' | 'fail';

export interface SubsystemReport {
  readonly system:
    | 'STRUCTURE'
    | 'PROPULSION'
    | 'FUEL'
    | 'POWER'
    | 'AVIONICS'
    | 'COMMUNICATION'
    | 'THERMAL'
    | 'LANDING'
    | 'PAYLOAD';
  readonly status: CheckStatus;
  /** Short line shown next to the system name. */
  readonly summary: string;
  /** Longer explanation of the physics behind the verdict. */
  readonly detail: string;
}

export interface Warning {
  readonly code: string;
  readonly severity: 'caution' | 'fail';
  readonly message: string;
}

export interface VehicleAnalysis {
  readonly reports: readonly SubsystemReport[];
  readonly warnings: readonly Warning[];
  /** Liftoff thrust-to-weight ratio at the launch planet. */
  readonly liftoffTWR: number;
  /** Total ideal delta-v across all stages, m/s. */
  readonly totalDeltaV: number;
  /** Per-stage ideal delta-v, m/s. */
  readonly stageDeltaV: readonly number[];
  readonly totalMass: number;
  readonly staticMargin: number;
  /** True when nothing is in a hard-fail state. */
  readonly launchable: boolean;
}

/** Axial acceleration at liftoff, m/s^2. */
const liftoftAccelOf = (thrust: number, mass: number): number =>
  mass > 0 ? thrust / mass : 0;

/** Delta-v needed to reach a low orbit of the given planet, m/s (rough budget). */
export function orbitBudget(planet: PlanetConstants): number {
  // Circular velocity at 200 km plus gravity and drag losses.
  const alt = 200_000;
  const vCirc = Math.sqrt(planet.mu / (planet.radius + alt));
  const losses = planet.name === 'Mars' ? 700 : 1_800;
  return vCirc + losses;
}

/**
 * Ideal delta-v of each stage by the rocket equation, accounting for the mass of
 * every stage still attached above it.
 */
export function stageDeltaV(vehicle: Vehicle): number[] {
  const stages = [...vehicle.stages].sort((a, b) => a.index - b.index);
  const out: number[] = [];

  // Mass of each stage: its dry parts plus its propellant.
  const stageDry = new Map<number, number>();
  const stageProp = new Map<number, number>();
  for (const s of stages) {
    let dry = 0;
    for (const p of s.parts) dry += p.def.mass;
    stageDry.set(s.index, dry);
    stageProp.set(s.index, vehicle.capacityInStage(s.index));
  }

  for (let i = 0; i < stages.length; i++) {
    const s = stages[i];
    const isp = vehicle.stageIspVac(s.index);
    const prop = stageProp.get(s.index) ?? 0;

    if (isp <= 0 || prop <= 0) {
      out.push(0);
      continue;
    }

    // Everything from this stage upward is being accelerated.
    let above = 0;
    for (let j = i + 1; j < stages.length; j++) {
      above += (stageDry.get(stages[j].index) ?? 0) + (stageProp.get(stages[j].index) ?? 0);
    }

    const m0 = above + (stageDry.get(s.index) ?? 0) + prop;
    const m1 = above + (stageDry.get(s.index) ?? 0);
    out.push(m1 > 0 ? isp * G0_ISP * Math.log(m0 / m1) : 0);
  }

  return out;
}

/** Runs the complete pre-flight analysis. */
export function analyseVehicle(
  vehicle: Vehicle,
  planet: PlanetConstants,
  requiresLanding: boolean,
  requiresDeepSpaceComms: boolean,
): VehicleAnalysis {
  const reports: SubsystemReport[] = [];
  const warnings: Warning[] = [];

  const mp = vehicle.massProperties();
  const firstStage = vehicle.stages.length > 0 ? vehicle.stages[0].index : 0;
  const liftoffThrust = vehicle.stageThrustSL(firstStage);
  const weight = mp.totalMass * planet.g0;
  const twr = weight > 0 ? liftoffThrust / weight : 0;

  const dv = stageDeltaV(vehicle);
  const totalDv = dv.reduce((a, b) => a + b, 0);
  const budget = orbitBudget(planet);

  // ---- STRUCTURE ----
  {
    const parts = vehicle.activeParts();
    const slenderness = vehicle.height / Math.max(vehicle.maxDiameter, 0.1);

    // Peak axial acceleration the vehicle will actually see. The guidance
    // limits sustained load to about 4 g, so the sizing case is the greater of
    // liftoff acceleration and that limit.
    const liftoffAccel = mp.totalMass > 0 ? liftoftAccelOf(liftoffThrust, mp.totalMass) : 0;
    const designAccel = Math.max(liftoffAccel, 4 * planet.g0);
    const structural = vehicle.structuralUtilisation(designAccel);

    let status: CheckStatus = 'nominal';
    let summary = `${parts.length} parts · ${vehicle.height.toFixed(1)} m · L/D ${slenderness.toFixed(1)}`;
    let detail =
      'Every part in the load path carries the mass stacked above it with ' +
      `margin; worst case is ${(structural.utilisation * 100).toFixed(0)} % of rated load.`;

    if (structural.utilisation > 1) {
      status = 'fail';
      summary = `Overload at ${structural.part?.def.name ?? 'a structural part'}`;
      detail =
        `At ${(designAccel / planet.g0).toFixed(1)} g the ` +
        `${structural.part?.def.name ?? 'part'} carries ` +
        `${(structural.load / 1000).toFixed(0)} kN from the mass above it, against a ` +
        `rating of ${((structural.part?.def.structuralLimit ?? 0) / 1000).toFixed(0)} kN. ` +
        'Put a stronger element at that station, or reduce the mass above it.';
      warnings.push({
        code: 'STRUCTURAL OVERLOAD',
        severity: 'fail',
        message: `${structural.part?.def.name ?? 'A part'} cannot carry the mass stacked above it.`,
      });
    } else if (structural.utilisation > 0.85) {
      status = 'caution';
      summary = `Structural margin ${((1 - structural.utilisation) * 100).toFixed(0)} %`;
      detail =
        `The ${structural.part?.def.name ?? 'worst-loaded part'} is at ` +
        `${(structural.utilisation * 100).toFixed(0)} % of its rated load. There is very ` +
        'little margin for flight loads on top of the axial case.';
      warnings.push({
        code: 'LOW STRUCTURAL MARGIN',
        severity: 'caution',
        message: 'The worst-loaded structural part is near its rated limit.',
      });
    } else if (slenderness > 22) {
      status = 'caution';
      summary = `Very slender: L/D ${slenderness.toFixed(1)}`;
      detail =
        'A stack this long relative to its diameter bends and is hard to control ' +
        'through maximum dynamic pressure. Consider a wider core or fewer stacked tanks.';
      warnings.push({
        code: 'SLENDER VEHICLE',
        severity: 'caution',
        message: 'High length-to-diameter ratio; expect poor control margins in the atmosphere.',
      });
    }
    reports.push({ system: 'STRUCTURE', status, summary, detail });
  }

  // ---- PROPULSION ----
  {
    let status: CheckStatus = 'nominal';
    let summary = `TWR ${twr.toFixed(2)} · ${(liftoffThrust / 1000).toFixed(0)} kN`;
    let detail =
      'Liftoff thrust comfortably exceeds vehicle weight; the vehicle will ' +
      'accelerate off the pad.';

    if (vehicle.engines.length === 0) {
      status = 'fail';
      summary = 'No engines fitted';
      detail = 'The vehicle has no propulsion at all and cannot leave the pad.';
      warnings.push({
        code: 'NO PROPULSION',
        severity: 'fail',
        message: 'No engine is fitted to the vehicle.',
      });
    } else if (twr < 1) {
      status = 'fail';
      summary = `TWR ${twr.toFixed(2)} — cannot lift`;
      detail =
        `Thrust-to-weight ratio is ${twr.toFixed(2)}. Anything below 1.0 means weight ` +
        'exceeds thrust and the vehicle physically cannot rise. Add engines or ' +
        'remove mass.';
      warnings.push({
        code: 'LOW THRUST',
        severity: 'fail',
        message: `Thrust-to-weight ratio ${twr.toFixed(2)} is below 1.0 — the vehicle will not lift.`,
      });
    } else if (twr < 1.2) {
      status = 'caution';
      summary = `TWR ${twr.toFixed(2)} — marginal`;
      detail =
        'The vehicle will leave the pad but climbs so slowly that gravity losses ' +
        'eat much of the propellant. A healthy first stage is between 1.3 and 1.8.';
      warnings.push({
        code: 'MARGINAL THRUST',
        severity: 'caution',
        message: `TWR ${twr.toFixed(2)} — expect severe gravity losses during ascent.`,
      });
    } else if (twr > 4) {
      status = 'caution';
      summary = `TWR ${twr.toFixed(2)} — very high`;
      detail =
        'Extremely high initial acceleration drives the vehicle into dense air at ' +
        'high speed, wasting energy on drag and stressing the structure.';
      warnings.push({
        code: 'HIGH ACCELERATION',
        severity: 'caution',
        message: `TWR ${twr.toFixed(2)} — high drag losses and structural stress expected.`,
      });
    }
    reports.push({ system: 'PROPULSION', status, summary, detail });
  }

  // ---- FUEL ----
  {
    let status: CheckStatus = 'nominal';
    let summary = `Δv ${totalDv.toFixed(0)} m/s of ${budget.toFixed(0)} required`;
    let detail =
      'Propellant load provides enough ideal delta-v for the planned mission with ' +
      'margin.';

    const orphanEngines = vehicle.stages.filter(
      (s) => s.engines.length > 0 && vehicle.capacityInStage(s.index) <= 0,
    );

    if (vehicle.tanks.length === 0) {
      status = 'fail';
      summary = 'No propellant';
      detail = 'There is no propellant tank anywhere on the vehicle.';
      warnings.push({
        code: 'INSUFFICIENT FUEL',
        severity: 'fail',
        message: 'No propellant tanks are fitted.',
      });
    } else if (orphanEngines.length > 0) {
      status = 'fail';
      summary = `Stage ${orphanEngines[0].index + 1} has engines but no tank`;
      detail =
        'An engine can only draw from tanks in its own stage. One of your stages ' +
        'has an engine with nothing to feed it, so it will never produce thrust.';
      warnings.push({
        code: 'DRY STAGE',
        severity: 'fail',
        message: `Stage ${orphanEngines[0].index + 1} has an engine with no propellant tank.`,
      });
    } else if (totalDv < budget) {
      status = 'fail';
      summary = `Δv ${totalDv.toFixed(0)} m/s — short by ${(budget - totalDv).toFixed(0)}`;
      detail =
        `The rocket equation gives this vehicle ${totalDv.toFixed(0)} m/s of ideal ` +
        `delta-v. Reaching orbit needs about ${budget.toFixed(0)} m/s including gravity ` +
        'and drag losses. It will run out of propellant before it gets there.';
      warnings.push({
        code: 'INSUFFICIENT FUEL',
        severity: 'fail',
        message: `Only ${totalDv.toFixed(0)} m/s delta-v available; ${budget.toFixed(0)} m/s needed.`,
      });
    } else if (totalDv < budget * 1.15) {
      status = 'caution';
      summary = `Δv ${totalDv.toFixed(0)} m/s — thin margin`;
      detail =
        'Delta-v is only just sufficient. Any inefficiency in the ascent will leave ' +
        'the vehicle short.';
      warnings.push({
        code: 'LOW FUEL MARGIN',
        severity: 'caution',
        message: 'Delta-v margin is under 15 percent.',
      });
    }
    reports.push({ system: 'FUEL', status, summary, detail });
  }

  // ---- POWER ----
  {
    const draw = -Math.min(0, vehicle.totalPowerOutput());
    const gen = Math.max(0, vehicle.totalPowerOutput());
    const storage = vehicle.totalPowerStorage();
    const enduranceH = draw > 0 ? storage / draw : Infinity;

    let status: CheckStatus = 'nominal';
    let summary =
      gen > 0
        ? `${gen.toFixed(0)} W generated · ${storage.toFixed(0)} Wh stored`
        : `${storage.toFixed(0)} Wh stored · ${enduranceH.toFixed(1)} h endurance`;
    let detail = 'Power generation and storage cover the vehicle load.';

    if (storage <= 0 && gen <= 0) {
      status = 'fail';
      summary = 'No power source';
      detail =
        'The avionics need electrical power. Without a battery or an array, the ' +
        'flight computer is dead the moment the umbilical is pulled.';
      warnings.push({
        code: 'NO POWER',
        severity: 'fail',
        message: 'No battery or power generation fitted.',
      });
    } else if (enduranceH < 1 && gen < draw) {
      status = 'caution';
      summary = `Endurance ${(enduranceH * 60).toFixed(0)} min`;
      detail =
        'Stored energy runs out quickly and generation does not cover the load. ' +
        'The vehicle will lose avionics partway through the mission.';
      warnings.push({
        code: 'LOW POWER MARGIN',
        severity: 'caution',
        message: 'Battery endurance is under one hour with no net generation.',
      });
    }
    reports.push({ system: 'POWER', status, summary, detail });
  }

  // ---- AVIONICS ----
  {
    const hasCommand = vehicle.hasCommandModule();
    const gimballed = vehicle.engines.some((e) => e.def.engine!.gimbalRange > 0);
    const fins = vehicle
      .activeParts()
      .some((p) => (p.def.aero?.liftAuthority ?? 0) > 0);

    let status: CheckStatus = hasCommand ? 'nominal' : 'fail';
    let summary = hasCommand ? 'Command authority present' : 'No command module';
    let detail = hasCommand
      ? 'A flight computer is present and can command the ascent profile.'
      : 'Without a flight computer the vehicle cannot steer at all. It will follow ' +
        'whatever attitude aerodynamics happen to give it.';

    if (!hasCommand) {
      warnings.push({
        code: 'NO COMMAND MODULE',
        severity: 'fail',
        message: 'No flight computer — the vehicle cannot be guided.',
      });
    } else if (!gimballed && !fins) {
      status = 'caution';
      summary = 'No steering authority';
      detail =
        'The flight computer has nothing to steer with: no gimballed engine and no ' +
        'aerodynamic surfaces. It can only hold whatever attitude it starts in.';
      warnings.push({
        code: 'NO CONTROL AUTHORITY',
        severity: 'caution',
        message: 'No gimballed engines and no fins — attitude cannot be corrected.',
      });
    }

    // Stability is an avionics-adjacent concern, reported here.
    if (mp.staticMargin < 0 && fins === false) {
      warnings.push({
        code: 'UNSTABLE VEHICLE',
        severity: 'caution',
        message:
          'Centre of pressure is ahead of the centre of mass. The vehicle wants to ' +
          'fly backwards and will need constant gimbal authority to stay pointed.',
      });
      if (status === 'nominal') status = 'caution';
    }

    reports.push({ system: 'AVIONICS', status, summary, detail });
  }

  // ---- COMMUNICATION ----
  {
    const range = vehicle.bestCommsRange();
    let status: CheckStatus = 'nominal';
    let summary = range > 0 ? `Link range ${(range / 1e6).toFixed(0)} Mm` : 'No antenna';
    let detail = 'Telemetry link is adequate for the planned mission profile.';

    if (range <= 0) {
      status = 'fail';
      summary = 'No antenna fitted';
      detail =
        'With no antenna there is no telemetry and no command link. The mission is ' +
        'blind from the moment it leaves the pad.';
      warnings.push({
        code: 'NO COMMUNICATION',
        severity: 'fail',
        message: 'No antenna fitted — no telemetry or command link.',
      });
    } else if (requiresDeepSpaceComms && range < 1e11) {
      status = 'fail';
      summary = `Range ${(range / 1e6).toFixed(0)} Mm — too short for Mars`;
      detail =
        'Mars is between 55 and 400 million kilometres away. A low-gain omni ' +
        'antenna cannot close that link. Fit a high-gain dish.';
      warnings.push({
        code: 'COMMUNICATION RANGE',
        severity: 'fail',
        message: 'Antenna range is insufficient for an interplanetary mission.',
      });
    }
    reports.push({ system: 'COMMUNICATION', status, summary, detail });
  }

  // ---- THERMAL ----
  {
    const capacity = vehicle.totalHeatCapacity();
    // Rough entry heat load for arriving at Mars from a transfer orbit.
    const requiredLoad = requiresLanding ? 9e7 : 0;

    let status: CheckStatus = 'nominal';
    let summary = capacity > 0 ? `${(capacity / 1e6).toFixed(0)} MJ/m² capacity` : 'No shielding';
    let detail = 'Thermal protection is adequate for the planned flight regime.';

    if (requiresLanding && capacity < requiredLoad) {
      status = 'fail';
      summary = capacity > 0 ? 'Shield undersized' : 'No heat shield';
      detail =
        'Arriving at Mars from an interplanetary trajectory means hitting the ' +
        'atmosphere at roughly 5.5 km/s. Without an aeroshell rated for that heat ' +
        'load the vehicle is destroyed long before the parachute phase.';
      warnings.push({
        code: 'NO THERMAL PROTECTION',
        severity: 'fail',
        message: 'Heat shield is missing or undersized for atmospheric entry.',
      });
    }
    reports.push({ system: 'THERMAL', status, summary, detail });
  }

  // ---- LANDING ----
  {
    const systems = vehicle.landingSystems();
    const chuteArea = vehicle.parachuteArea();
    const hasLegs = systems.some((p) => p.def.landing!.kind === 'legs');
    const hasRetro = vehicle.engines.some((e) => e.def.engine!.restartable);

    let status: CheckStatus = 'nominal';
    let summary = systems.length > 0 ? `${systems.length} landing systems` : 'None fitted';
    let detail = 'Landing systems are appropriate for the destination.';

    if (requiresLanding) {
      if (systems.length === 0) {
        status = 'fail';
        summary = 'No landing system';
        detail =
          'The vehicle has no way to survive contact with the surface — no legs, ' +
          'no parachute, no airbags.';
        warnings.push({
          code: 'NO LANDING SYSTEM',
          severity: 'fail',
          message: 'No landing system fitted for a mission that must land.',
        });
      } else {
        // Terminal velocity on parachutes alone, in the thin Martian atmosphere.
        const mass = mp.totalMass;
        const marsRho = 0.02 * Math.exp(-2_000 / 11_100);
        const vTerm =
          chuteArea > 0
            ? Math.sqrt((2 * mass * 3.72) / (marsRho * chuteArea * 1.4))
            : Infinity;

        if (!hasRetro && !hasLegs && vTerm > 25) {
          status = 'fail';
          summary = `Chute-only terminal velocity ${vTerm.toFixed(0)} m/s`;
          detail =
            `Parachutes alone bring this vehicle to about ${vTerm.toFixed(0)} m/s on Mars. ` +
            'The atmosphere is roughly one percent of Earth’s, so a chute can never ' +
            'do the whole job. Add a restartable descent engine.';
          warnings.push({
            code: 'INSUFFICIENT PARACHUTE',
            severity: 'fail',
            message: `Parachutes alone give ${vTerm.toFixed(0)} m/s at touchdown — not survivable.`,
          });
        } else if (!hasRetro && vTerm > 12) {
          status = 'caution';
          summary = `Terminal velocity ${vTerm.toFixed(0)} m/s`;
          detail =
            'Touchdown speed on parachutes alone is high. A propulsive descent ' +
            'engine would take most of that energy out.';
          warnings.push({
            code: 'HARD LANDING RISK',
            severity: 'caution',
            message: 'Predicted touchdown speed is near the structural limit.',
          });
        }
      }
    }
    reports.push({ system: 'LANDING', status, summary, detail });
  }

  // ---- PAYLOAD ----
  {
    const payloads = vehicle
      .activeParts()
      .filter(
        (p) =>
          p.def.category === PartCategory.PAYLOAD ||
          p.def.category === PartCategory.SATELLITE ||
          p.def.category === PartCategory.ROVER ||
          p.def.category === PartCategory.SCIENCE,
      );
    const science = vehicle.totalScienceValue();
    const chaos = vehicle.activeParts().filter((p) => p.def.category === PartCategory.CHAOS);

    let status: CheckStatus = payloads.length > 0 ? 'nominal' : 'caution';
    let summary =
      payloads.length > 0
        ? `${payloads.length} payload items · ${science} science`
        : 'No payload';
    let detail =
      payloads.length > 0
        ? 'A payload is aboard and the mission has something to achieve.'
        : 'The vehicle carries no payload. It can fly, but the mission returns nothing.';

    if (chaos.length > 0) {
      const chaosMass = chaos.reduce((s, p) => s + p.def.mass, 0);
      summary += ` · ${chaos.length} unapproved items`;
      detail +=
        ` There are also ${chaos.length} items aboard that engineering did not sign ` +
        `off on, adding ${chaosMass.toFixed(0)} kg and a great deal of drag.`;
      if (status === 'nominal') status = 'caution';
      warnings.push({
        code: 'UNAPPROVED PAYLOAD',
        severity: 'caution',
        message: `${chaos.length} non-flight items are attached to the vehicle.`,
      });
    }
    reports.push({ system: 'PAYLOAD', status, summary, detail });
  }

  // High-mass advisory, independent of the per-system checks.
  if (mp.totalMass > 500_000) {
    warnings.push({
      code: 'HIGH MASS',
      severity: 'caution',
      message: `Vehicle mass is ${(mp.totalMass / 1000).toFixed(0)} t — verify pad load limits.`,
    });
  }

  return {
    reports,
    warnings,
    liftoffTWR: twr,
    totalDeltaV: totalDv,
    stageDeltaV: dv,
    totalMass: mp.totalMass,
    staticMargin: mp.staticMargin,
    launchable: !reports.some((r) => r.status === 'fail'),
  };
}
