/**
 * Ground-interaction effects (spec §12, §36).
 *
 * Pad smoke is the big one. When a launch vehicle lights, the exhaust hits the
 * deflector and blasts sideways out of the flame trench, throwing an enormous
 * rolling cloud of steam and combustion products across the pad before the
 * vehicle has moved at all. That billowing sheet — not a puff — is what sells
 * the power of a liftoff, and it interacts visibly with the pad structure.
 *
 * The same system, retuned, produces the fine ochre dust a lander kicks up on
 * Mars: less of it, thrown further, and settling slowly in one third gravity.
 */
import * as THREE from 'three';
import { clamp, lerp } from '../utils/math';
import { smokePuff, softParticle } from '../render/textures';
import { ParticleSystem, effectRng } from './ParticleSystem';

export interface GroundBlastConfig {
  /** Colour of the bulk cloud. */
  readonly color: THREE.Color;
  /** Secondary, brighter colour mixed in for variation. */
  readonly highlight: THREE.Color;
  /** How fast the cloud is thrown outward, m/s. */
  readonly outflowSpeed: number;
  /** How large each puff starts, metres. */
  readonly puffSize: number;
  /** Metres per second each puff expands. */
  readonly growth: number;
  /** Seconds a puff survives. */
  readonly life: number;
  /** Upward acceleration; hot exhaust rises, cold dust does not. */
  readonly buoyancy: number;
  /** Peak opacity per puff. */
  readonly opacity: number;
  /** Air resistance. */
  readonly drag: number;
  /** Emission rate at full throttle, puffs/second. */
  readonly rate: number;
}

/** Earth launch pad: hot, wet, hugely voluminous exhaust and steam. */
export const PAD_EXHAUST: GroundBlastConfig = {
  color: new THREE.Color(0.82, 0.8, 0.78),
  highlight: new THREE.Color(0.96, 0.93, 0.88),
  outflowSpeed: 46,
  puffSize: 6,
  growth: 9,
  life: 8.5,
  buoyancy: 2.6,
  opacity: 0.52,
  drag: 0.55,
  rate: 130,
};

/** Mars surface: thin, fine, ochre dust thrown far and settling slowly. */
export const MARS_DUST: GroundBlastConfig = {
  color: new THREE.Color(0.68, 0.42, 0.26),
  highlight: new THREE.Color(0.85, 0.6, 0.42),
  outflowSpeed: 34,
  puffSize: 2.2,
  growth: 3.4,
  life: 6,
  buoyancy: -0.35,
  opacity: 0.34,
  drag: 0.8,
  rate: 70,
};

/**
 * A radial ground blast emitted where an exhaust plume meets a surface.
 */
export class GroundBlast {
  readonly system: ParticleSystem;
  private readonly config: GroundBlastConfig;
  private accumulator = 0;

  constructor(config: GroundBlastConfig, capacity = 1400) {
    this.config = config;
    this.system = new ParticleSystem(capacity, smokePuff(), THREE.NormalBlending);
  }

  /**
   * Emits the ground-interaction cloud.
   *
   * @param impactPoint where the plume meets the surface, world space
   * @param intensity   0..1, typically the engine throttle
   * @param proximity   0..1, how close the vehicle is to the surface; the blast
   *                    fades out as the vehicle climbs away from it
   * @param radius      radius of the impingement zone, metres
   */
  emit(
    dt: number,
    impactPoint: THREE.Vector3,
    intensity: number,
    proximity: number,
    radius: number,
  ): void {
    const strength = clamp(intensity * proximity, 0, 1);
    if (strength <= 0.02) return;

    const c = this.config;
    this.accumulator += c.rate * strength * dt;
    const count = Math.floor(this.accumulator);
    this.accumulator -= count;

    for (let i = 0; i < count; i++) {
      const ang = effectRng.range(0, Math.PI * 2);
      // Bias toward the rim: the densest part of the cloud is where the
      // deflected exhaust is still moving fastest.
      const rad = radius * (0.35 + Math.sqrt(effectRng.next()) * 0.85);

      const dir = new THREE.Vector3(Math.cos(ang), 0, Math.sin(ang));
      const pos = impactPoint
        .clone()
        .addScaledVector(dir, rad)
        .add(new THREE.Vector3(0, effectRng.range(0, radius * 0.4), 0));

      // Rolling motion: thrown outward, curling upward as it decelerates.
      const speed = c.outflowSpeed * effectRng.range(0.55, 1.25) * strength;
      const vel = dir
        .clone()
        .multiplyScalar(speed)
        .add(new THREE.Vector3(0, effectRng.range(0.1, 0.5) * speed, 0));

      const warm = effectRng.next();
      const color = c.color.clone().lerp(c.highlight, warm * 0.9);

      this.system.emit({
        position: pos,
        velocity: vel,
        life: c.life * effectRng.range(0.7, 1.3),
        size: c.puffSize * effectRng.range(0.7, 1.5),
        growth: c.growth * effectRng.range(0.75, 1.3),
        color,
        opacity: c.opacity * effectRng.range(0.6, 1.1) * strength,
        spin: effectRng.signed() * 0.55,
        drag: c.drag,
        buoyancy: c.buoyancy * effectRng.range(0.6, 1.4),
      });
    }
  }

  update(dt: number): void {
    this.system.update(dt);
  }

