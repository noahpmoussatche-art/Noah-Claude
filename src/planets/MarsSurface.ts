/**
 * The Martian surface (spec §32).
 *
 * Not a red plane. The terrain is a displaced mesh built from layered noise:
 * broad regional slopes, ridged multifractal for eroded highland crests, fine
 * detail for the near field, and explicitly carved impact craters with raised
 * rims and central peaks. On top of that sit scattered boulders and clasts
 * (instanced, so thousands cost almost nothing), wind-blown dust, an
 * atmospheric haze that thickens toward the horizon, and a butterscotch sky —
 * the colour Mars's sky actually is, because the dust in it scatters red
 * forward rather than blue.
 */
import * as THREE from 'three';
import { Materials } from '../render/materials';
import { mergeGeometries, mesh } from '../render/geometry';
import { Noise2D } from '../utils/noise';
import { clamp, Rng, smoothstep } from '../utils/math';
import { ParticleSystem, effectRng } from '../effects/ParticleSystem';
import { softParticle } from '../render/textures';

export interface MarsTerrainRefs {
  readonly root: THREE.Group;
  /** Samples ground elevation at a world XZ position, metres. */
  readonly heightAt: (x: number, z: number) => number;
  /** Ambient wind-blown dust. */
  readonly dust: ParticleSystem;
  readonly sky: THREE.Mesh;
  readonly sunLight: THREE.DirectionalLight;
  readonly ambient: THREE.HemisphereLight;
}

interface Crater {
  x: number;
  z: number;
  radius: number;
  depth: number;
}

// Large enough to contain the whole final descent: from parachute deploy at
// ~11 km the vehicle still travels several kilometres downrange before it
// touches down.
const TERRAIN_SIZE = 9_000;
const TERRAIN_SEGMENTS = 320;

