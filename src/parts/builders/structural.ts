/**
 * Tanks, aeroshells, interstages, separation hardware and aerodynamic surfaces
 * (spec §5). Each of these is the real architectural element it names — the
 * interstage is an open truss with a separation ring, the fairing is two
 * clamshell halves with a visible split line, the decoupler carries actual
 * pusher hardware.
 */
import * as THREE from 'three';
import { Materials } from '../../render/materials';
import {
  boltRing,
  mergeGeometries,
  mesh,
  ogiveNose,
  ribbedShell,
  tankBarrel,
  trussCylinder,
  aeroshellCone,
} from '../../render/geometry';
import { Rng } from '../../utils/math';

/** Names used to find animatable sub-objects at runtime. */
export const FAIRING_HALF_LEFT = 'fairing-half-l';
export const FAIRING_HALF_RIGHT = 'fairing-half-r';
export const LEG_PIVOT = 'leg-pivot';
export const PANEL_HINGE = 'panel-hinge';
export const ANTENNA_PIVOT = 'antenna-pivot';
export const CHUTE_CANOPY = 'chute-canopy';

/**
 * A propellant tank: domed pressure vessel, external stringers and ribs, feed
 * lines running down the outside, and a conduit raceway — the visual signature
 * of a real stage.
 */
export function buildTank(
  radius: number,
  length: number,
  seed: number,
  painted = true,
): THREE.Object3D {
  const root = new THREE.Group();
  root.name = 'tank';
  const rng = new Rng(seed);

  const skinMat = painted ? Materials.hullWhite() : Materials.tankMetal();

  // Pressure vessel with elliptical bulkheads.
  const barrel = mesh(tankBarrel(radius, length, 36), skinMat);
  root.add(barrel);

  // Structural stringers/ribs sitting proud of the skin.
  const structure = mesh(
    ribbedShell(radius * 1.004, length * 0.9, Math.max(3, Math.round(length / 4)), 18, 36),
    Materials.tankMetal(),
  );
  structure.position.y = length * 0.05;
  root.add(structure);

  // Interface rings top and bottom.
  for (const y of [radius * 0.12, length - radius * 0.12]) {
    const ring = mesh(
      new THREE.CylinderGeometry(radius * 1.02, radius * 1.02, radius * 0.1, 36),
      Materials.machinedAlloy(),
    );
    ring.position.y = y;
    root.add(ring);
    const bolts = mesh(boltRing(radius * 1.03, 28, radius * 0.02), Materials.machinedAlloy());
    bolts.position.y = y;
    root.add(bolts);
  }

  // External propellant feed line and electrical raceway.
  const raceAngle = rng.range(0, Math.PI * 2);
  const feedLine = mesh(
    new THREE.CylinderGeometry(radius * 0.07, radius * 0.07, length * 0.94, 10),
    Materials.tankMetal(),
  );
  feedLine.position.set(
    Math.sin(raceAngle) * radius * 1.07,
    length * 0.5,
    Math.cos(raceAngle) * radius * 1.07,
  );
  root.add(feedLine);

  const raceway = mesh(
    new THREE.BoxGeometry(radius * 0.22, length * 0.9, radius * 0.1),
    Materials.hullBlack(),
  );
  const raceAngle2 = raceAngle + Math.PI * 0.62;
  raceway.position.set(
    Math.sin(raceAngle2) * radius * 1.04,
    length * 0.5,
    Math.cos(raceAngle2) * radius * 1.04,
  );
  raceway.rotation.y = -raceAngle2;
  root.add(raceway);

  // Pressurisation bottles clustered near the top bulkhead.
  const bottles: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 3; i++) {
    const a = raceAngle + 1.8 + i * 0.28;
    const g = new THREE.CapsuleGeometry(radius * 0.09, radius * 0.3, 4, 8);
    g.translate(Math.sin(a) * radius * 1.08, length * 0.86, Math.cos(a) * radius * 1.08);
    bottles.push(g);
  }
  root.add(mesh(mergeGeometries(bottles), Materials.machinedAlloy()));

  // Agency roll-pattern band, so the vehicle has an identity (spec §61).
  const band = mesh(
    new THREE.CylinderGeometry(radius * 1.006, radius * 1.006, length * 0.06, 36, 1, true),
    Materials.hullBlack(),
  );
  band.position.y = length * 0.22;
  root.add(band);

  return root;
}

