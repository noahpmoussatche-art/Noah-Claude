/**
 * Interplanetary transfer (spec §30, §31).
 *
 * A Hohmann transfer between two circular, coplanar orbits. This is a genuine
 * orbital calculation — the transfer time, the delta-v and the phase angle all
 * come out of the vis-viva equation rather than being picked to look good — but
 * it deliberately stops short of a full n-body integration, which the spec says
 * is not required.
 *
 * The point is that the journey is real and visible: the ship is somewhere
 * specific on a drawn ellipse at every instant, and the player can watch Earth
 * shrink and Mars grow.
 */
import * as THREE from 'three';
import type { PlanetConstants } from '../data/constants';

/** Standard gravitational parameter of the Sun, m^3/s^2. */
const MU_SUN = 1.32712440018e20;

export class InterplanetaryTransfer {
  readonly origin: PlanetConstants;
  readonly destination: PlanetConstants;

  /** Semi-major axis of the transfer ellipse, m. */
  readonly semiMajor: number;
  /** Total flight time, s. */
  readonly duration: number;
  /** Delta-v for departure injection, m/s. */
  readonly departureDeltaV: number;
  /** Delta-v to circularise at arrival (unused when aerocapturing), m/s. */
  readonly arrivalDeltaV: number;
  /** Required phase angle between the planets at departure, radians. */
  readonly phaseAngle: number;

  /** 0 at departure, 1 at arrival. */
  progress = 0;
  /** Seconds elapsed on the transfer. */
  elapsed = 0;
  /** Mission time at which the burn happened. */
  startTime = 0;
  active = false;

  constructor(origin: PlanetConstants, destination: PlanetConstants) {
    this.origin = origin;
    this.destination = destination;

    const r1 = origin.orbitRadius;
    const r2 = destination.orbitRadius;

    this.semiMajor = (r1 + r2) / 2;
    this.duration = Math.PI * Math.sqrt(Math.pow(this.semiMajor, 3) / MU_SUN);

    const v1 = Math.sqrt(MU_SUN / r1);
    const v2 = Math.sqrt(MU_SUN / r2);
    // Vis-viva at each end of the transfer ellipse.
    const vTransfer1 = Math.sqrt(MU_SUN * (2 / r1 - 1 / this.semiMajor));
    const vTransfer2 = Math.sqrt(MU_SUN * (2 / r2 - 1 / this.semiMajor));

    this.departureDeltaV = Math.abs(vTransfer1 - v1);
    this.arrivalDeltaV = Math.abs(v2 - vTransfer2);

    // The destination must lead by this angle at departure for the two to meet.
    const destPeriod = 2 * Math.PI * Math.sqrt(Math.pow(r2, 3) / MU_SUN);
    this.phaseAngle = Math.PI - (2 * Math.PI * this.duration) / destPeriod;
  }

  begin(missionTime: number): void {
    this.active = true;
    this.startTime = missionTime;
    this.elapsed = 0;
    this.progress = 0;
  }

  update(dt: number): void {
    if (!this.active) return;
    this.elapsed = Math.min(this.elapsed + dt, this.duration);
    this.progress = this.elapsed / this.duration;
  }

  /** Remaining time to arrival, s. */
  timeRemaining(): number {
    return Math.max(0, this.duration - this.elapsed);
  }

  /**
   * True anomaly along the transfer ellipse at the current progress, solved from
   * Kepler's equation so the ship moves fast at perihelion and slow at
   * aphelion — the visible signature of a real orbit.
   */
  trueAnomaly(): number {
    const e = this.eccentricity();
    // Mean anomaly sweeps linearly from 0 (departure) to PI (arrival).
    const M = this.progress * Math.PI;

    // Newton iteration on Kepler's equation E - e·sin E = M.
    let E = M;
    for (let i = 0; i < 8; i++) {
      const f = E - e * Math.sin(E) - M;
      const fp = 1 - e * Math.cos(E);
      E -= f / fp;
    }

    return 2 * Math.atan2(
      Math.sqrt(1 + e) * Math.sin(E / 2),
      Math.sqrt(1 - e) * Math.cos(E / 2),
    );
  }

  eccentricity(): number {
    const r1 = this.origin.orbitRadius;
    const r2 = this.destination.orbitRadius;
    return Math.abs(r2 - r1) / (r1 + r2);
  }

  /** Heliocentric distance of the ship right now, m. */
  currentRadius(): number {
    const e = this.eccentricity();
    const nu = this.trueAnomaly();
    return (this.semiMajor * (1 - e * e)) / (1 + e * Math.cos(nu));
  }

  /**
   * Ship position in the heliocentric plane, in metres. The origin planet sits
   * at angle 0 at departure.
   */
  shipPosition(target = new THREE.Vector3()): THREE.Vector3 {
    const nu = this.trueAnomaly();
    const r = this.currentRadius();
    return target.set(Math.cos(nu) * r, 0, Math.sin(nu) * r);
  }

  /** Origin planet position at the current time. */
  originPosition(target = new THREE.Vector3()): THREE.Vector3 {
    const period = 2 * Math.PI * Math.sqrt(Math.pow(this.origin.orbitRadius, 3) / MU_SUN);
    const angle = (this.elapsed / period) * Math.PI * 2;
    return target.set(
      Math.cos(angle) * this.origin.orbitRadius,
      0,
      Math.sin(angle) * this.origin.orbitRadius,
    );
  }

  /** Destination planet position at the current time. */
  destinationPosition(target = new THREE.Vector3()): THREE.Vector3 {
    const period = 2 * Math.PI * Math.sqrt(Math.pow(this.destination.orbitRadius, 3) / MU_SUN);
    // Starts at the required lead angle and arrives at 180 degrees.
    const angle = this.phaseAngle + (this.elapsed / period) * Math.PI * 2;
    return target.set(
      Math.cos(angle) * this.destination.orbitRadius,
      0,
      Math.sin(angle) * this.destination.orbitRadius,
    );
  }

  /** Distance from the ship to the destination right now, m. */
  distanceToDestination(): number {
    return this.shipPosition().distanceTo(this.destinationPosition());
  }

  /** Distance from the ship back to the origin planet, m. */
  distanceToOrigin(): number {
    return this.shipPosition().distanceTo(this.originPosition());
  }

  /** Samples the transfer ellipse for drawing the trajectory line. */
  samplePath(samples = 128): THREE.Vector3[] {
    const e = this.eccentricity();
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= samples; i++) {
      const nu = (i / samples) * Math.PI;
      const r = (this.semiMajor * (1 - e * e)) / (1 + e * Math.cos(nu));
      pts.push(new THREE.Vector3(Math.cos(nu) * r, 0, Math.sin(nu) * r));
    }
    return pts;
  }

  /** Samples a full circular orbit for drawing a planet's path. */
  static sampleOrbit(radius: number, samples = 128): THREE.Vector3[] {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= samples; i++) {
      const a = (i / samples) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius));
    }
    return pts;
  }
}
