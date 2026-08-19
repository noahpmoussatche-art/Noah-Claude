/**
 * The part catalogue (spec §7, §8).
 *
 * Numbers here are grounded in public launch-vehicle engineering rather than
 * invented: propellant loads follow from tank volume at a realistic bulk
 * density, dry masses give stage mass ratios in the 1:15–1:22 band that real
 * kerolox stages achieve, and engine performance sits in the range published
 * for comparable hardware classes. The result is that the simulation produces
 * believable trajectories without any fudge factors.
 */
import * as THREE from 'three';
import {
  PartCategory,
  type AttachNode,
  type BuildContext,
  type PartDef,
} from '../parts/PartDef';
import { buildEngine, buildEngineCluster, buildRcsQuad } from '../parts/builders/propulsion';
import {
  buildAdapter,
  buildDecoupler,
  buildFairing,
  buildFin,
  buildGridFin,
  buildHeatShield,
  buildInterstage,
  buildNoseCone,
  buildTank,
} from '../parts/builders/structural';
import {
  buildAirbags,
  buildLandingLegs,
  buildParachute,
  buildWheel,
} from '../parts/builders/landing';
import {
  buildAvionics,
  buildBattery,
  buildBodyPanel,
  buildDishAntenna,
  buildDrill,
  buildRadiator,
  buildRoboticArm,
  buildScienceBay,
  buildSolarWing,
  buildWhipAntenna,
} from '../parts/builders/systems';
import {
  buildCapsule,
  buildLanderDeck,
  buildProbeBus,
  buildRoverChassis,
  buildSatelliteBus,
} from '../parts/builders/payloads';
import {
  buildCoffeeMug,
  buildCouch,
  buildGardenGnome,
  buildOfficeChair,
  buildPottedPlant,
  buildRefrigerator,
  buildRubberDuck,
  buildTelevision,
  buildToilet,
  buildToolbox,
  buildTrafficCone,
} from '../parts/builders/chaos';

/** Bulk density of a kerolox propellant load, kg/m^3 (LOX + RP-1 combined). */
const PROPELLANT_DENSITY = 1030;
/** Fraction of the geometric tank volume that is usable propellant. */
const TANK_FILL = 0.93;

/** Propellant mass implied by a tank's own geometry — no invented numbers. */
function propellantFor(radius: number, length: number): number {
  const volume = Math.PI * radius * radius * length;
  return Math.round(volume * TANK_FILL * PROPELLANT_DENSITY);
}

/** Frontal area of a circular cross-section. */
const areaOf = (radius: number): number => Math.PI * radius * radius;

/** Standard stack node pair for a part with its origin at the bottom. */
function stackNodes(diameter: number, height: number): AttachNode[] {
  return [
    { id: 'bottom', position: [0, 0, 0], facing: 'bottom', diameter },
    { id: 'top', position: [0, height, 0], facing: 'top', diameter },
  ];
}

// ---------------------------------------------------------------------------
// PROPULSION
// ---------------------------------------------------------------------------

interface EngineTemplate {
  id: string;
  name: string;
  description: string;
  exitRadius: number;
  bellLength: number;
  expansion: number;
  thrustSL: number;
  thrustVac: number;
  ispSL: number;
  ispVac: number;
  mass: number;
  cost: number;
  gimbalRange: number;
  ratedBurnTime: number;
  restartable: boolean;
  plumbing: boolean;
  shroud: boolean;
  cluster?: number;
}

function engineDef(t: EngineTemplate): PartDef {
  const totalHeight = t.bellLength * 1.55;
  const clusterRadius = t.exitRadius * 2.35;
  const width = t.cluster && t.cluster > 1 ? clusterRadius * 2 + t.exitRadius * 2 : t.exitRadius * 2.4;

  return {
    id: t.id,
    name: t.name,
    category: PartCategory.PROPULSION,
    function: t.restartable ? 'Restartable rocket engine' : 'Rocket engine',
    description: t.description,
    mass: t.mass,
    dimensions: [width, totalHeight, width],
    cost: t.cost,
    nodes: [{ id: 'top', position: [0, 0, 0], facing: 'top', diameter: width * 0.9 }],
    // Per-nozzle figures; the assembly instantiates one engine per nozzle.
    engine: {
      thrustVac: t.thrustVac,
      thrustSL: t.thrustSL,
      nozzleCount: t.cluster ?? 1,
      ispVac: t.ispVac,
      ispSL: t.ispSL,
      expansion: t.expansion,
      gimbalRange: t.gimbalRange,
      ratedBurnTime: t.ratedBurnTime,
      restartable: t.restartable,
    },
    aero: { area: areaOf(width / 2), dragCoefficient: 0.9, liftAuthority: 0 },
    structuralLimit: t.thrustVac * (t.cluster ?? 1) * 3.5,
    build: (ctx: BuildContext): THREE.Object3D => {
      const opts = {
        exitRadius: t.exitRadius,
        bellLength: t.bellLength,
        expansion: t.expansion,
        plumbing: t.plumbing,
        shroud: t.shroud,
        seed: ctx.seed,
      };
      return t.cluster && t.cluster > 1
        ? buildEngineCluster(opts, t.cluster, clusterRadius)
        : buildEngine(opts);
    },
  };
}

