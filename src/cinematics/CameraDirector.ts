/**
 * Cinematographic camera system (spec §28, §49).
 *
 * The camera is treated as a real one: it has a focal length, it is placed on a
 * rig with a specific relationship to its subject, and it moves the way a
 * physical camera on a crane, a dolly or a tracking mount would. Shots are
 * declarative — "low angle on the pad, 18 mm, tilting up" — and the director
 * blends between them, so a launch sequence cuts and moves like coverage rather
 * than like a single orbiting free camera.
 *
 * The player never flies the vehicle (spec §76), but always controls the camera.
 */
import * as THREE from 'three';
import { clamp, damp, dampVec3, easeInOutCubic, lerp, Rng } from '../utils/math';

export type ShotKind =
  | 'wide'
  | 'close-up'
  | 'low-angle'
  | 'tracking'
  | 'side'
  | 'onboard'
  | 'ground'
  | 'orbital'
  | 'crane'
  | 'over-shoulder'
  | 'free';

export interface Shot {
  readonly kind: ShotKind;
  /** Subject the shot is framed on. */
  readonly target: () => THREE.Vector3;
  /**
   * Camera placement, in world space. Recomputed each frame so a tracking shot
   * follows a moving subject.
   */
  readonly position: (t: number) => THREE.Vector3;
  /** Optional explicit look-at point; defaults to `target`. */
  readonly lookAt?: (t: number) => THREE.Vector3;
  /** Vertical field of view in degrees. Long lenses compress, short ones open. */
  readonly fov?: number;
  /** Seconds the shot lasts. Infinity means hold until replaced. */
  readonly duration?: number;
  /** Seconds to blend in from the previous shot. 0 is a hard cut. */
  readonly blend?: number;
  /** Camera roll, radians. */
  readonly roll?: number;
  /** How fast the camera catches up to its ideal position, per second. */
  readonly stiffness?: number;
  /** Handheld shake amplitude multiplier. */
  readonly handheld?: number;
  /** Called once when the shot becomes active. */
  readonly onEnter?: () => void;
}

/** Convenience: a fixed-position shot. */
export function staticShot(
  kind: ShotKind,
  position: THREE.Vector3,
  target: () => THREE.Vector3,
  options: Partial<Shot> = {},
): Shot {
  const p = position.clone();
  return { kind, target, position: () => p, ...options };
}

export class CameraDirector {
  readonly camera: THREE.PerspectiveCamera;

  private current: Shot | null = null;
  private previous: Shot | null = null;
  private shotTime = 0;
  private blendTime = 0;
  private blendDuration = 0;

  /** Live camera state, smoothed toward the shot's ideal each frame. */
  private readonly smoothPos = new THREE.Vector3();
  private readonly smoothLook = new THREE.Vector3();
  private smoothFov = 45;
  private smoothRoll = 0;

  /** Shake driven by the vehicle (spec §13) and by handheld feel. */
  private shakeAmount = 0;
  private shakeTime = 0;
  private readonly shakeOffset = new THREE.Vector3();
  private readonly rng = new Rng(0xca3e7a);

  /** Player camera control (spec §49). */
  private orbitYaw = 0;
  private orbitPitch = 0.2;
  private orbitDistance = 60;
  private userControlled = false;
  private freeTarget: (() => THREE.Vector3) | null = null;

  /** Queue of shots to play in order. */
  private readonly queue: Shot[] = [];

  constructor(aspect = 16 / 9) {
    // 45° vertical FOV is a reasonable "normal" lens; shots override it.
    this.camera = new THREE.PerspectiveCamera(45, aspect, 0.35, 4_000_000);
    this.camera.position.set(0, 20, 90);
  }

  // -------------------------------------------------------------------------
  // Shot control
  // -------------------------------------------------------------------------

  /** Plays a shot immediately, blending from whatever was on screen. */
  play(shot: Shot): void {
    this.previous = this.current;
    this.current = shot;
    this.shotTime = 0;
    this.blendDuration = shot.blend ?? 0.8;
    this.blendTime = 0;
    this.userControlled = false;
    shot.onEnter?.();
  }

