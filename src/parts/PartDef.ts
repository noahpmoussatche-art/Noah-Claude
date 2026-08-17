/**
 * Part definition schema (spec §7, §8).
 *
 * Every part carries a 3D model builder, a mass, real dimensions, a function, a
 * cost, attachment nodes, a description and its physical parameters. Nothing in
 * the catalogue is allowed to be a decorative shell with no simulation meaning —
 * even the CHAOS parts have honest mass and drag, which is exactly why bolting a
 * refrigerator to a rocket changes how it flies.
 */
import type * as THREE from 'three';

export enum PartCategory {
  STRUCTURAL = 'STRUCTURAL',
  PROPULSION = 'PROPULSION',
  FUEL = 'FUEL',
  AVIONICS = 'AVIONICS',
  POWER = 'POWER',
  COMMUNICATION = 'COMMUNICATION',
  THERMAL = 'THERMAL',
  LANDING = 'LANDING',
  SCIENCE = 'SCIENCE',
  ROBOTICS = 'ROBOTICS',
  PAYLOAD = 'PAYLOAD',
  SATELLITE = 'SATELLITE',
  ROVER = 'ROVER',
  DECORATION = 'DECORATION',
  CHAOS = 'CHAOS',
}

export const CATEGORY_ORDER: readonly PartCategory[] = [
  PartCategory.STRUCTURAL,
  PartCategory.PROPULSION,
  PartCategory.FUEL,
  PartCategory.AVIONICS,
  PartCategory.POWER,
  PartCategory.COMMUNICATION,
  PartCategory.THERMAL,
  PartCategory.LANDING,
  PartCategory.SCIENCE,
  PartCategory.ROBOTICS,
  PartCategory.PAYLOAD,
  PartCategory.SATELLITE,
  PartCategory.ROVER,
  PartCategory.DECORATION,
  PartCategory.CHAOS,
];

export const CATEGORY_LABEL: Record<PartCategory, string> = {
  [PartCategory.STRUCTURAL]: 'Structural',
  [PartCategory.PROPULSION]: 'Propulsion',
  [PartCategory.FUEL]: 'Propellant',
  [PartCategory.AVIONICS]: 'Avionics',
  [PartCategory.POWER]: 'Power',
  [PartCategory.COMMUNICATION]: 'Communication',
  [PartCategory.THERMAL]: 'Thermal',
  [PartCategory.LANDING]: 'Landing',
  [PartCategory.SCIENCE]: 'Science',
  [PartCategory.ROBOTICS]: 'Robotics',
  [PartCategory.PAYLOAD]: 'Payload',
  [PartCategory.SATELLITE]: 'Satellite',
  [PartCategory.ROVER]: 'Rover',
  [PartCategory.DECORATION]: 'Decoration',
  [PartCategory.CHAOS]: 'Chaos',
};

/** Where another part may attach. */
export interface AttachNode {
  readonly id: string;
  /** Local-space offset from the part origin, metres. */
  readonly position: readonly [number, number, number];
  /** Which way the node faces. `top` stacks upward, `bottom` downward. */
  readonly facing: 'top' | 'bottom' | 'radial';
  /** Structural diameter at the node, metres. Mismatches trigger adapters. */
  readonly diameter: number;
}

/**
 * Engine-specific parameters.
 *
 * Thrust and mass flow are stated PER NOZZLE. A clustered part such as an
 * octaweb reports `nozzleCount: 9`, and the vehicle assembly creates one engine
 * instance per nozzle — so the cluster's total thrust emerges from the nine
 * instances rather than being pre-multiplied here. Doing it the other way round
 * double-counts the cluster.
 */
export interface EngineSpec {
  /** Vacuum thrust per nozzle, newtons. */
  readonly thrustVac: number;
  /** Sea-level thrust per nozzle, newtons. */
  readonly thrustSL: number;
  /** How many nozzles this part has. */
  readonly nozzleCount: number;
  /** Vacuum specific impulse, seconds. */
  readonly ispVac: number;
  /** Sea-level specific impulse, seconds. */
  readonly ispSL: number;
  /** Nozzle area-expansion ratio; drives the visual bell size. */
  readonly expansion: number;
  /** Gimbal authority in degrees; 0 means fixed. */
  readonly gimbalRange: number;
  /** How many seconds of continuous burn before wear becomes a failure risk. */
  readonly ratedBurnTime: number;
  /** Can this engine relight after shutdown (needed for propulsive landing)? */
  readonly restartable: boolean;
}

