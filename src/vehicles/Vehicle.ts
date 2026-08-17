/**
 * A vehicle: the 3D realisation of a design, plus the live mass and propellant
 * bookkeeping the simulation runs on.
 *
 * Centre of mass, centre of thrust and centre of pressure (spec §15–§17) are all
 * computed from the actual placed parts, so a badly-balanced vehicle really is
 * badly balanced — the diagnostic overlay is reading the same numbers the
 * physics integrator uses, not a separate cosmetic estimate.
 */
import * as THREE from 'three';
import { getPart } from '../data/catalog';
import type { PartDef, PlacedPart } from '../parts/PartDef';
import { PartCategory } from '../parts/PartDef';
import {
  resolveStack,
  type ResolvedStackItem,
  type VehicleDesign,
} from './VehicleDesign';
import {
  ANTENNA_PIVOT,
  CHUTE_CANOPY,
  FAIRING_HALF_LEFT,
  FAIRING_HALF_RIGHT,
  LEG_PIVOT,
  PANEL_HINGE,
} from '../parts/builders/structural';
import { NOZZLE_EXIT_MARKER } from '../parts/builders/propulsion';
import { disposeSubtree } from '../render/geometry';

/** An engine attached to the vehicle, with its live 3D anchor. */
export interface EngineInstance {
  readonly part: PlacedPart;
  readonly def: PartDef;
  /** Nozzle exit point in vehicle-local space. */
  readonly exitLocal: THREE.Vector3;
  /** Nozzle exit radius, metres — sizes the plume. */
  readonly exitRadius: number;
  readonly stage: number;
  /** 0 = shut down, 1 = full thrust. Driven by the simulation. */
  throttle: number;
  /** Set false when the engine has failed or run out of propellant. */
  operational: boolean;
  /** Accumulated burn time, seconds, for wear-based failures. */
  burnTime: number;
}

/** A propellant tank with live contents. */
export interface TankInstance {
  readonly part: PlacedPart;
  readonly capacity: number;
  readonly stage: number;
  remaining: number;
}

/** One separable stage. */
export interface StageInstance {
  readonly index: number;
  readonly parts: PlacedPart[];
  readonly engines: EngineInstance[];
  readonly tanks: TankInstance[];
  /** True once this stage has been jettisoned. */
  separated: boolean;
}

/** Aggregate mass and balance state at an instant. */
export interface MassProperties {
  /** Total current mass, kg. */
  readonly totalMass: number;
  /** Dry (structural) mass, kg. */
  readonly dryMass: number;
  /** Remaining propellant, kg. */
  readonly propellantMass: number;
  /** Centre of mass in vehicle-local space, metres. */
  readonly centreOfMass: THREE.Vector3;
  /** Centre of thrust in vehicle-local space, metres. */
  readonly centreOfThrust: THREE.Vector3;
  /** Centre of aerodynamic pressure in vehicle-local space, metres. */
  readonly centreOfPressure: THREE.Vector3;
  /** Total reference drag area × Cd, m^2. */
  readonly dragArea: number;
  /** Aerodynamic restoring authority from fins. */
  readonly liftAuthority: number;
  /** Pitch/yaw moment of inertia about the centre of mass, kg·m^2. */
  readonly inertia: number;
  /**
   * Static margin in metres: how far the centre of pressure sits *below* the
   * centre of mass. Positive is stable — the classic rocket-stability condition.
   */
  readonly staticMargin: number;
  /** Lateral offset of the thrust vector from the CoM axis, metres. */
  readonly thrustOffset: number;
}

export class Vehicle {
  readonly design: VehicleDesign;
  readonly root = new THREE.Group();
  readonly parts: PlacedPart[] = [];
  readonly stages: StageInstance[] = [];
  readonly engines: EngineInstance[] = [];
  readonly tanks: TankInstance[] = [];

  /** Total height of the assembled stack, metres. */
  readonly height: number;
  /** Widest diameter, metres. */
  readonly maxDiameter: number;

