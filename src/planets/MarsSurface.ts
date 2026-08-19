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
  /**
   * Everything that makes up the ground: the detailed patch, the far field, the
   * distant relief, the boulders and the horizon haze. Grouped so the whole
   * surface can be swapped for the orbital globe in one move, high up where the
   * patch is a speck.
   */
  readonly ground: THREE.Group;
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

/**
 * Radius of the coarse far-field ring. Roughly the distance the thin Martian
 * atmosphere lets you see — far enough that the fog has closed in long before
 * the outer edge does.
 */
const FAR_FIELD_SIZE = 70_000;

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

  /**
   * The large-scale part of the elevation: regional slopes and eroded highland
   * ridges, both of which vary over kilometres. This is what the far field is
   * built from — the finer terms below it are far under that mesh's sampling
   * rate and would only alias into noise.
   */
  const coarseHeightAt = (x: number, z: number): number =>
    // Regional relief: highland massifs and basins tens of kilometres across.
    // Without a term at this wavelength the far field is smooth at every scale
    // the mesh can actually resolve, and the planet photographs from a hundred
    // kilometres up as a featureless brown gradient rather than as terrain.
    noise.fbm(x * 0.000031, z * 0.000031, 4) * 1_450 +
    noise.ridged(x * 0.000075, z * 0.000075, 4) * 620 +
    noise.fbm(x * 0.00042, z * 0.00042, 4) * 130 +
    noise.ridged(x * 0.0016, z * 0.0016, 5) * 34;

  /** Elevation at a point, metres. Shared by the mesh and by object placement. */
  const heightAt = (x: number, z: number): number => {
    let h = coarseHeightAt(x, z);

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
  const ground = new THREE.Group();
  ground.name = 'mars-ground';
  root.add(ground);

  const terrain = mesh(geo, terrainMat, false, true);
  ground.add(terrain);

  // -------------------------------------------------------------------------
  // Far field: a coarse annulus carrying the same height function out to the
  // horizon.
  //
  // The detailed patch is only 9 km across, which is plenty from a metre off
  // the ground — Mars's horizon is about 3.4 km away at eye height. But the
  // vehicle is under its parachute at 11 km, looking straight down, and from
  // there a 9 km patch reads as a square plate floating in the sky. The far
  // field costs one coarse mesh and turns that plate back into a planet.
  // -------------------------------------------------------------------------
  ground.add(buildFarField(heightAt, coarseHeightAt, lowColor, midColor, darkColor, detail));

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
    // Sat on the ground rather than on the datum: out here the regional slopes
    // are worth a couple of hundred metres, and a mesa pinned to zero either
    // floats above the plain or sinks into it.
    const mx = Math.cos(a) * d;
    const mz = Math.sin(a) * d;
    g.translate(mx, coarseHeightAt(mx, mz) + h * 0.42, mz);
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
  ground.add(distantMesh);

  // -------------------------------------------------------------------------
  // Boulders and rock fields, instanced for performance (spec §73)
  // -------------------------------------------------------------------------
  ground.add(buildRockField(heightAt, rng, 1_400, 'small'));
  ground.add(buildRockField(heightAt, rng, 260, 'large'));

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
  // gives the scene aerial perspective. It sits out at the far-field edge, low
  // and wide, so from the ground it reads as a band along the horizon — and
  // from above it is behind the camera rather than a ring drawn around the
  // landing site.
  const haze = mesh(
    new THREE.CylinderGeometry(FAR_FIELD_SIZE * 0.94, FAR_FIELD_SIZE * 0.94, 2_600, 64, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0xc98a5c,
      transparent: true,
      opacity: 0.3,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    }),
    false,
    false,
  );
  haze.position.y = 420;
  haze.renderOrder = -1;
  ground.add(haze);

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

  return { root, ground, heightAt, dust, sky, sunLight, ambient };
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

/**
 * Coarse ground from the edge of the detailed patch out to the horizon.
 *
 * Built as a ring so the detailed mesh is not paid for twice, with radial rings
 * spaced geometrically: dense where the seam has to match, sparse where a
 * vertex covers kilometres and nobody can tell. The height function is the same
 * one the detailed patch uses, damped with distance so the low-frequency
 * regional slopes survive while the fine detail — which is far below the
 * sampling rate out here — is faded away rather than aliased into noise.
 */