const ENGINES: PartDef[] = [
  engineDef({
    id: 'eng-vulcan9',
    name: 'VULCAN-9 Sea Level',
    description:
      'Gas-generator kerolox engine optimised for first-stage flight. The short ' +
      'bell trades vacuum efficiency for a nozzle that will not flow-separate at ' +
      'sea level. Gimballed for pitch and yaw authority.',
    exitRadius: 0.46,
    bellLength: 1.5,
    expansion: 16,
    thrustSL: 845_000,
    thrustVac: 914_000,
    ispSL: 282,
    ispVac: 311,
    mass: 470,
    cost: 640,
    gimbalRange: 5,
    ratedBurnTime: 200,
    restartable: true,
    plumbing: true,
    shroud: false,
  }),
  engineDef({
    id: 'eng-vulcan9-x9',
    name: 'VULCAN-9 Octaweb (×9)',
    description:
      'Nine VULCAN-9 engines on a shared octagonal thrust structure. Engine-out ' +
      'tolerant and the standard powerplant for a heavy first stage. Only the ' +
      'centre engine gimbals during landing burns.',
    exitRadius: 0.46,
    bellLength: 1.5,
    expansion: 16,
    thrustSL: 845_000,
    thrustVac: 914_000,
    ispSL: 282,
    ispVac: 311,
    mass: 4_600,
    cost: 5_200,
    gimbalRange: 5,
    ratedBurnTime: 200,
    restartable: true,
    plumbing: true,
    shroud: false,
    cluster: 9,
  }),
  engineDef({
    id: 'eng-vulcan-vac',
    name: 'VULCAN-V Vacuum',
    description:
      'Vacuum variant with a large niobium extension. The 165:1 expansion ratio ' +
      'is worth roughly 40 s of specific impulse in vacuum but makes the engine ' +
      'unusable in the lower atmosphere.',
    exitRadius: 1.05,
    bellLength: 3.1,
    expansion: 165,
    thrustSL: 480_000,
    thrustVac: 981_000,
    ispSL: 190,
    ispVac: 348,
    mass: 610,
    cost: 900,
    gimbalRange: 4,
    ratedBurnTime: 400,
    restartable: true,
    plumbing: true,
    shroud: false,
  }),
  engineDef({
    id: 'eng-ember3',
    name: 'EMBER-3 Medium',
    description:
      'Mid-thrust pump-fed engine for small launchers and boosters. Simple, ' +
      'cheap, and reliable; the workhorse of the agency inventory.',
    exitRadius: 0.32,
    bellLength: 1.05,
    expansion: 14,
    thrustSL: 420_000,
    thrustVac: 466_000,
    ispSL: 275,
    ispVac: 305,
    mass: 290,
    cost: 340,
    gimbalRange: 4,
    ratedBurnTime: 180,
    restartable: false,
    plumbing: true,
    shroud: false,
  }),
  engineDef({
    id: 'eng-spark1',
    name: 'SPARK-1 Upper Stage',
    description:
      'Small pressure-fed upper-stage engine. Multiple restarts make it suitable ' +
      'for orbit circularisation and interplanetary injection burns.',
    exitRadius: 0.42,
    bellLength: 1.2,
    expansion: 40,
    thrustSL: 42_000,
    thrustVac: 95_000,
    ispSL: 210,
    ispVac: 318,
    mass: 105,
    cost: 260,
    gimbalRange: 6,
    ratedBurnTime: 500,
    restartable: true,
    plumbing: true,
    shroud: false,
  }),
  engineDef({
    id: 'eng-talon-d',
    name: 'TALON-D Descent',
    description:
      'Deeply throttleable landing engine, 20–100 % of rated thrust. Designed for ' +
      'terminal descent where thrust must be trimmed continuously against a ' +
      'falling vehicle mass.',
    exitRadius: 0.3,
    bellLength: 0.78,
    expansion: 55,
    thrustSL: 28_000,
    thrustVac: 62_000,
    ispSL: 205,
    ispVac: 321,
    mass: 78,
    cost: 300,
    gimbalRange: 8,
    ratedBurnTime: 600,
    restartable: true,
    plumbing: true,
    shroud: false,
  }),
  engineDef({
    id: 'eng-pillar-s',
    name: 'PILLAR-S Solid Booster',
    description:
      'Strap-on solid motor. Enormous thrust, poor specific impulse, and — like ' +
      'every solid — it cannot be throttled or shut down once lit.',
    exitRadius: 0.62,
    bellLength: 1.7,
    expansion: 11,
    thrustSL: 1_610_000,
    thrustVac: 1_720_000,
    ispSL: 237,
    ispVac: 268,
    mass: 5_400,
    cost: 1_200,
    gimbalRange: 0,
    ratedBurnTime: 95,
    restartable: false,
    plumbing: false,
    shroud: true,
  }),
];

const RCS_PART: PartDef = {
  id: 'rcs-quad',
  name: 'Attitude Control Quad',
  category: PartCategory.PROPULSION,
  function: 'Reaction control thrusters',
  description:
    'Four cold-gas thrusters on a shared manifold. Provides the roll and pointing ' +
    'authority a vehicle needs once aerodynamic surfaces stop working.',
  mass: 24,
  dimensions: [0.5, 0.4, 0.5],
  cost: 90,
  nodes: [{ id: 'radial', position: [0, 0, 0], facing: 'radial', diameter: 0.4 }],
  build: () => buildRcsQuad(0.4),
};

// ---------------------------------------------------------------------------
// FUEL
// ---------------------------------------------------------------------------

interface TankTemplate {
  id: string;
  name: string;
  radius: number;
  length: number;
  description: string;
  painted?: boolean;
}

function tankDef(t: TankTemplate): PartDef {
  const prop = propellantFor(t.radius, t.length);
  // Dry mass follows a realistic structural mass fraction that improves with
  // scale, giving stage mass ratios between roughly 1:15 and 1:22.
  const dry = Math.round(prop * (0.075 - Math.min(0.03, t.radius * 0.012)));
  return {
    id: t.id,
    name: t.name,
    category: PartCategory.FUEL,
    function: 'Propellant tank',
    description: t.description,
    mass: dry,
    dimensions: [t.radius * 2, t.length, t.radius * 2],
    cost: Math.round(prop * 0.0042 + dry * 0.12),
    nodes: stackNodes(t.radius * 2, t.length),
    tank: { propellantMass: prop },
    aero: { area: areaOf(t.radius), dragCoefficient: 0.32, liftAuthority: 0 },
    structuralLimit: t.radius * t.radius * 9.2e6,
    build: (ctx: BuildContext) => buildTank(t.radius, t.length, ctx.seed, t.painted ?? true),
  };
}

