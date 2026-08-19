/**
 * Interior environments: the vehicle assembly workshop (spec §22) and mission
 * control (spec §23).
 *
 * Both were empty screens in the prototype. The workshop is now a real high-bay
 * with a gantry crane, robotic arms on rails, part racks, workbenches, a floor
 * pit and a service vehicle — and it is scaled so a 55 m vehicle stands inside
 * it. Mission control is a tiered room with consoles, a projection wall, and a
 * blast window looking out at the pad.
 */
import * as THREE from 'three';
import { Materials } from '../render/materials';
import { braceBetween, mergeGeometries, mesh, trussTower } from '../render/geometry';
import { Rng } from '../utils/math';
import { PART_CATALOG } from '../data/catalog';
import { PartCategory } from '../parts/PartDef';

export interface WorkshopRefs {
  readonly root: THREE.Group;
  /** Where the vehicle under construction stands. */
  readonly assemblyPoint: THREE.Vector3;
  /** Gantry crane, animated to move along the bay. */
  readonly crane: THREE.Group;
  /** Robotic arms that idle-animate. */
  readonly arms: THREE.Group[];
  /** Marks where the crew stand. */
  readonly crewMarks: THREE.Vector3[];
  readonly lights: THREE.Light[];
}

const BAY_WIDTH = 58;
const BAY_LENGTH = 92;
const BAY_HEIGHT = 72;