  /** Queues a shot to play after the current one finishes. */
  enqueue(...shots: Shot[]): void {
    this.queue.push(...shots);
    if (!this.current) this.advance();
  }

  /** Clears the queue and any active shot. */
  clearQueue(): void {
    this.queue.length = 0;
  }

  private advance(): void {
    const next = this.queue.shift();
    if (next) this.play(next);
  }

  get activeShot(): Shot | null {
    return this.current;
  }

  get queueLength(): number {
    return this.queue.length;
  }

  // -------------------------------------------------------------------------
  // Player control (spec §49: camera, zoom only — never piloting)
  // -------------------------------------------------------------------------

  /**
   * Hands control to the player, orbiting a subject. Called when the player
   * drags, or when a cinematic ends and gameplay resumes.
   */
  enterFreeCamera(target: () => THREE.Vector3, distance?: number): void {
    this.freeTarget = target;
    this.userControlled = true;
    this.current = null;
    this.previous = null;
    this.queue.length = 0;
    if (distance !== undefined) this.orbitDistance = distance;
    // Start from wherever the cinematic left the camera, so there is no jump.
    const t = target();
    const offset = new THREE.Vector3().subVectors(this.smoothPos, t);
    if (offset.lengthSq() > 1e-4) {
      this.orbitDistance = offset.length();
      this.orbitYaw = Math.atan2(offset.x, offset.z);
      this.orbitPitch = Math.asin(clamp(offset.y / this.orbitDistance, -1, 1));
    }
  }

  get isFree(): boolean {
    return this.userControlled;
  }

  orbit(deltaYaw: number, deltaPitch: number): void {
    if (!this.userControlled) return;
    this.orbitYaw -= deltaYaw;
    this.orbitPitch = clamp(this.orbitPitch + deltaPitch, -1.35, 1.42);
  }

  zoom(factor: number): void {
    this.orbitDistance = clamp(this.orbitDistance * factor, 3, 900_000);
  }

  setOrbitDistance(d: number): void {
    this.orbitDistance = d;
  }

  get distance(): number {
    return this.orbitDistance;
  }

  // -------------------------------------------------------------------------
  // Shake (spec §13, §34)
  // -------------------------------------------------------------------------

  /** Sets the vehicle-driven shake amplitude, metres. */
  setShake(amount: number): void {
    this.shakeAmount = amount;
  }

  // -------------------------------------------------------------------------
  // Update
  // -------------------------------------------------------------------------