const TANKS: PartDef[] = [
  tankDef({
    id: 'tank-15-s',
    name: 'T15 Short Tank',
    radius: 0.75,
    length: 4,
    description:
      'A 1.5 m diameter common-bulkhead tank. Small enough for sounding rockets ' +
      'and satellite kick stages.',
  }),
  tankDef({
    id: 'tank-15-m',
    name: 'T15 Long Tank',
    radius: 0.75,
    length: 8,
    description: 'Stretched 1.5 m tank. Doubles the burn time of a small stage.',
  }),
  tankDef({
    id: 'tank-24-s',
    name: 'T24 Short Tank',
    radius: 1.2,
    length: 6,
    description:
      '2.4 m diameter tank. The usual choice for an upper stage under a medium ' +
      'fairing.',
  }),
  tankDef({
    id: 'tank-24-m',
    name: 'T24 Long Tank',
    radius: 1.2,
    length: 12,
    description:
      'Stretched 2.4 m tank. Watch the slenderness ratio — long thin stacks are ' +
      'aerodynamically twitchy.',
  }),
  tankDef({
    id: 'tank-37-s',
    name: 'T37 Short Tank',
    radius: 1.85,
    length: 8,
    description:
      '3.7 m core-diameter tank, short barrel. Standard upper stage for the ' +
      'heavy launcher.',
  }),
  tankDef({
    id: 'tank-37-md',
    name: 'T37 Extended Upper Tank',
    radius: 1.85,
    length: 12,
    description:
      'A stretched 3.7 m upper-stage tank. Moving propellant from the booster ' +
      'into the vacuum stage buys more usable delta-v, because the vacuum engine ' +
      'converts it far more efficiently.',
  }),
  tankDef({
    id: 'tank-37-m',
    name: 'T37 Core Tank',
    radius: 1.85,
    length: 16,
    description:
      '3.7 m core tank. Together with an octaweb this is a complete first stage.',
  }),
  tankDef({
    id: 'tank-37-l',
    name: 'T37 Stretch Tank',
    radius: 1.85,
    length: 24,
    description:
      'Maximum-stretch 3.7 m core. Holds a quarter of a kilotonne of propellant ' +
      'and needs serious thrust under it to move at all.',
    painted: false,
  }),
  tankDef({
    id: 'tank-rcs',
    name: 'Monopropellant Sphere',
    radius: 0.45,
    length: 0.9,
    description:
      'Spherical service tank for attitude control and small trim burns.',
    painted: false,
  }),
];

// ---------------------------------------------------------------------------
// STRUCTURAL
// ---------------------------------------------------------------------------