export function buildWorkshop(seed = 771): WorkshopRefs {
  const root = new THREE.Group();
  root.name = 'workshop';
  const rng = new Rng(seed);
  const arms: THREE.Group[] = [];
  const lights: THREE.Light[] = [];

  // -------------------------------------------------------------------------
  // Shell
  // -------------------------------------------------------------------------
  const floorMat = new THREE.MeshStandardMaterial({
    color: 0x53575c,
    roughness: 0.82,
    metalness: 0.1,
  });
  const floor = mesh(new THREE.BoxGeometry(BAY_WIDTH, 0.6, BAY_LENGTH), floorMat, false, true);
  floor.position.y = -0.3;
  root.add(floor);

  // Painted safety zones on the floor.
  const zone = mesh(
    new THREE.RingGeometry(9, 10.2, 48),
    new THREE.MeshStandardMaterial({ color: 0xd8a32a, roughness: 0.9 }),
    false,
    true,
  );
  zone.rotation.x = -Math.PI / 2;
  zone.position.y = 0.02;
  root.add(zone);

  const hazardStripes: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    const g = new THREE.BoxGeometry(1.5, 0.02, 0.6);
    g.translate(12.5, 0.03, 0);
    g.rotateY(-a);
    hazardStripes.push(g);
  }
  root.add(
    mesh(
      mergeGeometries(hazardStripes),
      new THREE.MeshStandardMaterial({ color: 0x1b1d20, roughness: 0.9 }),
      false,
      true,
    ),
  );

  // Assembly pit, so the vehicle base sits below floor level.
  const pit = mesh(
    new THREE.CylinderGeometry(7.5, 7.5, 5, 24, 1, true),
    Materials.structuralSteel(),
  );
  pit.position.y = -2.5;
  root.add(pit);

  // Walls.
  const wallMat = new THREE.MeshStandardMaterial({
    color: 0x8f959b,
    roughness: 0.85,
    metalness: 0.12,
    side: THREE.BackSide,
  });
  const shell = mesh(
    new THREE.BoxGeometry(BAY_WIDTH, BAY_HEIGHT, BAY_LENGTH),
    wallMat,
    false,
    true,
  );
  shell.position.y = BAY_HEIGHT / 2 - 0.3;
  root.add(shell);

  // Structural ribs up the walls and across the ceiling.
  const ribs: THREE.BufferGeometry[] = [];
  for (let i = 0; i <= 8; i++) {
    const z = (i / 8 - 0.5) * BAY_LENGTH * 0.96;
    for (const s of [-1, 1]) {
      const g = new THREE.BoxGeometry(0.7, BAY_HEIGHT, 0.9);
      g.translate((s * BAY_WIDTH) / 2 - s * 0.5, BAY_HEIGHT / 2, z);
      ribs.push(g);
    }
    const beam = new THREE.BoxGeometry(BAY_WIDTH, 0.9, 0.9);
    beam.translate(0, BAY_HEIGHT - 1, z);
    ribs.push(beam);
  }
  root.add(mesh(mergeGeometries(ribs), Materials.structuralSteel(), false, true));

  // High windows along one wall, letting daylight in.
  const windows: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 8; i++) {
    const g = new THREE.BoxGeometry(0.3, 7, 8);
    g.translate(-BAY_WIDTH / 2 + 0.4, BAY_HEIGHT * 0.72, (i / 7 - 0.5) * BAY_LENGTH * 0.82);
    windows.push(g);
  }
  root.add(mesh(mergeGeometries(windows), Materials.glass(), false, false));

  // -------------------------------------------------------------------------
  // Gantry crane
  // -------------------------------------------------------------------------
  const crane = new THREE.Group();
  crane.position.y = BAY_HEIGHT - 8;

  const craneBridge = mesh(
    new THREE.BoxGeometry(BAY_WIDTH - 2, 2.2, 4.5),
    Materials.agencyOrange(),
  );
  crane.add(craneBridge);

  const craneTruss = mesh(
    trussTower(3.4, BAY_WIDTH - 4, 9, 0.16),
    Materials.agencyOrange(),
  );
  craneTruss.rotation.z = Math.PI / 2;
  craneTruss.position.set((BAY_WIDTH - 4) / 2, -2.4, 0);
  crane.add(craneTruss);

  // Trolley and hook block.
  const trolley = mesh(new THREE.BoxGeometry(4, 2, 4), Materials.structuralSteel());
  trolley.position.set(4, -3.4, 0);
  crane.add(trolley);

  const hookCable = mesh(
    new THREE.CylinderGeometry(0.08, 0.08, 26, 6),
    Materials.darkPlastic(),
  );
  hookCable.position.set(4, -17, 0);
  crane.add(hookCable);

  const hookBlock = mesh(new THREE.BoxGeometry(1.6, 2.2, 1.6), Materials.machinedAlloy());
  hookBlock.position.set(4, -31, 0);
  crane.add(hookBlock);

  root.add(crane);

  // Crane rails.
  const rails: THREE.BufferGeometry[] = [];
  for (const s of [-1, 1]) {
    const g = new THREE.BoxGeometry(1.2, 0.8, BAY_LENGTH * 0.96);
    g.translate((s * BAY_WIDTH) / 2 - s * 1.6, BAY_HEIGHT - 6.4, 0);
    rails.push(g);
  }
  root.add(mesh(mergeGeometries(rails), Materials.structuralSteel(), false, true));

  // -------------------------------------------------------------------------
  // Service gantries flanking the assembly point
  // -------------------------------------------------------------------------
  //
  // These are two free-standing service towers, not a row of floating slabs.
  // Each tower has four corner columns running floor to roof, horizontal
  // stringers tying the columns together at every deck, diagonal bracing in the
  // outer bay, and only then the decks themselves — which are grating with a
  // toe board and a handrail. Everything a deck carries is transferred into a
  // column, so nothing in the bay is unsupported: a work platform hanging in
  // mid-air was the single most artificial thing in the room.
  const LEVELS = 6;
  const LEVEL_RISE = 9;
  const FIRST_DECK = 6;
  const TOWER_X = 16; // centre-line of each tower
  const DECK_W = 13; // across the aisle
  const DECK_L = 22; // along the bay
  const TOP = FIRST_DECK + (LEVELS - 1) * LEVEL_RISE;

  const towerSteel: THREE.BufferGeometry[] = [];
  const towerGrate: THREE.BufferGeometry[] = [];
  const towerRail: THREE.BufferGeometry[] = [];

  for (const s of [-1, 1]) {
    const cx = s * TOWER_X;
    const xIn = cx - (s * DECK_W) / 2; // edge facing the vehicle
    const xOut = cx + (s * DECK_W) / 2; // edge facing the wall

    // ---- Corner columns, floor to just above the top deck ----
    const colH = TOP + 3;
    for (const x of [xIn, xOut]) {
      for (const z of [-DECK_L / 2, DECK_L / 2]) {
        const g = new THREE.BoxGeometry(0.55, colH, 0.55);
        g.translate(x, colH / 2, z);
        towerSteel.push(g);
      }
    }

    // ---- Per-level structure ----
    for (let level = 0; level < LEVELS; level++) {
      const y = FIRST_DECK + level * LEVEL_RISE;

      // Stringers: the beams the deck actually sits on, column to column.
      for (const z of [-DECK_L / 2, DECK_L / 2]) {
        const g = new THREE.BoxGeometry(DECK_W, 0.5, 0.4);
        g.translate(cx, y - 0.4, z);
        towerSteel.push(g);
      }
      for (const x of [xIn, xOut]) {
        const g = new THREE.BoxGeometry(0.4, 0.5, DECK_L);
        g.translate(x, y - 0.4, 0);
        towerSteel.push(g);
      }
      // Cross joists under the deck, visible from below.
      for (let j = 1; j < 6; j++) {
        const g = new THREE.BoxGeometry(DECK_W, 0.32, 0.24);
        g.translate(cx, y - 0.35, -DECK_L / 2 + (j / 6) * DECK_L);
        towerSteel.push(g);
      }

      // Deck grating.
      const deck = new THREE.BoxGeometry(DECK_W, 0.14, DECK_L);
      deck.translate(cx, y, 0);
      towerGrate.push(deck);

      // Retractable inner section reaching toward the vehicle, carried on two
      // cantilever arms off the inner columns.
      const reachLen = 6;
      const reachX = xIn - s * (reachLen / 2);
      const reach = new THREE.BoxGeometry(reachLen, 0.12, 10);
      reach.translate(reachX, y, 0);
      towerGrate.push(reach);
      for (const z of [-4.6, 4.6]) {
        const arm = new THREE.BoxGeometry(reachLen, 0.34, 0.22);
        arm.translate(reachX, y - 0.28, z);
        towerSteel.push(arm);
      }

      // Handrail: top rail, mid rail and stanchions around the outer three
      // sides. The inner edge is left open — that is the working face.
      const railRuns: Array<[number, number, number, number]> = [
        // [x, z, length, axis] axis 0 = along Z, 1 = along X
        [xOut, 0, DECK_L, 0],
        [cx, -DECK_L / 2, DECK_W, 1],
        [cx, DECK_L / 2, DECK_W, 1],
      ];
      for (const [rx, rz, len, axis] of railRuns) {
        for (const h of [0.55, 1.05]) {
          const g =
            axis === 0
              ? new THREE.BoxGeometry(0.07, 0.07, len)
              : new THREE.BoxGeometry(len, 0.07, 0.07);
          g.translate(rx, y + h, rz);
          towerRail.push(g);
        }
        const posts = Math.max(3, Math.round(len / 2.2));
        for (let p = 0; p <= posts; p++) {
          const t = p / posts - 0.5;
          const g = new THREE.BoxGeometry(0.07, 1.05, 0.07);
          g.translate(
            axis === 0 ? rx : cx + t * len,
            y + 0.52,
            axis === 0 ? t * len : rz,
          );
          towerRail.push(g);
        }
        // Toe board along the deck edge.
        const toe =
          axis === 0
            ? new THREE.BoxGeometry(0.06, 0.22, len)
            : new THREE.BoxGeometry(len, 0.22, 0.06);
        toe.translate(rx, y + 0.11, rz);
        towerRail.push(toe);
      }

      // ---- Diagonal bracing in the outer bay, between this deck and the next
      // one down. Alternating direction, so the tower reads as braced steel.
      if (level > 0) {
        const yLow = y - LEVEL_RISE;
        for (const z of [-DECK_L / 2, DECK_L / 2]) {
          const dir = level % 2 === 0 ? 1 : -1;
          const a = new THREE.Vector3(xIn, yLow, z);
          const b = new THREE.Vector3(xOut, y, z);
          if (dir < 0) {
            a.set(xOut, yLow, z);
            b.set(xIn, y, z);
          }
          towerSteel.push(braceBetween(a, b, 0.22));
        }
        // One brace in the plane along the bay, on the outer face.
        const a = new THREE.Vector3(xOut, yLow, -DECK_L / 2);
        const b = new THREE.Vector3(xOut, y, DECK_L / 2);
        towerSteel.push(braceBetween(a, b, 0.2));
      }
    }

    // ---- Access stair zig-zagging up the outer face of the tower ----
    for (let level = 0; level < LEVELS; level++) {
      const yBase = level === 0 ? 0 : FIRST_DECK + (level - 1) * LEVEL_RISE;
      const rise = level === 0 ? FIRST_DECK : LEVEL_RISE;
      const steps = Math.round(rise / 0.42);
      const dir = level % 2 === 0 ? 1 : -1;
      const stairX = xOut + s * 1.7;
      for (let i = 0; i < steps; i++) {
        const t = i / steps;
        const g = new THREE.BoxGeometry(2.6, 0.1, 0.42);
        g.translate(stairX, yBase + 0.3 + t * rise, dir * (t - 0.5) * (DECK_L * 0.8));
        towerGrate.push(g);
      }
      // Stair stringer.
      const a = new THREE.Vector3(stairX, yBase + 0.1, -dir * DECK_L * 0.4);
      const b = new THREE.Vector3(stairX, yBase + rise, dir * DECK_L * 0.4);
      towerSteel.push(braceBetween(a, b, 0.24));
    }
  }

  root.add(mesh(mergeGeometries(towerSteel), Materials.structuralSteel(), true, true));
  root.add(mesh(mergeGeometries(towerGrate), Materials.deckGrating(), true, true));
  root.add(mesh(mergeGeometries(towerRail), Materials.agencyOrange(), false, true));

  // -------------------------------------------------------------------------
  // Robotic arms on floor rails
  // -------------------------------------------------------------------------
  for (let i = 0; i < 3; i++) {
    const arm = buildWorkshopArm();
    arm.position.set(
      i % 2 === 0 ? -19 : 19,
      0,
      -22 + i * 20,
    );
    arm.rotation.y = i % 2 === 0 ? 0.6 : -0.6;
    root.add(arm);
    arms.push(arm);
  }

  // -------------------------------------------------------------------------
  // Part racks — stocked with actual catalogue models (spec §22)
  // -------------------------------------------------------------------------
  root.add(buildPartRacks(new THREE.Vector3(0, 0, -BAY_LENGTH / 2 + 9), rng));
  root.add(buildWorkbenches(new THREE.Vector3(BAY_WIDTH / 2 - 7, 0, 22), rng));

  // A forklift parked in the bay.
  root.add(buildForklift(new THREE.Vector3(-17, 0, 32), 0.8));

  // -------------------------------------------------------------------------
  // Lighting (spec §57)
  // -------------------------------------------------------------------------
  const ambient = new THREE.HemisphereLight(0xcfe0ee, 0x40444a, 1.35);
  root.add(ambient);
  lights.push(ambient);

  // High-bay luminaires.
  for (let i = 0; i < 6; i++) {
    const z = (i / 5 - 0.5) * BAY_LENGTH * 0.78;
    for (const s of [-1, 1]) {
      const fixture = mesh(
        new THREE.BoxGeometry(3.2, 0.4, 1.6),
        Materials.emissive(0xfff4e2, 1.2),
        false,
        false,
      );
      fixture.position.set(s * 17, BAY_HEIGHT - 3, z);
      root.add(fixture);
    }

    const lamp = new THREE.PointLight(0xffeedd, 2.6, 120, 2);
    lamp.position.set(0, BAY_HEIGHT - 6, z);
    root.add(lamp);
    lights.push(lamp);
  }

  // A key light so the vehicle has direction and shadows.
  const key = new THREE.DirectionalLight(0xdfe9f5, 2.4);
  key.position.set(-38, 66, 40);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 5;
  key.shadow.camera.far = 220;
  key.shadow.camera.left = -60;
  key.shadow.camera.right = 60;
  key.shadow.camera.top = 90;
  key.shadow.camera.bottom = -20;
  key.shadow.bias = -0.0006;
  root.add(key);
  root.add(key.target);
  lights.push(key);

  return {
    root,
    assemblyPoint: new THREE.Vector3(0, 0, 0),
    crane,
    arms,
    crewMarks: [new THREE.Vector3(-8, 0, 15), new THREE.Vector3(-5.4, 0, 16.5)],
    lights,
  };
}

