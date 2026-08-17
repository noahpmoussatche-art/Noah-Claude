/**
 * Earth sky, atmosphere and orbital environment (spec §29, §30).
 *
 * The sky is altitude-aware: at the pad it is a dawn gradient with sun scatter;
 * climbing, the blue drains out and the zenith goes black while a bright limb
 * stays on the horizon; above the atmosphere only stars and the curved bright
 * edge of the planet remain. That transition is the visual proof the vehicle is
 * actually going somewhere, rather than the scene being swapped.
 */
import * as THREE from 'three';
import { EARTH } from '../data/constants';
import { clamp } from '../utils/math';
import { Noise2D } from '../utils/noise';
import { Rng } from '../utils/math';

const SKY_VERTEX = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/**
 * Sky shader.
 *
 * `uAltitudeFactor` runs 0 (sea level) → 1 (space). It drives three things at
 * once: the zenith darkens to black, the atmospheric band compresses toward the
 * horizon, and the stars fade in — which is what actually happens on the way up.
 */
const SKY_FRAGMENT = /* glsl */ `
  varying vec3 vDir;

  uniform vec3  uSunDirection;
  uniform float uAltitudeFactor;
  uniform float uDawn;          // 0 = midday, 1 = dawn
  uniform vec3  uZenithDay;
  uniform vec3  uHorizonDay;
  uniform vec3  uDawnLow;
  uniform vec3  uDawnHigh;
  uniform float uStarBrightness;
  uniform float uTime;

  // Hash-based star field; cheap and stable, no texture required.
  float hash21(vec2 p) {
    p = fract(p * vec2(233.34, 851.73));
    p += dot(p, p + 23.45);
    return fract(p.x * p.y);
  }

  float stars(vec3 dir) {
    // Project onto a cube face grid so density is roughly uniform.
    vec3 a = abs(dir);
    vec2 uv = a.x > a.y && a.x > a.z ? dir.yz / a.x
            : a.y > a.z             ? dir.xz / a.y
                                    : dir.xy / a.z;
    uv *= 220.0;
    vec2 cell = floor(uv);
    float h = hash21(cell);
    if (h < 0.982) return 0.0;

    vec2 local = fract(uv) - 0.5;
    float d = length(local);
    float brightness = (h - 0.982) / 0.018;
    // Gentle twinkle.
    float tw = 0.75 + 0.25 * sin(uTime * 2.2 + h * 90.0);
    return smoothstep(0.42, 0.0, d) * brightness * tw;
  }

  void main() {
    vec3 dir = normalize(vDir);
    float h = dir.y;

    // ---- Daytime / dawn gradient ----
    float horizonBlend = pow(clamp(1.0 - h, 0.0, 1.0), 3.2);

    vec3 dayColor = mix(uZenithDay, uHorizonDay, horizonBlend);
    vec3 dawnColor = mix(uDawnHigh, uDawnLow, horizonBlend);
    vec3 color = mix(dayColor, dawnColor, uDawn);

    // Sun disc and its scattering halo, warmest near the horizon at dawn.
    float sunDot = max(dot(dir, uSunDirection), 0.0);
    vec3 halo = mix(vec3(1.0, 0.92, 0.78), vec3(1.0, 0.62, 0.33), uDawn);
    color += halo * pow(sunDot, 8.0) * 0.35;
    color += halo * pow(sunDot, 220.0) * 3.5;

    // ---- Altitude transition ----
    // The atmosphere compresses into a bright band at the limb and the rest of
    // the sky goes to space-black.
    float alt = clamp(uAltitudeFactor, 0.0, 1.0);

    // Above the horizon the sky fades out; the band that survives sits low.
    float band = exp(-max(h, 0.0) * mix(1.0, 26.0, alt));
    vec3 spaceColor = vec3(0.0);
    vec3 limb = mix(vec3(0.28, 0.48, 0.85), vec3(0.42, 0.62, 0.95), uDawn) * band;

    color = mix(color, spaceColor + limb, alt);

    // Keep the sun visible from space.
    color += halo * pow(sunDot, 220.0) * 3.0 * alt;

    // ---- Stars ----
    float starFade = clamp(alt * 1.35 - 0.12, 0.0, 1.0) + uStarBrightness;
    float s = stars(dir) * clamp(starFade, 0.0, 1.0);
    // Stars do not show through the bright limb.
    s *= 1.0 - clamp(band * 2.0, 0.0, 1.0);
    color += vec3(s);

    gl_FragColor = vec4(color, 1.0);
  }
`;