const STRUCTURAL: PartDef[] = [
  {
    id: 'nose-24',
    name: 'Ogive Nose Cone 2.4 m',
    category: PartCategory.STRUCTURAL,
    function: 'Aerodynamic nose',
    description:
      'Tangent-ogive nose with a blunted tip and a pitot boom. Cuts transonic ' +
      'drag dramatically compared with a flat-topped stack.',
    mass: 180,
    dimensions: [2.4, 3.6, 2.4],
    cost: 150,
    nodes: [
      { id: 'bottom', position: [0, 0, 0], facing: 'bottom', diameter: 2.4 },
      { id: 'top', position: [0, 3.6, 0], facing: 'top', diameter: 0.4 },
    ],
    aero: { area: areaOf(1.2), dragCoefficient: 0.12, liftAuthority: 0 },
    structuralLimit: 4.6e6,
    build: () => buildNoseCone(1.2, 3.6),
  },
  {
    id: 'nose-37',
    name: 'Ogive Nose Cone 3.7 m',
    category: PartCategory.STRUCTURAL,
    function: 'Aerodynamic nose',
    description: 'Core-diameter ogive nose for vehicles flying without a fairing.',
    mass: 340,
    dimensions: [3.7, 5.4, 3.7],
    cost: 240,
    nodes: [
      { id: 'bottom', position: [0, 0, 0], facing: 'bottom', diameter: 3.7 },
      { id: 'top', position: [0, 5.4, 0], facing: 'top', diameter: 0.5 },
    ],
    aero: { area: areaOf(1.85), dragCoefficient: 0.12, liftAuthority: 0 },
    structuralLimit: 9.2e6,
    build: () => buildNoseCone(1.85, 5.4),
  },
  {
    id: 'fairing-37',
    name: 'Payload Fairing 3.7 m',
    category: PartCategory.STRUCTURAL,
    function: 'Payload protection',
    description:
      'Two carbon-composite clamshell halves that shield the payload through the ' +
      'dense atmosphere, then separate and fall away once dynamic pressure is ' +
      'negligible. Anything you mount inside must fit within it.',
    mass: 900,
    dimensions: [3.7, 9, 3.7],
    cost: 520,
    nodes: [{ id: 'bottom', position: [0, 0, 0], facing: 'bottom', diameter: 3.7 }],
    aero: { area: areaOf(1.85), dragCoefficient: 0.15, liftAuthority: 0 },
    structuralLimit: 3.2e6,
    enclosing: true,
    build: () => buildFairing(1.85, 9),
  },
  {
    id: 'fairing-52',
    name: 'Payload Fairing 5.2 m',
    category: PartCategory.STRUCTURAL,
    function: 'Payload protection',
    description:
      'Wide-body fairing for bulky spacecraft. The extra frontal area costs ' +
      'noticeable drag during ascent.',
    mass: 1_900,
    dimensions: [5.2, 13, 5.2],
    cost: 1_100,
    nodes: [{ id: 'bottom', position: [0, 0, 0], facing: 'bottom', diameter: 3.7 }],
    aero: { area: areaOf(2.6), dragCoefficient: 0.16, liftAuthority: 0 },
    structuralLimit: 3.2e6,
    enclosing: true,
    build: () => buildFairing(2.6, 13),
  },
  {
    id: 'interstage-37',
    name: 'Interstage 3.7 m',
    category: PartCategory.STRUCTURAL,
    function: 'Stage connection',
    description:
      'Open truss bay carrying the upper stage above the booster. Houses the ' +
      'pneumatic pushers that physically separate the two stages.',
    mass: 520,
    dimensions: [3.7, 4.5, 3.7],
    cost: 300,
    nodes: stackNodes(3.7, 4.5),
    aero: { area: areaOf(1.85), dragCoefficient: 0.4, liftAuthority: 0 },
    structuralLimit: 8.4e6,
    build: () => buildInterstage(1.85, 1.85, 4.5, true),
  },
  {
    id: 'interstage-24',
    name: 'Interstage 2.4 m',
    category: PartCategory.STRUCTURAL,
    function: 'Stage connection',
    description: 'Closed-skin interstage for the medium-class stack.',
    mass: 260,
    dimensions: [2.4, 3, 2.4],
    cost: 180,
    nodes: stackNodes(2.4, 3),
    aero: { area: areaOf(1.2), dragCoefficient: 0.3, liftAuthority: 0 },
    structuralLimit: 4.6e6,
    build: () => buildInterstage(1.2, 1.2, 3, false),
  },
  {
    id: 'decoupler-37',
    name: 'Separation Ring 3.7 m',
    category: PartCategory.STRUCTURAL,
    function: 'Stage separation',
    description:
      'Frangible-joint separation ring with pusher springs. Fires once, cleanly, ' +
      'and everything below it becomes someone else’s problem.',
    mass: 120,
    dimensions: [3.7, 1.04, 3.7],
    cost: 110,
    nodes: stackNodes(3.7, 1.04),
    structuralLimit: 7.2e6,
    build: () => buildDecoupler(1.85),
  },
  {
    id: 'decoupler-24',
    name: 'Separation Ring 2.4 m',
    category: PartCategory.STRUCTURAL,
    function: 'Stage separation',
    description: 'Medium-class separation ring.',
    mass: 70,
    dimensions: [2.4, 0.67, 2.4],
    cost: 70,
    nodes: stackNodes(2.4, 0.67),
    structuralLimit: 4.2e6,
    build: () => buildDecoupler(1.2),
  },
  {
    id: 'adapter-37-24',
    name: 'Adapter 3.7 → 2.4 m',
    category: PartCategory.STRUCTURAL,
    function: 'Diameter transition',
    description:
      'Conical adapter between core and medium diameters, so mismatched stages ' +
      'still make a structurally sensible stack.',
    mass: 210,
    dimensions: [3.7, 2.2, 3.7],
    cost: 140,
    nodes: [
      { id: 'bottom', position: [0, 0, 0], facing: 'bottom', diameter: 3.7 },
      { id: 'top', position: [0, 2.2, 0], facing: 'top', diameter: 2.4 },
    ],
    aero: { area: areaOf(1.85), dragCoefficient: 0.28, liftAuthority: 0 },
    structuralLimit: 5.6e6,
    build: () => buildAdapter(1.85, 1.2, 2.2),
  },
  {
    id: 'adapter-24-15',
    name: 'Adapter 2.4 → 1.5 m',
    category: PartCategory.STRUCTURAL,
    function: 'Diameter transition',
    description: 'Conical adapter between medium and small diameters.',
    mass: 95,
    dimensions: [2.4, 1.5, 2.4],
    cost: 85,
    nodes: [
      { id: 'bottom', position: [0, 0, 0], facing: 'bottom', diameter: 2.4 },
      { id: 'top', position: [0, 1.5, 0], facing: 'top', diameter: 1.5 },
    ],
    aero: { area: areaOf(1.2), dragCoefficient: 0.28, liftAuthority: 0 },
    structuralLimit: 3.1e6,
    build: () => buildAdapter(1.2, 0.75, 1.5),
  },
  {
    id: 'fin-aero',
    name: 'Stabiliser Fin',
    category: PartCategory.STRUCTURAL,
    function: 'Aerodynamic stability',
    description:
      'A fixed aerodynamic surface mounted low on the vehicle. Fins move the ' +
      'centre of pressure aft of the centre of mass, which is what keeps a rocket ' +
      'flying nose-first instead of tumbling.',
    mass: 65,
    dimensions: [2.2, 3, 0.3],
    cost: 120,
    nodes: [{ id: 'radial', position: [0, 0, 0], facing: 'radial', diameter: 0.4 }],
    aero: { area: 2.4, dragCoefficient: 0.06, liftAuthority: 1 },
    structuralLimit: 8e5,
    build: () => buildFin(2.2, 3, 1.1),
  },
  {
    id: 'fin-grid',
    name: 'Grid Fin',
    category: PartCategory.STRUCTURAL,
    function: 'Descent control surface',
    description:
      'Titanium lattice control surface. Folds flat during ascent and provides ' +
      'high control authority at hypersonic and transonic speeds on the way down.',
    mass: 140,
    dimensions: [1.5, 1.3, 0.2],
    cost: 260,
    nodes: [{ id: 'radial', position: [0, 0, 0], facing: 'radial', diameter: 0.4 }],
    aero: { area: 1.3, dragCoefficient: 0.5, liftAuthority: 1.4 },
    structuralLimit: 1.2e6,
    build: () => buildGridFin(1.5, 1.3),
  },
];

// ---------------------------------------------------------------------------
// AVIONICS / POWER / COMMS / THERMAL
// ---------------------------------------------------------------------------