function buildWorkshopArm(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'workshop-arm';

  // Rail base.
  const base = mesh(new THREE.BoxGeometry(4, 1, 4), Materials.structuralSteel());
  base.position.y = 0.5;
  g.add(base);

  const column = mesh(
    new THREE.CylinderGeometry(1.2, 1.5, 6, 14),
    Materials.agencyAccent(),
  );
  column.position.y = 4;
  g.add(column);

  // Shoulder → upper → forearm → wrist, each in its own group so the idle
  // animation can articulate them.
  const shoulder = new THREE.Group();
  shoulder.name = 'arm-shoulder';
  shoulder.position.y = 7;
  g.add(shoulder);

  const upper = mesh(
    new THREE.BoxGeometry(1.6, 11, 1.6),
    Materials.hullWhite(),
  );
  upper.position.y = 5.5;
  shoulder.add(upper);

  const elbow = new THREE.Group();
  elbow.name = 'arm-elbow';
  elbow.position.y = 11;
  shoulder.add(elbow);

  const joint = mesh(new THREE.SphereGeometry(1.1, 12, 8), Materials.machinedAlloy());
  elbow.add(joint);

  const forearm = mesh(new THREE.BoxGeometry(1.3, 9, 1.3), Materials.hullWhite());
  forearm.position.y = 4.5;
  elbow.add(forearm);

  const wrist = new THREE.Group();
  wrist.name = 'arm-wrist';
  wrist.position.y = 9;
  elbow.add(wrist);

  const tool = mesh(
    new THREE.CylinderGeometry(0.8, 0.5, 1.8, 10),
    Materials.machinedAlloy(),
  );
  wrist.add(tool);

  // Welding tip that glows.
  const tip = mesh(
    new THREE.SphereGeometry(0.22, 8, 6),
    Materials.emissive(0x8fd4ff, 1.8),
    false,
    false,
  );
  tip.name = 'weld-tip';
  tip.position.y = -1.1;
  wrist.add(tip);

  // Cable loom along the arm.
  const loom = mesh(
    new THREE.CylinderGeometry(0.18, 0.18, 10, 6),
    Materials.darkPlastic(),
  );
  loom.position.set(1, 5.5, 0);
  shoulder.add(loom);

  // Default pose.
  shoulder.rotation.z = 0.35;
  elbow.rotation.z = -0.85;

  return g;
}

