/**
 * Duck animation and behaviour (spec §24, §25, §60).
 *
 * Animation is procedural: a small set of pose generators driven by phase
 * counters, blended together. That keeps the characters alive in every scene
 * without shipping any animation assets, and lets the cinematics ask for
 * behaviour ("walk to that mark, then look up at the rocket") rather than
 * scrubbing clips.
 *
 * The two ducks have different personalities and the animator expresses them:
 * the engineer is deliberate and keeps checking the clipboard; the pilot is
 * quicker, bouncier and gestures more.
 */
import * as THREE from 'three';
import { buildDuck, DUCK_HEIGHT, type DuckRig, type DuckRole } from './Duck';
import { clamp, damp, lerp, Rng, smoothstep } from '../utils/math';

export type DuckPose =
  | 'idle'
  | 'walk'
  | 'point'
  | 'look-up'
  | 'talk'
  | 'cheer'
  | 'flinch'
  | 'inspect'
  | 'wave'
  | 'salute';

interface Personality {
  /** Movement speed, m/s. */
  readonly walkSpeed: number;
  /** Overall animation tempo multiplier. */
  readonly tempo: number;
  /** How much the body bounces. */
  readonly bounce: number;
  /** How often idle fidgets happen, seconds. */
  readonly fidgetInterval: number;
}

const PERSONALITIES: Record<DuckRole, Personality> = {
  // Deliberate, methodical, always double-checking something.
  engineer: { walkSpeed: 0.62, tempo: 0.85, bounce: 0.7, fidgetInterval: 5.5 },
  // Quick, expressive, slightly too confident.
  pilot: { walkSpeed: 0.82, tempo: 1.18, bounce: 1.25, fidgetInterval: 3.2 },
};

/** Display names for subtitles and dialogue (spec §61 — own identity). */
export const DUCK_NAMES: Record<DuckRole, string> = {
  engineer: 'QUILL',
  pilot: 'MAVIS',
};

export class DuckActor {
  readonly rig: DuckRig;
  readonly role: DuckRole;
  readonly object: THREE.Group;

  private readonly personality: Personality;
  private readonly rng: Rng;

  private pose: DuckPose = 'idle';
  private poseBlend = 1;
  private previousPose: DuckPose = 'idle';

  private walkPhase = 0;
  private idlePhase = 0;
  private gesturePhase = 0;
  private blinkTimer = 2;
  private blinkAmount = 0;
  private fidgetTimer = 0;
  private talkPhase = 0;

  /** Where the duck is walking to, if anywhere. */
  private navTarget: THREE.Vector3 | null = null;
  private navOnArrive: (() => void) | null = null;

  /** What the head is trying to look at. */
  private lookTarget: THREE.Vector3 | null = null;
  private headYaw = 0;
  private headPitch = 0;

  /** Where the ground is under the duck, so it stands on terrain. */
  groundHeight = 0;

  constructor(role: DuckRole, seed = 1) {
    this.role = role;
    this.rig = buildDuck(role);
    this.object = this.rig.root;
    this.personality = PERSONALITIES[role];
    this.rng = new Rng(seed * 7919 + (role === 'engineer' ? 11 : 23));
    this.fidgetTimer = this.rng.range(1, this.personality.fidgetInterval);
  }

  get name(): string {
    return DUCK_NAMES[this.role];
  }

  get position(): THREE.Vector3 {
    return this.object.position;
  }

  /** Sets the pose, blending out of the previous one. */
  setPose(pose: DuckPose): void {
    if (pose === this.pose) return;
    this.previousPose = this.pose;
    this.pose = pose;
    this.poseBlend = 0;
    this.gesturePhase = 0;
  }

  currentPose(): DuckPose {
    return this.pose;
  }

  /** Places the duck immediately. */
  placeAt(x: number, y: number, z: number, facing = 0): void {
    this.object.position.set(x, y, z);
    this.object.rotation.y = facing;
    this.groundHeight = y;
  }

  /** Walks to a world position, then optionally runs a callback. */
  walkTo(target: THREE.Vector3, onArrive?: () => void): void {
    this.navTarget = target.clone();
    this.navOnArrive = onArrive ?? null;
    this.setPose('walk');
  }

  /** Stops any current navigation. */
  stopWalking(): void {
    this.navTarget = null;
    this.navOnArrive = null;
    if (this.pose === 'walk') this.setPose('idle');
  }

  get isWalking(): boolean {
    return this.navTarget !== null;
  }

