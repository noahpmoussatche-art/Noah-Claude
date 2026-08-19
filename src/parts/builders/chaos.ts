/**
 * CHAOS and DECORATION parts (spec §45).
 *
 * These are jokes, but the spec is explicit that they still get proper models —
 * and because they carry honest mass, drag and cost, strapping a refrigerator to
 * an upper stage is a real engineering decision with real consequences.
 */
import * as THREE from 'three';
import { Materials } from '../../render/materials';
import { mergeGeometries, mesh } from '../../render/geometry';

/** A two-seat couch with cushions, arms and feet. */
export function buildCouch(width: number): THREE.Object3D {
  const root = new THREE.Group();
  root.name = 'couch';
  const depth = width * 0.45;
  const seatH = width * 0.18;

  const fabricMat = new THREE.MeshStandardMaterial({
    color: 0x3f6b52,
    roughness: 0.92,
    metalness: 0,
  });

  const base = mesh(new THREE.BoxGeometry(width, seatH, depth), fabricMat);
  base.position.y = seatH * 1.4;
  root.add(base);

  // Seat cushions with a gap between them.
  for (const s of [-1, 1]) {
    const cushion = mesh(
      new THREE.BoxGeometry(width * 0.44, seatH * 0.5, depth * 0.86),
      fabricMat,
    );
    cushion.position.set(s * width * 0.24, seatH * 2.1, 0);
    root.add(cushion);
  }

  // Backrest, slightly reclined.
  const back = mesh(new THREE.BoxGeometry(width, width * 0.34, depth * 0.2), fabricMat);
  back.position.set(0, seatH * 2.6, -depth * 0.4);
  back.rotation.x = 0.12;
  root.add(back);

  // Arms.
  for (const s of [-1, 1]) {
    const arm = mesh(
      new THREE.BoxGeometry(width * 0.1, width * 0.22, depth),
      fabricMat,
    );
    arm.position.set(s * width * 0.45, seatH * 2.2, 0);
    root.add(arm);
  }

  // Feet.
  const feet: THREE.BufferGeometry[] = [];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const g = new THREE.CylinderGeometry(width * 0.03, width * 0.025, seatH * 0.9, 8);
      g.translate(sx * width * 0.42, seatH * 0.45, sz * depth * 0.36);
      feet.push(g);
    }
  }
  root.add(mesh(mergeGeometries(feet), Materials.darkPlastic()));

  return root;
}

/** A ceramic toilet, complete with cistern and seat. */
export function buildToilet(height: number): THREE.Object3D {
  const root = new THREE.Group();
  root.name = 'toilet';

  const ceramic = new THREE.MeshStandardMaterial({
    color: 0xf4f6f7,
    roughness: 0.18,
    metalness: 0.02,
  });

  // Pedestal, lathed so it has the real flared shape.
  const profile: THREE.Vector2[] = [
    new THREE.Vector2(height * 0.19, 0),
    new THREE.Vector2(height * 0.15, height * 0.08),
    new THREE.Vector2(height * 0.12, height * 0.24),
    new THREE.Vector2(height * 0.16, height * 0.4),
    new THREE.Vector2(height * 0.21, height * 0.46),
  ];
  const pedestal = mesh(new THREE.LatheGeometry(profile, 20), ceramic);
  root.add(pedestal);

  // Bowl.
  const bowl = mesh(
    new THREE.CylinderGeometry(height * 0.22, height * 0.19, height * 0.14, 20),
    ceramic,
  );
  bowl.position.y = height * 0.5;
  root.add(bowl);

  const rim = mesh(
    new THREE.TorusGeometry(height * 0.21, height * 0.03, 8, 20),
    ceramic,
  );
  rim.rotation.x = Math.PI / 2;
  rim.position.y = height * 0.57;
  root.add(rim);

  // Seat and lid.
  const seat = mesh(
    new THREE.TorusGeometry(height * 0.2, height * 0.025, 8, 20),
    Materials.plastic(),
  );
  seat.rotation.x = Math.PI / 2;
  seat.position.y = height * 0.6;
  root.add(seat);

  const lid = mesh(
    new THREE.CylinderGeometry(height * 0.22, height * 0.22, height * 0.025, 20),
    Materials.plastic(),
  );
  lid.position.set(0, height * 0.79, -height * 0.2);
  lid.rotation.x = -0.35;
  root.add(lid);

  // Cistern.
  const cistern = mesh(
    new THREE.BoxGeometry(height * 0.4, height * 0.34, height * 0.16),
    ceramic,
  );
  cistern.position.set(0, height * 0.8, -height * 0.28);
  root.add(cistern);

  const handle = mesh(
    new THREE.CylinderGeometry(height * 0.02, height * 0.02, height * 0.06, 8),
    Materials.machinedAlloy(),
  );
  handle.rotation.z = Math.PI / 2;
  handle.position.set(height * 0.15, height * 0.92, -height * 0.2);
  root.add(handle);

  return root;
}