/**
 * An interstage: an open truss bay with a separation plane, exactly like the
 * structure that carries an upper stage above a booster.
 */
export function buildInterstage(
  radiusBottom: number,
  radiusTop: number,
  height: number,
  open = true,
): THREE.Object3D {
  const root = new THREE.Group();
  root.name = 'interstage';

  if (open) {
    const truss = mesh(
      trussCylinder(radiusBottom * 0.92, radiusTop * 0.92, height, 3, 10, radiusBottom * 0.028),
      Materials.structuralSteel(),
    );
    root.add(truss);
    // Thin aerodynamic skin over part of the bay.
    const skin = mesh(
      new THREE.CylinderGeometry(radiusTop, radiusBottom, height * 0.34, 32, 1, true),
      Materials.composite(),
    );
    skin.position.y = height * 0.83;
    root.add(skin);
  } else {
    const skin = mesh(
      new THREE.CylinderGeometry(radiusTop, radiusBottom, height, 32, 1, true),
      Materials.composite(),
    );
    skin.position.y = height / 2;
    root.add(skin);
  }

  // Separation rings top and bottom.
  for (const [y, r] of [
    [0, radiusBottom],
    [height, radiusTop],
  ] as const) {
    const ring = mesh(
      new THREE.CylinderGeometry(r * 1.01, r * 1.01, height * 0.06, 32),
      Materials.machinedAlloy(),
    );
    ring.position.y = y;
    root.add(ring);
  }

  // Pneumatic pusher cylinders that physically push the stages apart.
  const pushers: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 8;
    const g = new THREE.CylinderGeometry(radiusBottom * 0.05, radiusBottom * 0.05, height * 0.3, 8);
    g.translate(Math.sin(a) * radiusBottom * 0.8, height * 0.18, Math.cos(a) * radiusBottom * 0.8);
    pushers.push(g);
  }
  root.add(mesh(mergeGeometries(pushers), Materials.machinedAlloy()));

  return root;
}

/**
 * A payload fairing as two clamshell halves. The halves are separate,
 * named objects hinged at their base so they can actually swing open and be
 * jettisoned rather than vanishing.
 */
export function buildFairing(radius: number, height: number): THREE.Object3D {
  const root = new THREE.Group();
  root.name = 'fairing';

  const noseFraction = 0.42;
  const barrelHeight = height * (1 - noseFraction);
  const noseHeight = height * noseFraction;

  for (let side = 0; side < 2; side++) {
    const half = new THREE.Group();
    half.name = side === 0 ? FAIRING_HALF_LEFT : FAIRING_HALF_RIGHT;

    const thetaStart = side === 0 ? 0 : Math.PI;
    // Slight gap so the split line is visible.
    const thetaLength = Math.PI - 0.02;

    const barrel = mesh(
      new THREE.CylinderGeometry(
        radius,
        radius,
        barrelHeight,
        20,
        1,
        true,
        thetaStart + 0.01,
        thetaLength,
      ),
      Materials.composite(),
    );
    barrel.position.y = barrelHeight / 2;
    half.add(barrel);

    // Ogive nose section, cut to the same half.
    const noseGeo = ogiveNose(radius, noseHeight, 20);
    // Rebuild as a half-lathe by clipping: cheaper to just build a half cone.
    const noseHalf = new THREE.LatheGeometry(
      sampleOgiveProfile(radius, noseHeight, 14),
      20,
      thetaStart + 0.01,
      thetaLength,
    );
    noseGeo.dispose();
    const nose = mesh(noseHalf, Materials.composite());
    nose.position.y = barrelHeight;
    half.add(nose);

    // External stiffening ribs on the inside face.
    const ribs: THREE.BufferGeometry[] = [];
    for (let i = 1; i <= 3; i++) {
      const y = (i / 4) * barrelHeight;
      const g = new THREE.TorusGeometry(
        radius * 0.985,
        radius * 0.012,
        5,
        18,
        thetaLength,
      );
      g.rotateX(Math.PI / 2);
      g.rotateY(-thetaStart);
      g.translate(0, y, 0);
      ribs.push(g);
    }
    half.add(mesh(mergeGeometries(ribs), Materials.structuralSteel()));

    // Agency wordmark plate on the outside of each half.
    const plate = mesh(
      new THREE.BoxGeometry(radius * 0.5, height * 0.1, radius * 0.02),
      Materials.agencyAccent(),
    );
    const a = thetaStart + Math.PI / 2;
    plate.position.set(Math.sin(a) * radius * 1.01, barrelHeight * 0.62, Math.cos(a) * radius * 1.01);
    plate.rotation.y = a;
    half.add(plate);

    root.add(half);
  }

  // Base separation ring shared by both halves.
  const base = mesh(
    new THREE.CylinderGeometry(radius * 1.02, radius * 1.02, radius * 0.1, 32),
    Materials.machinedAlloy(),
  );
  root.add(base);

  return root;
}