  /** Turns the head (and slightly the body) toward a world point. */
  lookAt(target: THREE.Vector3 | null): void {
    this.lookTarget = target ? target.clone() : null;
  }

  /** Faces the body toward a world point immediately. */
  faceToward(target: THREE.Vector3): void {
    const dx = target.x - this.object.position.x;
    const dz = target.z - this.object.position.z;
    this.object.rotation.y = Math.atan2(dx, dz);
  }

  /** Makes the duck speak for a while; the bill moves and the head bobs. */
  speak(seconds: number): void {
    this.talkPhase = seconds;
    if (this.pose === 'idle') this.setPose('talk');
  }

  get isSpeaking(): boolean {
    return this.talkPhase > 0;
  }

  update(dt: number): void {
    const p = this.personality;
    const t = dt * p.tempo;

    this.idlePhase += t;
    this.poseBlend = Math.min(1, this.poseBlend + dt * 3.5);
    if (this.talkPhase > 0) this.talkPhase = Math.max(0, this.talkPhase - dt);

    this.updateNavigation(dt);
    this.updateBlink(dt);
    this.updateHeadLook(dt);

    // Reset the rig to neutral, then apply the blended poses on top.
    this.resetRig();
    if (this.poseBlend < 1) {
      this.applyPose(this.previousPose, 1 - this.poseBlend, t);
    }
    this.applyPose(this.pose, this.poseBlend, t);
    this.applyHeadLook();
    this.applyBlink();
    this.applyTalking(t);
  }

  // -------------------------------------------------------------------------

  private updateNavigation(dt: number): void {
    if (!this.navTarget) return;

    const pos = this.object.position;
    const dx = this.navTarget.x - pos.x;
    const dz = this.navTarget.z - pos.z;
    const dist = Math.hypot(dx, dz);

    if (dist < 0.12) {
      this.navTarget = null;
      const cb = this.navOnArrive;
      this.navOnArrive = null;
      if (this.pose === 'walk') this.setPose('idle');
      cb?.();
      return;
    }

    // Turn toward the target, then move.
    const desiredYaw = Math.atan2(dx, dz);
    let delta = desiredYaw - this.object.rotation.y;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    this.object.rotation.y += clamp(delta, -3.5 * dt, 3.5 * dt);

    // Ease speed near the destination so the arrival is not abrupt.
    const speed = this.personality.walkSpeed * smoothstep(clamp(dist / 0.6, 0, 1));
    const step = Math.min(speed * dt, dist);
    pos.x += (dx / dist) * step;
    pos.z += (dz / dist) * step;
    pos.y = this.groundHeight;

    this.walkPhase += dt * speed * 9;
    if (this.pose !== 'walk') this.setPose('walk');
  }

  private updateBlink(dt: number): void {
    this.blinkTimer -= dt;
    if (this.blinkTimer <= 0) {
      this.blinkTimer = this.rng.range(2.2, 6.5);
      this.blinkAmount = 1;
    }
    this.blinkAmount = Math.max(0, this.blinkAmount - dt * 7);
  }

  private updateHeadLook(dt: number): void {
    let targetYaw = 0;
    let targetPitch = 0;

    if (this.lookTarget) {
      const local = this.object.worldToLocal(this.lookTarget.clone());
      targetYaw = clamp(Math.atan2(local.x, local.z), -1.15, 1.15);
      const horiz = Math.hypot(local.x, local.z);
      targetPitch = clamp(
        Math.atan2(local.y - DUCK_HEIGHT * 0.85, Math.max(horiz, 0.01)),
        -0.7,
        1.25,
      );
    }

    this.headYaw = damp(this.headYaw, targetYaw, 5, dt);
    this.headPitch = damp(this.headPitch, targetPitch, 5, dt);
  }

  private resetRig(): void {
    const r = this.rig;
    r.pelvis.position.y = DUCK_HEIGHT * 0.42;
    r.pelvis.rotation.set(0, 0, 0);
    r.spine.rotation.set(0, 0, 0);
    r.neck.rotation.set(0, 0, 0);
    r.head.rotation.set(0, 0, 0);
    r.bill.rotation.set(0, 0, 0);
    r.leftWing.rotation.set(0, 0, -0.18);
    r.rightWing.rotation.set(0, 0, 0.18);
    r.leftLeg.rotation.set(0, 0, 0);
    r.rightLeg.rotation.set(0, 0, 0);
    r.leftFoot.rotation.set(0, 0, 0);
    r.rightFoot.rotation.set(0, 0, 0);
  }

