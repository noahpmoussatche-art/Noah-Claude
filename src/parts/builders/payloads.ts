/**
 * Payload spacecraft: satellite buses, landers, rover chassis and probes
 * (spec §39, §42, §43, §44). These are complete vehicles in their own right —
 * a satellite bus already carries its thruster cluster, thermal blankets, star
 * trackers and attach fittings, so a deployed satellite never looks like a box.
 */
import * as THREE from 'three';
import { Materials } from '../../render/materials';
import { mergeGeometries, mesh } from '../../render/geometry';
import { buildRcsQuad } from './propulsion';
import { Rng } from '../../utils/math';

/**
 * A satellite bus: the octagonal/boxy structural core that everything else
 * bolts onto. Solar wings and antennas are added by the assembly step so they
 * can be animated independently.
 */
export function buildSatelliteBus(size: number, seed: number): THREE.Object3D {
  const root = new THREE.Group();
  root.name = 'satellite-bus';
  const rng = new Rng(seed);

  const height = size * 1.2;

  // Octagonal primary structure — the classic comms-bus shape.
  const core = mesh(
    new THREE.CylinderGeometry(size * 0.72, size * 0.72, height, 8),
    Materials.mli(),
  );
  root.add(core);

  // Structural corner posts at the octagon vertices.
  const posts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    const g = new THREE.BoxGeometry(size * 0.07, height * 1.02, size * 0.07);
    g.translate(Math.sin(a) * size * 0.68, 0, Math.cos(a) * size * 0.68);
    posts.push(g);
  }
  root.add(mesh(mergeGeometries(posts), Materials.machinedAlloy()));

  // Top and bottom decks.
  for (const y of [height / 2, -height / 2]) {
    const deck = mesh(
      new THREE.CylinderGeometry(size * 0.74, size * 0.74, size * 0.05, 8),
      Materials.hullWhite(),
    );
    deck.position.y = y;
    root.add(deck);
  }

  // Payload adapter ring on the bottom — how it actually mates to the rocket.
  const adapter = mesh(
    new THREE.CylinderGeometry(size * 0.34, size * 0.44, size * 0.18, 20),
    Materials.machinedAlloy(),
  );
  adapter.position.y = -height / 2 - size * 0.1;
  root.add(adapter);

  // Apogee/station-keeping engine poking through the bottom deck.
  const apogeeEngine = mesh(
    new THREE.CylinderGeometry(size * 0.06, size * 0.16, size * 0.24, 12),
    Materials.nozzleAlloy(),
  );
  apogeeEngine.position.y = -height / 2 - size * 0.24;
  apogeeEngine.rotation.x = Math.PI;
  root.add(apogeeEngine);

  // RCS thruster quads at the corners.
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const quad = buildRcsQuad(size * 0.14);
    quad.position.set(
      Math.sin(a) * size * 0.74,
      -height * 0.32,
      Math.cos(a) * size * 0.74,
    );
    root.add(quad);
  }

  // Star trackers and sun sensors.
  for (let i = 0; i < 2; i++) {
    const st = mesh(
      new THREE.CylinderGeometry(size * 0.07, size * 0.09, size * 0.2, 10),
      Materials.hullBlack(),
    );
    st.position.set(size * (i === 0 ? 0.4 : -0.4), height / 2 + size * 0.1, size * 0.3);
    st.rotation.x = -0.4;
    root.add(st);
  }

  // Propellant tank visible inside the bus frame.
  const tank = mesh(
    new THREE.SphereGeometry(size * 0.3, 14, 10),
    Materials.tankMetal(),
  );
  tank.position.y = -height * 0.1;
  root.add(tank);

  // Assorted electronics boxes for visual density.
  const boxes: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 5; i++) {
    const a = rng.range(0, Math.PI * 2);
    const g = new THREE.BoxGeometry(
      size * rng.range(0.14, 0.26),
      size * rng.range(0.1, 0.2),
      size * rng.range(0.08, 0.14),
    );
    g.translate(Math.sin(a) * size * 0.76, rng.range(-0.3, 0.3) * height, Math.cos(a) * size * 0.76);
    g.rotateY(-a);
    boxes.push(g);
  }
  root.add(mesh(mergeGeometries(boxes), Materials.darkPlastic()));

  return root;
}

