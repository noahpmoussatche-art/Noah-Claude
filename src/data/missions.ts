/**
 * Mission definitions (spec §75, §78).
 *
 * A mission states where the vehicle is going and what it has to survive to get
 * there. The pre-flight check reads these requirements, so a Mars mission
 * genuinely demands a heat shield and a deep-space antenna while a suborbital
 * hop does not.
 */
import type { VehicleDesign } from '../vehicles/VehicleDesign';

export type MissionDestination = 'suborbital' | 'earth-orbit' | 'mars-surface';

export interface MissionDef {
  readonly id: string;
  readonly name: string;
  readonly subtitle: string;
  readonly destination: MissionDestination;
  readonly briefing: string;
  /** Objectives shown in the HUD. */
  readonly objectives: readonly string[];
  /** Target circular orbit altitude, m (ignored for suborbital). */
  readonly targetAltitude: number;
  readonly requiresLanding: boolean;
  readonly requiresDeepSpaceComms: boolean;
  /** A design that satisfies this mission, used by the tutorial and as a preset. */
  readonly referenceDesign: VehicleDesign;
}

/**
 * The reference two-stage launcher. Roughly 3.7 m core diameter and 55 m tall,
 * which puts it in the same class as a real medium-lift vehicle — and makes a
 * duck standing beside it about 1/100 of its height (spec §21).
 */
export const PIONEER_LAUNCHER: VehicleDesign = {
  name: 'OSA Pioneer',
  stack: [
    {
      partId: 'eng-vulcan9-x9',
      stage: 0,
    },
    {
      partId: 'tank-37-l',
      stage: 0,
      radial: [
        // Aerodynamic fins low on the booster give the stack a positive static
        // margin; the grid fins high up are descent control surfaces.
        { partId: 'fin-aero', count: 4, heightFraction: 0.06 },
        { partId: 'fin-grid', count: 4, heightFraction: 0.94 },
        { partId: 'legs-heavy', count: 1, heightFraction: 0.02 },
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
        { partId: 'antenna-whip', count: 1, heightFraction: 0.85, angleOffset: 1.6 },
      ],
    },
    { partId: 'decoupler-37', stage: 1 },
    { partId: 'fairing-37', stage: 3 },
    { partId: 'ballast', stage: 2 },
  ],
};

/**
 * The complete Mars stack: the heavy launcher with the Ares lander riding
 * inside the fairing. This is what the Mars mission's checks actually require —
 * an aeroshell, a deep-space dish, a parachute and a restartable descent
 * engine — so the reference design has to carry the whole vehicle, not just the
 * booster underneath it.
 */
export const ARES_STACK: VehicleDesign = {
  name: 'OSA Ares',
  stack: [
    { partId: 'eng-vulcan9-x9', stage: 0 },
    {
      partId: 'tank-37-l',
      stage: 0,
      radial: [
        // Fins low on the booster, which is what puts the centre of pressure
        // below the centre of mass and keeps the stack flying nose-first.
        { partId: 'fin-aero', count: 4, heightFraction: 0.06 },
        { partId: 'fin-grid', count: 4, heightFraction: 0.94 },
        { partId: 'legs-heavy', count: 1, heightFraction: 0.02 },
      ],
    },
    { partId: 'interstage-37', stage: 0 },
    { partId: 'decoupler-37', stage: 0 },

    { partId: 'eng-vulcan-vac', stage: 1 },
    { partId: 'tank-37-md', stage: 1 },
    {
      partId: 'avionics-37',
      stage: 1,
      radial: [
        { partId: 'battery-pack', count: 2, heightFraction: 0.5 },
        { partId: 'antenna-whip', count: 1, heightFraction: 0.85, angleOffset: 1.6 },
      ],
    },
    { partId: 'decoupler-37', stage: 1 },

    // The fairing is placed before the payload: everything after it rides
    // *inside* it, shielded from the airstream until jettison.
    { partId: 'fairing-37', stage: 3 },

    // ---- The lander itself ----
    { partId: 'heatshield-37', stage: 2 },
    { partId: 'eng-talon-d', stage: 2 },
    {
      partId: 'lander-deck',
      stage: 2,
      radial: [
        { partId: 'legs-light', count: 1, heightFraction: 0.05 },
        { partId: 'solar-body', count: 2, heightFraction: 0.9 },
        { partId: 'antenna-dish', count: 1, heightFraction: 0.7, angleOffset: 1.0 },
        { partId: 'battery-pack', count: 1, heightFraction: 0.3, angleOffset: 2.4 },
      ],
    },
    {
      partId: 'rover-chassis',
      stage: 2,
      radial: [
        { partId: 'rover-wheel', count: 6, heightFraction: 0.2 },
        { partId: 'robotic-arm', count: 1, heightFraction: 0.8, angleOffset: 0.4 },
        { partId: 'science-drill', count: 1, heightFraction: 0.6, angleOffset: 2.2 },
      ],
    },
    { partId: 'chute-main', stage: 2 },
  ],
};