  update(dt: number, aspect: number): void {
    this.camera.aspect = aspect;

    let idealPos: THREE.Vector3;
    let idealLook: THREE.Vector3;
    let idealFov: number;
    let idealRoll: number;
    let stiffness: number;
    let handheld: number;

    if (this.userControlled && this.freeTarget) {
      const t = this.freeTarget();
      const cp = Math.cos(this.orbitPitch);
      idealPos = new THREE.Vector3(
        t.x + Math.sin(this.orbitYaw) * cp * this.orbitDistance,
        t.y + Math.sin(this.orbitPitch) * this.orbitDistance,
        t.z + Math.cos(this.orbitYaw) * cp * this.orbitDistance,
      );
      idealLook = t;
      idealFov = 45;
      idealRoll = 0;
      stiffness = 9;
      handheld = 0.25;
    } else if (this.current) {
      this.shotTime += dt;

      const evaluate = (shot: Shot, time: number) => ({
        pos: shot.position(time),
        look: (shot.lookAt ?? shot.target)(time),
        fov: shot.fov ?? 45,
        roll: shot.roll ?? 0,
        stiffness: shot.stiffness ?? 6,
        handheld: shot.handheld ?? 0.4,
      });

      const cur = evaluate(this.current, this.shotTime);

      // Blend from the previous shot so cuts can be soft when we want them soft.
      if (this.previous && this.blendDuration > 0 && this.blendTime < this.blendDuration) {
        this.blendTime += dt;
        const k = easeInOutCubic(this.blendTime / this.blendDuration);
        const prev = evaluate(this.previous, this.shotTime + this.blendDuration);

        idealPos = prev.pos.clone().lerp(cur.pos, k);
        idealLook = prev.look.clone().lerp(cur.look, k);
        idealFov = lerp(prev.fov, cur.fov, k);
        idealRoll = lerp(prev.roll, cur.roll, k);
        stiffness = lerp(prev.stiffness, cur.stiffness, k);
        handheld = lerp(prev.handheld, cur.handheld, k);
      } else {
        this.previous = null;
        idealPos = cur.pos;
        idealLook = cur.look;
        idealFov = cur.fov;
        idealRoll = cur.roll;
        stiffness = cur.stiffness;
        handheld = cur.handheld;
      }

      // Shot expiry.
      const duration = this.current.duration ?? Infinity;
      if (this.shotTime >= duration) {
        if (this.queue.length > 0) this.advance();
      }
    } else {
      // Nothing playing: hold position.
      idealPos = this.smoothPos.clone();
      idealLook = this.smoothLook.clone();
      idealFov = this.smoothFov;
      idealRoll = this.smoothRoll;
      stiffness = 6;
      handheld = 0;
    }

    // First frame: snap rather than easing in from the origin.
    if (this.smoothPos.lengthSq() === 0) {
      this.smoothPos.copy(idealPos);
      this.smoothLook.copy(idealLook);
      this.smoothFov = idealFov;
    }

    dampVec3(this.smoothPos, idealPos, stiffness, dt);
    dampVec3(this.smoothLook, idealLook, stiffness * 1.25, dt);
    this.smoothFov = damp(this.smoothFov, idealFov, 5, dt);
    this.smoothRoll = damp(this.smoothRoll, idealRoll, 4, dt);

    // ---- Shake ----
    this.shakeTime += dt;
    const amp = this.shakeAmount * (0.6 + handheld);
    if (amp > 1e-4) {
      // Layered frequencies read as structural vibration rather than jitter.
      const f1 = Math.sin(this.shakeTime * 47.3) + Math.sin(this.shakeTime * 31.7) * 0.6;
      const f2 = Math.sin(this.shakeTime * 53.1) + Math.sin(this.shakeTime * 23.9) * 0.6;
      const f3 = Math.sin(this.shakeTime * 41.9) * 0.5;
      // Scale with distance so a shake looks the same regardless of shot size.
      const scale = amp * (1 + this.smoothPos.distanceTo(this.smoothLook) * 0.006);
      this.shakeOffset.set(f1 * scale, f2 * scale * 0.8, f3 * scale);
      // Occasional larger jolt.
      if (this.rng.next() < dt * 3) {
        this.shakeOffset.addScalar(this.rng.signed() * scale * 1.6);
      }
    } else {
      this.shakeOffset.multiplyScalar(Math.exp(-8 * dt));
    }

    // Idle handheld drift, so even a "static" shot is never mechanically still.
    const drift = handheld * 0.05;
    const driftOffset = new THREE.Vector3(
      Math.sin(this.shakeTime * 0.43) * drift,
      Math.sin(this.shakeTime * 0.31 + 1.2) * drift,
      Math.sin(this.shakeTime * 0.27 + 2.4) * drift,
    );

    this.camera.position.copy(this.smoothPos).add(this.shakeOffset).add(driftOffset);
    this.camera.fov = this.smoothFov;
    this.camera.lookAt(this.smoothLook);
    if (Math.abs(this.smoothRoll) > 1e-4) {
      this.camera.rotateZ(this.smoothRoll);
    }
    // Shake the aim slightly too, not just the body.
    this.camera.rotateX(this.shakeOffset.y * 0.0016);
    this.camera.rotateY(this.shakeOffset.x * 0.0016);

    this.camera.updateProjectionMatrix();
  }

