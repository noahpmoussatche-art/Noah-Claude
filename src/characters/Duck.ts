/**
 * The two ducks (spec §24, §60) — the agency's entire staff.
 *
 * They are proper 3D characters, not icons: body, head, eyes, bill, wings,
 * legs, webbed feet, and their own gear. The model is built on a nested-group
 * rig (pelvis → spine → neck → head, plus shoulder and hip joints) so the
 * animator can pose them — walk, point, look up at the rocket, talk, cheer,
 * flinch — rather than sliding a static mesh around.
 *
 * Scale is deliberate and consistent with everything else: a duck stands about
 * 0.55 m tall, which next to a 55 m launch vehicle is exactly the 1:100 ratio
 * the sense-of-scale requirement depends on (spec §21, §55).
 */
import * as THREE from 'three';
import { Materials } from '../render/materials';
import { mergeGeometries, mesh } from '../render/geometry';

/** Overall standing height of a duck, metres. */
export const DUCK_HEIGHT = 0.55;

export type DuckRole = 'engineer' | 'pilot';

export interface DuckRig {
  readonly root: THREE.Group;
  /** Whole-body vertical bob and lean. */
  readonly pelvis: THREE.Group;
  readonly spine: THREE.Group;
  readonly neck: THREE.Group;
  readonly head: THREE.Group;
  readonly bill: THREE.Group;
  readonly leftWing: THREE.Group;
  readonly rightWing: THREE.Group;
  readonly leftLeg: THREE.Group;
  readonly rightLeg: THREE.Group;
  readonly leftFoot: THREE.Group;
  readonly rightFoot: THREE.Group;
  /** Held prop (tablet or clipboard), may be null. */
  readonly prop: THREE.Group | null;
  readonly eyelids: THREE.Mesh[];
}

/**
 * Builds a duck. The two roles differ in plumage, gear and held prop so they
 * read as distinct individuals at a glance.
 */