function sampleOgiveProfile(radius: number, length: number, steps: number): THREE.Vector2[] {
  const rho = (radius * radius + length * length) / (2 * radius);
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const y = t * length;
    const inner = rho * rho - Math.pow(length - y, 2);
    const r = Math.sqrt(Math.max(inner, 0)) + radius - rho;
    pts.push(new THREE.Vector2(Math.max(r, radius * 0.05), y));
  }
  return pts;
}

/** A simple aerodynamic nose cone for vehicles that fly without a fairing. */
export function buildNoseCone(radius: number, height: number): THREE.Object3D {
  const root = new THREE.Group();
  root.name = 'nose-cone';

  const cone = mesh(ogiveNose(radius, height, 32), Materials.hullWhite());
  root.add(cone);

  // Blunt tip cap and a pitot boom.
  const tip = mesh(new THREE.SphereGeometry(radius * 0.08, 10, 8), Materials.hullBlack());
  tip.position.y = height;
  root.add(tip);

  const boom = mesh(
    new THREE.CylinderGeometry(radius * 0.012, radius * 0.02, height * 0.14, 6),
    Materials.machinedAlloy(),
  );
  boom.position.y = height + height * 0.07;
  root.add(boom);

  const ring = mesh(
    new THREE.CylinderGeometry(radius * 1.01, radius * 1.01, radius * 0.08, 32),
    Materials.machinedAlloy(),
  );
  root.add(ring);

  return root;
}

/**
 * A stage decoupler: a structural ring with visible separation bolts and
 * pusher springs. It is a real object between stages, not an invisible marker.
 */
export function buildDecoupler(radius: number): THREE.Object3D {
  const root = new THREE.Group();
  root.name = 'decoupler';
  const h = radius * 0.28;

  const ring = mesh(
    new THREE.CylinderGeometry(radius, radius, h, 32),
    Materials.machinedAlloy(),
  );
  ring.position.y = h / 2;
  root.add(ring);

  // Explosive-bolt housings around the circumference.
  const bolts: THREE.BufferGeometry[] = [];
  const count = 12;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const g = new THREE.BoxGeometry(radius * 0.1, h * 1.3, radius * 0.08);
    g.translate(Math.sin(a) * radius * 1.02, h / 2, Math.cos(a) * radius * 1.02);
    bolts.push(g);
  }
  root.add(mesh(mergeGeometries(bolts), Materials.agencyOrange()));

  // Pusher springs on the upper face.
  const springs: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    const g = new THREE.CylinderGeometry(radius * 0.06, radius * 0.06, h * 0.9, 8);
    g.translate(Math.sin(a) * radius * 0.7, h * 1.3, Math.cos(a) * radius * 0.7);
    springs.push(g);
  }
  root.add(mesh(mergeGeometries(springs), Materials.structuralSteel()));

  return root;
}

