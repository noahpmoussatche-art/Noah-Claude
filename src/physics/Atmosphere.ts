/**
 * Atmosphere model (spec §14).
 *
 * An exponential density profile is the standard first-order model and is
 * accurate enough to reproduce the behaviour that matters here: maximum dynamic
 * pressure at roughly 11–14 km on Earth, the transonic drag rise, and the fact
 * that Mars's atmosphere is thick enough to destroy a vehicle on entry but far
 * too thin to land one on parachutes alone.
 */
import type { PlanetConstants } from '../data/constants';

/** Air density at an altitude above the datum, kg/m^3. */
export function density(planet: PlanetConstants, altitude: number): number {
  if (altitude <= 0) return planet.rho0;
  if (altitude >= planet.atmosphereTop) return 0;
  const rho = planet.rho0 * Math.exp(-altitude / planet.scaleHeight);
  // Taper the last stretch to zero so drag does not switch off discontinuously.
  const fade = 1 - Math.max(0, (altitude - planet.atmosphereTop * 0.75) / (planet.atmosphereTop * 0.25));
  return rho * Math.min(1, Math.max(0, fade));
}

/** Speed of sound, m/s. Uses a simple lapse-rate temperature profile. */
export function speedOfSound(planet: PlanetConstants, altitude: number): number {
  if (planet.name === 'Mars') {
    // Cold CO2 atmosphere: ~240 m/s near the surface, falling slowly with height.
    const t = 210 - Math.min(altitude, 60_000) * 0.0008;
    return 20.05 * Math.sqrt(Math.max(t, 130)) * 0.79;
  }
  // Earth: troposphere lapse, then roughly isothermal.
  const t = altitude < 11_000 ? 288.15 - 0.0065 * altitude : 216.65;
  return 20.05 * Math.sqrt(Math.max(t, 180));
}

/** Dynamic pressure, Pa. */
export function dynamicPressure(rho: number, speed: number): number {
  return 0.5 * rho * speed * speed;
}

/**
 * Mach-dependent multiplier on the drag coefficient. Reproduces the transonic
 * drag rise — the reason a rocket throttles down through max-Q.
 */
export function dragRise(mach: number): number {
  if (mach < 0.8) return 1;
  if (mach < 1.2) {
    // Sharp rise through the transonic region.
    return 1 + 2.6 * ((mach - 0.8) / 0.4);
  }
  if (mach < 5) {
    // Falling back off toward the hypersonic plateau.
    return 3.6 - 1.9 * ((mach - 1.2) / 3.8);
  }
  return 1.7;
}

/**
 * Convective heating rate at a stagnation point, W/m^2 (Sutton-Graves form).
 * Used to decide whether a heat shield survives entry (spec §34).
 */
export function stagnationHeatFlux(rho: number, speed: number, noseRadius: number): number {
  if (rho <= 0 || speed <= 0) return 0;
  const k = 1.7415e-4; // Sutton-Graves constant for air; close enough for CO2.
  return k * Math.sqrt(rho / Math.max(noseRadius, 0.1)) * Math.pow(speed, 3);
}