function buildPartRacks(position: THREE.Vector3, rng: Rng): THREE.Group {
  const g = new THREE.Group();
  g.position.copy(position);

  // Racking frame.
  const frame: THREE.BufferGeometry[] = [];
  const rackW = 40;
  const rackH = 14;
  for (let i = 0; i <= 8; i++) {
    const post = new THREE.BoxGeometry(0.4, rackH, 0.4);
    post.translate((i / 8 - 0.5) * rackW, rackH / 2, 0);
    frame.push(post);
    const post2 = post.clone();
    post2.translate(0, 0, -4);
    frame.push(post2);
  }
  for (let s = 0; s < 4; s++) {
    const shelf = new THREE.BoxGeometry(rackW, 0.25, 4.4);
    shelf.translate(0, 1 + s * 4, -2);
    frame.push(shelf);
  }
  g.add(mesh(mergeGeometries(frame), Materials.agencyOrange(), false, true));

  // Stock the shelves with real parts from the catalogue, scaled to fit.
  const shelfCandidates = PART_CATALOG.filter(
    (p) =>
      p.category === PartCategory.PROPULSION ||
      p.category === PartCategory.AVIONICS ||
      p.category === PartCategory.POWER ||
      p.category === PartCategory.COMMUNICATION ||
      p.category === PartCategory.SCIENCE ||
      p.category === PartCategory.DECORATION,
  );

  for (let s = 0; s < 4; s++) {
    for (let i = 0; i < 6; i++) {
      const def = rng.pick(shelfCandidates);
      const obj = def.build({ stackDiameter: 2, seed: rng.int(0, 1e6) });

      // Normalise to fit the shelf without clipping through it.
      const box = new THREE.Box3().setFromObject(obj);
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z, 0.01);
      const scale = Math.min(3.2 / maxDim, 1);
      obj.scale.setScalar(scale);

      obj.position.set(
        (i / 5 - 0.5) * rackW * 0.86 + rng.range(-0.6, 0.6),
        1.15 + s * 4 - box.min.y * scale,
        -2 + rng.range(-0.5, 0.5),
      );
      obj.rotation.y = rng.range(0, Math.PI * 2);
      g.add(obj);
    }
  }

  // Shipping crates stacked beside the racks.
  const crates: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 12; i++) {
    const w = rng.range(1.6, 3.2);
    const c = new THREE.BoxGeometry(w, w * 0.7, w * 0.9);
    c.translate(rackW / 2 + rng.range(3, 12), (w * 0.7) / 2 + (i % 2) * w * 0.7, rng.range(-4, 6));
    c.rotateY(rng.range(-0.3, 0.3));
    crates.push(c);
  }
  g.add(
    mesh(
      mergeGeometries(crates),
      new THREE.MeshStandardMaterial({ color: 0x9c8058, roughness: 0.92 }),
      true,
      true,
    ),
  );

  return g;
}