export class SkyDome {
  readonly mesh: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;
  private time = 0;

  constructor(radius = 40_000) {
    const geo = new THREE.SphereGeometry(radius, 40, 28);
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uSunDirection: { value: new THREE.Vector3(0.35, 0.12, -0.9).normalize() },
        uAltitudeFactor: { value: 0 },
        uDawn: { value: 1 },
        uZenithDay: { value: new THREE.Color(0x2f6ec4) },
        uHorizonDay: { value: new THREE.Color(0xbcd8f0) },
        uDawnLow: { value: new THREE.Color(0xf0a05a) },
        uDawnHigh: { value: new THREE.Color(0x2b3f78) },
        uStarBrightness: { value: 0 },
        uTime: { value: 0 },
      },
      vertexShader: SKY_VERTEX,
      fragmentShader: SKY_FRAGMENT,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });

    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.renderOrder = -100;
    this.mesh.frustumCulled = false;
  }

  /** Sun direction, also used to place the directional light. */
  setSunDirection(dir: THREE.Vector3): void {
    (this.material.uniforms.uSunDirection.value as THREE.Vector3)
      .copy(dir)
      .normalize();
  }

  /** 0 = midday, 1 = dawn. */
  setDawn(amount: number): void {
    this.material.uniforms.uDawn.value = clamp(amount, 0, 1);
  }

  /**
   * Updates the sky for the vehicle's altitude. The transition is mapped so
   * most of the visible change happens between 20 km and 90 km, which is where
   * it happens in reality.
   */
  setAltitude(metres: number): void {
    const t = clamp((metres - 12_000) / (EARTH.atmosphereTop * 0.62), 0, 1);
    this.material.uniforms.uAltitudeFactor.value = Math.pow(t, 0.78);
  }

  /** Forces the star layer on, for orbital and deep-space views. */
  setStarBrightness(amount: number): void {
    this.material.uniforms.uStarBrightness.value = clamp(amount, 0, 1);
  }

  get altitudeFactor(): number {
    return this.material.uniforms.uAltitudeFactor.value as number;
  }

  update(dt: number): void {
    this.time += dt;
    this.material.uniforms.uTime.value = this.time;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}

/**
 * A dense point-based starfield used in the orbital and cruise views, where the
 * sky shader is not present.
 */
export function buildStarfield(count = 4_000, radius = 900_000): THREE.Points {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const rng = new Rng(0x57a45);

  for (let i = 0; i < count; i++) {
    // Uniform distribution on a sphere.
    const u = rng.next() * 2 - 1;
    const theta = rng.next() * Math.PI * 2;
    const r = Math.sqrt(1 - u * u);

    positions[i * 3] = Math.cos(theta) * r * radius;
    positions[i * 3 + 1] = u * radius;
    positions[i * 3 + 2] = Math.sin(theta) * r * radius;

    // Stellar colour range: most white, some blue-white, a few orange.
    const t = rng.next();
    const c = new THREE.Color();
    if (t < 0.12) c.setRGB(0.72, 0.8, 1.0);
    else if (t < 0.78) c.setRGB(1, 1, 1);
    else c.setRGB(1.0, 0.86, 0.7);

    const mag = Math.pow(rng.next(), 2.4);
    c.multiplyScalar(0.45 + mag * 0.55);

    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
    sizes[i] = (0.6 + mag * 3.2) * (radius / 900_000);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));

  const mat = new THREE.ShaderMaterial({
    uniforms: { uScale: { value: 620 } },
    vertexShader: /* glsl */ `
      attribute float aSize;
      varying vec3 vColor;
      uniform float uScale;
      void main() {
        vColor = color;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = aSize * uScale / max(-mv.z, 1.0) * 1000.0;
        gl_PointSize = clamp(gl_PointSize, 0.6, 5.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      void main() {
        vec2 d = gl_PointCoord - 0.5;
        float a = smoothstep(0.5, 0.05, length(d));
        if (a < 0.02) discard;
        gl_FragColor = vec4(vColor, a);
      }
    `,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  });

  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = -90;
  return points;
}