/** A rubber duck — an in-universe merchandising item, not a character. */
export function buildRubberDuck(size: number): THREE.Object3D {
  const root = new THREE.Group();
  root.name = 'rubber-duck';

  const rubberYellow = new THREE.MeshStandardMaterial({
    color: 0xffd21f,
    roughness: 0.45,
    metalness: 0,
  });

  const body = mesh(new THREE.SphereGeometry(size * 0.5, 16, 12), rubberYellow);
  body.scale.set(1, 0.82, 1.25);
  root.add(body);

  const head = mesh(new THREE.SphereGeometry(size * 0.3, 14, 10), rubberYellow);
  head.position.set(0, size * 0.5, size * 0.28);
  root.add(head);

  const bill = mesh(new THREE.ConeGeometry(size * 0.13, size * 0.3, 10), Materials.duckBill());
  bill.rotation.x = Math.PI / 2;
  bill.position.set(0, size * 0.46, size * 0.6);
  root.add(bill);

  // Tail.
  const tail = mesh(new THREE.ConeGeometry(size * 0.16, size * 0.3, 8), rubberYellow);
  tail.rotation.x = -0.9;
  tail.position.set(0, size * 0.2, -size * 0.6);
  root.add(tail);

  // Eyes.
  for (const s of [-1, 1]) {
    const eye = mesh(new THREE.SphereGeometry(size * 0.05, 8, 6), Materials.duckEye());
    eye.position.set(s * size * 0.14, size * 0.6, size * 0.46);
    root.add(eye);
  }

  return root;
}

/** An office chair on a five-star base with castors. */
export function buildOfficeChair(height: number): THREE.Object3D {
  const root = new THREE.Group();
  root.name = 'office-chair';

  const upholstery = new THREE.MeshStandardMaterial({
    color: 0x2b2f36,
    roughness: 0.9,
    metalness: 0,
  });

  // Five-star base with castors.
  const legs: THREE.BufferGeometry[] = [];
  const castors: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const g = new THREE.BoxGeometry(height * 0.28, height * 0.03, height * 0.05);
    g.translate(height * 0.14, height * 0.05, 0);
    g.rotateY(-a);
    legs.push(g);

    const c = new THREE.SphereGeometry(height * 0.03, 8, 6);
    c.translate(Math.sin(a) * height * 0.27, height * 0.03, Math.cos(a) * height * 0.27);
    castors.push(c);
  }
  root.add(mesh(mergeGeometries(legs), Materials.darkPlastic()));
  root.add(mesh(mergeGeometries(castors), Materials.rubber()));

  // Gas cylinder.
  const column = mesh(
    new THREE.CylinderGeometry(height * 0.035, height * 0.045, height * 0.35, 12),
    Materials.machinedAlloy(),
  );
  column.position.y = height * 0.22;
  root.add(column);

  // Seat and back.
  const seat = mesh(
    new THREE.BoxGeometry(height * 0.4, height * 0.06, height * 0.38),
    upholstery,
  );
  seat.position.y = height * 0.42;
  root.add(seat);

  const back = mesh(
    new THREE.BoxGeometry(height * 0.38, height * 0.42, height * 0.05),
    upholstery,
  );
  back.position.set(0, height * 0.66, -height * 0.17);
  back.rotation.x = 0.14;
  root.add(back);

  // Armrests.
  for (const s of [-1, 1]) {
    const arm = mesh(
      new THREE.BoxGeometry(height * 0.04, height * 0.03, height * 0.26),
      Materials.darkPlastic(),
    );
    arm.position.set(s * height * 0.22, height * 0.56, 0);
    root.add(arm);
  }

  return root;
}

/** A flat-panel television on a stand. */
export function buildTelevision(width: number): THREE.Object3D {
  const root = new THREE.Group();
  root.name = 'television';
  const h = width * 0.58;

  const bezel = mesh(
    new THREE.BoxGeometry(width, h, width * 0.05),
    Materials.darkPlastic(),
  );
  bezel.position.y = h / 2 + width * 0.12;
  root.add(bezel);

  // A faintly glowing screen, so it reads as switched on.
  const screen = mesh(
    new THREE.BoxGeometry(width * 0.94, h * 0.9, width * 0.01),
    Materials.emissive(0x2a4a6a, 0.55),
    false,
    false,
  );
  screen.position.set(0, h / 2 + width * 0.12, width * 0.03);
  root.add(screen);

  // Stand.
  const neck = mesh(
    new THREE.BoxGeometry(width * 0.1, width * 0.12, width * 0.08),
    Materials.darkPlastic(),
  );
  neck.position.y = width * 0.08;
  root.add(neck);

  const foot = mesh(
    new THREE.BoxGeometry(width * 0.5, width * 0.03, width * 0.22),
    Materials.darkPlastic(),
  );
  foot.position.y = width * 0.015;
  root.add(foot);

  return root;
}