const SYSTEMS: PartDef[] = [
  {
    id: 'avionics-37',
    name: 'Flight Computer Ring 3.7 m',
    category: PartCategory.AVIONICS,
    function: 'Guidance and command',
    description:
      'Triple-redundant flight computer, inertial measurement unit and star ' +
      'tracker. Without a command module the vehicle has no guidance authority ' +
      'and cannot fly its ascent profile.',
    mass: 260,
    dimensions: [3.7, 1.2, 3.7],
    cost: 720,
    nodes: stackNodes(3.7, 1.2),
    hasCommandModule: true,
    power: { outputW: -180, storageWh: 400, deployable: false },
    structuralLimit: 6.8e6,
    build: () => buildAvionics(1.85, 1.2),
  },
  {
    id: 'avionics-24',
    name: 'Flight Computer Ring 2.4 m',
    category: PartCategory.AVIONICS,
    function: 'Guidance and command',
    description: 'Medium-class avionics ring with the same command authority.',
    mass: 160,
    dimensions: [2.4, 0.9, 2.4],
    cost: 540,
    nodes: stackNodes(2.4, 0.9),
    hasCommandModule: true,
    power: { outputW: -140, storageWh: 300, deployable: false },
    structuralLimit: 4.2e6,
    build: () => buildAvionics(1.2, 0.9),
  },
  {
    id: 'battery-pack',
    name: 'Battery Pack',
    category: PartCategory.POWER,
    function: 'Energy storage',
    description:
      'Lithium-ion pack sized for launch and early orbit operations. Every ' +
      'vehicle needs enough stored energy to run avionics until its arrays are ' +
      'generating.',
    mass: 85,
    dimensions: [0.8, 0.6, 0.7],
    cost: 180,
    nodes: [{ id: 'radial', position: [0, 0, 0], facing: 'radial', diameter: 0.6 }],
    power: { outputW: 0, storageWh: 3_200, deployable: false },
    build: () => buildBattery(0.8),
  },
  {
    id: 'solar-wing',
    name: 'Deployable Solar Wing',
    category: PartCategory.POWER,
    function: 'Power generation',
    description:
      'Four-panel folding array. Stowed flat against the spacecraft for launch, ' +
      'it unfolds panel by panel once the payload is free of the fairing.',
    mass: 110,
    dimensions: [8, 0.2, 2],
    cost: 460,
    nodes: [{ id: 'radial', position: [0, 0, 0], facing: 'radial', diameter: 0.5 }],
    power: { outputW: 2_600, storageWh: 0, deployable: true },
    build: () => buildSolarWing(2, 1.6, 4),
  },
  {
    id: 'solar-body',
    name: 'Body-Mounted Panel',
    category: PartCategory.POWER,
    function: 'Power generation',
    description:
      'Fixed panel bonded directly to the spacecraft skin. Less output than a ' +
      'deployable wing, but nothing can fail to unfold.',
    mass: 42,
    dimensions: [1.4, 0.1, 1.4],
    cost: 190,
    nodes: [{ id: 'radial', position: [0, 0, 0], facing: 'radial', diameter: 0.5 }],
    power: { outputW: 620, storageWh: 0, deployable: false },
    build: () => buildBodyPanel(1.4, 1.4),
  },
  {
    id: 'antenna-dish',
    name: 'High-Gain Dish',
    category: PartCategory.COMMUNICATION,
    function: 'Deep-space communication',
    description:
      'Two-metre parabolic reflector on a two-axis gimbal. Stowed against the bus ' +
      'for launch, deployed and pointed at the home station once on station. ' +
      'Required for any mission beyond Earth orbit.',
    mass: 96,
    dimensions: [2, 2.4, 2],
    cost: 620,
    nodes: [{ id: 'radial', position: [0, 0, 0], facing: 'radial', diameter: 0.6 }],
    comms: { rangeM: 4.5e11, deployable: true },
    power: { outputW: -220, storageWh: 0, deployable: false },
    build: () => buildDishAntenna(1),
  },
  {
    id: 'antenna-whip',
    name: 'Omni Whip Antenna',
    category: PartCategory.COMMUNICATION,
    function: 'Short-range telemetry',
    description:
      'Low-gain omnidirectional antenna. Works without pointing, which is exactly ' +
      'what you want during ascent and tumbling, but its range is limited to near ' +
      'Earth space.',
    mass: 12,
    dimensions: [0.2, 1.4, 0.2],
    cost: 120,
    nodes: [{ id: 'radial', position: [0, 0, 0], facing: 'radial', diameter: 0.3 }],
    comms: { rangeM: 2.5e7, deployable: false },
    build: () => buildWhipAntenna(1.2),
  },
  {
    id: 'radiator-panel',
    name: 'Thermal Radiator',
    category: PartCategory.THERMAL,
    function: 'Heat rejection',
    description:
      'Pumped-loop radiator that dumps waste heat from the avionics and power ' +
      'system to space.',
    mass: 58,
    dimensions: [2, 0.1, 1.6],
    cost: 230,
    nodes: [{ id: 'radial', position: [0, 0, 0], facing: 'radial', diameter: 0.5 }],
    thermal: { heatCapacity: 1.2e6, coverage: 0 },
    build: () => buildRadiator(2, 1.6),
  },
  {
    id: 'heatshield-37',
    name: 'Aeroshell Heat Shield 3.7 m',
    category: PartCategory.THERMAL,
    function: 'Atmospheric entry protection',
    description:
      'A 70-degree sphere-cone ablator. Entering Mars at interplanetary speed ' +
      'dumps enormous energy into the vehicle; without a shield sized for the ' +
      'job, the spacecraft does not survive to the parachute phase.',
    mass: 640,
    dimensions: [3.7, 1.1, 3.7],
    cost: 780,
    nodes: [{ id: 'top', position: [0, 0, 0], facing: 'top', diameter: 3.7 }],
    thermal: { heatCapacity: 2.4e8, coverage: 1 },
    aero: { area: areaOf(1.85), dragCoefficient: 1.55, liftAuthority: 0.2 },
    structuralLimit: 5e6,
    build: () => buildHeatShield(1.85),
  },
  {
    id: 'heatshield-24',
    name: 'Aeroshell Heat Shield 2.4 m',
    category: PartCategory.THERMAL,
    function: 'Atmospheric entry protection',
    description: 'Smaller entry aeroshell for medium-class landers.',
    mass: 290,
    dimensions: [2.4, 0.72, 2.4],
    cost: 480,
    nodes: [{ id: 'top', position: [0, 0, 0], facing: 'top', diameter: 2.4 }],
    thermal: { heatCapacity: 1.05e8, coverage: 1 },
    aero: { area: areaOf(1.2), dragCoefficient: 1.55, liftAuthority: 0.2 },
    structuralLimit: 3e6,
    build: () => buildHeatShield(1.2),
  },
];

// ---------------------------------------------------------------------------
// LANDING
// ---------------------------------------------------------------------------