/** A diameter adapter so stacks of different widths connect plausibly. */
export function buildAdapter(
  radiusBottom: number,
  radiusTop: number,
  height: number,
): THREE.Object3D {
  const root = new THREE.Group();
  root.name = 'adapter';

  const cone = mesh(
    new THREE.CylinderGeometry(radiusTop, radiusBottom, height, 32, 1, true),
    Materials.hullWhite(),
  );
  cone.position.y = height / 2;
  root.add(cone);

  for (const [y, r] of [
    [0, radiusBottom],
    [height, radiusTop],
  ] as const) {
    const ring = mesh(
      new THREE.CylinderGeometry(r * 1.01, r * 1.01, height * 0.1, 32),
      Materials.machinedAlloy(),
    );
    ring.position.y = y;
    root.add(ring);
  }
  return root;
}

/**
 * A grid fin — the lattice control surface used for controlled descent. Built
 * as an actual grid so it is unmistakable in silhouette.
 */
export function buildGridFin(span: number, chord: number): THREE.Object3D {
  const root = new THREE.Group();
  root.name = 'grid-fin';

  const frame: THREE.BufferGeometry[] = [];
  const t = span * 0.035;

  // Outer frame.
  const outer = new THREE.BoxGeometry(span, chord, t);
  frame.push(outer);

  // Inner lattice.
  const cells = 5;
  for (let i = 1; i < cells; i++) {
    const g1 = new THREE.BoxGeometry(t * 0.7, chord * 0.94, t * 1.6);
    g1.translate((i / cells - 0.5) * span, 0, 0);
    frame.push(g1);
    const g2 = new THREE.BoxGeometry(span * 0.94, t * 0.7, t * 1.6);
    g2.translate(0, (i / cells - 0.5) * chord, 0);
    frame.push(g2);
  }

  const grid = mesh(mergeGeometries(frame), Materials.machinedAlloy());
  root.add(grid);

  // Hinge and actuator shaft back to the vehicle.
  const shaft = mesh(
    new THREE.CylinderGeometry(span * 0.05, span * 0.05, span * 0.3, 10),
    Materials.structuralSteel(),
  );
  shaft.rotation.z = Math.PI / 2;
  shaft.position.x = -span * 0.62;
  root.add(shaft);

  return root;
}

/** A conventional aerodynamic stabiliser fin. */
export function buildFin(span: number, rootChord: number, tipChord: number): THREE.Object3D {
  const root = new THREE.Group();
  root.name = 'fin';

  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(0, rootChord);
  shape.lineTo(span, rootChord * 0.35 + tipChord);
  shape.lineTo(span, rootChord * 0.35);
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: rootChord * 0.06,
    bevelEnabled: true,
    bevelSize: rootChord * 0.02,
    bevelThickness: rootChord * 0.015,
    bevelSegments: 2,
  });
  geo.translate(0, 0, -rootChord * 0.03);
  geo.computeVertexNormals();

  const fin = mesh(geo, Materials.hullWhite());
  root.add(fin);

  // Root attachment fitting.
  const fitting = mesh(
    new THREE.BoxGeometry(span * 0.1, rootChord * 0.9, rootChord * 0.1),
    Materials.structuralSteel(),
  );
  fitting.position.set(0, rootChord * 0.45, 0);
  root.add(fitting);

  return root;
}

/**
 * A blunt-body aeroshell / heat shield for atmospheric entry (spec §34).
 * The ablative face points down local -Y.
 */
export function buildHeatShield(radius: number): THREE.Object3D {
  const root = new THREE.Group();
  root.name = 'heat-shield';

  const geo = aeroshellCone(radius, 70, 36);
  geo.rotateX(Math.PI); // Face downward.
  const shield = mesh(geo, Materials.ablative());
  root.add(shield);

  // Structural back-shell carrier and attach ring.
  const carrier = mesh(
    new THREE.CylinderGeometry(radius * 0.98, radius * 0.98, radius * 0.08, 36),
    Materials.machinedAlloy(),
  );
  root.add(carrier);

  const ribs: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const g = new THREE.BoxGeometry(radius * 0.9, radius * 0.05, radius * 0.05);
    g.translate(radius * 0.45, radius * 0.06, 0);
    g.rotateY(-a);
    ribs.push(g);
  }
  root.add(mesh(mergeGeometries(ribs), Materials.structuralSteel()));

  return root;
}