  /** Immediately places the camera, skipping smoothing (used on scene changes). */
  snapTo(position: THREE.Vector3, lookAt: THREE.Vector3, fov = 45): void {
    this.smoothPos.copy(position);
    this.smoothLook.copy(lookAt);
    this.smoothFov = fov;
    this.camera.position.copy(position);
    this.camera.fov = fov;
    this.camera.lookAt(lookAt);
    this.camera.updateProjectionMatrix();
  }

  /** Adjusts near/far planes for the scale of the current scene. */
  setClipRange(near: number, far: number): void {
    this.camera.near = near;
    this.camera.far = far;
    this.camera.updateProjectionMatrix();
  }
}

// ---------------------------------------------------------------------------
// Shot factory helpers
// ---------------------------------------------------------------------------

/**
 * A low, wide shot looking up at a subject — the shot that makes a rocket look
 * enormous, because it puts the camera at duck height (spec §21).
 */
export function lowAngleShot(
  subject: () => THREE.Vector3,
  options: {
    distance: number;
    height: number;
    azimuth: number;
    fov?: number;
    /** Vertical offset of the look-at point, to frame the whole vehicle. */
    lookHeight?: number;
    duration?: number;
    blend?: number;
  },
): Shot {
  return {
    kind: 'low-angle',
    target: subject,
    fov: options.fov ?? 34,
    duration: options.duration,
    blend: options.blend,
    stiffness: 5,
    handheld: 0.5,
    position: () => {
      const s = subject();
      return new THREE.Vector3(
        s.x + Math.sin(options.azimuth) * options.distance,
        options.height,
        s.z + Math.cos(options.azimuth) * options.distance,
      );
    },
    lookAt: () => {
      const s = subject();
      return new THREE.Vector3(s.x, s.y + (options.lookHeight ?? 0), s.z);
    },
  };
}

/** A tracking shot that holds a constant offset from a moving subject. */
export function trackingShot(
  subject: () => THREE.Vector3,
  offset: THREE.Vector3,
  options: { fov?: number; duration?: number; blend?: number; stiffness?: number } = {},
): Shot {
  const off = offset.clone();
  return {
    kind: 'tracking',
    target: subject,
    fov: options.fov ?? 40,
    duration: options.duration,
    blend: options.blend,
    stiffness: options.stiffness ?? 3.2,
    handheld: 0.35,
    position: () => subject().clone().add(off),
  };
}

/**
 * A ground camera: fixed on the pad, watching the vehicle climb away. The
 * long lens keeps the vehicle large in frame as it recedes, which is exactly
 * how launch coverage is actually shot.
 */
export function groundCameraShot(
  position: THREE.Vector3,
  subject: () => THREE.Vector3,
  options: { fov?: number; duration?: number; blend?: number } = {},
): Shot {
  const p = position.clone();
  return {
    kind: 'ground',
    target: subject,
    position: () => p,
    fov: options.fov ?? 18,
    duration: options.duration,
    blend: options.blend,
    stiffness: 2.4,
    handheld: 0.8,
  };
}

/** A slow crane move: the camera rises and pushes in over the shot's duration. */
export function craneShot(
  subject: () => THREE.Vector3,
  options: {
    startOffset: THREE.Vector3;
    endOffset: THREE.Vector3;
    duration: number;
    fov?: number;
    blend?: number;
    lookHeight?: number;
  },
): Shot {
  const a = options.startOffset.clone();
  const b = options.endOffset.clone();
  return {
    kind: 'crane',
    target: subject,
    fov: options.fov ?? 38,
    duration: options.duration,
    blend: options.blend,
    stiffness: 7,
    handheld: 0.2,
    position: (t: number) => {
      const k = easeInOutCubic(clamp(t / options.duration, 0, 1));
      return subject().clone().add(a.clone().lerp(b, k));
    },
    lookAt: () => {
      const s = subject();
      return new THREE.Vector3(s.x, s.y + (options.lookHeight ?? 0), s.z);
    },
  };
}