const LANDING: PartDef[] = [
  {
    id: 'legs-heavy',
    name: 'Landing Legs (Heavy)',
    category: PartCategory.LANDING,
    function: 'Propulsive landing gear',
    description:
      'Four carbon-and-aluminium legs with crushable shock cartridges. Folded ' +
      'against the stage for launch, deployed shortly before touchdown. Rated to ' +
      'about 6 m/s vertical.',
    mass: 1_900,
    dimensions: [11, 9, 11],
    cost: 950,
    nodes: [{ id: 'radial', position: [0, 0, 0], facing: 'radial', diameter: 3.7 }],
    landing: { kind: 'legs', maxTouchdownSpeed: 6 },
    build: (ctx) => buildLandingLegs(ctx.stackDiameter / 2, 5.2, 4),
  },
  {
    id: 'legs-light',
    name: 'Landing Legs (Light)',
    category: PartCategory.LANDING,
    function: 'Lander gear',
    description:
      'Lightweight three-point gear for small landers. Rated to about 4 m/s ' +
      'vertical — come in faster than that and something folds.',
    mass: 380,
    dimensions: [5, 3.6, 5],
    cost: 380,
    nodes: [{ id: 'radial', position: [0, 0, 0], facing: 'radial', diameter: 2.4 }],
    landing: { kind: 'legs', maxTouchdownSpeed: 4 },
    build: (ctx) => buildLandingLegs(ctx.stackDiameter / 2, 2.4, 3),
  },
  {
    id: 'chute-main',
    name: 'Main Parachute',
    category: PartCategory.LANDING,
    function: 'Aerodynamic deceleration',
    description:
      'A 21.5 m disk-gap-band canopy, mortar-deployed. It only works where there ' +
      'is air to catch: on Mars the atmosphere is about one percent of Earth’s, ' +
      'so a chute alone will never bring a heavy lander to a survivable speed.',
    mass: 165,
    dimensions: [1.2, 1.6, 1.2],
    cost: 340,
    nodes: [{ id: 'bottom', position: [0, 0, 0], facing: 'bottom', diameter: 1.2 }],
    landing: {
      kind: 'parachute',
      maxTouchdownSpeed: 9,
      chuteArea: 363,
      maxDeployPressure: 1_100,
    },
    build: () => buildParachute(10.75, 0.6),
  },
  {
    id: 'chute-drogue',
    name: 'Drogue Parachute',
    category: PartCategory.LANDING,
    function: 'High-speed stabilisation',
    description:
      'Small, strong canopy that can be deployed at high dynamic pressure to ' +
      'stabilise and slow a vehicle enough for the mains to open safely.',
    mass: 60,
    dimensions: [0.8, 1.1, 0.8],
    cost: 180,
    nodes: [{ id: 'bottom', position: [0, 0, 0], facing: 'bottom', diameter: 0.8 }],
    landing: {
      kind: 'parachute',
      maxTouchdownSpeed: 30,
      chuteArea: 48,
      maxDeployPressure: 9_500,
    },
    build: () => buildParachute(3.9, 0.4),
  },
  {
    id: 'airbag-cluster',
    name: 'Impact Airbags',
    category: PartCategory.LANDING,
    function: 'Impact attenuation',
    description:
      'Inflatable vectran bladders that let a small lander bounce to a stop. ' +
      'Crude, cheap, and surprisingly tolerant of a bad final approach.',
    mass: 240,
    dimensions: [4, 2, 4],
    cost: 300,
    nodes: [{ id: 'bottom', position: [0, 0, 0], facing: 'bottom', diameter: 2.4 }],
    landing: { kind: 'airbag', maxTouchdownSpeed: 14 },
    build: () => buildAirbags(2),
  },
  {
    id: 'rover-wheel',
    name: 'Rover Wheel',
    category: PartCategory.ROVER,
    function: 'Surface mobility',
    description:
      'Machined aluminium wheel with compliant spokes and cleated tread, sized ' +
      'for loose regolith. Six of these will carry a rover over almost anything.',
    mass: 12,
    dimensions: [0.3, 0.52, 0.52],
    cost: 95,
    nodes: [{ id: 'radial', position: [0, 0, 0], facing: 'radial', diameter: 0.3 }],
    landing: { kind: 'wheels', maxTouchdownSpeed: 3 },
    build: () => buildWheel(0.26, 0.22),
  },
];

// ---------------------------------------------------------------------------
// SCIENCE / ROBOTICS
// ---------------------------------------------------------------------------

const SCIENCE: PartDef[] = [
  {
    id: 'science-bay',
    name: 'Instrument Bay',
    category: PartCategory.SCIENCE,
    function: 'Science payload',
    description:
      'Multispectral imager, spectrometer and environmental sensor suite in a ' +
      'thermally controlled bay. This is what a mission is actually for.',
    mass: 130,
    dimensions: [1.1, 1, 1],
    cost: 640,
    nodes: [{ id: 'radial', position: [0, 0, 0], facing: 'radial', diameter: 0.8 }],
    scienceValue: 40,
    power: { outputW: -120, storageWh: 0, deployable: false },
    build: (ctx) => buildScienceBay(1.1, ctx.seed),
  },
  {
    id: 'science-drill',
    name: 'Sample Drill',
    category: PartCategory.SCIENCE,
    function: 'Subsurface sampling',
    description:
      'Percussive coring drill able to reach material that has never been exposed ' +
      'to the surface radiation environment.',
    mass: 78,
    dimensions: [0.5, 1.6, 0.5],
    cost: 520,
    nodes: [{ id: 'radial', position: [0, 0, 0], facing: 'radial', diameter: 0.5 }],
    scienceValue: 55,
    power: { outputW: -300, storageWh: 0, deployable: false },
    build: () => buildDrill(1),
  },
  {
    id: 'robotic-arm',
    name: 'Robotic Arm',
    category: PartCategory.ROBOTICS,
    function: 'Manipulation',
    description:
      'Five-degree-of-freedom arm with a parallel-jaw gripper, for placing ' +
      'instruments and handling samples.',
    mass: 92,
    dimensions: [0.6, 2.2, 0.6],
    cost: 580,
    nodes: [{ id: 'radial', position: [0, 0, 0], facing: 'radial', diameter: 0.5 }],
    scienceValue: 20,
    power: { outputW: -160, storageWh: 0, deployable: false },
    build: () => buildRoboticArm(2.2),
  },
];

// ---------------------------------------------------------------------------
// PAYLOAD / SATELLITE / ROVER
// ---------------------------------------------------------------------------