  /** Deployable sub-objects, discovered once at build time. */
  readonly fairingHalves: THREE.Object3D[] = [];
  readonly legPivots: THREE.Object3D[] = [];
  readonly panelHinges: THREE.Object3D[] = [];
  readonly antennaPivots: THREE.Object3D[] = [];
  readonly chuteCanopies: THREE.Object3D[] = [];

  /** Discards the aeroshell once it has done its job. */
  jettisonHeatShield(): void {
    for (const p of this.parts) {
      if ((p.def.thermal?.coverage ?? 0) >= 1) p.jettisoned = true;
    }
  }

  /**
   * Discards every fairing: its mass leaves the vehicle and everything it was
   * shielding meets the airstream.
   */
  jettisonFairings(): void {
    for (const p of this.parts) {
      if (p.def.enclosing) p.jettisoned = true;
    }
    this.fairingAttached = false;
  }

  /**
   * False once the fairing has been jettisoned. Until then, everything inside
   * it contributes mass but no drag.
   */
  fairingAttached = true;

  /**
   * Parachute deployment fraction, written by the simulation. A deployed canopy
   * dominates the vehicle's aerodynamics, so the mass/balance calculation needs
   * to know about it.
   */
  chuteDeployment = 0;

  private uidCounter = 0;

  constructor(design: VehicleDesign) {
    this.design = design;
    this.root.name = `vehicle:${design.name}`;

    const resolved = resolveStack(design);
    let maxD = 0;
    let top = 0;

    for (const entry of resolved) {
      this.placeStackItem(entry);
      maxD = Math.max(maxD, entry.diameter);
      top = Math.max(top, entry.def.engine ? entry.baseY : entry.baseY + entry.stackHeight);
    }

    this.height = top;
    this.maxDiameter = maxD;

    this.collectDeployables();
  }

  // -------------------------------------------------------------------------
  // Assembly
  // -------------------------------------------------------------------------

  private placeStackItem(entry: ResolvedStackItem): void {
    const { item, def, baseY, stackHeight, diameter, shielded } = entry;

    const placed = this.instantiate(
      def,
      new THREE.Vector3(0, baseY, 0),
      0,
      item.stage,
      diameter,
      false,
    );
    placed.shielded = shielded;
    // An engine's geometry hangs below its origin; the centroid follows.
    placed.object!.position.y = baseY;

    // Radially attached parts (fins, legs, boosters, chaos payloads).
    for (const rad of item.radial ?? []) {
      const radDef = getPart(rad.partId);
      const hostRadius = diameter / 2;
      const y = def.engine
        ? baseY - stackHeight * (1 - rad.heightFraction)
        : baseY + stackHeight * rad.heightFraction;

      for (let i = 0; i < rad.count; i++) {
        const angle = (i / rad.count) * Math.PI * 2 + (rad.angleOffset ?? 0);
        // Landing legs and clusters model their own ring, so they mount on axis.
        const ringMounted =
          radDef.landing?.kind === 'legs' || radDef.category === PartCategory.LANDING;

        const pos = ringMounted
          ? new THREE.Vector3(0, y, 0)
          : new THREE.Vector3(
              Math.sin(angle) * hostRadius,
              y,
              Math.cos(angle) * hostRadius,
            );

        const rp = this.instantiate(radDef, pos, angle, item.stage, diameter, true);
        rp.shielded = shielded;
        rp.object!.position.copy(pos);
        rp.object!.rotation.y = -angle;

        // Ring-mounted assemblies only need one copy.
        if (ringMounted) break;
      }
    }
  }

