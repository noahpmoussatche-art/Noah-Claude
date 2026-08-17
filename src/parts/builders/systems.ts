/**
 * Avionics, power, communication, thermal, science and robotics hardware
 * (spec §39–§42). Solar wings and antennas are built folded, with named hinge
 * objects, so deployment is a real mechanical animation rather than a pop-in.
 */
import * as THREE from 'three';
import { Materials } from '../../render/materials';
import { mergeGeometries, mesh } from '../../render/geometry';
import { PANEL_HINGE, ANTENNA_PIVOT } from './structural';
import { Rng } from '../../utils/math';

/** Flight computer / command module: an avionics ring with boxes and connectors. */
export function buildAvionics(radius: number, height: number): THREE.Object3D {
  const root = new THREE.Group();
  root.name = 'avionics';

  const shell = mesh(
    new THREE.CylinderGeometry(radius, radius, height, 28),
    Materials.hullWhite(),
  );
  shell.position.y = height / 2;
  root.add(shell);

  // Avionics boxes bolted around the interior ring, visible through cutouts.
  const boxes: THREE.BufferGeometry[] = [];
  const count = 6;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const g = new THREE.BoxGeometry(radius * 0.4, height * 0.5, radius * 0.22);
    g.translate(Math.sin(a) * radius * 1.02, height * 0.5, Math.cos(a) * radius * 1.02);
    g.rotateY(0);
    boxes.push(g);
  }
  root.add(mesh(mergeGeometries(boxes), Materials.darkPlastic()));

  // Star tracker and inertial unit on top.
  const tracker = mesh(
    new THREE.CylinderGeometry(radius * 0.14, radius * 0.18, height * 0.5, 10),
    Materials.machinedAlloy(),
  );
  tracker.position.set(radius * 0.5, height * 1.1, 0);
  tracker.rotation.z = -0.35;
  root.add(tracker);

  const hood = mesh(
    new THREE.CylinderGeometry(radius * 0.16, radius * 0.16, height * 0.2, 10, 1, true),
    Materials.hullBlack(),
  );
  hood.position.set(radius * 0.62, height * 1.3, 0);
  hood.rotation.z = -0.35;
  root.add(hood);

  // Status indicator that lights during the countdown.
  const lamp = mesh(
    new THREE.SphereGeometry(radius * 0.05, 8, 6),
    Materials.emissive(0x2fe08a, 1.6),
    false,
    false,
  );
  lamp.name = 'avionics-lamp';
  lamp.position.set(0, height * 0.8, radius * 1.01);
  root.add(lamp);

  return root;
}

/**
 * A deployable solar wing. Panels are chained through nested hinge groups so
 * folding one hinge folds everything outboard of it — a real accordion.
 */
export function buildSolarWing(
  panelLength: number,
  panelWidth: number,
  panelCount: number,
): THREE.Object3D {
  const root = new THREE.Group();
  root.name = 'solar-wing';

  // Root yoke that carries the wing off the spacecraft body.
  const yoke = mesh(
    new THREE.BoxGeometry(panelWidth * 0.12, panelWidth * 0.1, panelWidth * 0.3),
    Materials.machinedAlloy(),
  );
  root.add(yoke);

  let parent: THREE.Object3D = root;
  const thickness = panelWidth * 0.018;

  for (let i = 0; i < panelCount; i++) {
    const hinge = new THREE.Group();
    hinge.name = PANEL_HINGE;
    // Each hinge sits at the outboard edge of the previous panel.
    hinge.position.x = i === 0 ? panelWidth * 0.12 : panelLength;
    // Stowed: folded back on itself (animation drives this to 0).
    hinge.rotation.z = Math.PI * 0.98;

    const panelGroup = new THREE.Group();

    // Substrate.
    const substrate = mesh(
      new THREE.BoxGeometry(panelLength, thickness, panelWidth),
      Materials.solarBack(),
    );
    substrate.position.x = panelLength / 2;
    panelGroup.add(substrate);

    // Cell face on the sun side.
    const face = mesh(
      new THREE.BoxGeometry(panelLength * 0.96, thickness * 0.4, panelWidth * 0.94),
      Materials.solarFace(),
    );
    face.position.set(panelLength / 2, thickness * 0.6, 0);
    panelGroup.add(face);

    // Edge frame.
    const frame: THREE.BufferGeometry[] = [];
    const fr = thickness * 1.6;
    frame.push(
      (() => {
        const g = new THREE.BoxGeometry(panelLength, fr, fr);
        g.translate(panelLength / 2, 0, panelWidth / 2);
        return g;
      })(),
      (() => {
        const g = new THREE.BoxGeometry(panelLength, fr, fr);
        g.translate(panelLength / 2, 0, -panelWidth / 2);
        return g;
      })(),
    );
    panelGroup.add(mesh(mergeGeometries(frame), Materials.machinedAlloy()));

    // Hinge knuckles, so the fold looks mechanical.
    const knuckles: THREE.BufferGeometry[] = [];
    for (const z of [-panelWidth * 0.38, 0, panelWidth * 0.38]) {
      const g = new THREE.CylinderGeometry(thickness * 2, thickness * 2, panelWidth * 0.08, 8);
      g.rotateX(Math.PI / 2);
      g.translate(0, 0, z);
      knuckles.push(g);
    }
    panelGroup.add(mesh(mergeGeometries(knuckles), Materials.structuralSteel()));

    hinge.add(panelGroup);
    parent.add(hinge);
    parent = hinge;
  }

  return root;
}