function buildFarField(
  heightAt: (x: number, z: number) => number,
  coarseHeightAt: (x: number, z: number) => number,
  lowColor: THREE.Color,
  midColor: THREE.Color,
  darkColor: THREE.Color,
  detail: Noise2D,
): THREE.Mesh {
  const inner = TERRAIN_SIZE * 0.46;
  const outer = FAR_FIELD_SIZE;
  const rings = 34;
  const segments = 128;

  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  const c = new THREE.Color();

  for (let r = 0; r <= rings; r++) {
    // Geometric spacing: fine at the seam, coarse at the horizon.
    const t = r / rings;
    const radius = inner * Math.pow(outer / inner, t);
    // Blend from the full height function to its large-scale part alone. What
    // it must *not* do is fade toward zero: the landing site can sit seventy
    // metres below the datum, and a far field that flattened to zero then hung
    // over the camera as a dark slab across the whole sky.
    const fadeStart = TERRAIN_SIZE * 0.75;
    const detailWeight = clamp(1 - (radius - fadeStart) / (TERRAIN_SIZE * 1.4), 0, 1);

    for (let s = 0; s <= segments; s++) {
      const a = (s / segments) * Math.PI * 2;
      const x = Math.cos(a) * radius;
      const z = Math.sin(a) * radius;
      const coarse = coarseHeightAt(x, z);
      const h = coarse + (heightAt(x, z) - coarse) * detailWeight;
      positions.push(x, h, z);

      // Regional albedo. Mars is not one colour: dark basaltic plains sit
      // against bright dust-mantled highlands, and it is that banding — at tens
      // of kilometres, not hundreds of metres — that reads as a planet from
      // orbit. Contrast is stretched about the midpoint so the regions actually
      // separate instead of averaging back to a single brown.
      const regional = detail.fbm(x * 0.000042, z * 0.000042, 4) * 0.5 + 0.5;
      const banded = clamp((regional - 0.5) * 1.85 + 0.5, 0, 1);
      const patch = detail.fbm(x * 0.0009, z * 0.0009, 3) * 0.5 + 0.5;
      c.copy(lowColor).lerp(midColor, clamp(banded * 0.78 + patch * 0.22, 0, 1));
      // Everything far away sits behind more atmosphere, so it desaturates
      // toward the haze rather than staying vivid to the horizon.
      c.lerp(darkColor, clamp((radius - inner) / (outer * 0.7), 0, 0.35));
      colors.push(c.r, c.g, c.b);
    }
  }

  const stride = segments + 1;
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < segments; s++) {
      const a = r * stride + s;
      const b = a + 1;
      const d = a + stride;
      const e = d + 1;
      indices.push(a, d, b, b, d, e);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  // No shadows either way: it is kilometres from anything that casts one.
  const far = mesh(
    geo,
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 }),
    false,
    false,
  );
  // Two metres down, so the detailed patch always wins where the two overlap
  // instead of the pair z-fighting across several square kilometres.
  far.position.y = -2;
  return far;
}

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
      uOpacity: { value: 1 },
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
      uniform float uOpacity;

      void main() {
        float h = clamp(vDir.y * 1.35, -0.2, 1.0);
        vec3 color = mix(uHorizon, uZenith, smoothstep(0.0, 0.85, h));

        // Blue-grey aureole around the sun — Mars's signature.
        float sun = max(dot(normalize(vDir), uSunDirection), 0.0);
        color = mix(color, uSunGlow, pow(sun, 7.0) * 0.75);
        color += uSunGlow * pow(sun, 90.0) * 0.9;

        // Darken below the horizon so the sky does not glow under the terrain.
        color *= mix(0.55, 1.0, smoothstep(-0.15, 0.06, vDir.y));

        gl_FragColor = vec4(color, uOpacity);
      }
    `,
    side: THREE.BackSide,
    depthWrite: false,
    transparent: true,
    fog: false,
  });

  const sky = new THREE.Mesh(geo, mat);
  sky.renderOrder = -100;
  sky.frustumCulled = false;
  return sky;
}