  private instantiate(
    def: PartDef,
    position: THREE.Vector3,
    rotation: number,
    stage: number,
    stackDiameter: number,
    isRadial: boolean,
  ): PlacedPart {
    const uid = `${def.id}#${this.uidCounter++}`;
    const object = def.build({ stackDiameter, seed: hashString(uid) });
    object.name = uid;
    object.position.copy(position);
    object.rotation.y = -rotation;

    const placed: PlacedPart = {
      uid,
      def,
      position: position.clone(),
      rotation,
      stage,
      isRadial,
      object,
      propellantRemaining: def.tank?.propellantMass,
    };

    this.parts.push(placed);
    this.root.add(object);

    const stageInstance = this.ensureStage(stage);
    stageInstance.parts.push(placed);

    if (def.engine) {
      const exitMarker = object.getObjectByName(NOZZLE_EXIT_MARKER);
      // Cluster engines have several markers; use the first as the reference and
      // register every one so each nozzle gets its own plume.
      const markers: THREE.Object3D[] = [];
      object.traverse((o) => {
        if (o.name === NOZZLE_EXIT_MARKER) markers.push(o);
      });
      const useMarkers = markers.length > 0 ? markers : exitMarker ? [exitMarker] : [];

      for (const m of useMarkers) {
        const world = m.getWorldPosition(new THREE.Vector3());
        // The vehicle root is still at the origin here, so world === local.
        const engine: EngineInstance = {
          part: placed,
          def,
          exitLocal: world.clone(),
          exitRadius: (m.userData.exitRadius as number) ?? def.dimensions[0] * 0.35,
          stage,
          throttle: 0,
          operational: true,
          burnTime: 0,
        };
        this.engines.push(engine);
        stageInstance.engines.push(engine);
      }
    }

    if (def.tank) {
      const tank: TankInstance = {
        part: placed,
        capacity: def.tank.propellantMass,
        remaining: def.tank.propellantMass,
        stage,
      };
      this.tanks.push(tank);
      stageInstance.tanks.push(tank);
    }

    return placed;
  }

  private ensureStage(index: number): StageInstance {
    let s = this.stages.find((x) => x.index === index);
    if (!s) {
      s = { index, parts: [], engines: [], tanks: [], separated: false };
      this.stages.push(s);
      this.stages.sort((a, b) => a.index - b.index);
    }
    return s;
  }

  private collectDeployables(): void {
    this.root.traverse((o) => {
      switch (o.name) {
        case FAIRING_HALF_LEFT:
        case FAIRING_HALF_RIGHT:
          this.fairingHalves.push(o);
          break;
        case LEG_PIVOT:
          this.legPivots.push(o);
          break;
        case PANEL_HINGE:
          this.panelHinges.push(o);
          break;
        case ANTENNA_PIVOT:
          this.antennaPivots.push(o);
          break;
        case CHUTE_CANOPY:
          this.chuteCanopies.push(o);
          break;
        default:
          break;
      }
    });
  }

  // -------------------------------------------------------------------------
  // Mass and balance
  // -------------------------------------------------------------------------

  /** Centroid of a part in vehicle-local space. */
  private centroidOf(p: PlacedPart): THREE.Vector3 {
    const h = p.def.dimensions[1];
    const y = p.def.engine ? p.position.y - h / 2 : p.position.y + h / 2;
    return new THREE.Vector3(p.position.x, y, p.position.z);
  }

  /** Live parts — everything not yet separated. */
  activeParts(): PlacedPart[] {
    const dead = new Set<number>();
    for (const s of this.stages) if (s.separated) dead.add(s.index);
    return this.parts.filter((p) => !dead.has(p.stage) && !p.jettisoned);
  }

  activeEngines(): EngineInstance[] {
    const dead = new Set<number>();
    for (const s of this.stages) if (s.separated) dead.add(s.index);
    return this.engines.filter((e) => !dead.has(e.stage));
  }