export function buildMarsSurface(seed = 91_193): MarsTerrainRefs {
  const root = new THREE.Group();
  root.name = 'mars-surface';

  const rng = new Rng(seed);
  const noise = new Noise2D(seed);
  const detail = new Noise2D(seed + 7);

  // -------------------------------------------------------------------------
  // Craters: placed first so the height function can account for them
  // -------------------------------------------------------------------------
  const craters: Crater[] = [];
  for (let i = 0; i < 26; i++) {
    const radius = rng.range(30, 260);
    craters.push({
      x: rng.range(-TERRAIN_SIZE / 2, TERRAIN_SIZE / 2),
      z: rng.range(-TERRAIN_SIZE / 2, TERRAIN_SIZE / 2),
      radius,
      depth: radius * rng.range(0.1, 0.2),
    });
  }
  // Keep the landing zone reasonably flat by pushing craters out of the centre.
  for (const c of craters) {
    const d = Math.hypot(c.x, c.z);
    if (d < 320) {
      const s = 340 / Math.max(d, 1);
      c.x *= s;
      c.z *= s;
    }
  }

  /** Elevation at a point, metres. Shared by the mesh and by object placement. */
  const heightAt = (x: number, z: number): number => {
    // Regional relief: broad, low-frequency slopes.
    let h = noise.fbm(x * 0.00042, z * 0.00042, 4) * 130;

    // Eroded highland ridges — the sharp crests that make Mars look ancient.
    h += noise.ridged(x * 0.0016, z * 0.0016, 5) * 34;

    // Mid-scale dunes and undulation.
    h += noise.fbm(x * 0.006, z * 0.006, 4) * 6.5;

    // Fine surface roughness, so the ground is never glassy underfoot.
    h += detail.fbm(x * 0.05, z * 0.05, 3) * 0.55;

    // Impact craters: a depressed bowl inside a raised ejecta rim.
    for (const c of craters) {
      const d = Math.hypot(x - c.x, z - c.z);
      if (d > c.radius * 1.9) continue;

      const t = d / c.radius;
      if (t < 1) {
        // Parabolic bowl floor.
        h -= c.depth * (1 - t * t) * 0.9;
        // Central peak in the larger craters, as complex craters have.
        if (c.radius > 120 && t < 0.22) {
          h += c.depth * 0.55 * (1 - t / 0.22);
        }
      }
      // Raised rim, decaying outward into the ejecta blanket.
      const rim = Math.exp(-Math.pow((t - 1) * 3.2, 2));
      h += c.depth * 0.42 * rim;
    }

    return h;
  };

  // -------------------------------------------------------------------------
  // Terrain mesh
  // -------------------------------------------------------------------------
  const geo = new THREE.PlaneGeometry(
    TERRAIN_SIZE,
    TERRAIN_SIZE,
    TERRAIN_SEGMENTS,
    TERRAIN_SEGMENTS,
  );
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);

  const lowColor = new THREE.Color(0x8c4526);
  const midColor = new THREE.Color(0xb26a3c);
  const highColor = new THREE.Color(0xd9a06a);
  const darkColor = new THREE.Color(0x5e3320);

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const h = heightAt(x, z);
    pos.setY(i, h);

    // Vertex colour from elevation plus a dust-deposition term, so slopes read
    // darker (swept clean) and flats read dustier.
    const elev = clamp((h + 60) / 200, 0, 1);
    const patch = detail.fbm(x * 0.004, z * 0.004, 3) * 0.5 + 0.5;

    const c = lowColor.clone().lerp(midColor, smoothstep(elev * 1.4));
    c.lerp(highColor, smoothstep((elev - 0.55) * 2.2));
    c.lerp(darkColor, clamp((1 - patch) * 0.55, 0, 0.55));

    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }

  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const terrainMat = Materials.regolith();
  (terrainMat.map as THREE.Texture).repeat.set(180, 180);
  const terrain = mesh(geo, terrainMat, false, true);
  root.add(terrain);

  // -------------------------------------------------------------------------
  // Distant relief: a ring of mesas and mountains beyond the terrain patch, so
  // the horizon is not a hard edge.
  // -------------------------------------------------------------------------
  const distant: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 90; i++) {
    const a = (i / 90) * Math.PI * 2 + rng.range(-0.02, 0.02);
    const d = rng.range(TERRAIN_SIZE * 0.56, TERRAIN_SIZE * 0.82);
    const w = rng.range(180, 620);
    const h = rng.range(90, 340);

    const g = new THREE.ConeGeometry(w, h, rng.int(5, 8), 1);
    // Flatten some into mesas.
    if (rng.bool(0.4)) {
      const p = g.attributes.position as THREE.BufferAttribute;
      for (let v = 0; v < p.count; v++) {
        if (p.getY(v) > h * 0.2) p.setY(v, h * 0.3);
      }
    }
    g.translate(Math.cos(a) * d, h * 0.42, Math.sin(a) * d);
    distant.push(g);
  }
  const distantMesh = mesh(
    mergeGeometries(distant),
    new THREE.MeshStandardMaterial({
      color: 0x8a4e30,
      roughness: 1,
      flatShading: true,
    }),
    false,
    false,
  );
  root.add(distantMesh);

  // -------------------------------------------------------------------------
  // Boulders and rock fields, instanced for performance (spec §73)
  // -------------------------------------------------------------------------
  root.add(buildRockField(heightAt, rng, 1_400, 'small'));
  root.add(buildRockField(heightAt, rng, 260, 'large'));

  // -------------------------------------------------------------------------
  // Wind-blown dust
  // -------------------------------------------------------------------------
  const dust = new ParticleSystem(
    700,
    softParticle('rgba(214,160,116,1)', 'rgba(180,110,70,0)'),
    THREE.NormalBlending,
  );
  root.add(dust.points);

  // -------------------------------------------------------------------------
  // Sky and atmosphere
  // -------------------------------------------------------------------------
  const sky = buildMarsSky();
  root.add(sky);

  // Ground haze: a broad translucent shell that thickens toward the horizon and
  // gives the scene aerial perspective.
  const haze = mesh(
    new THREE.CylinderGeometry(TERRAIN_SIZE * 0.95, TERRAIN_SIZE * 0.95, 900, 48, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0xc98a5c,
      transparent: true,
      opacity: 0.26,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    }),
    false,
    false,
  );
  haze.position.y = 190;
  haze.renderOrder = -1;
  root.add(haze);

  // -------------------------------------------------------------------------
  // Lighting (spec §57): a small, distant, weak sun and dusty sky bounce
  // -------------------------------------------------------------------------
  const sunLight = new THREE.DirectionalLight(0xffd9b0, 1.55);
  sunLight.position.set(-700, 620, 420);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  sunLight.shadow.camera.near = 10;
  sunLight.shadow.camera.far = 2_200;
  sunLight.shadow.camera.left = -180;
  sunLight.shadow.camera.right = 180;
  sunLight.shadow.camera.top = 180;
  sunLight.shadow.camera.bottom = -180;
  sunLight.shadow.bias = -0.0008;
  root.add(sunLight);
  root.add(sunLight.target);

  // Sky and ground bounce: strongly tinted, because everything here is ochre.
  const ambient = new THREE.HemisphereLight(0xd9a172, 0x6b3a22, 0.72);
  root.add(ambient);

  return { root, heightAt, dust, sky, sunLight, ambient };
}