/** A domestic refrigerator with two doors and handles. */
export function buildRefrigerator(height: number): THREE.Object3D {
  const root = new THREE.Group();
  root.name = 'refrigerator';
  const w = height * 0.44;
  const d = height * 0.4;

  const shell = new THREE.MeshStandardMaterial({
    color: 0xd9dde1,
    roughness: 0.32,
    metalness: 0.55,
  });

  const body = mesh(new THREE.BoxGeometry(w, height, d), shell);
  body.position.y = height / 2;
  root.add(body);

  // Freezer / fridge door split.
  const split = mesh(
    new THREE.BoxGeometry(w * 1.01, height * 0.012, d * 1.01),
    Materials.darkPlastic(),
  );
  split.position.y = height * 0.66;
  root.add(split);

  // Handles.
  for (const y of [height * 0.8, height * 0.42]) {
    const handle = mesh(
      new THREE.CylinderGeometry(height * 0.012, height * 0.012, height * 0.16, 8),
      Materials.machinedAlloy(),
    );
    handle.position.set(w * 0.36, y, d * 0.53);
    root.add(handle);
  }

  // Feet.
  const feet: THREE.BufferGeometry[] = [];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const g = new THREE.CylinderGeometry(height * 0.02, height * 0.02, height * 0.02, 6);
      g.translate(sx * w * 0.4, height * 0.01, sz * d * 0.4);
      feet.push(g);
    }
  }
  root.add(mesh(mergeGeometries(feet), Materials.darkPlastic()));

  return root;
}

/** A traffic cone, correctly proportioned with a reflective band. */
export function buildTrafficCone(height: number): THREE.Object3D {
  const root = new THREE.Group();
  root.name = 'traffic-cone';

  const orange = new THREE.MeshStandardMaterial({
    color: 0xf1601a,
    roughness: 0.7,
    metalness: 0,
  });

  // Square base slab.
  const base = mesh(
    new THREE.BoxGeometry(height * 0.52, height * 0.05, height * 0.52),
    orange,
  );
  base.position.y = height * 0.025;
  root.add(base);

  // Tapered body, lathed with the real concave profile.
  const profile: THREE.Vector2[] = [];
  const steps = 8;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const r = height * 0.2 * Math.pow(1 - t, 1.35) + height * 0.02;
    profile.push(new THREE.Vector2(r, height * 0.05 + t * height * 0.95));
  }
  root.add(mesh(new THREE.LatheGeometry(profile, 16), orange));

  // Reflective collar.
  const band = mesh(
    new THREE.CylinderGeometry(height * 0.13, height * 0.15, height * 0.14, 16, 1, true),
    Materials.emissive(0xdfe6ea, 0.5),
    false,
    false,
  );
  band.position.y = height * 0.6;
  root.add(band);

  return root;
}

/** A potted plant, because someone insisted it was flight hardware. */
export function buildPottedPlant(height: number): THREE.Object3D {
  const root = new THREE.Group();
  root.name = 'potted-plant';

  const terracotta = new THREE.MeshStandardMaterial({
    color: 0xb0623c,
    roughness: 0.86,
    metalness: 0,
  });
  const foliage = new THREE.MeshStandardMaterial({
    color: 0x2f7a3f,
    roughness: 0.88,
    metalness: 0,
    flatShading: true,
  });

  const pot = mesh(
    new THREE.CylinderGeometry(height * 0.16, height * 0.12, height * 0.26, 14),
    terracotta,
  );
  pot.position.y = height * 0.13;
  root.add(pot);

  const rim = mesh(
    new THREE.TorusGeometry(height * 0.16, height * 0.018, 6, 14),
    terracotta,
  );
  rim.rotation.x = Math.PI / 2;
  rim.position.y = height * 0.26;
  root.add(rim);

  const soil = mesh(
    new THREE.CylinderGeometry(height * 0.145, height * 0.145, height * 0.02, 14),
    new THREE.MeshStandardMaterial({ color: 0x3a2b20, roughness: 1 }),
  );
  soil.position.y = height * 0.25;
  root.add(soil);

  // Leaves arranged around a short stem.
  const leaves: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const tilt = 0.5 + (i % 3) * 0.2;
    const g = new THREE.SphereGeometry(height * 0.13, 6, 4);
    g.scale(0.32, 0.1, 1);
    g.translate(0, 0, height * 0.14);
    g.rotateX(-tilt);
    g.rotateY(a);
    g.translate(0, height * (0.42 + (i % 3) * 0.08), 0);
    leaves.push(g);
  }
  root.add(mesh(mergeGeometries(leaves), foliage));

  const stem = mesh(
    new THREE.CylinderGeometry(height * 0.012, height * 0.016, height * 0.3, 6),
    foliage,
  );
  stem.position.y = height * 0.4;
  root.add(stem);

  return root;
}