function buildWorkbenches(position: THREE.Vector3, rng: Rng): THREE.Group {
  const g = new THREE.Group();
  g.position.copy(position);

  for (let i = 0; i < 3; i++) {
    const bench = new THREE.Group();
    bench.position.z = i * 9;

    const top = mesh(new THREE.BoxGeometry(3, 0.14, 7), Materials.machinedAlloy());
    top.position.y = 0.95;
    bench.add(top);

    const legs: THREE.BufferGeometry[] = [];
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const l = new THREE.BoxGeometry(0.16, 0.95, 0.16);
        l.translate(sx * 1.3, 0.48, sz * 3.2);
        legs.push(l);
      }
    }
    bench.add(mesh(mergeGeometries(legs), Materials.structuralSteel()));

    // Tools and clutter on the bench.
    const clutter: THREE.BufferGeometry[] = [];
    for (let c = 0; c < 7; c++) {
      const w = rng.range(0.12, 0.4);
      const item = new THREE.BoxGeometry(w, rng.range(0.08, 0.3), w * rng.range(0.6, 2.4));
      item.translate(rng.range(-1.1, 1.1), 1.1, rng.range(-3, 3));
      item.rotateY(rng.range(0, Math.PI));
      clutter.push(item);
    }
    bench.add(mesh(mergeGeometries(clutter), Materials.darkPlastic()));

    // A monitor at the back of each bench.
    const monitor = mesh(
      new THREE.BoxGeometry(1.2, 0.7, 0.06),
      Materials.emissive(0x2c7fb8, 0.6),
      false,
      false,
    );
    monitor.position.set(-1.2, 1.6, 0);
    monitor.rotation.y = 0.5;
    bench.add(monitor);

    // Pegboard with hanging tools.
    const board = mesh(new THREE.BoxGeometry(0.1, 2, 6.6), Materials.darkPlastic());
    board.position.set(1.6, 2, 0);
    bench.add(board);

    const tools: THREE.BufferGeometry[] = [];
    for (let t = 0; t < 9; t++) {
      const item = new THREE.BoxGeometry(0.05, rng.range(0.25, 0.6), rng.range(0.06, 0.16));
      item.translate(1.5, 2.2, -3 + t * 0.7);
      tools.push(item);
    }
    bench.add(mesh(mergeGeometries(tools), Materials.machinedAlloy()));

    g.add(bench);
  }

  return g;
}