/**
 * A propulsive lander: a load-bearing deck on a truss, with descent engines
 * clustered underneath and tankage between.
 */
export function buildLanderDeck(size: number): THREE.Object3D {
  const root = new THREE.Group();
  root.name = 'lander-deck';

  // Hexagonal deck.
  const deck = mesh(
    new THREE.CylinderGeometry(size, size, size * 0.12, 6),
    Materials.hullWhite(),
  );
  root.add(deck);

  // Underside structural ribs.
  const ribs: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const g = new THREE.BoxGeometry(size * 1.8, size * 0.08, size * 0.08);
    g.translate(0, -size * 0.1, 0);
    g.rotateY(-a);
    ribs.push(g);
  }
  root.add(mesh(mergeGeometries(ribs), Materials.structuralSteel()));

  // Spherical propellant tanks slung under the deck.
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.5;
    const tank = mesh(
      new THREE.SphereGeometry(size * 0.28, 14, 10),
      Materials.tankMetal(),
    );
    tank.position.set(Math.sin(a) * size * 0.55, -size * 0.34, Math.cos(a) * size * 0.55);
    root.add(tank);
  }

  // Thermal blanket wrap around the deck edge.
  const skirt = mesh(
    new THREE.CylinderGeometry(size * 1.01, size * 0.9, size * 0.3, 6, 1, true),
    Materials.mli(),
  );
  skirt.position.y = -size * 0.16;
  root.add(skirt);

  return root;
}

/**
 * A rover chassis with a rocker-bogie style suspension frame. Wheels are added
 * separately by the assembly so they can steer and roll.
 */
export function buildRoverChassis(length: number, width: number): THREE.Object3D {
  const root = new THREE.Group();
  root.name = 'rover-chassis';
  const height = width * 0.44;

  // Warm electronics box — the rover's body.
  const body = mesh(
    new THREE.BoxGeometry(width, height, length),
    Materials.hullWhite(),
  );
  root.add(body);

  // Thermal blanket over the top deck.
  const blanket = mesh(
    new THREE.BoxGeometry(width * 1.01, height * 0.12, length * 0.86),
    Materials.mli(),
  );
  blanket.position.y = height * 0.5;
  root.add(blanket);

  // Rocker-bogie suspension frame on both sides.
  for (const s of [-1, 1]) {
    const members: THREE.BufferGeometry[] = [];
    const y0 = -height * 0.3;
    const nodes: Array<[number, number]> = [
      [length * 0.42, y0],
      [length * 0.1, y0 + height * 0.42],
      [-length * 0.16, y0],
      [-length * 0.44, y0 + height * 0.12],
    ];
    for (let i = 0; i < nodes.length - 1; i++) {
      const [z1, y1] = nodes[i];
      const [z2, y2] = nodes[i + 1];
      const a = new THREE.Vector3(0, y1, z1);
      const b = new THREE.Vector3(0, y2, z2);
      const dir = new THREE.Vector3().subVectors(b, a);
      const len = dir.length();
      const g = new THREE.CylinderGeometry(width * 0.035, width * 0.035, len, 6);
      g.translate(0, len / 2, 0);
      g.applyQuaternion(
        new THREE.Quaternion().setFromUnitVectors(
          new THREE.Vector3(0, 1, 0),
          dir.clone().normalize(),
        ),
      );
      g.translate(a.x, a.y, a.z);
      members.push(g);
    }
    const frame = mesh(mergeGeometries(members), Materials.machinedAlloy());
    frame.position.x = s * width * 0.56;
    root.add(frame);
  }

  // Camera mast.
  const mast = mesh(
    new THREE.CylinderGeometry(width * 0.045, width * 0.055, height * 2.2, 10),
    Materials.machinedAlloy(),
  );
  mast.position.set(0, height * 1.5, -length * 0.3);
  root.add(mast);

  const head = mesh(
    new THREE.BoxGeometry(width * 0.42, height * 0.3, height * 0.26),
    Materials.hullWhite(),
  );
  head.position.set(0, height * 2.7, -length * 0.3);
  root.add(head);

  // Stereo camera pair — instantly reads as a rover head.
  const eyes: THREE.BufferGeometry[] = [];
  for (const s of [-1, 1]) {
    const g = new THREE.CylinderGeometry(width * 0.05, width * 0.05, height * 0.1, 12);
    g.rotateX(Math.PI / 2);
    g.translate(s * width * 0.13, height * 2.7, -length * 0.3 + height * 0.16);
    eyes.push(g);
  }
  root.add(mesh(mergeGeometries(eyes), Materials.darkPlastic()));

  const lenses: THREE.BufferGeometry[] = [];
  for (const s of [-1, 1]) {
    const g = new THREE.CylinderGeometry(width * 0.034, width * 0.034, height * 0.02, 12);
    g.rotateX(Math.PI / 2);
    g.translate(s * width * 0.13, height * 2.7, -length * 0.3 + height * 0.22);
    lenses.push(g);
  }
  root.add(mesh(mergeGeometries(lenses), Materials.glass()));

  return root;
}