  private applyPose(pose: DuckPose, weight: number, t: number): void {
    if (weight <= 0.001) return;
    const r = this.rig;
    const w = weight;
    const S = DUCK_HEIGHT;
    const p = this.personality;

    switch (pose) {
      case 'idle': {
        // Gentle breathing, occasional weight shift and a head fidget.
        const breath = Math.sin(this.idlePhase * 1.6) * 0.5 + 0.5;
        r.pelvis.position.y += w * breath * S * 0.008;
        r.spine.rotation.x += w * (breath * 0.03 - 0.015);

        this.fidgetTimer -= t;
        const fidget =
          this.fidgetTimer < 0.7 ? Math.sin((0.7 - this.fidgetTimer) * 9) * 0.16 : 0;
        if (this.fidgetTimer < 0) this.fidgetTimer = p.fidgetInterval * this.rng.range(0.7, 1.4);

        r.neck.rotation.y += w * fidget;
        r.leftWing.rotation.z += w * Math.sin(this.idlePhase * 1.3) * 0.05;
        r.rightWing.rotation.z -= w * Math.sin(this.idlePhase * 1.3 + 0.5) * 0.05;
        break;
      }

      case 'walk': {
        // A duck's waddle: big lateral hip roll, short stride, head bob.
        const ph = this.walkPhase;
        const stride = 0.55;
        const roll = Math.sin(ph) * 0.16 * p.bounce;

        r.pelvis.rotation.z += w * roll;
        r.pelvis.position.y += w * Math.abs(Math.sin(ph * 2)) * S * 0.022 * p.bounce;
        r.spine.rotation.x += w * 0.1;
        r.spine.rotation.z -= w * roll * 0.4;

        r.leftLeg.rotation.x += w * Math.sin(ph) * stride;
        r.rightLeg.rotation.x += w * Math.sin(ph + Math.PI) * stride;
        r.leftFoot.rotation.x += w * Math.max(0, -Math.sin(ph)) * 0.5;
        r.rightFoot.rotation.x += w * Math.max(0, -Math.sin(ph + Math.PI)) * 0.5;

        // Wings counter-swing, as a walking bird's do.
        r.leftWing.rotation.x += w * Math.sin(ph + Math.PI) * 0.24;
        r.rightWing.rotation.x += w * Math.sin(ph) * 0.24;
        r.leftWing.rotation.z += w * -0.1;
        r.rightWing.rotation.z += w * 0.1;

        // Head bobs forward and back with each step.
        r.neck.rotation.x += w * Math.sin(ph * 2) * 0.09;
        break;
      }

      case 'point': {
        this.gesturePhase += t;
        const raise = smoothstep(clamp(this.gesturePhase / 0.55, 0, 1));
        // Right wing comes up and forward to point.
        r.rightWing.rotation.z += w * raise * -1.25;
        r.rightWing.rotation.x += w * raise * -0.65;
        r.spine.rotation.y += w * raise * -0.16;
        r.neck.rotation.x += w * raise * -0.12;
        // A small insistent jab.
        r.rightWing.rotation.x += w * raise * Math.sin(this.gesturePhase * 6) * 0.08;
        break;
      }

      case 'look-up': {
        // Craning to take in something very large and very close.
        const settle = smoothstep(clamp((this.gesturePhase += t) / 0.9, 0, 1));
        r.neck.rotation.x += w * settle * -0.72;
        r.head.rotation.x += w * settle * -0.42;
        r.spine.rotation.x += w * settle * -0.2;
        r.pelvis.position.y -= w * settle * S * 0.015;
        // Slight sway, as if leaning back to see the top.
        r.spine.rotation.z += w * Math.sin(this.idlePhase * 0.9) * 0.04;
        break;
      }

      case 'talk': {
        // Conversational gesturing with the wings.
        const g = this.idlePhase * 3.1;
        r.leftWing.rotation.z += w * (Math.sin(g) * 0.22 - 0.2);
        r.leftWing.rotation.x += w * Math.sin(g * 1.3) * 0.18;
        r.rightWing.rotation.z += w * (Math.sin(g + 1.4) * 0.18 + 0.2);
        r.neck.rotation.y += w * Math.sin(g * 0.7) * 0.1;
        r.spine.rotation.y += w * Math.sin(g * 0.5) * 0.06;
        break;
      }

      case 'cheer': {
        this.gesturePhase += t;
        const hop = Math.abs(Math.sin(this.gesturePhase * 5.5));
        r.pelvis.position.y += w * hop * S * 0.12 * p.bounce;
        r.leftWing.rotation.z += w * -2.1;
        r.rightWing.rotation.z += w * 2.1;
        r.leftWing.rotation.x += w * Math.sin(this.gesturePhase * 11) * 0.3;
        r.rightWing.rotation.x += w * Math.sin(this.gesturePhase * 11 + 1) * 0.3;
        r.neck.rotation.x += w * -0.3;
        // Legs tuck on the way up.
        r.leftLeg.rotation.x += w * hop * 0.4;
        r.rightLeg.rotation.x += w * hop * 0.4;
        break;
      }

      case 'flinch': {
        this.gesturePhase += t;
        const shock = Math.exp(-this.gesturePhase * 2.2);
        r.spine.rotation.x += w * shock * 0.45;
        r.neck.rotation.x += w * shock * 0.5;
        r.pelvis.position.y -= w * shock * S * 0.05;
        // Wings clamp in.
        r.leftWing.rotation.z += w * shock * 0.7;
        r.rightWing.rotation.z -= w * shock * 0.7;
        r.leftWing.rotation.x += w * shock * 0.4;
        r.rightWing.rotation.x += w * shock * 0.4;
        break;
      }

      case 'inspect': {
        // Head down over the clipboard/tablet, occasionally glancing up.
        const glance = Math.sin(this.idlePhase * 0.55) > 0.82 ? 1 : 0;
        const g = damp(0, glance, 4, t);
        r.neck.rotation.x += w * lerp(0.55, -0.25, g);
        r.head.rotation.x += w * lerp(0.3, 0, g);
        r.spine.rotation.x += w * 0.14;
        // The wing holding the prop comes up to reading height.
        const holding = this.role === 'engineer' ? r.leftWing : r.rightWing;
        holding.rotation.x += w * -0.85;
        holding.rotation.z += w * (this.role === 'engineer' ? 0.35 : -0.35);
        // Tapping the other wing on the prop.
        const other = this.role === 'engineer' ? r.rightWing : r.leftWing;
        other.rotation.x += w * (-0.6 + Math.sin(this.idlePhase * 4) * 0.12);
        break;
      }

      case 'wave': {
        this.gesturePhase += t;
        const raise = smoothstep(clamp(this.gesturePhase / 0.4, 0, 1));
        r.rightWing.rotation.z += w * raise * 2.0;
        r.rightWing.rotation.x += w * Math.sin(this.gesturePhase * 7) * 0.35 * raise;
        r.neck.rotation.y += w * 0.1;
        break;
      }

      case 'salute': {
        this.gesturePhase += t;
        const raise = smoothstep(clamp(this.gesturePhase / 0.5, 0, 1));
        r.rightWing.rotation.z += w * raise * 1.5;
        r.rightWing.rotation.x += w * raise * -1.15;
        r.spine.rotation.x += w * raise * -0.08;
        break;
      }

      default:
        break;
    }
  }