/** A slow orbit around a subject, for reveals and hero shots. */
export function orbitShot(
  subject: () => THREE.Vector3,
  options: {
    distance: number;
    height: number;
    angularSpeed: number;
    startAngle?: number;
    fov?: number;
    duration?: number;
    blend?: number;
    lookHeight?: number;
  },
): Shot {
  return {
    kind: 'orbital',
    target: subject,
    fov: options.fov ?? 40,
    duration: options.duration,
    blend: options.blend,
    stiffness: 8,
    handheld: 0.15,
    position: (t: number) => {
      const a = (options.startAngle ?? 0) + t * options.angularSpeed;
      const s = subject();
      return new THREE.Vector3(
        s.x + Math.sin(a) * options.distance,
        s.y + options.height,
        s.z + Math.cos(a) * options.distance,
      );
    },
    lookAt: () => {
      const s = subject();
      return new THREE.Vector3(s.x, s.y + (options.lookHeight ?? 0), s.z);
    },
  };
}

/** A close-up on a specific point, with a long lens and shallow framing. */
export function closeUpShot(
  subject: () => THREE.Vector3,
  offset: THREE.Vector3,
  options: { fov?: number; duration?: number; blend?: number } = {},
): Shot {
  const off = offset.clone();
  return {
    kind: 'close-up',
    target: subject,
    position: () => subject().clone().add(off),
    fov: options.fov ?? 22,
    duration: options.duration,
    blend: options.blend,
    stiffness: 6,
    handheld: 0.6,
  };
}

/**
 * An over-the-shoulder shot: camera behind a character, framing what they are
 * looking at. This is how the ducks get to be *in* the cinematic rather than
 * merely present in the scene (spec §25).
 */
export function overShoulderShot(
  character: () => THREE.Vector3,
  lookedAt: () => THREE.Vector3,
  options: {
    /** Metres behind and above the character's head. */
    back: number;
    up: number;
    side: number;
    fov?: number;
    duration?: number;
    blend?: number;
  },
): Shot {
  return {
    kind: 'over-shoulder',
    target: lookedAt,
    fov: options.fov ?? 30,
    duration: options.duration,
    blend: options.blend,
    stiffness: 4.5,
    handheld: 0.55,
    position: () => {
      const c = character();
      const t = lookedAt();
      // Place the camera along the character→subject axis, pulled back.
      const dir = new THREE.Vector3().subVectors(t, c).setY(0);
      if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
      dir.normalize();
      const right = new THREE.Vector3(-dir.z, 0, dir.x);
      return c
        .clone()
        .addScaledVector(dir, -options.back)
        .addScaledVector(right, options.side)
        .add(new THREE.Vector3(0, options.up, 0));
    },
    lookAt: () => {
      // Frame between the character's head and the subject.
      const c = character().clone().add(new THREE.Vector3(0, 0.45, 0));
      return c.lerp(lookedAt(), 0.82);
    },
  };
}

/** A camera rigidly mounted to the vehicle, looking along a chosen direction. */
export function onboardShot(
  mount: () => { position: THREE.Vector3; quaternion: THREE.Quaternion },
  localOffset: THREE.Vector3,
  localLookDir: THREE.Vector3,
  options: { fov?: number; duration?: number; blend?: number } = {},
): Shot {
  const off = localOffset.clone();
  const dir = localLookDir.clone().normalize();
  return {
    kind: 'onboard',
    target: () => {
      const m = mount();
      return m.position
        .clone()
        .add(dir.clone().applyQuaternion(m.quaternion).multiplyScalar(40));
    },
    position: () => {
      const m = mount();
      return m.position.clone().add(off.clone().applyQuaternion(m.quaternion));
    },
    lookAt: () => {
      const m = mount();
      return m.position
        .clone()
        .add(off.clone().applyQuaternion(m.quaternion))
        .add(dir.clone().applyQuaternion(m.quaternion).multiplyScalar(60));
    },
    fov: options.fov ?? 62,
    duration: options.duration,
    blend: options.blend,
    stiffness: 30,
    handheld: 0.9,
  };
}
