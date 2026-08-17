/**
 * Engine exhaust plume (spec §10) — the prototype's most critical visual gap.
 *
 * This is not an orange cone and not a light. A running engine produces:
 *   - a hard, bright supersonic core with visible shock diamonds,
 *   - a turbulent luminous envelope that flares and flickers,
 *   - a soft bloom at the nozzle exit plane,
 *   - a trailing exhaust column of hot particles,
 *   - a flickering dynamic light that actually illuminates the vehicle and pad.
 *
 * The plume geometry responds to ambient pressure the way a real one does: at
 * sea level the atmosphere confines it into a narrow collimated jet with strong
 * diamonds; in vacuum there is nothing to confine it and it blooms into a wide,
 * soft, diamond-free cone. It is anchored to the nozzle exit marker, points
 * along the engine axis, and scales with throttle.
 */
import * as THREE from 'three';
import { clamp, lerp } from '../utils/math';
import { softParticle } from '../render/textures';
import { ParticleSystem, effectRng } from './ParticleSystem';

const PLUME_VERTEX = /* glsl */ `
  varying vec2 vUv;
  varying float vRadial;

  uniform float uTime;
  uniform float uThrottle;
  uniform float uVacuum;      // 0 = sea level, 1 = vacuum
  uniform float uTurbulence;

  // Cheap 3D hash noise — enough for plume turbulence, and no texture fetch.
  float hash(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }

  float noise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
          mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
      mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
          mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y),
      f.z);
  }

  void main() {
    vUv = uv;
    // Distance from the nozzle exit: 0 at the throat end, 1 at the tail.
    float d = 1.0 - uv.y;

    vec3 pos = position;

    // Vacuum plumes expand: with no ambient pressure to confine the flow the
    // exhaust keeps spreading, so widen the cone with distance from the nozzle.
    float bloom = 1.0 + uVacuum * d * 2.6;
    pos.xz *= bloom;

    // Turbulent breakup, growing downstream — the jet is smooth at the throat
    // and ragged where it has mixed with the surrounding air.
    float n = noise(vec3(pos.xz * 1.6, uTime * 5.0 + d * 4.0)) - 0.5;
    float wobble = n * uTurbulence * d * d * (0.5 + uVacuum * 0.9);
    pos.xz += pos.xz * wobble * 2.2;
    pos.x += n * wobble * 0.6;

    // Throttle shortens and narrows the whole plume.
    pos.y *= mix(0.25, 1.0, uThrottle);
    pos.xz *= mix(0.55, 1.0, uThrottle);

    vRadial = length(pos.xz) / max(length(position.xz), 0.0001);

    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

const PLUME_FRAGMENT = /* glsl */ `
  varying vec2 vUv;
  varying float vRadial;

  uniform float uTime;
  uniform float uThrottle;
  uniform float uVacuum;
  uniform float uIntensity;
  uniform vec3  uCoreColor;
  uniform vec3  uMidColor;
  uniform vec3  uTailColor;

  void main() {
    float d = 1.0 - vUv.y;   // 0 at nozzle, 1 at tail

    // ---- Longitudinal temperature gradient ----
    // Incandescent core near the throat, cooling to orange and then to smoke.
    vec3 color = mix(uCoreColor, uMidColor, smoothstep(0.0, 0.34, d));
    color = mix(color, uTailColor, smoothstep(0.3, 1.0, d));

    // ---- Shock diamonds ----
    // Only form when ambient pressure confines the jet, so they fade out in
    // vacuum. Spacing widens downstream as the shocks weaken.
    float diamondPhase = d * 17.0 - pow(d, 1.6) * 6.0;
    float diamonds = pow(max(sin(diamondPhase) * 0.5 + 0.5, 0.0), 5.0);
    float diamondStrength = (1.0 - uVacuum) * (1.0 - smoothstep(0.05, 0.62, d)) * uThrottle;
    color += vec3(0.85, 0.92, 1.0) * diamonds * diamondStrength * 1.5;

    // ---- Radial falloff ----
    // Hot dense centre, soft luminous edge.
    float radial = clamp(vRadial, 0.0, 2.0);
    float edge = 1.0 - smoothstep(0.35, 1.0, radial);
    float centre = 1.0 - smoothstep(0.0, 0.55, radial);
    color += uCoreColor * centre * 0.55 * (1.0 - d);

    // ---- Alpha ----
    // Dense at the nozzle, dissolving downstream; flicker keeps it alive.
    float flicker = 0.88 + 0.12 * sin(uTime * 41.0 + d * 9.0)
                         + 0.06 * sin(uTime * 97.0);
    float alpha = (1.0 - pow(d, 0.85)) * edge * uIntensity * flicker;
    alpha *= smoothstep(0.0, 0.06, uThrottle);

    if (alpha <= 0.002) discard;
    gl_FragColor = vec4(color * uIntensity, alpha);
  }