/** Updates the ambient dust drift. Call each frame while on Mars. */
export function updateMarsDust(
  dust: ParticleSystem,
  dt: number,
  focus: THREE.Vector3,
  windStrength = 1,
): void {
  // Keep a light haze of drifting particles around wherever the camera is.
  const want = 4 * windStrength;
  for (let i = 0; i < want; i++) {
    if (effectRng.next() > dt * 12) continue;
    const a = effectRng.range(0, Math.PI * 2);
    const d = effectRng.range(20, 190);
    dust.emit({
      position: new THREE.Vector3(
        focus.x + Math.cos(a) * d,
        focus.y + effectRng.range(0.4, 26),
        focus.z + Math.sin(a) * d,
      ),
      velocity: new THREE.Vector3(
        effectRng.range(3, 11) * windStrength,
        effectRng.range(-0.3, 0.9),
        effectRng.range(-2, 2),
      ),
      life: effectRng.range(7, 16),
      size: effectRng.range(1.5, 7),
      growth: effectRng.range(0.3, 1.4),
      color: new THREE.Color(0.72, 0.48, 0.32),
      opacity: effectRng.range(0.05, 0.15),
      spin: effectRng.signed() * 0.3,
      drag: 0.05,
      buoyancy: 0.05,
    });
  }
  dust.update(dt);
}

// ---------------------------------------------------------------------------

function buildRockField(
  heightAt: (x: number, z: number) => number,
  rng: Rng,
  count: number,
  size: 'small' | 'large',
): THREE.InstancedMesh {
  // A few irregular base shapes, faceted so they read as fractured basalt.
  const base = new THREE.IcosahedronGeometry(1, size === 'large' ? 1 : 0);
  const p = base.attributes.position as THREE.BufferAttribute;
  const jitter = new Rng(rng.int(0, 1e6));
  for (let i = 0; i < p.count; i++) {
    const s = 1 + jitter.signed() * 0.34;
    p.setXYZ(i, p.getX(i) * s, p.getY(i) * s * 0.72, p.getZ(i) * s);
  }
  base.computeVertexNormals();

  const inst = new THREE.InstancedMesh(base, Materials.marsRock(), count);
  inst.castShadow = true;
  inst.receiveShadow = true;

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const pos = new THREE.Vector3();

  const radius = size === 'large' ? TERRAIN_SIZE * 0.4 : TERRAIN_SIZE * 0.16;
  const [minS, maxS] = size === 'large' ? [1.6, 6.5] : [0.14, 0.9];

  for (let i = 0; i < count; i++) {
    const a = rng.range(0, Math.PI * 2);
    const d = Math.sqrt(rng.next()) * radius;
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    const s = rng.range(minS, maxS);

    pos.set(x, heightAt(x, z) + s * 0.32, z);
    q.setFromEuler(
      new THREE.Euler(rng.range(-0.35, 0.35), rng.range(0, Math.PI * 2), rng.range(-0.35, 0.35)),
    );
    scale.set(s * rng.range(0.8, 1.25), s * rng.range(0.55, 0.95), s * rng.range(0.8, 1.25));

    m.compose(pos, q, scale);
    inst.setMatrixAt(i, m);
  }
  inst.instanceMatrix.needsUpdate = true;

  return inst;
}

/**
 * The Martian sky. Dust suspended in the atmosphere forward-scatters red light,
 * so the sky is butterscotch with a *blue* glow immediately around the sun —
 * the opposite of Earth, and one of the most recognisable things about Mars.
 */
function buildMarsSky(): THREE.Mesh {
  const geo = new THREE.SphereGeometry(6_000, 32, 24);

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uSunDirection: { value: new THREE.Vector3(-0.6, 0.55, 0.36).normalize() },
      uZenith: { value: new THREE.Color(0x8e6444) },
      uHorizon: { value: new THREE.Color(0xd9a473) },
      uSunGlow: { value: new THREE.Color(0x9fb8d4) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vDir;
      uniform vec3 uSunDirection;
      uniform vec3 uZenith;
      uniform vec3 uHorizon;
      uniform vec3 uSunGlow;

      void main() {
        float h = clamp(vDir.y * 1.35, -0.2, 1.0);
        vec3 color = mix(uHorizon, uZenith, smoothstep(0.0, 0.85, h));

        // Blue-grey aureole around the sun — Mars's signature.
        float sun = max(dot(normalize(vDir), uSunDirection), 0.0);
        color = mix(color, uSunGlow, pow(sun, 7.0) * 0.75);
        color += uSunGlow * pow(sun, 90.0) * 0.9;

        // Darken below the horizon so the sky does not glow under the terrain.
        color *= mix(0.55, 1.0, smoothstep(-0.15, 0.06, vDir.y));

        gl_FragColor = vec4(color, 1.0);
      }
    `,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });

  const sky = new THREE.Mesh(geo, mat);
  sky.renderOrder = -100;
  sky.frustumCulled = false;
  return sky;
}
