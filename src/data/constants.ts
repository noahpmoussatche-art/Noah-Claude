/**
 * Physical constants and world scale.
 *
 * SCALE RULE (spec §6, §55): 1 three.js unit === 1 metre, everywhere, for every
 * object in the game. Ducks, rockets, towers, rovers and Mars terrain all obey
 * it. The only exception is the interplanetary map view, which draws planets at
 * a documented, explicitly-applied reduction factor (see SPACE_VIEW_SCALE) so an
 * astronomical distance fits inside a camera frustum.
 */

/** Universal gravitational constant, m^3 kg^-1 s^-2. */
export const G = 6.6743e-11;

export interface PlanetConstants {
  readonly name: string;
  /** Mean radius, m. */
  readonly radius: number;
  /** Standard gravitational parameter GM, m^3/s^2. */
  readonly mu: number;
  /** Surface gravity, m/s^2. */
  readonly g0: number;
  /** Sea-level (or datum) atmospheric density, kg/m^3. */
  readonly rho0: number;
  /** Density scale height, m. */
  readonly scaleHeight: number;
  /** Altitude above which atmosphere is negligible, m. */
  readonly atmosphereTop: number;
  /** Sidereal rotation period, s. */
  readonly rotationPeriod: number;
  /** Semi-major axis of heliocentric orbit, m. */
  readonly orbitRadius: number;
}

export const EARTH: PlanetConstants = {
  name: 'Earth',
  radius: 6.371e6,
  mu: 3.986004418e14,
  g0: 9.80665,
  rho0: 1.225,
  scaleHeight: 8500,
  atmosphereTop: 140_000,
  rotationPeriod: 86164,
  orbitRadius: 1.496e11,
};

export const MARS: PlanetConstants = {
  name: 'Mars',
  radius: 3.3895e6,
  mu: 4.282837e13,
  g0: 3.72076,
  // Mars datum density ~0.020 kg/m^3 (surface pressure ~610 Pa, ~210 K CO2).
  rho0: 0.02,
  scaleHeight: 11_100,
  // Mars entry interface is conventionally taken at ~125 km.
  atmosphereTop: 125_000,
  rotationPeriod: 88_642,
  orbitRadius: 2.279e11,
};

/** Standard sea-level gravity used for specific-impulse bookkeeping. */
export const G0_ISP = 9.80665;

/**
 * Reduction applied ONLY in the interplanetary cruise view, where real distances
 * (1.5e11 m) cannot coexist with a 1-unit-per-metre near plane. Vehicles in that
 * view are drawn at true metre scale in a separate near layer, so the ship never
 * looks like a dot next to a toy planet.
 */
export const SPACE_VIEW_SCALE = 1 / 40_000;

/** Mission phase identifiers (spec §75). */
export enum MissionState {
  BUILD = 'BUILD',
  CHECK = 'CHECK',
  COUNTDOWN = 'COUNTDOWN',
  IGNITION = 'IGNITION',
  LAUNCH = 'LAUNCH',
  ASCENT = 'ASCENT',
  STAGING = 'STAGING',
  ORBIT = 'ORBIT',
  TRANSFER = 'TRANSFER',
  MARS_APPROACH = 'MARS_APPROACH',
  ENTRY = 'ENTRY',
  DESCENT = 'DESCENT',
  LANDING = 'LANDING',
  LANDED = 'LANDED',
  MISSION_COMPLETE = 'MISSION_COMPLETE',
  MISSION_FAILED = 'MISSION_FAILED',
}

/** Time-warp steps offered during powered and atmospheric flight (spec §50). */
export const TIME_SCALES = [1, 5, 10, 50, 100, 1000] as const;

/**
 * Additional warp steps offered only while coasting or cruising.
 *
 * An interplanetary transfer is 255 days. At 1000x that is still six hours of
 * real time, so the cruise needs its own range. The vehicle is genuinely
 * integrated along the trajectory at every step — the warp changes how fast the
 * clock runs, not whether the journey happens (spec §50).
 */
export const CRUISE_TIME_SCALES = [1, 1_000, 10_000, 100_000, 1_000_000] as const;

/** Rendering layers, used to composite the far/near space views. */
export const LAYER_DEFAULT = 0;
export const LAYER_FAR_SPACE = 1;
