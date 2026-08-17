/**
 * Reusable geometry constructors.
 *
 * These exist so that no part is ever "a cylinder" (spec §5, §72). A tank is a
 * lathed barrel with domed bulkheads, stringers and a thrust skirt; a nozzle is
 * a bell contour of revolution; a truss is real triangulated members. Building
 * from these primitives keeps every model detailed but low-poly.
 */
import * as THREE from 'three';
import { Rng } from '../utils/math';

/**
 * Merges child geometries of a group into as few meshes as possible by
 * material, which matters for scenes that place hundreds of small props.
 */
export function countTriangles(root: THREE.Object3D): number {
  let tris = 0;
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && m.geometry) {
      const g = m.geometry;
      tris += g.index ? g.index.count / 3 : g.attributes.position.count / 3;
    }
  });
  return Math.round(tris);
}

/**
 * A surface of revolution from a 2D profile given as [radius, height] pairs.
 * The profile runs bottom-to-top in local +Y.
 */
export function lathe(
  profile: ReadonlyArray<readonly [number, number]>,
  segments = 32,
): THREE.LatheGeometry {
  const pts = profile.map(([r, y]) => new THREE.Vector2(Math.max(r, 1e-4), y));
  const geo = new THREE.LatheGeometry(pts, segments);
  geo.computeVertexNormals();
  return geo;
}

/**
 * A propellant tank barrel: cylindrical section closed by elliptical bulkheads,
 * which is the actual shape of a pressure vessel and reads very differently
 * from a flat-capped cylinder.
 */
export function tankBarrel(
  radius: number,
  length: number,
  segments = 32,
  domeRatio = 0.42,
): THREE.LatheGeometry {
  const dome = radius * domeRatio;
  const barrel = Math.max(length - dome * 2, radius * 0.2);
  const profile: Array<[number, number]> = [];
  const steps = 6;

  // Lower elliptical dome.
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = (t * Math.PI) / 2;
    profile.push([radius * Math.sin(a), dome * (1 - Math.cos(a))]);
  }
  // Cylindrical barrel.
  profile.push([radius, dome + barrel]);
  // Upper elliptical dome.
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const a = (t * Math.PI) / 2;
    profile.push([radius * Math.cos(a), dome + barrel + dome * Math.sin(a)]);
  }

  return lathe(profile, segments);
}

/**
 * A rocket-engine bell. Uses a parabolic-approximation contour: a converging
 * throat followed by a rapidly-expanding, then gently-flaring, exit cone. The
 * `expansion` parameter is the area ratio, so vacuum engines automatically get
 * the tall, wide bells they should have.
 */
export function nozzleBell(
  throatRadius: number,
  length: number,
  expansion: number,
  segments = 32,
): THREE.LatheGeometry {
  const exitRadius = throatRadius * Math.sqrt(expansion);
  const profile: Array<[number, number]> = [];
  const steps = 14;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    // Bell contour: fast initial expansion easing into a shallow exit angle.
    const r = throatRadius + (exitRadius - throatRadius) * Math.pow(t, 0.62);
    profile.push([r, t * length]);
  }
  return lathe(profile, segments);
}

/** An ogive nose cone — the aerodynamic shape actually used on launch vehicles. */
export function ogiveNose(
  radius: number,
  length: number,
  segments = 32,
  bluntness = 0.06,
): THREE.LatheGeometry {
  const profile: Array<[number, number]> = [];
  const steps = 16;
  // Tangent-ogive radius.
  const rho = (radius * radius + length * length) / (2 * radius);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const y = t * length;
    const inner = rho * rho - Math.pow(length - y, 2);
    const r = Math.sqrt(Math.max(inner, 0)) + radius - rho;
    profile.push([Math.max(r, radius * bluntness), y]);
  }
  return lathe(profile, segments);
}

/** A blunt-body aeroshell face (70-degree sphere-cone, the Mars entry standard). */
export function aeroshellCone(
  radius: number,
  halfAngleDeg = 70,
  segments = 32,
): THREE.LatheGeometry {
  const half = (halfAngleDeg * Math.PI) / 180;
  const noseRadius = radius * 0.5;
  const profile: Array<[number, number]> = [];
  const steps = 10;

  // Spherical nose cap.
  const capEnd = Math.PI / 2 - half;
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * capEnd;
    profile.push([noseRadius * Math.sin(a), noseRadius * (1 - Math.cos(a))]);
  }
  // Conic flank out to the maximum diameter.
  const rStart = noseRadius * Math.sin(capEnd);
  const yStart = noseRadius * (1 - Math.cos(capEnd));
  const run = radius - rStart;
  profile.push([radius, yStart + run / Math.tan(half)]);

  return lathe(profile, segments);
}

/**
 * A cylindrical shell with raised longitudinal stringers and circumferential
 * ribs, built as one merged geometry. This is the detail that makes a tank
 * section look structural instead of smooth.
 */