/** A compact deep-space probe bus. */
export function buildProbeBus(size: number): THREE.Object3D {
  const root = new THREE.Group();
  root.name = 'probe-bus';

  const core = mesh(
    new THREE.CylinderGeometry(size * 0.55, size * 0.55, size * 0.7, 12),
    Materials.mli(),
  );
  root.add(core);

  const deck = mesh(
    new THREE.CylinderGeometry(size * 0.6, size * 0.6, size * 0.06, 12),
    Materials.hullWhite(),
  );
  deck.position.y = size * 0.36;
  root.add(deck);

  // Radioisotope-style power unit on a boom.
  const boom = mesh(
    new THREE.CylinderGeometry(size * 0.04, size * 0.04, size * 0.8, 8),
    Materials.machinedAlloy(),
  );
  boom.position.set(size * 0.55, 0, 0);
  boom.rotation.z = Math.PI / 2;
  root.add(boom);

  const rtg = mesh(
    new THREE.CylinderGeometry(size * 0.16, size * 0.16, size * 0.6, 12),
    Materials.structuralSteel(),
  );
  rtg.position.set(size * 1.05, 0, 0);
  rtg.rotation.z = Math.PI / 2;
  root.add(rtg);

  // Cooling fins on the power unit.
  const fins: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const g = new THREE.BoxGeometry(size * 0.56, size * 0.2, size * 0.02);
    g.translate(0, size * 0.22, 0);
    g.rotateX(a);
    g.rotateZ(Math.PI / 2);
    g.translate(size * 1.05, 0, 0);
    fins.push(g);
  }
  root.add(mesh(mergeGeometries(fins), Materials.structuralSteel()));

  return root;
}

/** A pressurised crew/cargo capsule with a docking ring and windows. */
export function buildCapsule(radius: number): THREE.Object3D {
  const root = new THREE.Group();
  root.name = 'capsule';
  const height = radius * 1.5;

  // Truncated-cone pressure vessel — the classic capsule silhouette.
  const body = mesh(
    new THREE.CylinderGeometry(radius * 0.42, radius, height, 24),
    Materials.hullWhite(),
  );
  body.position.y = height / 2;
  root.add(body);

  // Windows.
  const windows: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.4;
    const g = new THREE.CylinderGeometry(radius * 0.13, radius * 0.13, radius * 0.06, 12);
    g.rotateX(Math.PI / 2);
    g.rotateY(-a);
    g.translate(Math.sin(a) * radius * 0.78, height * 0.62, Math.cos(a) * radius * 0.78);
    windows.push(g);
  }
  root.add(mesh(mergeGeometries(windows), Materials.glass()));

  // Docking ring on top.
  const ring = mesh(
    new THREE.TorusGeometry(radius * 0.3, radius * 0.05, 8, 20),
    Materials.machinedAlloy(),
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = height;
  root.add(ring);

  // Base heat-shield carrier.
  const base = mesh(
    new THREE.CylinderGeometry(radius * 1.01, radius * 0.95, radius * 0.1, 24),
    Materials.ablative(),
  );
  root.add(base);

  return root;
}