function buildForklift(position: THREE.Vector3, rotation: number): THREE.Group {
  const g = new THREE.Group();
  g.position.copy(position);
  g.rotation.y = rotation;

  const body = mesh(
    new THREE.BoxGeometry(1.8, 1.4, 3),
    new THREE.MeshStandardMaterial({ color: 0xd8a520, roughness: 0.6, metalness: 0.3 }),
  );
  body.position.y = 1;
  g.add(body);

  const cage = mesh(new THREE.BoxGeometry(1.7, 1.6, 1.6), Materials.structuralSteel());
  cage.position.set(0, 2.4, -0.4);
  g.add(cage);

  // Mast and forks.
  const mast: THREE.BufferGeometry[] = [];
  for (const s of [-1, 1]) {
    const m = new THREE.BoxGeometry(0.18, 3.6, 0.18);
    m.translate(s * 0.6, 1.8, 1.6);
    mast.push(m);
  }
  g.add(mesh(mergeGeometries(mast), Materials.structuralSteel()));

  const forks: THREE.BufferGeometry[] = [];
  for (const s of [-1, 1]) {
    const f = new THREE.BoxGeometry(0.14, 0.1, 1.4);
    f.translate(s * 0.4, 0.2, 2.4);
    forks.push(f);
  }
  g.add(mesh(mergeGeometries(forks), Materials.machinedAlloy()));

  const wheels: THREE.BufferGeometry[] = [];
  for (const z of [1.1, -1]) {
    for (const s of [-1, 1]) {
      const w = new THREE.CylinderGeometry(0.42, 0.42, 0.3, 12);
      w.rotateZ(Math.PI / 2);
      w.translate(s * 0.85, 0.42, z);
      wheels.push(w);
    }
  }
  g.add(mesh(mergeGeometries(wheels), Materials.rubber()));

  return g;
}

// ---------------------------------------------------------------------------
// Mission control (spec §23)
// ---------------------------------------------------------------------------

export interface ControlRoomRefs {
  readonly root: THREE.Group;
  /** Screens whose content is driven by live telemetry. */
  readonly screens: THREE.Mesh[];
  readonly crewMarks: THREE.Vector3[];
  readonly lights: THREE.Light[];
}

export function buildControlRoom(seed = 313): ControlRoomRefs {
  const root = new THREE.Group();
  root.name = 'control-room';
  const rng = new Rng(seed);
  const screens: THREE.Mesh[] = [];
  const lights: THREE.Light[] = [];

  const W = 34;
  const D = 26;
  const H = 7.5;

  // ---- Shell ----
  const floor = mesh(
    new THREE.BoxGeometry(W, 0.4, D),
    new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.9 }),
    false,
    true,
  );
  floor.position.y = -0.2;
  root.add(floor);

  const walls = mesh(
    new THREE.BoxGeometry(W, H, D),
    new THREE.MeshStandardMaterial({
      color: 0x3a4048,
      roughness: 0.88,
      side: THREE.BackSide,
    }),
    false,
    true,
  );
  walls.position.y = H / 2 - 0.2;
  root.add(walls);

  // Ceiling service grid.
  const grid: THREE.BufferGeometry[] = [];
  for (let i = 0; i <= 10; i++) {
    const b = new THREE.BoxGeometry(W, 0.16, 0.16);
    b.translate(0, H - 0.4, (i / 10 - 0.5) * D * 0.94);
    grid.push(b);
  }
  root.add(mesh(mergeGeometries(grid), Materials.darkPlastic(), false, false));

  // ---- Tiered console rows ----
  for (let row = 0; row < 3; row++) {
    const z = 2 + row * 5.2;
    const y = row * 0.75;

    // Riser platform.
    const riser = mesh(
      new THREE.BoxGeometry(W - 4, 0.75, 5),
      new THREE.MeshStandardMaterial({ color: 0x343941, roughness: 0.9 }),
      false,
      true,
    );
    riser.position.set(0, y - 0.37, z);
    root.add(riser);

    // Console desks.
    for (let i = 0; i < 4; i++) {
      const x = (i / 3 - 0.5) * (W - 12);
      const console = buildConsole(rng);
      console.position.set(x, y, z - 1.2);
      root.add(console);

      // The console screens are live surfaces.
      console.traverse((o) => {
        if (o.name === 'console-screen') screens.push(o as THREE.Mesh);
      });
    }
  }

  // ---- Projection wall (spec §23: mapas, telemetria) ----
  const wallFrame = mesh(
    new THREE.BoxGeometry(W - 6, 6.4, 0.4),
    Materials.darkPlastic(),
  );
  wallFrame.position.set(0, 3.6, -D / 2 + 0.6);
  root.add(wallFrame);

  // Three panels: trajectory map, vehicle telemetry, camera feed.
  const panelWidth = (W - 8) / 3 - 0.4;
  for (let i = 0; i < 3; i++) {
    const panel = mesh(
      new THREE.PlaneGeometry(panelWidth, 4.6),
      new THREE.MeshBasicMaterial({
        map: makeScreenTexture(i, rng),
        toneMapped: false,
      }),
      false,
      false,
    );
    panel.name = 'wall-screen';
    panel.position.set((i - 1) * (panelWidth + 0.4), 3.9, -D / 2 + 0.82);
    root.add(panel);
    screens.push(panel);

    // Each panel throws a little light into the room.
    const glow = new THREE.PointLight(i === 1 ? 0x4fd08a : 0x3f8fd0, 0.5, 22, 2);
    glow.position.set((i - 1) * (panelWidth + 0.4), 3.9, -D / 2 + 3);
    root.add(glow);
    lights.push(glow);
  }

  // ---- Blast window looking out at the pad ----
  const windowFrame = mesh(
    new THREE.BoxGeometry(W - 10, 3.4, 0.5),
    Materials.structuralSteel(),
  );
  windowFrame.position.set(0, 4.2, D / 2 - 0.4);
  root.add(windowFrame);

  const glazing = mesh(
    new THREE.PlaneGeometry(W - 11, 2.8),
    new THREE.MeshBasicMaterial({
      color: 0x8fb8d8,
      transparent: true,
      opacity: 0.34,
      side: THREE.DoubleSide,
    }),
    false,
    false,
  );
  glazing.position.set(0, 4.2, D / 2 - 0.66);
  root.add(glazing);

  // Mullions.
  const mullions: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 5; i++) {
    const m = new THREE.BoxGeometry(0.2, 3, 0.3);
    m.translate((i / 4 - 0.5) * (W - 11), 4.2, D / 2 - 0.55);
    mullions.push(m);
  }
  root.add(mesh(mergeGeometries(mullions), Materials.structuralSteel()));

  // ---- Clutter that makes it a workplace ----
  const chairs: THREE.Group[] = [];
  for (let row = 0; row < 3; row++) {
    for (let i = 0; i < 4; i++) {
      const chair = buildControlChair();
      chair.position.set(
        (i / 3 - 0.5) * (W - 12) + rng.range(-0.3, 0.3),
        row * 0.75,
        2 + row * 5.2 + 0.6,
      );
      chair.rotation.y = Math.PI + rng.range(-0.3, 0.3);
      root.add(chair);
      chairs.push(chair);
    }
  }

  // ---- Lighting: dim room, bright screens ----
  const ambient = new THREE.HemisphereLight(0x5a6c80, 0x1a1d22, 0.45);
  root.add(ambient);
  lights.push(ambient);

  for (let i = 0; i < 4; i++) {
    const strip = mesh(
      new THREE.BoxGeometry(W * 0.7, 0.12, 0.4),
      Materials.emissive(0xa8c8e8, 0.7),
      false,
      false,
    );
    strip.position.set(0, H - 0.7, (i / 3 - 0.5) * D * 0.7);
    root.add(strip);

    const lamp = new THREE.PointLight(0xa8c8e8, 0.35, 26, 2);
    lamp.position.set(0, H - 1.2, (i / 3 - 0.5) * D * 0.7);
    root.add(lamp);
    lights.push(lamp);
  }

  return {
    root,
    screens,
    crewMarks: [new THREE.Vector3(-3.2, 0, 9), new THREE.Vector3(-0.6, 0, 9.6)],
    lights,
  };
}