export function buildDuck(role: DuckRole): DuckRig {
  const root = new THREE.Group();
  root.name = `duck-${role}`;

  const S = DUCK_HEIGHT;

  // Distinct plumage per character.
  const bodyMat =
    role === 'engineer'
      ? Materials.duckBody()
      : new THREE.MeshStandardMaterial({ color: 0xf1f2f0, roughness: 0.8, metalness: 0 });

  const accentMat =
    role === 'engineer' ? Materials.agencyOrange() : Materials.agencyAccent();

  // ---- Pelvis: the root of the rig ----
  const pelvis = new THREE.Group();
  pelvis.position.y = S * 0.42;
  root.add(pelvis);

  // ---- Spine and body ----
  const spine = new THREE.Group();
  pelvis.add(spine);

  // Duck body: an egg, slightly pitched forward, with a tail.
  const bodyGeo = new THREE.SphereGeometry(S * 0.3, 18, 14);
  bodyGeo.scale(1, 0.92, 1.24);
  const body = mesh(bodyGeo, bodyMat);
  spine.add(body);

  // Tail feathers.
  const tail = mesh(new THREE.ConeGeometry(S * 0.12, S * 0.26, 7), bodyMat);
  tail.rotation.x = -1.15;
  tail.position.set(0, S * 0.08, -S * 0.34);
  spine.add(tail);

  // Chest highlight so the silhouette has some shading interest.
  const chestGeo = new THREE.SphereGeometry(S * 0.2, 14, 10);
  chestGeo.scale(1, 0.9, 0.9);
  const chest = mesh(
    chestGeo,
    new THREE.MeshStandardMaterial({
      color: role === 'engineer' ? 0xfff0a8 : 0xffffff,
      roughness: 0.82,
    }),
  );
  chest.position.set(0, -S * 0.03, S * 0.14);
  spine.add(chest);

  // ---- Gear (spec §24: roupas/equipamentos) ----
  if (role === 'engineer') {
    // Hi-vis work vest with reflective bands.
    const vestGeo = new THREE.SphereGeometry(S * 0.315, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.62);
    vestGeo.scale(1, 0.86, 1.22);
    const vest = mesh(vestGeo, accentMat);
    vest.position.y = -S * 0.02;
    spine.add(vest);

    const bands: THREE.BufferGeometry[] = [];
    for (const y of [-S * 0.02, S * 0.06]) {
      const g = new THREE.TorusGeometry(S * 0.29, S * 0.014, 6, 20);
      g.rotateX(Math.PI / 2);
      g.scale(1, 1, 1.2);
      g.translate(0, y, 0);
      bands.push(g);
    }
    spine.add(mesh(mergeGeometries(bands), Materials.emissive(0xdfe6ea, 0.35), false, false));

    // Tool belt.
    const belt = mesh(
      new THREE.TorusGeometry(S * 0.28, S * 0.022, 6, 20),
      Materials.darkPlastic(),
    );
    belt.rotation.x = Math.PI / 2;
    belt.scale.set(1, 1, 1.2);
    belt.position.y = -S * 0.16;
    spine.add(belt);

    const pouch = mesh(
      new THREE.BoxGeometry(S * 0.1, S * 0.1, S * 0.06),
      Materials.darkPlastic(),
    );
    pouch.position.set(S * 0.26, -S * 0.16, S * 0.06);
    spine.add(pouch);
  } else {
    // Flight jacket with a shoulder patch.
    const jacketGeo = new THREE.SphereGeometry(S * 0.315, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.58);
    jacketGeo.scale(1, 0.84, 1.2);
    const jacket = mesh(jacketGeo, accentMat);
    jacket.position.y = -S * 0.04;
    spine.add(jacket);

    const patch = mesh(
      new THREE.CylinderGeometry(S * 0.05, S * 0.05, S * 0.01, 12),
      Materials.agencyOrange(),
    );
    patch.rotation.z = Math.PI / 2;
    patch.position.set(S * 0.29, S * 0.02, S * 0.04);
    spine.add(patch);

    // Scarf, because someone has to look the part.
    const scarf = mesh(
      new THREE.TorusGeometry(S * 0.17, S * 0.032, 8, 18),
      Materials.fabricOrange(),
    );
    scarf.rotation.x = Math.PI / 2;
    scarf.position.y = S * 0.2;
    spine.add(scarf);

    const scarfTail = mesh(
      new THREE.BoxGeometry(S * 0.07, S * 0.24, S * 0.02),
      Materials.fabricOrange(),
    );
    scarfTail.position.set(S * 0.1, S * 0.08, -S * 0.14);
    scarfTail.rotation.x = 0.3;
    spine.add(scarfTail);
  }

  // ---- Neck and head ----
  const neck = new THREE.Group();
  neck.position.set(0, S * 0.2, S * 0.08);
  spine.add(neck);

  const neckMesh = mesh(
    new THREE.CylinderGeometry(S * 0.09, S * 0.12, S * 0.16, 12),
    bodyMat,
  );
  neckMesh.position.y = S * 0.07;
  neck.add(neckMesh);

  const head = new THREE.Group();
  head.position.y = S * 0.16;
  neck.add(head);

  const headGeo = new THREE.SphereGeometry(S * 0.155, 16, 12);
  headGeo.scale(1, 1.02, 1.06);
  head.add(mesh(headGeo, bodyMat));

  // Bill on its own group so it can open when the duck talks.
  const bill = new THREE.Group();
  bill.position.set(0, -S * 0.02, S * 0.12);
  head.add(bill);

  const upperBillGeo = new THREE.SphereGeometry(S * 0.075, 12, 8);
  upperBillGeo.scale(1, 0.42, 1.6);
  const upperBill = mesh(upperBillGeo, Materials.duckBill());
  upperBill.position.z = S * 0.04;
  bill.add(upperBill);

  const lowerBill = new THREE.Group();
  lowerBill.name = 'lower-bill';
  const lowerBillGeo = new THREE.SphereGeometry(S * 0.065, 12, 8);
  lowerBillGeo.scale(1, 0.3, 1.45);
  const lowerBillMesh = mesh(lowerBillGeo, Materials.duckBill());
  lowerBillMesh.position.set(0, -S * 0.028, S * 0.038);
  lowerBill.add(lowerBillMesh);
  bill.add(lowerBill);

  // Nostrils — small, but they stop the bill reading as a blob.
  const nostrils: THREE.BufferGeometry[] = [];
  for (const s of [-1, 1]) {
    const g = new THREE.SphereGeometry(S * 0.008, 6, 4);
    g.translate(s * S * 0.025, S * 0.012, S * 0.02);
    nostrils.push(g);
  }
  bill.add(mesh(mergeGeometries(nostrils), Materials.duckEye(), false, false));

  // ---- Eyes with eyelids for blinking ----
  const eyelids: THREE.Mesh[] = [];
  for (const s of [-1, 1]) {
    const eyeGroup = new THREE.Group();
    eyeGroup.position.set(s * S * 0.085, S * 0.04, S * 0.085);

    const sclera = mesh(new THREE.SphereGeometry(S * 0.042, 12, 10), Materials.plastic());
    eyeGroup.add(sclera);

    const pupil = mesh(new THREE.SphereGeometry(S * 0.026, 10, 8), Materials.duckEye());
    pupil.position.z = S * 0.026;
    eyeGroup.add(pupil);

    // A tiny specular dot gives the character life.
    const glint = mesh(
      new THREE.SphereGeometry(S * 0.009, 6, 5),
      Materials.emissive(0xffffff, 0.9),
      false,
      false,
    );
    glint.position.set(s * S * 0.008, S * 0.01, S * 0.043);
    eyeGroup.add(glint);

    const lid = mesh(
      new THREE.SphereGeometry(S * 0.045, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.5),
      bodyMat,
    );
    lid.position.y = S * 0.045;
    eyeGroup.add(lid);
    eyelids.push(lid);

    head.add(eyeGroup);
  }

  // ---- Headgear ----
  if (role === 'engineer') {
    // Hard hat.
    const hatGeo = new THREE.SphereGeometry(S * 0.15, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.5);
    hatGeo.scale(1, 0.82, 1);
    const hat = mesh(hatGeo, Materials.agencyOrange());
    hat.position.y = S * 0.09;
    head.add(hat);

    const brim = mesh(
      new THREE.CylinderGeometry(S * 0.165, S * 0.165, S * 0.012, 16),
      Materials.agencyOrange(),
    );
    brim.position.y = S * 0.088;
    head.add(brim);

    // Ridge along the crown.
    const ridge = mesh(
      new THREE.BoxGeometry(S * 0.024, S * 0.03, S * 0.26),
      Materials.agencyOrange(),
    );
    ridge.position.y = S * 0.16;
    head.add(ridge);
  } else {
    // Flight cap with goggles pushed up on the forehead.
    const capGeo = new THREE.SphereGeometry(S * 0.152, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.52);
    capGeo.scale(1, 0.78, 1);
    const cap = mesh(capGeo, Materials.hullBlack());
    cap.position.y = S * 0.075;
    head.add(cap);

    const strap = mesh(
      new THREE.TorusGeometry(S * 0.15, S * 0.014, 6, 18),
      Materials.darkPlastic(),
    );
    strap.rotation.x = Math.PI / 2;
    strap.rotation.z = 0.1;
    strap.position.y = S * 0.075;
    head.add(strap);

    const goggles: THREE.BufferGeometry[] = [];
    for (const s of [-1, 1]) {
      const g = new THREE.CylinderGeometry(S * 0.045, S * 0.045, S * 0.03, 12);
      g.rotateX(Math.PI / 2);
      g.translate(s * S * 0.06, S * 0.1, S * 0.09);
      goggles.push(g);
    }
    head.add(mesh(mergeGeometries(goggles), Materials.glass()));

    const gogglesFrame: THREE.BufferGeometry[] = [];
    for (const s of [-1, 1]) {
      const g = new THREE.TorusGeometry(S * 0.048, S * 0.008, 6, 12);
      g.translate(s * S * 0.06, S * 0.1, S * 0.09);
      gogglesFrame.push(g);
    }
    head.add(mesh(mergeGeometries(gogglesFrame), Materials.copperPlumbing()));
  }

  // ---- Wings ----
  const makeWing = (side: number): THREE.Group => {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * S * 0.26, S * 0.04, 0);
    // Slight default droop so the arms are not held out stiffly.
    shoulder.rotation.z = -side * 0.18;

    const wingGeo = new THREE.SphereGeometry(S * 0.15, 12, 8);
    wingGeo.scale(0.34, 0.86, 1.15);
    const wing = mesh(wingGeo, bodyMat);
    wing.position.y = -S * 0.08;
    shoulder.add(wing);

    // Primary feathers at the wingtip.
    const feathers: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 4; i++) {
      const g = new THREE.BoxGeometry(S * 0.014, S * 0.1, S * 0.038);
      g.translate(0, -S * 0.2, -S * 0.05 + i * S * 0.032);
      g.rotateX(0.12 * i);
      feathers.push(g);
    }
    shoulder.add(mesh(mergeGeometries(feathers), bodyMat));

    return shoulder;
  };

  const leftWing = makeWing(-1);
  const rightWing = makeWing(1);
  spine.add(leftWing);
  spine.add(rightWing);

  // ---- Legs and webbed feet ----
  const makeLeg = (side: number): { hip: THREE.Group; foot: THREE.Group } => {
    const hip = new THREE.Group();
    hip.position.set(side * S * 0.1, -S * 0.2, 0);

    const thigh = mesh(
      new THREE.CylinderGeometry(S * 0.035, S * 0.03, S * 0.18, 8),
      Materials.duckBill(),
    );
    thigh.position.y = -S * 0.09;
    hip.add(thigh);

    const knee = mesh(new THREE.SphereGeometry(S * 0.033, 8, 6), Materials.duckBill());
    knee.position.y = -S * 0.18;
    hip.add(knee);

    const foot = new THREE.Group();
    foot.position.y = -S * 0.19;

    // Webbed foot: a flattened triangle with toe ridges.
    const footGeo = new THREE.SphereGeometry(S * 0.09, 10, 6);
    footGeo.scale(0.75, 0.18, 1.3);
    const footMesh = mesh(footGeo, Materials.duckBill());
    footMesh.position.z = S * 0.035;
    foot.add(footMesh);

    const toes: THREE.BufferGeometry[] = [];
    for (let i = -1; i <= 1; i++) {
      const g = new THREE.BoxGeometry(S * 0.012, S * 0.012, S * 0.07);
      g.translate(i * S * 0.03, S * 0.008, S * 0.1);
      toes.push(g);
    }
    foot.add(mesh(mergeGeometries(toes), Materials.duckBill()));

    hip.add(foot);
    return { hip, foot };
  };

  const left = makeLeg(-1);
  const right = makeLeg(1);
  pelvis.add(left.hip);
  pelvis.add(right.hip);

  // ---- Held prop ----
  let prop: THREE.Group | null = null;
  if (role === 'engineer') {
    // A clipboard, held in the left wing.
    prop = new THREE.Group();
    const board = mesh(
      new THREE.BoxGeometry(S * 0.18, S * 0.24, S * 0.008),
      new THREE.MeshStandardMaterial({ color: 0xc9a86a, roughness: 0.85 }),
    );
    prop.add(board);

    const paper = mesh(
      new THREE.BoxGeometry(S * 0.155, S * 0.2, S * 0.004),
      Materials.plastic(),
    );
    paper.position.z = S * 0.006;
    prop.add(paper);

    const clip = mesh(
      new THREE.BoxGeometry(S * 0.07, S * 0.022, S * 0.014),
      Materials.machinedAlloy(),
    );
    clip.position.set(0, S * 0.115, S * 0.008);
    prop.add(clip);

    // Rows of "writing" so the board is not blank.
    const lines: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 6; i++) {
      const g = new THREE.BoxGeometry(S * 0.11, S * 0.005, S * 0.002);
      g.translate(-S * 0.01, S * 0.07 - i * S * 0.025, S * 0.009);
      lines.push(g);
    }
    prop.add(mesh(mergeGeometries(lines), Materials.darkPlastic(), false, false));

    prop.position.set(-S * 0.05, -S * 0.16, S * 0.1);
    prop.rotation.set(-0.9, 0.3, 0.2);
    leftWing.add(prop);
  } else {
    // A ruggedised tablet with a lit screen.
    prop = new THREE.Group();
    const shell = mesh(
      new THREE.BoxGeometry(S * 0.2, S * 0.15, S * 0.014),
      Materials.darkPlastic(),
    );
    prop.add(shell);

    const bumper = mesh(
      new THREE.BoxGeometry(S * 0.21, S * 0.16, S * 0.01),
      Materials.agencyOrange(),
    );
    bumper.position.z = -S * 0.004;
    prop.add(bumper);

    const screen = mesh(
      new THREE.BoxGeometry(S * 0.175, S * 0.125, S * 0.004),
      Materials.emissive(0x36a8e0, 0.7),
      false,
      false,
    );
    screen.position.z = S * 0.009;
    prop.add(screen);

    prop.position.set(S * 0.05, -S * 0.16, S * 0.11);
    prop.rotation.set(-1.0, -0.3, -0.2);
    rightWing.add(prop);
  }

  // Everything casts and receives shadows so the characters sit in the world.
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.castShadow = true;
      m.receiveShadow = true;
    }
  });

  return {
    root,
    pelvis,
    spine,
    neck,
    head,
    bill: lowerBill,
    leftWing,
    rightWing,
    leftLeg: left.hip,
    rightLeg: right.hip,
    leftFoot: left.foot,
    rightFoot: right.foot,
    prop,
    eyelids,
  };
}