const PAYLOADS: PartDef[] = [
  {
    id: 'sat-bus',
    name: 'Satellite Bus',
    category: PartCategory.SATELLITE,
    function: 'Spacecraft core',
    description:
      'Octagonal spacecraft structure with its own tankage, apogee engine, ' +
      'attitude thrusters and star trackers. Add wings and an antenna and you ' +
      'have a working satellite.',
    mass: 620,
    dimensions: [2.2, 2.6, 2.2],
    cost: 1_600,
    nodes: [
      { id: 'bottom', position: [0, -1.3, 0], facing: 'bottom', diameter: 1.6 },
      { id: 'top', position: [0, 1.3, 0], facing: 'top', diameter: 1.6 },
      { id: 'radial', position: [0, 0, 0], facing: 'radial', diameter: 1.6 },
    ],
    hasCommandModule: true,
    power: { outputW: -240, storageWh: 900, deployable: false },
    scienceValue: 15,
    structuralLimit: 1.4e6,
    build: (ctx) => buildSatelliteBus(1.5, ctx.seed),
  },
  {
    id: 'probe-bus',
    name: 'Deep Space Probe',
    category: PartCategory.SATELLITE,
    function: 'Interplanetary spacecraft',
    description:
      'Compact probe bus with a radioisotope power unit on a boom, so it keeps ' +
      'working where sunlight is thin.',
    mass: 380,
    dimensions: [2.6, 1.6, 1.6],
    cost: 1_900,
    nodes: [
      { id: 'bottom', position: [0, -0.8, 0], facing: 'bottom', diameter: 1.2 },
      { id: 'top', position: [0, 0.8, 0], facing: 'top', diameter: 1.2 },
    ],
    hasCommandModule: true,
    power: { outputW: 320, storageWh: 600, deployable: false },
    scienceValue: 35,
    structuralLimit: 9e5,
    build: () => buildProbeBus(1.2),
  },
  {
    id: 'lander-deck',
    name: 'Lander Deck',
    category: PartCategory.PAYLOAD,
    function: 'Surface platform',
    description:
      'Hexagonal load-bearing deck with slung propellant tanks. Mount descent ' +
      'engines below and a rover or instruments above.',
    mass: 540,
    dimensions: [4, 1.2, 4],
    cost: 1_100,
    nodes: [
      { id: 'bottom', position: [0, -0.6, 0], facing: 'bottom', diameter: 2.4 },
      { id: 'top', position: [0, 0.6, 0], facing: 'top', diameter: 2.4 },
    ],
    tank: { propellantMass: 1_400 },
    structuralLimit: 2.2e6,
    build: () => buildLanderDeck(2),
  },
  {
    id: 'rover-chassis',
    name: 'Rover Chassis',
    category: PartCategory.ROVER,
    function: 'Mobile surface platform',
    description:
      'Warm electronics box on a rocker-bogie frame, with a mast-mounted stereo ' +
      'camera pair. Add wheels, power and instruments to complete the rover.',
    mass: 320,
    dimensions: [2, 1.4, 3],
    cost: 1_400,
    nodes: [
      { id: 'bottom', position: [0, -0.5, 0], facing: 'bottom', diameter: 1.8 },
      { id: 'top', position: [0, 0.5, 0], facing: 'top', diameter: 1.8 },
      { id: 'radial', position: [0, 0, 0], facing: 'radial', diameter: 1.8 },
    ],
    hasCommandModule: true,
    power: { outputW: -200, storageWh: 1_800, deployable: false },
    scienceValue: 30,
    structuralLimit: 8e5,
    build: () => buildRoverChassis(3, 2),
  },
  {
    id: 'capsule',
    name: 'Return Capsule',
    category: PartCategory.PAYLOAD,
    function: 'Pressurised module',
    description:
      'Pressurised capsule with a docking ring and an integral base heat shield. ' +
      'Comfortably seats two ducks, allegedly.',
    mass: 1_450,
    dimensions: [3, 4.5, 3],
    cost: 2_400,
    nodes: [
      { id: 'bottom', position: [0, 0, 0], facing: 'bottom', diameter: 3 },
      { id: 'top', position: [0, 4.5, 0], facing: 'top', diameter: 1.2 },
    ],
    hasCommandModule: true,
    thermal: { heatCapacity: 6e7, coverage: 0.7 },
    aero: { area: areaOf(1.5), dragCoefficient: 1.2, liftAuthority: 0.1 },
    power: { outputW: -160, storageWh: 2_200, deployable: false },
    structuralLimit: 2.6e6,
    build: () => buildCapsule(1.5),
  },
  {
    id: 'ballast',
    name: 'Mass Simulator',
    category: PartCategory.PAYLOAD,
    function: 'Inert test mass',
    description:
      'A block of instrumented concrete. Flies on qualification launches so that ' +
      'if the vehicle fails, nothing expensive is lost.',
    mass: 2_000,
    dimensions: [1.6, 1.6, 1.6],
    cost: 60,
    nodes: [
      { id: 'bottom', position: [0, 0, 0], facing: 'bottom', diameter: 1.6 },
      { id: 'top', position: [0, 1.6, 0], facing: 'top', diameter: 1.6 },
    ],
    structuralLimit: 9e6,
    build: () => {
      const g = new THREE.Group();
      const block = new THREE.Mesh(
        new THREE.BoxGeometry(1.6, 1.6, 1.6),
        new THREE.MeshStandardMaterial({ color: 0x8a8a84, roughness: 0.95 }),
      );
      block.castShadow = true;
      block.receiveShadow = true;
      block.position.y = 0.8;
      g.add(block);
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        const eye = new THREE.Mesh(
          new THREE.TorusGeometry(0.09, 0.02, 6, 12),
          new THREE.MeshStandardMaterial({ color: 0x9aa1a9, metalness: 0.9, roughness: 0.4 }),
        );
        eye.position.set(Math.sin(a) * 0.5, 1.6, Math.cos(a) * 0.5);
        g.add(eye);
      }
      return g;
    },
  },
];

// ---------------------------------------------------------------------------
// DECORATION / CHAOS
// ---------------------------------------------------------------------------

interface ChaosTemplate {
  id: string;
  name: string;
  category: PartCategory;
  description: string;
  mass: number;
  dimensions: [number, number, number];
  cost: number;
  build: () => THREE.Object3D;
}