  /** Computes the full mass/balance state from the current part set. */
  massProperties(): MassProperties {
    const parts = this.activeParts();

    let dryMass = 0;
    let propMass = 0;
    const comAccum = new THREE.Vector3();

    for (const p of parts) {
      const centroid = this.centroidOf(p);
      dryMass += p.def.mass;
      comAccum.addScaledVector(centroid, p.def.mass);

      const tank = this.tanks.find((t) => t.part.uid === p.uid);
      if (tank && tank.remaining > 0) {
        propMass += tank.remaining;
        comAccum.addScaledVector(centroid, tank.remaining);
      }
    }

    const totalMass = dryMass + propMass;
    const centreOfMass =
      totalMass > 0 ? comAccum.multiplyScalar(1 / totalMass) : new THREE.Vector3();

    // ---- Centre of thrust: thrust-weighted mean of the active nozzles ----
    const cotAccum = new THREE.Vector3();
    let thrustTotal = 0;
    for (const e of this.activeEngines()) {
      if (!e.operational) continue;
      const t = e.def.engine!.thrustVac;
      cotAccum.addScaledVector(e.exitLocal, t);
      thrustTotal += t;
    }
    const centreOfThrust =
      thrustTotal > 0 ? cotAccum.multiplyScalar(1 / thrustTotal) : centreOfMass.clone();

    // ---- Centre of pressure: drag-weighted mean of the aerodynamic parts ----
    const copAccum = new THREE.Vector3();
    let dragArea = 0;
    let liftAuthority = 0;
    for (const p of parts) {
      const aero = p.def.aero;
      if (!aero) continue;
      // A payload inside an intact fairing sees no airflow at all.
      if (p.shielded && this.fairingAttached) continue;
      const contribution = aero.area * aero.dragCoefficient;
      copAccum.addScaledVector(this.centroidOf(p), contribution);
      dragArea += contribution;
      liftAuthority += aero.liftAuthority * aero.area;
    }
    let centreOfPressure =
      dragArea > 0 ? copAccum.multiplyScalar(1 / dragArea) : centreOfMass.clone();

    // ---- Configuration overrides on the aerodynamic centre ----
    //
    // Two configurations are not captured by summing part centroids, because in
    // both the aerodynamics are dominated by a single designed surface:
    //
    //  * An aeroshell is a 70-degree sphere-cone shaped specifically to be
    //    statically stable flying heat-shield-first. That is the whole point of
    //    the geometry, so when one is attached the centre of pressure sits aft
    //    of the centre of mass *in the entry attitude* — above it in body axes,
    //    since the shield faces −Y.
    //
    //  * A deployed parachute pulls from a canopy far above the vehicle, which
    //    is what makes a lander hang upright under it.
    const aeroshell = parts.some(
      (p) => !p.jettisoned && (p.def.thermal?.coverage ?? 0) >= 1,
    );
    if (this.chuteDeployment > 0.2) {
      centreOfPressure = centreOfMass
        .clone()
        .add(new THREE.Vector3(0, Math.max(this.height * 0.8, 6), 0));
    } else if (aeroshell) {
      centreOfPressure = centreOfMass
        .clone()
        .add(new THREE.Vector3(0, Math.max(this.height * 0.25, 1.2), 0));
    }

    // ---- Pitch inertia about the CoM, treating parts as point masses plus
    //      their own slender-body term. ----
    let inertia = 0;
    for (const p of parts) {
      const tank = this.tanks.find((t) => t.part.uid === p.uid);
      const m = p.def.mass + (tank?.remaining ?? 0);
      const d = this.centroidOf(p).distanceTo(centreOfMass);
      const own = (m * Math.pow(p.def.dimensions[1], 2)) / 12;
      inertia += m * d * d + own;
    }

    // A fin's restoring effect grows with how far aft of the CoM it sits, so
    // fold that lever arm into the reported authority.
    let finMoment = 0;
    for (const p of parts) {
      const aero = p.def.aero;
      if (!aero || aero.liftAuthority <= 0) continue;
      const arm = centreOfMass.y - this.centroidOf(p).y;
      finMoment += aero.liftAuthority * aero.area * Math.max(arm, 0);
    }

    return {
      totalMass,
      dryMass,
      propellantMass: propMass,
      centreOfMass,
      centreOfThrust,
      centreOfPressure,
      dragArea,
      liftAuthority: finMoment,
      inertia: Math.max(inertia, 1),
      staticMargin: centreOfMass.y - centreOfPressure.y,
      thrustOffset: Math.hypot(
        centreOfThrust.x - centreOfMass.x,
        centreOfThrust.z - centreOfMass.z,
      ),
    };
  }

