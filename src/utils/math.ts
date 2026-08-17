import * as THREE from 'three';

export const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export const invLerp = (a: number, b: number, v: number): number =>
  a === b ? 0 : clamp((v - a) / (b - a), 0, 1);

/** Maps v from [inMin,inMax] into [outMin,outMax], clamped. */
export const remap = (
  v: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number,
): number => lerp(outMin, outMax, invLerp(inMin, inMax, v));

export const smoothstep = (t: number): number => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};

export const smootherstep = (t: number): number => {
  const x = clamp(t, 0, 1);
  return x * x * x * (x * (x * 6 - 15) + 10);
};

export const easeInOutCubic = (t: number): number => {
  const x = clamp(t, 0, 1);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};

export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - clamp(t, 0, 1), 3);

export const easeInCubic = (t: number): number => Math.pow(clamp(t, 0, 1), 3);

export const easeOutBack = (t: number): number => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const x = clamp(t, 0, 1);
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
};

/**
 * Frame-rate independent exponential smoothing.
 * `rate` is the fraction of remaining distance closed per second.
 */
export const damp = (current: number, target: number, rate: number, dt: number): number =>
  lerp(current, target, 1 - Math.exp(-rate * dt));

export const dampVec3 = (
  current: THREE.Vector3,
  target: THREE.Vector3,
  rate: number,
  dt: number,
): THREE.Vector3 => current.lerp(target, 1 - Math.exp(-rate * dt));

/** Deterministic pseudo-random generator (mulberry32) so scenes rebuild identically. */
export class Rng {
  private state: number;

  constructor(seed = 0x9e3779b9) {
    this.state = seed >>> 0;
  }

  /** Uniform in [0,1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform in [min,max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }

  /** Symmetric noise in [-1,1). */
  signed(): number {
    return this.next() * 2 - 1;
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)];
  }

  bool(chance = 0.5): boolean {
    return this.next() < chance;
  }
}

/** Angle wrapped into (-PI, PI]. */
export const wrapAngle = (a: number): number => {
  let x = a % (Math.PI * 2);
  if (x > Math.PI) x -= Math.PI * 2;
  if (x <= -Math.PI) x += Math.PI * 2;
  return x;
};

/** Formats metres as m / km with sensible precision. */
export const formatDistance = (metres: number): string => {
  const m = Math.abs(metres);
  if (m < 1000) return `${metres.toFixed(0)} m`;
  if (m < 1e6) return `${(metres / 1000).toFixed(1)} km`;
  if (m < 1e9) return `${(metres / 1000).toFixed(0)} km`;
  return `${(metres / 1e9).toFixed(2)} Gm`;
};

export const formatSpeed = (mps: number): string =>
  mps < 1000 ? `${mps.toFixed(0)} m/s` : `${(mps / 1000).toFixed(2)} km/s`;

export const formatMass = (kg: number): string =>
  kg < 1000 ? `${kg.toFixed(0)} kg` : `${(kg / 1000).toFixed(1)} t`;

export const formatForce = (newtons: number): string =>
  newtons < 1000 ? `${newtons.toFixed(0)} N` : `${(newtons / 1000).toFixed(0)} kN`;

export const formatDuration = (seconds: number): string => {
  const s = Math.max(0, Math.floor(seconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h.toString().padStart(2, '0')}h`;
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
  return `${m}:${sec.toString().padStart(2, '0')}`;
};