/** A fixed body-mounted solar panel. */
export function buildBodyPanel(width: number, height: number): THREE.Object3D {
  const root = new THREE.Group();
  root.name = 'body-panel';

  const substrate = mesh(
    new THREE.BoxGeometry(width, height * 0.03, height),
    Materials.solarBack(),
  );
  root.add(substrate);

  const face = mesh(
    new THREE.BoxGeometry(width * 0.95, height * 0.012, height * 0.95),
    Materials.solarFace(),
  );
  face.position.y = height * 0.022;
  root.add(face);

  return root;
}

/**
 * A deployable high-gain dish. The dish is parented to a named pivot so it can
 * unfold from stowed and then track a target (spec §41).
 */
export function buildDishAntenna(dishRadius: number): THREE.Object3D {
  const root = new THREE.Group();
  root.name = 'dish-antenna';

  // Two-axis gimbal base.
  const base = mesh(
    new THREE.CylinderGeometry(dishRadius * 0.16, dishRadius * 0.2, dishRadius * 0.16, 12),
    Materials.machinedAlloy(),
  );
  root.add(base);

  const pivot = new THREE.Group();
  pivot.name = ANTENNA_PIVOT;
  pivot.position.y = dishRadius * 0.16;
  // Stowed: laid over against the body.
  pivot.rotation.x = Math.PI * 0.48;

  const arm = mesh(
    new THREE.CylinderGeometry(dishRadius * 0.05, dishRadius * 0.05, dishRadius * 0.5, 10),
    Materials.machinedAlloy(),
  );
  arm.position.y = dishRadius * 0.25;
  pivot.add(arm);

  // Parabolic reflector, built as a lathed paraboloid rather than a flat disc.
  const profile: THREE.Vector2[] = [];
  const steps = 12;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const r = t * dishRadius;
    profile.push(new THREE.Vector2(Math.max(r, 1e-3), (r * r) / (2.6 * dishRadius)));
  }
  const dish = mesh(
    new THREE.LatheGeometry(profile, 28),
    Materials.hullWhite(),
  );
  (dish.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
  dish.position.y = dishRadius * 0.5;
  pivot.add(dish);

  // Ribbed back structure.
  const ribs: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const g = new THREE.BoxGeometry(dishRadius * 0.9, dishRadius * 0.03, dishRadius * 0.03);
    g.translate(dishRadius * 0.45, -dishRadius * 0.03, 0);
    g.rotateY(-a);
    ribs.push(g);
  }
  const ribMesh = mesh(mergeGeometries(ribs), Materials.structuralSteel());
  ribMesh.position.y = dishRadius * 0.5;
  pivot.add(ribMesh);

  // Feed horn on a tripod at the focus.
  const feed = mesh(
    new THREE.CylinderGeometry(dishRadius * 0.07, dishRadius * 0.11, dishRadius * 0.18, 10),
    Materials.machinedAlloy(),
  );
  feed.position.y = dishRadius * 0.5 + dishRadius * 0.62;
  feed.rotation.x = Math.PI;
  pivot.add(feed);

  const legs: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const top = new THREE.Vector3(0, dishRadius * 0.6, 0);
    const bot = new THREE.Vector3(
      Math.sin(a) * dishRadius * 0.75,
      dishRadius * 0.11,
      Math.cos(a) * dishRadius * 0.75,
    );
    const dir = new THREE.Vector3().subVectors(bot, top);
    const len = dir.length();
    const g = new THREE.CylinderGeometry(dishRadius * 0.012, dishRadius * 0.012, len, 5);
    g.translate(0, -len / 2, 0);
    g.applyQuaternion(
      new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir.clone().normalize()),
    );
    g.translate(top.x, top.y, top.z);
    legs.push(g);
  }
  const legMesh = mesh(mergeGeometries(legs), Materials.machinedAlloy());
  legMesh.position.y = dishRadius * 0.5;
  pivot.add(legMesh);

  root.add(pivot);
  return root;
}