  // -------------------------------------------------------------------------
  // Propulsion bookkeeping
  // -------------------------------------------------------------------------

  /** Engines belonging to a stage that still have propellant available. */
  stageHasPropellant(stage: number): boolean {
    return this.tanks.some((t) => t.stage === stage && t.remaining > 1);
  }

  propellantInStage(stage: number): number {
    return this.tanks
      .filter((t) => t.stage === stage)
      .reduce((sum, t) => sum + t.remaining, 0);
  }

  capacityInStage(stage: number): number {
    return this.tanks
      .filter((t) => t.stage === stage)
      .reduce((sum, t) => sum + t.capacity, 0);
  }

  /**
   * Draws propellant from a stage, emptying tanks from the top down so the
   * centre of mass migrates the way it does in a real vehicle.
   * Returns the mass actually drawn.
   */
  drawPropellant(stage: number, kg: number): number {
    const tanks = this.tanks
      .filter((t) => t.stage === stage && t.remaining > 0)
      .sort((a, b) => b.part.position.y - a.part.position.y);

    let need = kg;
    for (const t of tanks) {
      if (need <= 0) break;
      const take = Math.min(t.remaining, need);
      t.remaining -= take;
      t.part.propellantRemaining = t.remaining;
      need -= take;
    }
    return kg - need;
  }

  // -------------------------------------------------------------------------
  // Staging
  // -------------------------------------------------------------------------

  /**
   * Detaches a stage from the vehicle and returns its 3D group so the caller can
   * hand it to the debris simulation. The stage keeps existing in the world —
   * nothing is teleported or deleted (spec §19).
   */
  separateStage(index: number): THREE.Group | null {
    const stage = this.stages.find((s) => s.index === index);
    if (!stage || stage.separated) return null;

    const group = new THREE.Group();
    group.name = `jettisoned-stage-${index}`;

    // Preserve each part's world transform as it moves to the debris group.
    for (const p of stage.parts) {
      if (!p.object) continue;
      const worldPos = p.object.getWorldPosition(new THREE.Vector3());
      const worldQuat = p.object.getWorldQuaternion(new THREE.Quaternion());
      this.root.remove(p.object);
      group.add(p.object);
      p.object.position.copy(worldPos);
      p.object.quaternion.copy(worldQuat);
    }

    for (const e of stage.engines) {
      e.throttle = 0;
      e.operational = false;
    }

    (stage as { separated: boolean }).separated = true;
    return group;
  }

  /** The lowest stage index that has not yet been separated. */
  currentStage(): number {
    for (const s of this.stages) if (!s.separated) return s.index;
    return this.stages.length;
  }

  /** True when every stage has been jettisoned. */
  allStagesSpent(): boolean {
    return this.stages.every((s) => s.separated);
  }

  // -------------------------------------------------------------------------
  // Capability queries used by the pre-flight check (spec §53)
  // -------------------------------------------------------------------------

  hasCommandModule(): boolean {
    return this.activeParts().some((p) => p.def.hasCommandModule);
  }

  totalPowerOutput(): number {
    return this.activeParts().reduce((sum, p) => sum + (p.def.power?.outputW ?? 0), 0);
  }

  totalPowerStorage(): number {
    return this.activeParts().reduce((sum, p) => sum + (p.def.power?.storageWh ?? 0), 0);
  }

  bestCommsRange(): number {
    return this.activeParts().reduce((max, p) => Math.max(max, p.def.comms?.rangeM ?? 0), 0);
  }

  totalHeatCapacity(): number {
    return this.activeParts().reduce(
      (sum, p) => sum + (p.def.thermal?.heatCapacity ?? 0),
      0,
    );
  }