  private applyHeadLook(): void {
    // Split the look between neck and head so the motion is not robotic.
    this.rig.neck.rotation.y += this.headYaw * 0.45;
    this.rig.head.rotation.y += this.headYaw * 0.55;
    this.rig.neck.rotation.x -= this.headPitch * 0.5;
    this.rig.head.rotation.x -= this.headPitch * 0.5;
  }

  private applyBlink(): void {
    const closed = clamp(this.blinkAmount, 0, 1);
    for (const lid of this.rig.eyelids) {
      lid.position.y = lerp(DUCK_HEIGHT * 0.045, -DUCK_HEIGHT * 0.01, closed);
    }
  }

  private applyTalking(t: number): void {
    if (this.talkPhase <= 0) {
      this.rig.bill.rotation.x = 0;
      return;
    }
    // Bill opens and closes on a syllable rhythm with pauses between phrases.
    const phase = this.idlePhase * 11;
    const syllable = Math.max(0, Math.sin(phase)) * (0.6 + 0.4 * Math.sin(this.idlePhase * 2.3));
    this.rig.bill.rotation.x = syllable * 0.42;
    this.rig.neck.rotation.x += Math.sin(phase * 0.5) * 0.03;
    void t;
  }

  dispose(): void {
    this.object.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.geometry) m.geometry.dispose();
    });
  }
}

/** Creates the agency's two-duck crew. */
export function createCrew(): { engineer: DuckActor; pilot: DuckActor } {
  return {
    engineer: new DuckActor('engineer', 1),
    pilot: new DuckActor('pilot', 2),
  };
}