/** A whip / omnidirectional low-gain antenna. */
export function buildWhipAntenna(length: number): THREE.Object3D {
  const root = new THREE.Group();
  root.name = 'whip-antenna';

  const base = mesh(
    new THREE.CylinderGeometry(length * 0.05, length * 0.07, length * 0.1, 10),
    Materials.machinedAlloy(),
  );
  root.add(base);

  const whip = mesh(
    new THREE.CylinderGeometry(length * 0.008, length * 0.016, length, 6),
    Materials.machinedAlloy(),
  );
  whip.position.y = length / 2 + length * 0.05;
  root.add(whip);

  const tip = mesh(new THREE.SphereGeometry(length * 0.022, 8, 6), Materials.agencyOrange());
  tip.position.y = length * 1.06;
  root.add(tip);

  return root;
}

/** Battery pack. */
export function buildBattery(size: number): THREE.Object3D {
  const root = new THREE.Group();
  root.name = 'battery';

  const body = mesh(
    new THREE.BoxGeometry(size, size * 0.7, size * 0.8),
    Materials.darkPlastic(),
  );
  root.add(body);

  // Cell rows visible along the top.
  const cells: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 3; j++) {
      const g = new THREE.CylinderGeometry(size * 0.08, size * 0.08, size * 0.12, 8);
      g.translate((i / 3 - 0.5) * size * 0.7, size * 0.38, (j / 2 - 0.5) * size * 0.5);
      cells.push(g);
    }
  }
  root.add(mesh(mergeGeometries(cells), Materials.machinedAlloy()));

  // Charge indicator.
  const led = mesh(
    new THREE.BoxGeometry(size * 0.3, size * 0.04, size * 0.04),
    Materials.emissive(0x3fd07a, 1.4),
    false,
    false,
  );
  led.position.set(0, size * 0.2, size * 0.41);
  root.add(led);

  return root;
}

/** Radiator panel for thermal rejection. */
export function buildRadiator(width: number, height: number): THREE.Object3D {
  const root = new THREE.Group();
  root.name = 'radiator';

  const panel = mesh(
    new THREE.BoxGeometry(width, height * 0.02, height),
    Materials.hullWhite(),
  );
  root.add(panel);

  // Coolant tubes running across the face.
  const tubes: THREE.BufferGeometry[] = [];
  const count = 10;
  for (let i = 0; i < count; i++) {
    const g = new THREE.CylinderGeometry(height * 0.012, height * 0.012, width * 0.96, 6);
    g.rotateZ(Math.PI / 2);
    g.translate(0, height * 0.02, (i / (count - 1) - 0.5) * height * 0.9);
    tubes.push(g);
  }
  root.add(mesh(mergeGeometries(tubes), Materials.copperPlumbing()));

  return root;
}

/** Science instrument package with a camera mast and sensor heads. */
export function buildScienceBay(size: number, seed: number): THREE.Object3D {
  const root = new THREE.Group();
  root.name = 'science-bay';
  const rng = new Rng(seed);

  const body = mesh(
    new THREE.BoxGeometry(size, size * 0.8, size * 0.9),
    Materials.hullWhite(),
  );
  root.add(body);

  // Instrument apertures.
  const optics: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 3; i++) {
    const g = new THREE.CylinderGeometry(size * 0.11, size * 0.13, size * 0.22, 12);
    g.rotateX(Math.PI / 2);
    g.translate((i - 1) * size * 0.28, size * 0.05, size * 0.52);
    optics.push(g);
  }
  root.add(mesh(mergeGeometries(optics), Materials.darkPlastic()));

  const lenses: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 3; i++) {
    const g = new THREE.CylinderGeometry(size * 0.08, size * 0.08, size * 0.02, 12);
    g.rotateX(Math.PI / 2);
    g.translate((i - 1) * size * 0.28, size * 0.05, size * 0.63);
    lenses.push(g);
  }
  root.add(mesh(mergeGeometries(lenses), Materials.glass()));

  // Deployable boom sensor.
  const boom = mesh(
    new THREE.CylinderGeometry(size * 0.03, size * 0.03, size * 0.9, 8),
    Materials.machinedAlloy(),
  );
  boom.position.set(size * 0.4, size * 0.45, 0);
  boom.rotation.z = -0.5;
  root.add(boom);

  const sensor = mesh(
    new THREE.BoxGeometry(size * 0.16, size * 0.16, size * 0.16),
    Materials.mli(),
  );
  sensor.position.set(size * 0.62, size * 0.82, 0);
  root.add(sensor);

  // Thermal blanket wrap over part of the bay.
  const blanket = mesh(
    new THREE.BoxGeometry(size * 1.02, size * 0.34, size * 0.92),
    Materials.mli(),
  );
  blanket.position.y = -size * 0.22;
  root.add(blanket);

  // A couple of connector boxes for visual density.
  for (let i = 0; i < 2; i++) {
    const b = mesh(
      new THREE.BoxGeometry(size * 0.18, size * 0.14, size * 0.1),
      Materials.darkPlastic(),
    );
    b.position.set(rng.range(-0.3, 0.3) * size, size * 0.44, rng.range(-0.3, 0.3) * size);
    root.add(b);
  }

  return root;
}