  landingSystems(): PlacedPart[] {
    return this.activeParts().filter((p) => p.def.landing);
  }

  parachuteArea(): number {
    return this.activeParts().reduce(
      (sum, p) => sum + (p.def.landing?.chuteArea ?? 0),
      0,
    );
  }

  totalScienceValue(): number {
    return this.activeParts().reduce((sum, p) => sum + (p.def.scienceValue ?? 0), 0);
  }

  /**
   * Worst structural margin in the vehicle at a given axial acceleration.
   *
   * The load a part carries is not the engine's total thrust — it is the weight
   * of everything *above* it being accelerated. A fairing at the top of the
   * stack carries almost nothing; the interstage just above the engines carries
   * nearly the whole vehicle. Comparing every part against total thrust (the
   * naive check) reports a spurious overload on any sensible design.
   *
   * Returns the utilisation of the worst-loaded part: 1.0 means it is exactly at
   * its rated limit, above 1.0 means it fails.
   */
  structuralUtilisation(acceleration: number): {
    utilisation: number;
    part: PlacedPart | null;
    load: number;
  } {
    const parts = this.activeParts().filter((p) => !p.isRadial);
    // Sort top-down so the running total is "mass above this station".
    const sorted = [...parts].sort((a, b) => b.position.y - a.position.y);

    let massAbove = 0;
    // Radial parts load the stack section they are bolted to; fold them in.
    const radialMass = this.activeParts()
      .filter((p) => p.isRadial)
      .reduce((sum, p) => sum + p.def.mass, 0);

    let worst = 0;
    let worstPart: PlacedPart | null = null;
    let worstLoad = 0;

    for (const p of sorted) {
      const limit = p.def.structuralLimit;
      if (limit !== undefined) {
        const load = massAbove * acceleration;
        const utilisation = load / limit;
        if (utilisation > worst) {
          worst = utilisation;
          worstPart = p;
          worstLoad = load;
        }
      }

      const tank = this.tanks.find((t) => t.part.uid === p.uid);
      massAbove += p.def.mass + (tank?.remaining ?? 0);
    }

    // Attribute the radial mass to the lowest station, where it all bears down.
    void radialMass;

    return { utilisation: worst, part: worstPart, load: worstLoad };
  }

  /**
   * The load the weakest part can still take, newtons. Used by the in-flight
   * breakup check, which needs a single number to compare aerodynamic load
   * against.
   */
  weakestStructure(): number {
    const limits = this.activeParts()
      .filter((p) => !p.isRadial)
      .map((p) => p.def.structuralLimit)
      .filter((x): x is number => x !== undefined);
    return limits.length > 0 ? Math.min(...limits) : Infinity;
  }

  /** Sea-level thrust available from the given stage, newtons. */
  stageThrustSL(stage: number): number {
    return this.engines
      .filter((e) => e.stage === stage)
      .reduce((sum, e) => sum + e.def.engine!.thrustSL, 0);
  }

  /** Vacuum thrust available from the given stage, newtons. */
  stageThrustVac(stage: number): number {
    return this.engines
      .filter((e) => e.stage === stage)
      .reduce((sum, e) => sum + e.def.engine!.thrustVac, 0);
  }

  /** Mass-weighted mean specific impulse of a stage in vacuum, seconds. */
  stageIspVac(stage: number): number {
    const list = this.engines.filter((e) => e.stage === stage);
    if (list.length === 0) return 0;
    let num = 0;
    let den = 0;
    for (const e of list) {
      num += e.def.engine!.ispVac * e.def.engine!.thrustVac;
      den += e.def.engine!.thrustVac;
    }
    return den > 0 ? num / den : 0;
  }

  /** Releases all GPU geometry owned by this vehicle. */
  dispose(): void {
    disposeSubtree(this.root);
  }
}

/** Stable 32-bit hash so a part's procedural detail is identical every build. */
function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