/**
 * A planet globe for the orbital and cruise views: procedurally shaded
 * continents and ocean, a cloud layer, a night side and an atmospheric rim.
 */
export function buildPlanetGlobe(
  radius: number,
  kind: 'earth' | 'mars',
  seed = 5,
): THREE.Group {
  const group = new THREE.Group();
  group.name = `globe-${kind}`;

  const texture = generatePlanetTexture(kind, seed);

  const surface = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 96, 64),
    new THREE.MeshStandardMaterial({
      map: texture,
      roughness: kind === 'earth' ? 0.72 : 0.95,
      metalness: 0.02,
    }),
  );
  surface.receiveShadow = false;
  group.add(surface);

  if (kind === 'earth') {
    // Cloud shell, slightly larger and slowly rotating.
    const clouds = new THREE.Mesh(
      new THREE.SphereGeometry(radius * 1.012, 64, 40),
      new THREE.MeshStandardMaterial({
        map: generateCloudTexture(seed + 3),
        transparent: true,
        opacity: 0.82,
        depthWrite: false,
        roughness: 1,
      }),
    );
    clouds.name = 'clouds';
    group.add(clouds);
  }

  // Atmospheric rim: brighter where the surface is edge-on to the camera.
  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(radius * (kind === 'earth' ? 1.045 : 1.02), 64, 40),
    new THREE.ShaderMaterial({
      uniforms: {
        uColor: {
          value:
            kind === 'earth'
              ? new THREE.Color(0.35, 0.62, 1.0)
              : new THREE.Color(0.85, 0.55, 0.36),
        },
        uPower: { value: kind === 'earth' ? 3.0 : 4.2 },
        uStrength: { value: kind === 'earth' ? 1.15 : 0.62 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vNormal;
        varying vec3 vView;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vView = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vNormal;
        varying vec3 vView;
        uniform vec3 uColor;
        uniform float uPower;
        uniform float uStrength;
        void main() {
          float rim = pow(1.0 - max(dot(vNormal, vView), 0.0), uPower);
          gl_FragColor = vec4(uColor, rim * uStrength);
        }
      `,
      transparent: true,
      side: THREE.BackSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  group.add(atmosphere);

  return group;
}

/** Procedural planet surface texture — continents, ice caps, terrain bands. */
function generatePlanetTexture(kind: 'earth' | 'mars', seed: number): THREE.Texture {
  const w = 1024;
  const h = 512;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  const noise = new Noise2D(seed);
  const detail = new Noise2D(seed + 31);
  const img = ctx.createImageData(w, h);

  for (let y = 0; y < h; y++) {
    // Latitude from +1 (north pole) to -1 (south pole).
    const lat = 1 - (y / h) * 2;
    for (let x = 0; x < w; x++) {
      const lon = (x / w) * Math.PI * 2;

      // Sample on a sphere so the texture wraps without a visible seam.
      const cz = Math.cos(lat * Math.PI * 0.5);
      const sx = Math.cos(lon) * cz;
      const sy = Math.sin(lat * Math.PI * 0.5);
      const sz = Math.sin(lon) * cz;

      const base = noise.fbm(sx * 2.2 + 10, sz * 2.2 + sy * 1.6, 6);
      const fine = detail.fbm(sx * 8 + 3, sz * 8 + sy * 6, 4);

      let r: number;
      let g: number;
      let b: number;

      if (kind === 'earth') {
        const elevation = base + fine * 0.22;
        if (elevation < 0.02) {
          // Ocean, deepening away from the shelf.
          const depth = clamp((0.02 - elevation) * 3.4, 0, 1);
          r = 12 + (1 - depth) * 26;
          g = 44 + (1 - depth) * 60;
          b = 92 + (1 - depth) * 70;
        } else {
          // Land: green lowlands through arid tan to grey highlands.
          const e = clamp(elevation * 2.6, 0, 1);
          const arid = clamp(Math.abs(lat) * 1.6 - 0.15, 0, 1);
          r = 52 + e * 92 + arid * 78;
          g = 92 + e * 56 - arid * 18;
          b = 44 + e * 46 - arid * 10;
        }
        // Polar ice.
        const ice = clamp((Math.abs(lat) - 0.76) * 5.2, 0, 1);
        r = r + (242 - r) * ice;
        g = g + (246 - g) * ice;
        b = b + (252 - b) * ice;
      } else {
        // Mars: ochre with darker volcanic plains and bright polar caps.
        const e = base * 0.5 + 0.5 + fine * 0.18;
        r = 118 + e * 96;
        g = 62 + e * 52;
        b = 38 + e * 30;
        const dark = clamp((0.42 - base) * 2.2, 0, 1);
        r -= dark * 42;
        g -= dark * 26;
        b -= dark * 14;
        const ice = clamp((Math.abs(lat) - 0.86) * 7, 0, 1);
        r = r + (238 - r) * ice;
        g = g + (238 - g) * ice;
        b = b + (232 - b) * ice;
      }

      const i = (y * w + x) * 4;
      img.data[i] = clamp(r, 0, 255);
      img.data[i + 1] = clamp(g, 0, 255);
      img.data[i + 2] = clamp(b, 0, 255);
      img.data[i + 3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** Procedural cloud layer with alpha. */
function generateCloudTexture(seed: number): THREE.Texture {
  const w = 1024;
  const h = 512;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const noise = new Noise2D(seed);
  const img = ctx.createImageData(w, h);

  for (let y = 0; y < h; y++) {
    const lat = 1 - (y / h) * 2;
    for (let x = 0; x < w; x++) {
      const lon = (x / w) * Math.PI * 2;
      const cz = Math.cos(lat * Math.PI * 0.5);
      const sx = Math.cos(lon) * cz;
      const sy = Math.sin(lat * Math.PI * 0.5);
      const sz = Math.sin(lon) * cz;

      // Banded cloud structure: stretch the noise zonally, as real weather is.
      let v = noise.fbm(sx * 3.1, sz * 3.1 + sy * 2.2, 5);
      v += noise.fbm(sx * 9, sz * 9 + sy * 5, 3) * 0.3;
      // Suppress cloud at the horse latitudes for a recognisable pattern.
      const band = Math.abs(Math.sin(lat * Math.PI * 1.6));
      v -= (1 - band) * 0.22;

      const alpha = clamp((v - 0.06) * 2.6, 0, 1) * 255;
      const i = (y * w + x) * 4;
      img.data[i] = 255;
      img.data[i + 1] = 255;
      img.data[i + 2] = 255;
      img.data[i + 3] = alpha;
    }
  }

  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** A sun billboard with a corona, for the orbital and cruise views. */
export function buildSun(size: number): THREE.Group {
  const group = new THREE.Group();

  const core = new THREE.Mesh(
    new THREE.SphereGeometry(size, 32, 24),
    new THREE.MeshBasicMaterial({ color: 0xfff6e0, toneMapped: false }),
  );
  group.add(core);

  // Layered corona sprites.
  for (let i = 0; i < 3; i++) {
    const scale = size * (4 + i * 5);
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: makeGlowTexture(),
        color: i === 0 ? 0xfff0c8 : 0xffb85a,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
        opacity: 0.55 - i * 0.16,
        toneMapped: false,
      }),
    );
    sprite.scale.setScalar(scale);
    group.add(sprite);
  }

  return group;
}

function makeGlowTexture(): THREE.Texture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.18, 'rgba(255,236,190,0.7)');
  g.addColorStop(0.5, 'rgba(255,170,70,0.22)');
  g.addColorStop(1, 'rgba(255,120,30,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