export function ribbedShell(
  radius: number,
  length: number,
  ribCount = 6,
  stringerCount = 16,
  radialSegments = 32,
): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  const skin = new THREE.CylinderGeometry(radius, radius, length, radialSegments, 1, true);
  skin.translate(0, length / 2, 0);
  parts.push(skin);

  // Circumferential ribs.
  const ribR = radius * 1.016;
  for (let i = 0; i < ribCount; i++) {
    const y = ((i + 0.5) / ribCount) * length;
    const rib = new THREE.TorusGeometry(ribR, radius * 0.014, 6, radialSegments);
    rib.rotateX(Math.PI / 2);
    rib.translate(0, y, 0);
    parts.push(rib);
  }

  // Longitudinal stringers.
  for (let i = 0; i < stringerCount; i++) {
    const a = (i / stringerCount) * Math.PI * 2;
    const s = new THREE.BoxGeometry(radius * 0.03, length * 0.98, radius * 0.022);
    s.translate(0, length / 2, 0);
    s.rotateY(-a);
    s.translate(Math.sin(a) * ribR, 0, Math.cos(a) * ribR);
    parts.push(s);
  }

  return mergeGeometries(parts);
}

/** A ring of bolt heads / fasteners around a circumference. */
export function boltRing(
  radius: number,
  count = 24,
  boltRadius = 0.035,
): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const b = new THREE.CylinderGeometry(boltRadius, boltRadius, boltRadius * 1.1, 6);
    b.rotateZ(Math.PI / 2);
    b.rotateY(-a);
    b.translate(Math.sin(a) * radius, 0, Math.cos(a) * radius);
    parts.push(b);
  }
  return mergeGeometries(parts);
}

/**
 * A triangulated truss between two rings — real diagonal members, not a solid
 * tube. Used for interstages, launch-tower structure and rover chassis.
 */
export function trussCylinder(
  radiusBottom: number,
  radiusTop: number,
  height: number,
  bays = 3,
  columns = 8,
  memberRadius = 0.05,
): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const ringAt = (t: number): number => radiusBottom + (radiusTop - radiusBottom) * t;

  const nodeAt = (bay: number, col: number): THREE.Vector3 => {
    const t = bay / bays;
    const r = ringAt(t);
    const a = (col / columns) * Math.PI * 2;
    return new THREE.Vector3(Math.sin(a) * r, t * height, Math.cos(a) * r);
  };

  const member = (a: THREE.Vector3, b: THREE.Vector3, rad: number): void => {
    const dir = new THREE.Vector3().subVectors(b, a);
    const len = dir.length();
    if (len < 1e-4) return;
    const g = new THREE.CylinderGeometry(rad, rad, len, 5);
    g.translate(0, len / 2, 0);
    const q = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      dir.clone().normalize(),
    );
    g.applyQuaternion(q);
    g.translate(a.x, a.y, a.z);
    parts.push(g);
  };

  // Horizontal rings.
  for (let bay = 0; bay <= bays; bay++) {
    for (let col = 0; col < columns; col++) {
      member(nodeAt(bay, col), nodeAt(bay, (col + 1) % columns), memberRadius * 0.8);
    }
  }
  // Verticals and alternating diagonals.
  for (let bay = 0; bay < bays; bay++) {
    for (let col = 0; col < columns; col++) {
      member(nodeAt(bay, col), nodeAt(bay + 1, col), memberRadius);
      const diagTo = bay % 2 === 0 ? (col + 1) % columns : (col + columns - 1) % columns;
      member(nodeAt(bay, col), nodeAt(bay + 1, diagTo), memberRadius * 0.7);
    }
  }

  return mergeGeometries(parts);
}

/** A rectangular lattice tower section (launch-tower / crane structure). */
export function trussTower(
  width: number,
  height: number,
  bays: number,
  memberRadius = 0.09,
): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const h = width / 2;
  const corners: Array<[number, number]> = [
    [-h, -h],
    [h, -h],
    [h, h],
    [-h, h],
  ];
  const bayH = height / bays;

  const member = (a: THREE.Vector3, b: THREE.Vector3, rad: number): void => {
    const dir = new THREE.Vector3().subVectors(b, a);
    const len = dir.length();
    if (len < 1e-4) return;
    const g = new THREE.CylinderGeometry(rad, rad, len, 5);
    g.translate(0, len / 2, 0);
    g.applyQuaternion(
      new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        dir.clone().normalize(),
      ),
    );
    g.translate(a.x, a.y, a.z);
    parts.push(g);
  };

  // Corner columns.
  for (const [x, z] of corners) {
    member(new THREE.Vector3(x, 0, z), new THREE.Vector3(x, height, z), memberRadius);
  }
  // Per-bay horizontals and face diagonals.
  for (let b = 0; b <= bays; b++) {
    const y = b * bayH;
    for (let i = 0; i < 4; i++) {
      const [x1, z1] = corners[i];
      const [x2, z2] = corners[(i + 1) % 4];
      member(new THREE.Vector3(x1, y, z1), new THREE.Vector3(x2, y, z2), memberRadius * 0.7);
    }
  }
  for (let b = 0; b < bays; b++) {
    const y0 = b * bayH;
    const y1 = (b + 1) * bayH;
    for (let i = 0; i < 4; i++) {
      const [x1, z1] = corners[i];
      const [x2, z2] = corners[(i + 1) % 4];
      // Alternate the diagonal direction per bay for a real braced look.
      if (b % 2 === 0) {
        member(new THREE.Vector3(x1, y0, z1), new THREE.Vector3(x2, y1, z2), memberRadius * 0.55);
      } else {
        member(new THREE.Vector3(x2, y0, z2), new THREE.Vector3(x1, y1, z1), memberRadius * 0.55);
      }
    }
  }

  return mergeGeometries(parts);
}