`;

export interface PlumeOptions {
  /** Nozzle exit radius, metres. */
  readonly exitRadius: number;
  /** Plume length at full throttle in vacuum, metres. */
  readonly length: number;
  /** Colour temperature preset. */
  readonly fuel?: 'kerolox' | 'hypergolic' | 'solid';
}

const FUEL_COLORS = {
  // Kerolox: bright yellow-white core, deep orange mixing region, sooty tail.
  kerolox: {
    core: new THREE.Color(1.0, 0.95, 0.82),
    mid: new THREE.Color(1.0, 0.55, 0.16),
    tail: new THREE.Color(0.42, 0.16, 0.07),
    light: new THREE.Color(1.0, 0.62, 0.28),
  },
  // Hypergolic: cooler, translucent, faintly blue-violet.
  hypergolic: {
    core: new THREE.Color(0.86, 0.93, 1.0),
    mid: new THREE.Color(0.62, 0.72, 1.0),
    tail: new THREE.Color(0.24, 0.3, 0.5),
    light: new THREE.Color(0.72, 0.82, 1.0),
  },
  // Solid: dense, aluminium-bright, very smoky.
  solid: {
    core: new THREE.Color(1.0, 0.98, 0.92),
    mid: new THREE.Color(1.0, 0.72, 0.34),
    tail: new THREE.Color(0.55, 0.34, 0.22),
    light: new THREE.Color(1.0, 0.78, 0.44),
  },
} as const;

export class EnginePlume {
  readonly group = new THREE.Group();

  private readonly core: THREE.Mesh;
  private readonly envelope: THREE.Mesh;
  private readonly bloom: THREE.Sprite;
  private readonly light: THREE.PointLight;

  private readonly coreMat: THREE.ShaderMaterial;
  private readonly envMat: THREE.ShaderMaterial;

  private readonly options: PlumeOptions;
  private readonly palette: (typeof FUEL_COLORS)[keyof typeof FUEL_COLORS];

  /** 0..1 commanded throttle. */
  throttle = 0;
  /** 0 = sea level, 1 = vacuum. */
  vacuum = 0;

  private smoothThrottle = 0;
  private time = 0;

  constructor(options: PlumeOptions) {
    this.options = options;
    this.palette = FUEL_COLORS[options.fuel ?? 'kerolox'];

    const r = options.exitRadius;
    const L = options.length;

    // ---- Inner core: narrow, opaque, carries the shock diamonds ----
    const coreGeo = new THREE.CylinderGeometry(r * 0.9, r * 0.28, L, 20, 24, true);
    coreGeo.translate(0, -L / 2, 0);

    this.coreMat = this.makeMaterial(1.55, 0.55);
    this.core = new THREE.Mesh(coreGeo, this.coreMat);
    this.core.frustumCulled = false;
    this.core.renderOrder = 14;
    this.group.add(this.core);

    // ---- Outer envelope: wide, soft, turbulent ----
    const envGeo = new THREE.CylinderGeometry(r * 1.28, r * 1.5, L * 1.22, 20, 26, true);
    envGeo.translate(0, -(L * 1.22) / 2, 0);

    this.envMat = this.makeMaterial(0.7, 1.5);
    this.envelope = new THREE.Mesh(envGeo, this.envMat);
    this.envelope.frustumCulled = false;
    this.envelope.renderOrder = 13;
    this.group.add(this.envelope);

    // ---- Bloom at the nozzle exit plane ----
    const bloomMat = new THREE.SpriteMaterial({
      map: softParticle('rgba(255,236,200,1)', 'rgba(255,140,40,0)'),
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
      toneMapped: false,
    });
    this.bloom = new THREE.Sprite(bloomMat);
    this.bloom.scale.setScalar(r * 5);
    this.bloom.renderOrder = 15;
    this.group.add(this.bloom);

    // ---- Dynamic light (spec §57) ----
    this.light = new THREE.PointLight(this.palette.light, 0, r * 220, 2);
    this.light.position.y = -L * 0.12;
    this.group.add(this.light);
  }

  private makeMaterial(intensity: number, turbulence: number): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uThrottle: { value: 0 },
        uVacuum: { value: 0 },
        uIntensity: { value: intensity },
        uTurbulence: { value: turbulence },
        uCoreColor: { value: this.palette.core.clone() },
        uMidColor: { value: this.palette.mid.clone() },
        uTailColor: { value: this.palette.tail.clone() },
      },
      vertexShader: PLUME_VERTEX,
      fragmentShader: PLUME_FRAGMENT,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
  }

  /**
   * Advances the plume. `dt` is real seconds; throttle changes are smoothed so
   * the flame spools up and dies down rather than snapping between states.
   */
  update(dt: number): void {
    this.time += dt;

    // Spool up quickly, tail off slowly — engines light fast and trail off.
    const rate = this.throttle > this.smoothThrottle ? 7 : 3.4;
    this.smoothThrottle = lerp(
      this.smoothThrottle,
      this.throttle,
      1 - Math.exp(-rate * dt),
    );

    const t = this.smoothThrottle;
    const visible = t > 0.008;
    this.group.visible = visible;
    if (!visible) {
      this.light.intensity = 0;
      return;
    }

    for (const mat of [this.coreMat, this.envMat]) {
      mat.uniforms.uTime.value = this.time;
      mat.uniforms.uThrottle.value = t;
      mat.uniforms.uVacuum.value = this.vacuum;
    }

    // Bloom grows with throttle and flickers on a different beat to the flame.
    const flicker = 0.9 + 0.1 * Math.sin(this.time * 33) + 0.05 * Math.sin(this.time * 71);
    const r = this.options.exitRadius;
    this.bloom.scale.setScalar(r * (3.2 + 3.4 * t) * flicker * (1 + this.vacuum * 0.7));
    (this.bloom.material as THREE.SpriteMaterial).opacity = clamp(t * 1.1, 0, 1);

    // Light intensity tracks thrust; range grows so a big engine lights a big area.
    this.light.intensity = t * 26 * flicker * (1 + this.vacuum * 0.4);
    this.light.distance = r * (140 + 180 * t);
  }

  /** Smoothed throttle, for callers that drive smoke and dust from the plume. */
  get intensity(): number {
    return this.smoothThrottle;
  }

  setLightEnabled(enabled: boolean): void {
    this.light.visible = enabled;
  }

  dispose(): void {
    this.core.geometry.dispose();
    this.envelope.geometry.dispose();
    this.coreMat.dispose();
    this.envMat.dispose();
    (this.bloom.material as THREE.SpriteMaterial).dispose();
  }
}

/**
 * The trailing exhaust column: hot particles shed behind the nozzle that cool
 * from incandescent to smoke as they age. This is what gives the plume depth and
 * makes a climbing rocket leave a visible trail (spec §12).
 */
export class ExhaustTrail {
  readonly system: ParticleSystem;
  private accumulator = 0;

  constructor(capacity = 900) {
    this.system = new ParticleSystem(
      capacity,
      softParticle('rgba(255,220,170,1)', 'rgba(255,110,30,0)'),
      THREE.AdditiveBlending,
    );
  }

  /**
   * Emits exhaust from a nozzle.
   *
   * @param worldPos   nozzle exit in world space
   * @param exhaustDir unit vector the exhaust travels along
   * @param vehicleVel vehicle velocity, so the trail is left behind correctly
   * @param throttle   0..1
   * @param exitRadius nozzle radius, metres
   * @param vacuum     0..1, widens and slows the plume in thin air
   */
  emit(
    dt: number,
    worldPos: THREE.Vector3,
    exhaustDir: THREE.Vector3,
    vehicleVel: THREE.Vector3,
    throttle: number,
    exitRadius: number,
    vacuum: number,
  ): void {
    if (throttle <= 0.02) return;

    const rate = 55 * throttle;
    this.accumulator += rate * dt;
    const count = Math.floor(this.accumulator);
    this.accumulator -= count;

    // Perpendicular basis for spreading particles across the nozzle.
    const a = Math.abs(exhaustDir.y) < 0.9
      ? new THREE.Vector3(0, 1, 0)
      : new THREE.Vector3(1, 0, 0);
    const u = new THREE.Vector3().crossVectors(exhaustDir, a).normalize();
    const v = new THREE.Vector3().crossVectors(exhaustDir, u).normalize();

    const exhaustSpeed = lerp(240, 90, vacuum) * throttle;
    const spread = lerp(0.06, 0.3, vacuum);

    for (let i = 0; i < count; i++) {
      const ang = effectRng.range(0, Math.PI * 2);
      const rad = Math.sqrt(effectRng.next()) * exitRadius * 0.85;

      const pos = worldPos
        .clone()
        .addScaledVector(u, Math.cos(ang) * rad)
        .addScaledVector(v, Math.sin(ang) * rad)
        .addScaledVector(exhaustDir, effectRng.range(0, exitRadius * 2));

      const vel = exhaustDir
        .clone()
        .multiplyScalar(exhaustSpeed * effectRng.range(0.7, 1.15))
        .addScaledVector(u, effectRng.signed() * exhaustSpeed * spread)
        .addScaledVector(v, effectRng.signed() * exhaustSpeed * spread)
        // Inherit part of the vehicle's motion so the column trails properly.
        .addScaledVector(vehicleVel, 0.35);

      // Hot at birth, cooling toward sooty grey.
      const heat = effectRng.range(0.55, 1);
      const color = new THREE.Color().setRGB(
        lerp(0.5, 1.0, heat),
        lerp(0.22, 0.72, heat),
        lerp(0.1, 0.34, heat),
      );

      this.system.emit({
        position: pos,
        velocity: vel,
        life: effectRng.range(0.35, 0.95) * (1 + vacuum),
        size: exitRadius * effectRng.range(0.5, 1.1),
        growth: exitRadius * lerp(2.2, 5.5, vacuum),
        color,
        opacity: effectRng.range(0.3, 0.62) * throttle,
        spin: effectRng.signed() * 2.5,
        drag: lerp(2.2, 0.35, vacuum),
        buoyancy: 0,
      });
    }
  }

  update(dt: number): void {
    this.system.update(dt);
  }

  dispose(): void {
    this.system.dispose();
  }
}
