/**
 * Atmospheric entry heating (spec §34).
 *
 * At Mars entry speeds the vehicle is not "on fire" — it is sitting behind a
 * detached bow shock that heats the gas in front of it to incandescence. So the
 * effect is built as a shock layer standing off the heat shield, plus a long
 * luminous wake of ablated material streaming behind, plus a glow on the shield
 * itself. The intensity is driven by the real heat flux the physics computes.
 */
import * as THREE from 'three';
import { clamp } from '../utils/math';
import { softParticle } from '../render/textures';
import { ParticleSystem, effectRng } from './ParticleSystem';

const SHOCK_VERTEX = /* glsl */ `
  varying vec3 vNormal;
  varying vec2 vUv;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SHOCK_FRAGMENT = /* glsl */ `
  varying vec3 vNormal;
  varying vec2 vUv;

  uniform float uIntensity;
  uniform float uTime;
  uniform vec3  uHotColor;
  uniform vec3  uCoolColor;

  void main() {
    // Brightest where the shock is normal to the flow (the stagnation region)
    // and falling off around the shoulder.
    float facing = clamp(dot(vNormal, vec3(0.0, -1.0, 0.0)), 0.0, 1.0);
    float core = pow(facing, 1.6);

    // Unsteady shock: real entry glow shimmers rather than sitting still.
    float shimmer = 0.85 + 0.15 * sin(uTime * 23.0 + vUv.x * 30.0)
                         + 0.08 * sin(uTime * 57.0 + vUv.y * 18.0);

    vec3 color = mix(uCoolColor, uHotColor, core);
    float alpha = core * uIntensity * shimmer;

    // Rim brightening around the shoulder where the shock is edge-on.
    float rim = pow(1.0 - facing, 2.5) * 0.55;
    color += uHotColor * rim * uIntensity;
    alpha += rim * uIntensity * 0.6;

    if (alpha <= 0.003) discard;
    gl_FragColor = vec4(color, clamp(alpha, 0.0, 1.0));
  }
`;

export class EntryPlasma {
  readonly group = new THREE.Group();

  private readonly shock: THREE.Mesh;
  private readonly shockMat: THREE.ShaderMaterial;
  private readonly glowLight: THREE.PointLight;
  readonly wake: ParticleSystem;

  private accumulator = 0;
  private time = 0;

  /** 0..1, driven from the simulated stagnation heat flux. */
  intensity = 0;
  private smoothed = 0;

  constructor(shieldRadius: number) {
    // The shock stands off the shield by a few percent of its diameter.
    const geo = new THREE.SphereGeometry(
      shieldRadius * 1.22,
      28,
      18,
      0,
      Math.PI * 2,
      Math.PI * 0.42,
      Math.PI * 0.58,
    );

    this.shockMat = new THREE.ShaderMaterial({
      uniforms: {
        uIntensity: { value: 0 },
        uTime: { value: 0 },
        // White-hot at the stagnation point, cooling to orange around the rim.
        uHotColor: { value: new THREE.Color(1.0, 0.93, 0.78) },
        uCoolColor: { value: new THREE.Color(1.0, 0.36, 0.12) },
      },
      vertexShader: SHOCK_VERTEX,
      fragmentShader: SHOCK_FRAGMENT,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });

    this.shock = new THREE.Mesh(geo, this.shockMat);
    this.shock.frustumCulled = false;
    this.shock.renderOrder = 16;
    this.group.add(this.shock);

    this.glowLight = new THREE.PointLight(0xff8840, 0, shieldRadius * 90, 2);
    this.group.add(this.glowLight);

    this.wake = new ParticleSystem(
      1200,
      softParticle('rgba(255,220,170,1)', 'rgba(255,90,20,0)'),
      THREE.AdditiveBlending,
    );
  }

  /**
   * Emits the ablation wake trailing behind the vehicle.
   *
   * @param worldPos position of the heat shield in world space
   * @param wakeDir  direction the wake streams (opposite the velocity)
   * @param speed    airspeed, m/s
   * @param radius   shield radius, metres
   */
  update(
    dt: number,
    worldPos: THREE.Vector3,
    wakeDir: THREE.Vector3,
    speed: number,
    radius: number,
  ): void {
    this.time += dt;
    this.smoothed += (this.intensity - this.smoothed) * (1 - Math.exp(-4 * dt));

    const i = clamp(this.smoothed, 0, 1);
    this.group.visible = i > 0.01;
    this.shockMat.uniforms.uIntensity.value = i;
    this.shockMat.uniforms.uTime.value = this.time;
    this.glowLight.intensity = i * 30;

    if (i > 0.05) {
      this.accumulator += 90 * i * dt;
      const count = Math.floor(this.accumulator);
      this.accumulator -= count;

      const a = Math.abs(wakeDir.y) < 0.9
        ? new THREE.Vector3(0, 1, 0)
        : new THREE.Vector3(1, 0, 0);
      const u = new THREE.Vector3().crossVectors(wakeDir, a).normalize();
      const v = new THREE.Vector3().crossVectors(wakeDir, u).normalize();

      for (let n = 0; n < count; n++) {
        const ang = effectRng.range(0, Math.PI * 2);
        const rad = Math.sqrt(effectRng.next()) * radius * 1.15;

        const pos = worldPos
          .clone()
          .addScaledVector(u, Math.cos(ang) * rad)
          .addScaledVector(v, Math.sin(ang) * rad);

        const heat = effectRng.range(0.4, 1) * i;
        this.wake.emit({
          position: pos,
          velocity: wakeDir
            .clone()
            .multiplyScalar(speed * effectRng.range(0.12, 0.3))
            .addScaledVector(u, effectRng.signed() * 18)
            .addScaledVector(v, effectRng.signed() * 18),
          life: effectRng.range(0.5, 1.6),
          size: radius * effectRng.range(0.2, 0.55),
          growth: radius * 1.4,
          color: new THREE.Color(1, 0.35 + heat * 0.5, 0.1 + heat * 0.28),
          opacity: heat * 0.55,
          spin: effectRng.signed() * 3,
          drag: 1.6,
          buoyancy: 0,
        });
      }
    }

    this.wake.update(dt);
  }

  reset(): void {
    this.intensity = 0;
    this.smoothed = 0;
    this.wake.reset();
  }

  dispose(): void {
    this.shock.geometry.dispose();
    this.shockMat.dispose();
    this.wake.dispose();
  }
}