  reset(): void {
    this.system.reset();
  }

  dispose(): void {
    this.system.dispose();
  }
}

/**
 * The rising smoke column left behind after liftoff — the tower of exhaust that
 * hangs over the pad long after the rocket has gone.
 */
export class SmokeColumn {
  readonly system: ParticleSystem;
  private accumulator = 0;

  constructor(capacity = 700) {
    this.system = new ParticleSystem(capacity, smokePuff(), THREE.NormalBlending);
  }

  /** Emits along the vehicle's recent path, leaving a trail in the air. */
  emit(dt: number, position: THREE.Vector3, intensity: number, scale: number): void {
    if (intensity <= 0.03) return;
    this.accumulator += 26 * intensity * dt;
    const count = Math.floor(this.accumulator);
    this.accumulator -= count;

    for (let i = 0; i < count; i++) {
      const jitter = new THREE.Vector3(
        effectRng.signed() * scale * 0.8,
        effectRng.signed() * scale * 0.4,
        effectRng.signed() * scale * 0.8,
      );
      const grey = effectRng.range(0.62, 0.9);

      this.system.emit({
        position: position.clone().add(jitter),
        velocity: new THREE.Vector3(
          effectRng.signed() * 3,
          effectRng.range(0.5, 3),
          effectRng.signed() * 3,
        ),
        life: effectRng.range(7, 14),
        size: scale * effectRng.range(0.9, 1.8),
        growth: scale * effectRng.range(0.5, 1.1),
        color: new THREE.Color(grey, grey * 0.98, grey * 0.96),
        opacity: effectRng.range(0.16, 0.34) * intensity,
        spin: effectRng.signed() * 0.3,
        drag: 0.32,
        buoyancy: 1.1,
      });
    }
  }

  update(dt: number): void {
    this.system.update(dt);
  }

  reset(): void {
    this.system.reset();
  }

  dispose(): void {
    this.system.dispose();
  }
}

/**
 * Condensation and venting effects: the wisps of boil-off that stream off a
 * cryogenic vehicle sitting on the pad, and the vapour cone that forms around a
 * vehicle passing through the transonic region.
 */
export class VentingEffect {
  readonly system: ParticleSystem;
  private accumulator = 0;

  constructor(capacity = 400) {
    this.system = new ParticleSystem(
      capacity,
      softParticle('rgba(255,255,255,1)', 'rgba(230,240,255,0)'),
      THREE.NormalBlending,
    );
  }

  /** Emits venting boil-off from a point on the vehicle. */
  emit(dt: number, position: THREE.Vector3, direction: THREE.Vector3, rate: number): void {
    if (rate <= 0) return;
    this.accumulator += 22 * rate * dt;
    const count = Math.floor(this.accumulator);
    this.accumulator -= count;

    for (let i = 0; i < count; i++) {
      const vel = direction
        .clone()
        .multiplyScalar(effectRng.range(2.5, 7))
        .add(
          new THREE.Vector3(
            effectRng.signed() * 1.4,
            effectRng.range(-0.4, 1.2),
            effectRng.signed() * 1.4,
          ),
        );

      this.system.emit({
        position: position.clone(),
        velocity: vel,
        life: effectRng.range(1.4, 3.2),
        size: effectRng.range(0.4, 1.1),
        growth: effectRng.range(0.9, 2.1),
        color: new THREE.Color(0.94, 0.96, 1),
        opacity: effectRng.range(0.18, 0.38) * rate,
        spin: effectRng.signed() * 1.2,
        drag: 1.1,
        buoyancy: 0.9,
      });
    }
  }

  update(dt: number): void {
    this.system.update(dt);
  }

  reset(): void {
    this.system.reset();
  }

  dispose(): void {
    this.system.dispose();
  }
}

/**
 * Debris and sparks thrown at ignition and at stage separation — the shower of
 * ice and pyrotechnic sparks that makes a separation event read as violent.
 */
export class SparkBurst {
  readonly system: ParticleSystem;

  constructor(capacity = 500) {
    this.system = new ParticleSystem(
      capacity,
      softParticle('rgba(255,240,200,1)', 'rgba(255,150,40,0)'),
      THREE.AdditiveBlending,
    );
  }

  /** Fires a one-shot burst of sparks. */
  burst(position: THREE.Vector3, count: number, speed: number, scale = 1): void {
    for (let i = 0; i < count; i++) {
      const dir = new THREE.Vector3(
        effectRng.signed(),
        effectRng.signed(),
        effectRng.signed(),
      ).normalize();

      const heat = effectRng.range(0.6, 1);
      this.system.emit({
        position: position.clone(),
        velocity: dir.multiplyScalar(speed * effectRng.range(0.4, 1.4)),
        life: effectRng.range(0.5, 1.8),
        size: scale * effectRng.range(0.12, 0.4),
        growth: -scale * 0.05,
        color: new THREE.Color(1, lerp(0.5, 0.9, heat), lerp(0.15, 0.45, heat)),
        opacity: effectRng.range(0.5, 1),
        spin: effectRng.signed() * 4,
        drag: 0.5,
        buoyancy: -3.5,
      });
    }
  }

  update(dt: number): void {
    this.system.update(dt);
  }

  reset(): void {
    this.system.reset();
  }

  dispose(): void {
    this.system.dispose();
  }
}