/** A stack of mission-critical coffee cups. */
export function buildCoffeeMug(size: number): THREE.Object3D {
  const root = new THREE.Group();
  root.name = 'coffee-mug';

  const ceramic = new THREE.MeshStandardMaterial({
    color: 0xe8ecef,
    roughness: 0.25,
    metalness: 0.02,
  });

  const body = mesh(
    new THREE.CylinderGeometry(size * 0.4, size * 0.34, size, 18, 1, true),
    ceramic,
  );
  (body.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
  body.position.y = size / 2;
  root.add(body);

  const bottom = mesh(
    new THREE.CylinderGeometry(size * 0.34, size * 0.34, size * 0.06, 18),
    ceramic,
  );
  bottom.position.y = size * 0.03;
  root.add(bottom);

  // Coffee surface.
  const coffee = mesh(
    new THREE.CylinderGeometry(size * 0.36, size * 0.36, size * 0.02, 18),
    new THREE.MeshStandardMaterial({ color: 0x3a2114, roughness: 0.3 }),
  );
  coffee.position.y = size * 0.78;
  root.add(coffee);

  // Handle.
  const handle = mesh(
    new THREE.TorusGeometry(size * 0.2, size * 0.05, 8, 16, Math.PI * 1.3),
    ceramic,
  );
  handle.position.set(size * 0.42, size * 0.5, 0);
  handle.rotation.z = -Math.PI * 0.35;
  root.add(handle);

  return root;
}

/** A garden gnome. Nobody remembers approving this. */
export function buildGardenGnome(height: number): THREE.Object3D {
  const root = new THREE.Group();
  root.name = 'garden-gnome';

  const red = new THREE.MeshStandardMaterial({ color: 0xc42f2f, roughness: 0.8 });
  const blue = new THREE.MeshStandardMaterial({ color: 0x2f5fc4, roughness: 0.85 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xe8b98f, roughness: 0.75 });
  const white = new THREE.MeshStandardMaterial({ color: 0xf0f0ee, roughness: 0.9 });

  const bodyMesh = mesh(new THREE.ConeGeometry(height * 0.24, height * 0.5, 14), blue);
  bodyMesh.position.y = height * 0.25;
  root.add(bodyMesh);

  const head = mesh(new THREE.SphereGeometry(height * 0.14, 14, 10), skin);
  head.position.y = height * 0.58;
  root.add(head);

  // Beard.
  const beard = mesh(new THREE.ConeGeometry(height * 0.13, height * 0.26, 12), white);
  beard.position.set(0, height * 0.48, height * 0.05);
  beard.rotation.x = Math.PI;
  root.add(beard);

  // Pointed hat.
  const hat = mesh(new THREE.ConeGeometry(height * 0.16, height * 0.34, 14), red);
  hat.position.y = height * 0.82;
  root.add(hat);

  const nose = mesh(new THREE.SphereGeometry(height * 0.035, 8, 6), skin);
  nose.position.set(0, height * 0.57, height * 0.13);
  root.add(nose);

  return root;
}

/** A workshop toolbox — DECORATION, and genuinely useful set dressing. */
export function buildToolbox(width: number): THREE.Object3D {
  const root = new THREE.Group();
  root.name = 'toolbox';
  const h = width * 0.5;

  const red = new THREE.MeshStandardMaterial({
    color: 0xa8291f,
    roughness: 0.55,
    metalness: 0.3,
  });

  const body = mesh(new THREE.BoxGeometry(width, h * 0.7, width * 0.45), red);
  body.position.y = h * 0.35;
  root.add(body);

  const lid = mesh(new THREE.BoxGeometry(width * 1.02, h * 0.16, width * 0.47), red);
  lid.position.y = h * 0.78;
  root.add(lid);

  const handle = mesh(
    new THREE.TorusGeometry(width * 0.13, width * 0.02, 6, 14, Math.PI),
    Materials.machinedAlloy(),
  );
  handle.position.y = h * 0.86;
  handle.rotation.y = Math.PI / 2;
  root.add(handle);

  // Latches.
  for (const s of [-1, 1]) {
    const latch = mesh(
      new THREE.BoxGeometry(width * 0.08, h * 0.14, width * 0.03),
      Materials.machinedAlloy(),
    );
    latch.position.set(s * width * 0.33, h * 0.68, width * 0.24);
    root.add(latch);
  }

  return root;
}