function buildConsole(rng: Rng): THREE.Group {
  const g = new THREE.Group();

  const desk = mesh(
    new THREE.BoxGeometry(4.2, 0.12, 1.7),
    new THREE.MeshStandardMaterial({ color: 0x4a5058, roughness: 0.7, metalness: 0.2 }),
  );
  desk.position.y = 0.78;
  g.add(desk);

  const body = mesh(
    new THREE.BoxGeometry(4, 0.78, 1.5),
    new THREE.MeshStandardMaterial({ color: 0x363b42, roughness: 0.85 }),
  );
  body.position.y = 0.39;
  g.add(body);

  // Two angled monitors.
  for (let i = 0; i < 2; i++) {
    const bezel = mesh(new THREE.BoxGeometry(1.7, 1.05, 0.07), Materials.darkPlastic());
    bezel.position.set((i - 0.5) * 1.85, 1.42, -0.42);
    bezel.rotation.x = -0.14;
    bezel.rotation.y = (i - 0.5) * -0.28;
    g.add(bezel);

    const screen = mesh(
      new THREE.PlaneGeometry(1.55, 0.9),
      new THREE.MeshBasicMaterial({
        map: makeScreenTexture(rng.int(3, 6), rng),
        toneMapped: false,
      }),
      false,
      false,
    );
    screen.name = 'console-screen';
    screen.position.set((i - 0.5) * 1.85, 1.42, -0.375);
    screen.rotation.x = -0.14;
    screen.rotation.y = (i - 0.5) * -0.28;
    g.add(screen);
  }

  // Keyboard and switch panel.
  const keyboard = mesh(new THREE.BoxGeometry(1.4, 0.05, 0.5), Materials.darkPlastic());
  keyboard.position.set(-0.6, 0.86, 0.3);
  g.add(keyboard);

  const switches: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 14; i++) {
    const s = new THREE.CylinderGeometry(0.035, 0.035, 0.06, 6);
    s.translate(0.9 + (i % 7) * 0.16, 0.87, 0.15 + Math.floor(i / 7) * 0.2);
    switches.push(s);
  }
  g.add(mesh(mergeGeometries(switches), Materials.agencyOrange(), false, false));

  // Indicator lamps.
  const lamps: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 6; i++) {
    const l = new THREE.SphereGeometry(0.04, 6, 4);
    l.translate(-1.7 + i * 0.18, 0.87, 0.45);
    lamps.push(l);
  }
  g.add(mesh(mergeGeometries(lamps), Materials.emissive(0x4fe08a, 1.4), false, false));

  // A mug, because of course.
  const mug = mesh(
    new THREE.CylinderGeometry(0.06, 0.05, 0.12, 10),
    Materials.plastic(),
  );
  mug.position.set(1.6, 0.9, 0.55);
  g.add(mug);

  return g;
}

