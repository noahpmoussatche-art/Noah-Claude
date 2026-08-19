/**
 * A pooled billboard particle system (spec §58).
 *
 * Built on THREE.Points with a custom shader so each particle carries its own
 * size, rotation, colour and opacity — a plain Points cloud cannot rotate its
 * sprites, and un-rotated smoke reads instantly as a stack of identical discs.
 *
 * The pool is fixed-size and allocation-free at runtime (spec §73): emitting a
 * particle reuses the oldest dead slot rather than growing an array.
 */
import * as THREE from 'three';
import { Rng } from '../utils/math';

export interface ParticleSpawn {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  /** Seconds the particle lives. */
  life: number;
  /** Starting radius, metres. */
  size: number;
  /** Metres per second the particle grows. */
  growth: number;
  color: THREE.Color;
  /** Peak opacity, reached early in life then faded out. */
  opacity: number;
  /** Radians per second. */
  spin: number;
  /** Fraction of velocity retained per second (air resistance). */
  drag: number;
  /** Upward acceleration, m/s^2 — positive for hot buoyant smoke. */
  buoyancy: number;
}

const VERTEX_SHADER = /* glsl */ `
  attribute float aSize;
  attribute float aRotation;
  attribute float aOpacity;
  attribute vec3 aColor;

  varying float vRotation;
  varying float vOpacity;
  varying vec3 vColor;

  uniform float uPixelRatio;
  uniform float uViewportHeight;

  void main() {
    vRotation = aRotation;
    vOpacity = aOpacity;
    vColor = aColor;

    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;

    // Perspective-correct world-space sizing: a 10 m puff stays 10 m across.
    float dist = max(-mvPosition.z, 0.001);
    gl_PointSize = aSize * uViewportHeight * projectionMatrix[1][1] / dist * uPixelRatio;
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D uTexture;

  varying float vRotation;
  varying float vOpacity;
  varying vec3 vColor;

  void main() {
    if (vOpacity <= 0.001) discard;

    // Rotate the sprite's UVs about its centre.
    vec2 uv = gl_PointCoord - 0.5;
    float s = sin(vRotation);
    float c = cos(vRotation);
    uv = vec2(uv.x * c - uv.y * s, uv.x * s + uv.y * c) + 0.5;

    vec4 tex = texture2D(uTexture, uv);
    gl_FragColor = vec4(vColor, tex.a * vOpacity);
    if (gl_FragColor.a < 0.003) discard;
  }
`;

export class ParticleSystem {
  readonly points: THREE.Points;
  readonly capacity: number;

  private readonly positions: Float32Array;
  private readonly velocities: Float32Array;
  private readonly sizes: Float32Array;
  private readonly rotations: Float32Array;
  private readonly opacities: Float32Array;
  private readonly colors: Float32Array;

  private readonly ages: Float32Array;
  private readonly lives: Float32Array;
  private readonly growths: Float32Array;
  private readonly spins: Float32Array;
  private readonly drags: Float32Array;
  private readonly buoyancies: Float32Array;
  private readonly peakOpacity: Float32Array;

  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.ShaderMaterial;

  private cursor = 0;
  private liveCount = 0;