/** A jointed robotic arm with a gripper. */
export function buildRoboticArm(reach: number): THREE.Object3D {
  const root = new THREE.Group();
  root.name = 'robotic-arm';

  const shoulder = mesh(
    new THREE.CylinderGeometry(reach * 0.07, reach * 0.08, reach * 0.1, 12),
    Materials.machinedAlloy(),
  );
  root.add(shoulder);

  const upper = new THREE.Group();
  upper.position.y = reach * 0.05;
  upper.rotation.z = -0.5;

  const upperArm = mesh(
    new THREE.CylinderGeometry(reach * 0.045, reach * 0.05, reach * 0.45, 10),
    Materials.hullWhite(),
  );
  upperArm.position.y = reach * 0.225;
  upper.add(upperArm);

  const elbow = new THREE.Group();
  elbow.position.y = reach * 0.45;
  elbow.rotation.z = 1.1;

  const elbowJoint = mesh(
    new THREE.SphereGeometry(reach * 0.055, 10, 8),
    Materials.machinedAlloy(),
  );
  elbow.add(elbowJoint);

  const foreArm = mesh(
    new THREE.CylinderGeometry(reach * 0.035, reach * 0.042, reach * 0.4, 10),
    Materials.hullWhite(),
  );
  foreArm.position.y = reach * 0.2;
  elbow.add(foreArm);

  // Gripper.
  const wrist = new THREE.Group();
  wrist.position.y = reach * 0.4;

  const wristJoint = mesh(
    new THREE.CylinderGeometry(reach * 0.04, reach * 0.04, reach * 0.06, 10),
    Materials.machinedAlloy(),
  );
  wrist.add(wristJoint);

  for (const s of [-1, 1]) {
    const finger = mesh(
      new THREE.BoxGeometry(reach * 0.02, reach * 0.11, reach * 0.04),
      Materials.darkPlastic(),
    );
    finger.position.set(s * reach * 0.03, reach * 0.09, 0);
    finger.rotation.z = -s * 0.2;
    wrist.add(finger);
  }

  elbow.add(wrist);
  upper.add(elbow);
  root.add(upper);

  return root;
}

/** A drill / sampling instrument for surface science. */
export function buildDrill(size: number): THREE.Object3D {
  const root = new THREE.Group();
  root.name = 'drill';

  const housing = mesh(
    new THREE.BoxGeometry(size * 0.4, size, size * 0.4),
    Materials.hullWhite(),
  );
  root.add(housing);

  const motor = mesh(
    new THREE.CylinderGeometry(size * 0.22, size * 0.22, size * 0.3, 12),
    Materials.machinedAlloy(),
  );
  motor.position.y = size * 0.55;
  root.add(motor);

  const bit = mesh(
    new THREE.ConeGeometry(size * 0.09, size * 0.5, 8),
    Materials.machinedAlloy(),
  );
  bit.position.y = -size * 0.72;
  bit.rotation.x = Math.PI;
  root.add(bit);

  // Helical flutes.
  const flutes: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 12; i++) {
    const t = i / 12;
    const g = new THREE.BoxGeometry(size * 0.16, size * 0.03, size * 0.03);
    g.translate(0, -size * 0.5 - t * size * 0.35, 0);
    g.rotateY(t * Math.PI * 3);
    flutes.push(g);
  }
  root.add(mesh(mergeGeometries(flutes), Materials.structuralSteel()));

  return root;
}