/**
 * Scatters small boxes and cylinders over a surface region — plumbing runs,
 * connector boxes, conduit. "Greebling" is what stops a large flat panel from
 * reading as untextured geometry.
 */
export function greebleStrip(
  length: number,
  width: number,
  seed: number,
  density = 14,
): THREE.BufferGeometry {
  const rng = new Rng(seed);
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < density; i++) {
    const w = rng.range(width * 0.12, width * 0.5);
    const h = rng.range(width * 0.08, width * 0.3);
    const l = rng.range(length * 0.03, length * 0.14);
    const g = new THREE.BoxGeometry(w, h, l);
    g.translate(rng.range(-width * 0.3, width * 0.3), h / 2, rng.range(0, length) - length / 2);
    parts.push(g);
  }
  return mergeGeometries(parts);
}

/**
 * A square-section structural member running between two points.
 *
 * Diagonal bracing is what makes a steel frame read as a *structure* rather
 * than a stack of shelves, and it has to actually land on the joints it claims
 * to tie together — so this takes the two endpoints and builds the member
 * between them rather than approximating with a rotated box.
 */
export function braceBetween(
  a: THREE.Vector3,
  b: THREE.Vector3,
  thickness: number,
): THREE.BufferGeometry {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  if (len < 1e-4) return new THREE.BoxGeometry(thickness, thickness, thickness);

  const g = new THREE.BoxGeometry(thickness, len, thickness);
  // Box is built centred on the origin along +Y; stand it up along the member.
  g.applyQuaternion(
    new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      dir.clone().normalize(),
    ),
  );
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return g;
}

/** A hemispherical pressure-vessel end used on ground storage tanks. */
export function sphericalTank(radius: number, segments = 20): THREE.BufferGeometry {
  return new THREE.SphereGeometry(radius, segments, Math.max(8, segments / 2));
}

/**
 * Merges an array of BufferGeometries that share an attribute layout.
 * Implemented locally so the project does not depend on the three.js examples
 * addon tree (which is not part of the core package's stable API surface).
 */
export function mergeGeometries(geometries: THREE.BufferGeometry[]): THREE.BufferGeometry {
  if (geometries.length === 0) return new THREE.BufferGeometry();
  if (geometries.length === 1) return geometries[0];

  // Normalise: everything must be non-indexed with position + normal + uv.
  const prepared = geometries.map((g) => {
    let geo = g.index ? g.toNonIndexed() : g.clone();
    if (!geo.getAttribute('normal')) geo.computeVertexNormals();
    if (!geo.getAttribute('uv')) {
      const count = geo.getAttribute('position').count;
      geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
    }
    return geo;
  });

  let total = 0;
  for (const g of prepared) total += g.getAttribute('position').count;

  const position = new Float32Array(total * 3);
  const normal = new Float32Array(total * 3);
  const uv = new Float32Array(total * 2);

  let vOffset = 0;
  for (const g of prepared) {
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    const u = g.getAttribute('uv');
    position.set(p.array as Float32Array, vOffset * 3);
    normal.set(n.array as Float32Array, vOffset * 3);
    uv.set(u.array as Float32Array, vOffset * 2);
    vOffset += p.count;
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(position, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.computeBoundingSphere();

  // The temporary clones are no longer needed.
  for (const g of prepared) g.dispose();
  return out;
}

/** Convenience: build a mesh and mark it for shadows. */
export function mesh(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  castShadow = true,
  receiveShadow = true,
): THREE.Mesh {
  const m = new THREE.Mesh(geometry, material);
  m.castShadow = castShadow;
  m.receiveShadow = receiveShadow;
  return m;
}

/** Recursively disposes geometries owned by a subtree (materials are shared). */
export function disposeSubtree(root: THREE.Object3D): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && m.geometry) m.geometry.dispose();
  });
}