function chaosDef(t: ChaosTemplate): PartDef {
  return {
    id: t.id,
    name: t.name,
    category: t.category,
    function: t.category === PartCategory.CHAOS ? 'Questionable payload' : 'Set dressing',
    description: t.description,
    mass: t.mass,
    dimensions: t.dimensions,
    cost: t.cost,
    nodes: [
      { id: 'bottom', position: [0, 0, 0], facing: 'bottom', diameter: t.dimensions[0] },
      { id: 'top', position: [0, t.dimensions[1], 0], facing: 'top', diameter: t.dimensions[0] },
      { id: 'radial', position: [0, t.dimensions[1] / 2, 0], facing: 'radial', diameter: t.dimensions[0] },
    ],
    // Chaos parts are bluff bodies: honest mass and honest, terrible drag.
    aero: {
      area: t.dimensions[0] * t.dimensions[2],
      dragCoefficient: 1.05,
      liftAuthority: 0,
    },
    structuralLimit: 4e4,
    build: t.build,
  };
}

const CHAOS: PartDef[] = [
  chaosDef({
    id: 'chaos-couch',
    name: 'Two-Seat Couch',
    category: PartCategory.CHAOS,
    description:
      'Upholstered, comfortable, and aerodynamically catastrophic. Mission ' +
      'control has formally objected. Twice.',
    mass: 95,
    dimensions: [2.2, 1, 1],
    cost: 40,
    build: () => buildCouch(2.2),
  }),
  chaosDef({
    id: 'chaos-toilet',
    name: 'Ceramic Toilet',
    category: PartCategory.CHAOS,
    description:
      'A fully plumbed sanitary fixture. Structurally it is a brittle ceramic ' +
      'pressure vessel, which is not a phrase anyone wants on a flight manifest.',
    mass: 45,
    dimensions: [0.7, 1.1, 0.8],
    cost: 30,
    build: () => buildToilet(1.1),
  }),
  chaosDef({
    id: 'chaos-rubberduck',
    name: 'Giant Rubber Duck',
    category: PartCategory.CHAOS,
    description:
      'Official agency merchandise, scaled up considerably. The flight crew ' +
      'insisted. The flight crew are ducks.',
    mass: 30,
    dimensions: [1.4, 1.2, 1.6],
    cost: 25,
    build: () => buildRubberDuck(1.4),
  }),
  chaosDef({
    id: 'chaos-chair',
    name: 'Office Chair',
    category: PartCategory.CHAOS,
    description:
      'Ergonomic, adjustable, and on castors — which is going to be interesting ' +
      'under 3 g of acceleration.',
    mass: 18,
    dimensions: [0.7, 1.2, 0.7],
    cost: 20,
    build: () => buildOfficeChair(1.2),
  }),
  chaosDef({
    id: 'chaos-tv',
    name: 'Flat-Screen Television',
    category: PartCategory.CHAOS,
    description:
      'For watching the launch, from inside the launch. Nobody has explained how ' +
      'this is supposed to work.',
    mass: 22,
    dimensions: [1.3, 0.95, 0.3],
    cost: 35,
    build: () => buildTelevision(1.3),
  }),
  chaosDef({
    id: 'chaos-fridge',
    name: 'Refrigerator',
    category: PartCategory.CHAOS,
    description:
      'Two hundred litres of cold storage. Heavy, boxy, and the single worst ' +
      'thing you could bolt to the outside of an ascending rocket.',
    mass: 78,
    dimensions: [0.8, 1.8, 0.72],
    cost: 55,
    build: () => buildRefrigerator(1.8),
  }),
  chaosDef({
    id: 'chaos-cone',
    name: 'Traffic Cone',
    category: PartCategory.CHAOS,
    description:
      'Reflective collar, weighted base, universally understood. Arguably the ' +
      'most flight-proven object in the entire catalogue.',
    mass: 4,
    dimensions: [0.5, 0.9, 0.5],
    cost: 8,
    build: () => buildTrafficCone(0.9),
  }),
  chaosDef({
    id: 'chaos-gnome',
    name: 'Garden Gnome',
    category: PartCategory.CHAOS,
    description:
      'Ceramic, cheerful, and entirely unqualified. Has nonetheless been assigned ' +
      'a part number and an inspection record.',
    mass: 9,
    dimensions: [0.4, 0.7, 0.4],
    cost: 15,
    build: () => buildGardenGnome(0.7),
  }),
  chaosDef({
    id: 'chaos-mug',
    name: 'Mission Control Mug',
    category: PartCategory.CHAOS,
    description:
      'Still half full. The contents are considered a sloshing liquid mass and ' +
      'were modelled accordingly, because someone insisted.',
    mass: 1,
    dimensions: [0.25, 0.3, 0.2],
    cost: 5,
    build: () => buildCoffeeMug(0.3),
  }),
  chaosDef({
    id: 'deco-plant',
    name: 'Potted Plant',
    category: PartCategory.DECORATION,
    description:
      'Brightens the workshop considerably. Has survived three vehicle failures ' +
      'and one small fire.',
    mass: 8,
    dimensions: [0.4, 0.8, 0.4],
    cost: 12,
    build: () => buildPottedPlant(0.8),
  }),
  chaosDef({
    id: 'deco-toolbox',
    name: 'Toolbox',
    category: PartCategory.DECORATION,
    description:
      'Standard workshop toolbox. Please do not leave it inside the fairing this ' +
      'time.',
    mass: 16,
    dimensions: [0.6, 0.35, 0.3],
    cost: 18,
    build: () => buildToolbox(0.6),
  }),
];

// ---------------------------------------------------------------------------

/** Every part in the game, in a stable order. */
export const PART_CATALOG: readonly PartDef[] = [
  ...STRUCTURAL,
  ...ENGINES,
  RCS_PART,
  ...TANKS,
  ...SYSTEMS,
  ...LANDING,
  ...SCIENCE,
  ...PAYLOADS,
  ...CHAOS,
];

const byId = new Map<string, PartDef>(PART_CATALOG.map((p) => [p.id, p]));

export function getPart(id: string): PartDef {
  const p = byId.get(id);
  if (!p) throw new Error(`Unknown part id: ${id}`);
  return p;
}

export function partsInCategory(category: PartCategory): PartDef[] {
  return PART_CATALOG.filter((p) => p.category === category);
}