function buildControlChair(): THREE.Group {
  const g = new THREE.Group();
  const fabric = new THREE.MeshStandardMaterial({ color: 0x2a2e34, roughness: 0.92 });

  const seat = mesh(new THREE.BoxGeometry(0.55, 0.09, 0.52), fabric);
  seat.position.y = 0.5;
  g.add(seat);

  const back = mesh(new THREE.BoxGeometry(0.52, 0.6, 0.08), fabric);
  back.position.set(0, 0.82, -0.24);
  back.rotation.x = 0.12;
  g.add(back);

  const post = mesh(
    new THREE.CylinderGeometry(0.05, 0.06, 0.44, 8),
    Materials.machinedAlloy(),
  );
  post.position.y = 0.26;
  g.add(post);

  const legs: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const l = new THREE.BoxGeometry(0.34, 0.04, 0.07);
    l.translate(0.17, 0.06, 0);
    l.rotateY(-a);
    legs.push(l);
  }
  g.add(mesh(mergeGeometries(legs), Materials.darkPlastic()));

  return g;
}

/**
 * Generates a screen texture: trajectory plots, telemetry strips, orbital maps.
 * Drawn once per screen so the room is full of different, plausible displays.
 */
function makeScreenTexture(variant: number, rng: Rng): THREE.Texture {
  const w = 512;
  const h = 320;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#071019';
  ctx.fillRect(0, 0, w, h);

  const accent = ['#4fd08a', '#3fa8e0', '#e0a83f', '#e05f5f'][variant % 4];

  // Grid.
  ctx.strokeStyle = 'rgba(80,140,180,0.16)';
  ctx.lineWidth = 1;
  for (let x = 0; x < w; x += 32) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let y = 0; y < h; y += 32) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  // Header bar.
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, w, 4);
  ctx.font = 'bold 15px monospace';
  ctx.fillStyle = accent;
  const titles = [
    'TRAJECTORY',
    'VEHICLE TELEMETRY',
    'PAD CAMERA 3',
    'PROPULSION',
    'GUIDANCE',
    'POWER BUS',
    'RANGE SAFETY',
  ];
  ctx.fillText(`OSA · ${titles[variant % titles.length]}`, 12, 26);

  if (variant % 3 === 0) {
    // An ascent trajectory curve.
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    for (let i = 0; i <= 60; i++) {
      const t = i / 60;
      const x = 20 + t * (w - 40);
      const y = h - 40 - Math.pow(t, 0.62) * (h - 90);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // A planned-vs-actual dashed line.
    ctx.setLineDash([6, 5]);
    ctx.strokeStyle = 'rgba(200,220,240,0.4)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (let i = 0; i <= 60; i++) {
      const t = i / 60;
      const x = 20 + t * (w - 40);
      const y = h - 44 - Math.pow(t, 0.58) * (h - 92);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  } else if (variant % 3 === 1) {
    // Scrolling telemetry strips.
    for (let s = 0; s < 4; s++) {
      const baseY = 60 + s * 62;
      ctx.strokeStyle = s === 0 ? accent : 'rgba(120,190,230,0.55)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      for (let x = 12; x < w - 12; x += 4) {
        const v = Math.sin(x * 0.05 + s * 2.2) * 12 + rng.signed() * 4;
        const y = baseY + v;
        if (x === 12) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      ctx.fillStyle = 'rgba(150,200,230,0.7)';
      ctx.font = '11px monospace';
      ctx.fillText(['ALT', 'VEL', 'ACC', 'PRP'][s], 14, baseY - 20);
    }
  } else {
    // A camera-feed style view with reticle and status text.
    ctx.fillStyle = 'rgba(30,52,68,0.7)';
    ctx.fillRect(14, 40, w - 28, h - 60);

    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.4;
    ctx.strokeRect(w / 2 - 60, h / 2 - 40, 120, 80);
    ctx.beginPath();
    ctx.moveTo(w / 2 - 16, h / 2);
    ctx.lineTo(w / 2 + 16, h / 2);
    ctx.moveTo(w / 2, h / 2 - 16);
    ctx.lineTo(w / 2, h / 2 + 16);
    ctx.stroke();

    ctx.fillStyle = accent;
    ctx.font = '12px monospace';
    ctx.fillText('● REC', 24, 62);
    ctx.fillText('LOCK', w - 70, h - 26);
  }

  // Status readout rows along the bottom.
  ctx.font = '11px monospace';
  ctx.fillStyle = 'rgba(160,210,240,0.75)';
  for (let i = 0; i < 3; i++) {
    ctx.fillText(
      `${['NOMINAL', 'ARMED', 'GO'][i]}  ${(rng.next() * 1000).toFixed(1)}`,
      14 + i * 150,
      h - 10,
    );
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