/** The satellite-deployment stack: launcher plus the Surveyor spacecraft. */
export const SURVEYOR_STACK: VehicleDesign = {
  name: 'OSA Surveyor Launch',
  stack: [
    { partId: 'eng-vulcan9-x9', stage: 0 },
    {
      partId: 'tank-37-l',
      stage: 0,
      radial: [
        { partId: 'fin-aero', count: 4, heightFraction: 0.06 },
        { partId: 'fin-grid', count: 4, heightFraction: 0.94 },
        { partId: 'legs-heavy', count: 1, heightFraction: 0.02 },
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
        { partId: 'antenna-whip', count: 1, heightFraction: 0.85, angleOffset: 1.6 },
      ],
    },
    { partId: 'decoupler-37', stage: 1 },

    { partId: 'fairing-37', stage: 3 },
    {
      partId: 'sat-bus',
      stage: 2,
      radial: [
        { partId: 'solar-wing', count: 2, heightFraction: 0.5 },
        { partId: 'antenna-dish', count: 1, heightFraction: 0.95, angleOffset: 1.57 },
        { partId: 'science-bay', count: 1, heightFraction: 0.2, angleOffset: 3.14 },
      ],
    },
  ],
};

export const MISSIONS: readonly MissionDef[] = [
  {
    id: 'first-flight',
    name: 'FIRST FLIGHT',
    subtitle: 'Qualification launch',
    destination: 'earth-orbit',
    briefing:
      'The agency has never flown. Build a launch vehicle, prove it survives ' +
      'maximum dynamic pressure, stage cleanly, and put a mass simulator into a ' +
      'low parking orbit. Nothing else matters until this works.',
    objectives: [
      'Clear the tower',
      'Survive maximum dynamic pressure',
      'Separate the first stage',
      'Reach a stable orbit above 180 km',
    ],
    targetAltitude: 200_000,
    requiresLanding: false,
    requiresDeepSpaceComms: false,
    referenceDesign: PIONEER_LAUNCHER,
  },
  {
    id: 'satellite-deploy',
    name: 'SURVEYOR',
    subtitle: 'Satellite deployment',
    destination: 'earth-orbit',
    briefing:
      'Carry the Surveyor satellite to orbit inside the fairing, separate it ' +
      'cleanly, and watch it unfold its solar wings and high-gain dish. A ' +
      'satellite that cannot deploy is a very expensive rock.',
    objectives: [
      'Reach a stable orbit above 200 km',
      'Jettison the fairing',
      'Separate the satellite',
      'Deploy solar arrays and antenna',
    ],
    targetAltitude: 250_000,
    requiresLanding: false,
    requiresDeepSpaceComms: false,
    referenceDesign: SURVEYOR_STACK,
  },
  {
    id: 'mars-landing',
    name: 'ARES',
    subtitle: 'Mars surface mission',
    destination: 'mars-surface',
    briefing:
      'The full profile. Launch, reach orbit, burn for Mars, cruise for eight ' +
      'months, then survive entry at 5.5 km/s, deploy the parachute in an ' +
      'atmosphere one percent as thick as Earth’s, and fly the last kilometre ' +
      'down on the descent engine. Everything has to work.',
    objectives: [
      'Reach Earth orbit',
      'Perform the Mars injection burn',
      'Survive atmospheric entry',
      'Deploy the parachute',
      'Land the rover on the surface',
    ],
    targetAltitude: 220_000,
    requiresLanding: true,
    requiresDeepSpaceComms: true,
    referenceDesign: ARES_STACK,
  },
];

export function getMission(id: string): MissionDef {
  const m = MISSIONS.find((x) => x.id === id);
  if (!m) throw new Error(`Unknown mission: ${id}`);
  return m;
}