/** Propellant tank parameters. */
export interface TankSpec {
  /** Usable propellant mass, kg. */
  readonly propellantMass: number;
}

/** Aerodynamic parameters used by the drag model. */
export interface AeroSpec {
  /** Reference cross-sectional area, m^2. */
  readonly area: number;
  /** Drag coefficient in the nominal (nose-first) attitude. */
  readonly dragCoefficient: number;
  /** Restoring aerodynamic authority — fins produce this, nose cones do not. */
  readonly liftAuthority: number;
}

/** Landing-system parameters. */
export interface LandingSpec {
  readonly kind: 'legs' | 'parachute' | 'airbag' | 'wheels';
  /** Maximum touchdown speed the system survives, m/s. */
  readonly maxTouchdownSpeed: number;
  /** For parachutes: drag area when fully inflated, m^2. */
  readonly chuteArea?: number;
  /** For parachutes: dynamic-pressure limit for safe deployment, Pa. */
  readonly maxDeployPressure?: number;
}

/** Thermal-protection parameters. */
export interface ThermalSpec {
  /** Total heat load the shield can absorb, joules per m^2. */
  readonly heatCapacity: number;
  /** Fraction of the vehicle's frontal area it protects. */
  readonly coverage: number;
}

export interface PowerSpec {
  /** Generation at 1 AU, watts. Negative values consume. */
  readonly outputW: number;
  /** Stored energy, watt-hours. */
  readonly storageWh: number;
  /** Whether the array must be deployed before it produces (spec §40). */
  readonly deployable: boolean;
}

export interface CommsSpec {
  /** Effective link range, metres. */
  readonly rangeM: number;
  readonly deployable: boolean;
}

/** Context handed to a model builder so it can adapt to how it is mounted. */
export interface BuildContext {
  /** Diameter of the stack the part is attached to, metres. */
  readonly stackDiameter: number;
  /** Deterministic seed so repeated builds are identical. */
  readonly seed: number;
}

export interface PartDef {
  readonly id: string;
  readonly name: string;
  readonly category: PartCategory;
  /** One-line role summary shown in the build UI. */
  readonly function: string;
  /** Longer flavour + engineering description (spec §8). */
  readonly description: string;

  /** Dry mass, kg. */
  readonly mass: number;
  /** Bounding dimensions [width, height, depth], metres. */
  readonly dimensions: readonly [number, number, number];
  /** Build cost, agency credits. */
  readonly cost: number;

  /** Attachment nodes. */
  readonly nodes: readonly AttachNode[];

  /** Optional subsystem specs. */
  readonly engine?: EngineSpec;
  readonly tank?: TankSpec;
  readonly aero?: AeroSpec;
  readonly landing?: LandingSpec;
  readonly thermal?: ThermalSpec;
  readonly power?: PowerSpec;
  readonly comms?: CommsSpec;

  /** Marks the part as carrying command authority (spec §53 AVIONICS check). */
  readonly hasCommandModule?: boolean;
  /** Marks the part as a science instrument. */
  readonly scienceValue?: number;
  /** Structural strength: how much compressive load the part tolerates, newtons. */
  readonly structuralLimit?: number;
  /**
   * True for payload fairings. Parts stacked immediately above an enclosing
   * part sit *inside* it rather than on top of it, and are shielded from the
   * airstream until it is jettisoned.
   */
  readonly enclosing?: boolean;

  /** Builds the 3D model. Called once per instance. */
  readonly build: (ctx: BuildContext) => THREE.Object3D;
}

/** A part placed in a vehicle. */
export interface PlacedPart {
  readonly uid: string;
  readonly def: PartDef;
  /** Position of the part origin in vehicle-local space, metres. */
  readonly position: THREE.Vector3;
  /** Rotation about the stack axis, radians. */
  readonly rotation: number;
  /** Which stage this part belongs to (0 = first to fire). */
  stage: number;
  /**
   * True for radially-attached parts (fins, legs, boxes). These hang off the
   * side of the vehicle and do NOT carry the engines' thrust, so they are
   * excluded from the structural load-path check.
   */
  readonly isRadial: boolean;
  /** Live instance, populated when the vehicle is realised in 3D. */
  object?: THREE.Object3D;
  /** Remaining propellant, kg — only meaningful for tanks. */
  propellantRemaining?: number;
  /**
   * True while this part is inside a fairing. Shielded parts contribute mass
   * but no drag, which is the entire reason fairings exist.
   */
  shielded?: boolean;
  /** True once this part has been physically discarded (e.g. a jettisoned fairing). */
  jettisoned?: boolean;
}