  constructor(
    capacity: number,
    texture: THREE.Texture,
    blending: THREE.Blending = THREE.NormalBlending,
    depthWrite = false,
  ) {
    this.capacity = capacity;

    this.positions = new Float32Array(capacity * 3);
    this.velocities = new Float32Array(capacity * 3);
    this.sizes = new Float32Array(capacity);
    this.rotations = new Float32Array(capacity);
    this.opacities = new Float32Array(capacity);
    this.colors = new Float32Array(capacity * 3);

    this.ages = new Float32Array(capacity);
    this.lives = new Float32Array(capacity);
    this.growths = new Float32Array(capacity);
    this.spins = new Float32Array(capacity);
    this.drags = new Float32Array(capacity);
    this.buoyancies = new Float32Array(capacity);
    this.peakOpacity = new Float32Array(capacity);

    // Dead particles are parked far away with zero opacity.
    this.positions.fill(0);
    this.opacities.fill(0);

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1));
    this.geometry.setAttribute('aRotation', new THREE.BufferAttribute(this.rotations, 1));
    this.geometry.setAttribute('aOpacity', new THREE.BufferAttribute(this.opacities, 1));
    this.geometry.setAttribute('aColor', new THREE.BufferAttribute(this.colors, 3));
    // The cloud moves constantly; skip frustum culling on a stale bounding box.
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTexture: { value: texture },
        uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
        uViewportHeight: { value: window.innerHeight },
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: true,
      depthWrite,
      depthTest: true,
      blending,
    });

    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = blending === THREE.AdditiveBlending ? 12 : 10;
  }

  get activeCount(): number {
    return this.liveCount;
  }

  /** Notifies the shader of a viewport change so sizes stay world-correct. */
  setViewport(height: number, pixelRatio: number): void {
    this.material.uniforms.uViewportHeight.value = height;
    this.material.uniforms.uPixelRatio.value = pixelRatio;
  }

  /** Emits one particle, recycling the oldest slot if the pool is full. */
  emit(spawn: ParticleSpawn): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.capacity;

    const i3 = i * 3;
    this.positions[i3] = spawn.position.x;
    this.positions[i3 + 1] = spawn.position.y;
    this.positions[i3 + 2] = spawn.position.z;

    this.velocities[i3] = spawn.velocity.x;
    this.velocities[i3 + 1] = spawn.velocity.y;
    this.velocities[i3 + 2] = spawn.velocity.z;

    this.colors[i3] = spawn.color.r;
    this.colors[i3 + 1] = spawn.color.g;
    this.colors[i3 + 2] = spawn.color.b;

    this.sizes[i] = spawn.size;
    this.rotations[i] = Math.random() * Math.PI * 2;
    this.opacities[i] = 0;
    this.ages[i] = 0;
    this.lives[i] = spawn.life;
    this.growths[i] = spawn.growth;
    this.spins[i] = spawn.spin;
    this.drags[i] = spawn.drag;
    this.buoyancies[i] = spawn.buoyancy;
    this.peakOpacity[i] = spawn.opacity;
  }

  /** Advances every live particle. */
  update(dt: number): void {
    let live = 0;

    for (let i = 0; i < this.capacity; i++) {
      const life = this.lives[i];
      if (life <= 0) continue;

      const age = this.ages[i] + dt;
      if (age >= life) {
        this.lives[i] = 0;
        this.opacities[i] = 0;
        continue;
      }
      this.ages[i] = age;
      live++;

      const i3 = i * 3;
      const t = age / life;

      // Integrate motion.
      const decay = Math.exp(-this.drags[i] * dt);
      this.velocities[i3] *= decay;
      this.velocities[i3 + 1] = this.velocities[i3 + 1] * decay + this.buoyancies[i] * dt;
      this.velocities[i3 + 2] *= decay;

      this.positions[i3] += this.velocities[i3] * dt;
      this.positions[i3 + 1] += this.velocities[i3 + 1] * dt;
      this.positions[i3 + 2] += this.velocities[i3 + 2] * dt;

      this.sizes[i] += this.growths[i] * dt;
      this.rotations[i] += this.spins[i] * dt;

      // Fade in fast, out slow — the profile a real puff of smoke has.
      const fadeIn = Math.min(t / 0.12, 1);
      const fadeOut = 1 - Math.pow(t, 1.7);
      this.opacities[i] = this.peakOpacity[i] * fadeIn * Math.max(fadeOut, 0);
    }

    this.liveCount = live;

    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.aSize.needsUpdate = true;
    this.geometry.attributes.aRotation.needsUpdate = true;
    this.geometry.attributes.aOpacity.needsUpdate = true;
    this.geometry.attributes.aColor.needsUpdate = true;
  }

  /** Instantly clears the system. */
  reset(): void {
    this.lives.fill(0);
    this.opacities.fill(0);
    this.liveCount = 0;
    this.geometry.attributes.aOpacity.needsUpdate = true;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}

/** Shared RNG for effect jitter; deterministic so replays match. */
export const effectRng = new Rng(0xf1a3e);
