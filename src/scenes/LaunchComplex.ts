/**
 * The launch complex (spec §20, §21).
 *
 * The prototype's environment was empty; this one is a working spaceport. The
 * governing idea is scale: the tower is 78 m, the pad deck is 64 m across, the
 * service vehicles are real-sized, and a 0.55 m duck standing at the perimeter
 * is a speck against all of it. Every dimension is in metres and consistent with
 * everything else in the game, which is what makes the sense of size read.
 */
import * as THREE from 'three';
import { Materials } from '../render/materials';
import {
  mergeGeometries,
  mesh,
  sphericalTank,
  trussTower,
} from '../render/geometry';
import { Rng } from '../utils/math';

export interface LaunchComplexRefs {
  readonly root: THREE.Group;
  /** World position of the pad surface where the vehicle sits. */
  readonly padCentre: THREE.Vector3;
  /** Height of the pad deck above the terrain, metres. */
  readonly padHeight: number;
  /** Height of the launch tower, metres. */
  readonly towerHeight: number;
  /** Service arms that retract before launch. */
  readonly serviceArms: THREE.Object3D[];
  /** Xenon pad floodlights, dimmed during the day. */
  readonly padLights: THREE.SpotLight[];
  /** Marks where the crew walk to during the pre-launch cinematic. */
  readonly crewMarks: THREE.Vector3[];
  /** Flame-trench exit, where the deflected exhaust erupts. */
  readonly trenchMouths: THREE.Vector3[];
}

const PAD_HEIGHT = 8;
const PAD_RADIUS = 32;
const TOWER_HEIGHT = 78;

export function buildLaunchComplex(seed = 4242): LaunchComplexRefs {
  const root = new THREE.Group();
  root.name = 'launch-complex';
  const rng = new Rng(seed);

  const serviceArms: THREE.Object3D[] = [];
  const padLights: THREE.SpotLight[] = [];

  // -------------------------------------------------------------------------
  // Terrain apron
  // -------------------------------------------------------------------------
  // 1.6 km was enough from the ground and not from the air: by three kilometres
  // up the site read as a grey disc floating in an orange sky. At twenty-five
  // kilometres the fog closes long before the edge does, in every shot the
  // launch site appears in.
  const ground = mesh(
    new THREE.CircleGeometry(25_000, 72),
    new THREE.MeshStandardMaterial({ color: 0x6d7359, roughness: 1, metalness: 0 }),
    false,
    true,
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.02;
  root.add(ground);

  // Scrub and low vegetation patches, so the ground is not a flat colour.
  const scrub: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 340; i++) {
    const a = rng.range(0, Math.PI * 2);
    const d = 90 + Math.sqrt(rng.next()) * 900;
    const s = rng.range(1.2, 4.5);
    const g = new THREE.SphereGeometry(s, 5, 3);
    g.scale(1, 0.35, 1);
    g.translate(Math.cos(a) * d, s * 0.2, Math.sin(a) * d);
    scrub.push(g);
  }
  root.add(
    mesh(
      mergeGeometries(scrub),
      new THREE.MeshStandardMaterial({ color: 0x59613f, roughness: 1, flatShading: true }),
      false,
      true,
    ),
  );

  // -------------------------------------------------------------------------
  // Launch mount: deck, flame trench and deflector
  // -------------------------------------------------------------------------
  const padGroup = new THREE.Group();
  root.add(padGroup);

  // Concrete apron.
  const apron = mesh(new THREE.CircleGeometry(PAD_RADIUS * 2.4, 48), Materials.concrete(), false, true);
  apron.rotation.x = -Math.PI / 2;
  apron.position.y = 0.01;
  padGroup.add(apron);

  // Raised pad deck.
  const deck = mesh(
    new THREE.CylinderGeometry(PAD_RADIUS, PAD_RADIUS * 1.06, PAD_HEIGHT, 8),
    Materials.concreteScorched(),
  );
  deck.position.y = PAD_HEIGHT / 2;
  padGroup.add(deck);

  // The deck has a central opening the exhaust falls through.
  const trenchOpening = mesh(
    new THREE.CylinderGeometry(8.5, 8.5, PAD_HEIGHT * 1.1, 20, 1, true),
    Materials.concreteScorched(),
  );
  trenchOpening.position.y = PAD_HEIGHT / 2;
  padGroup.add(trenchOpening);

  // Flame deflector: a wedge under the opening that throws exhaust sideways.
  const deflectorShape = new THREE.Shape();
  deflectorShape.moveTo(-14, 0);
  deflectorShape.lineTo(0, 6.5);
  deflectorShape.lineTo(14, 0);
  deflectorShape.closePath();
  const deflector = mesh(
    new THREE.ExtrudeGeometry(deflectorShape, { depth: 26, bevelEnabled: false }),
    Materials.concreteScorched(),
  );
  deflector.rotation.y = Math.PI / 2;
  deflector.position.set(0, 0.2, 13);
  padGroup.add(deflector);

  // Launch mount ring the vehicle actually stands on, with hold-down posts.
  const mountRing = mesh(
    new THREE.TorusGeometry(6.2, 0.85, 8, 28),
    Materials.structuralSteel(),
  );
  mountRing.rotation.x = Math.PI / 2;
  mountRing.position.y = PAD_HEIGHT + 0.6;
  padGroup.add(mountRing);

  const holdDowns: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const g = new THREE.BoxGeometry(1.5, 3.2, 1.5);
    g.translate(Math.sin(a) * 6.2, PAD_HEIGHT + 1.8, Math.cos(a) * 6.2);
    holdDowns.push(g);
  }
  padGroup.add(mesh(mergeGeometries(holdDowns), Materials.structuralSteel()));

  // ---- Water deluge system ----
  //
  // A sound-suppression deluge is a ring header lying on the deck with short
  // spray nozzles rising off it — not a picket fence. The previous version drew
  // twenty 2.6 m posts in bright agency blue standing around the mount, which
  // dominated every low shot of the pad and read as pure placeholder geometry.
  const deluge: THREE.BufferGeometry[] = [];

  // The header itself: a large-bore pipe running the full circle at deck level.
  const header = new THREE.TorusGeometry(11.5, 0.34, 8, 40);
  header.rotateX(Math.PI / 2);
  header.translate(0, PAD_HEIGHT + 0.42, 0);
  deluge.push(header);

  // Risers from the deck up to the header, carrying it clear of the surface.
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.2;
    const g = new THREE.BoxGeometry(0.4, 0.5, 0.4);
    g.translate(Math.sin(a) * 11.5, PAD_HEIGHT + 0.2, Math.cos(a) * 11.5);
    deluge.push(g);
  }

  // Spray nozzles: short stubs angled inward toward the flame trench, standing
  // only about half a metre proud of the header.
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const g = new THREE.CylinderGeometry(0.075, 0.13, 0.62, 6);
    // Lean inward, toward the mount.
    g.rotateX(0.42);
    g.translate(0, 0.3, 0);
    g.rotateY(-a);
    g.translate(Math.sin(a) * 11.5, PAD_HEIGHT + 0.5, Math.cos(a) * 11.5);
    deluge.push(g);
  }

  // Two supply mains feeding the header from the edge of the deck.
  for (const side of [1, -1]) {
    const g = new THREE.CylinderGeometry(0.42, 0.42, PAD_RADIUS - 11, 8);
    g.rotateZ(Math.PI / 2);
    g.translate(side * (11.5 + (PAD_RADIUS - 11) / 2), PAD_HEIGHT + 0.42, 0);
    deluge.push(g);
  }

  padGroup.add(mesh(mergeGeometries(deluge), Materials.groundPipework()));

  // Perimeter railings on the deck edge.
  const rails: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 64; i++) {
    const a = (i / 64) * Math.PI * 2;
    const g = new THREE.CylinderGeometry(0.09, 0.09, 1.2, 5);
    g.translate(Math.sin(a) * (PAD_RADIUS - 1), PAD_HEIGHT + 0.6, Math.cos(a) * (PAD_RADIUS - 1));
    rails.push(g);
  }
  const railTop = new THREE.TorusGeometry(PAD_RADIUS - 1, 0.07, 5, 64);
  railTop.rotateX(Math.PI / 2);
  railTop.translate(0, PAD_HEIGHT + 1.2, 0);
  rails.push(railTop);
  padGroup.add(mesh(mergeGeometries(rails), Materials.agencyOrange()));

  // Access stairway up the side of the deck.
  const stairs: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 16; i++) {
    const g = new THREE.BoxGeometry(4, 0.25, 0.9);
    g.translate(0, (i / 16) * PAD_HEIGHT + 0.3, PAD_RADIUS + 1 + i * 0.85);
    stairs.push(g);
  }
  padGroup.add(mesh(mergeGeometries(stairs), Materials.structuralSteel()));

  // -------------------------------------------------------------------------
  // Launch tower
  // -------------------------------------------------------------------------
  const towerGroup = new THREE.Group();
  towerGroup.position.set(-22, PAD_HEIGHT, 0);
  root.add(towerGroup);

  const tower = mesh(trussTower(9, TOWER_HEIGHT, 13, 0.24), Materials.structuralSteel());
  towerGroup.add(tower);

  // Enclosed elevator shaft up one face.
  const shaft = mesh(
    new THREE.BoxGeometry(3, TOWER_HEIGHT * 0.94, 3),
    Materials.hullWhite(),
  );
  shaft.position.set(-5.2, TOWER_HEIGHT * 0.47, 0);
  towerGroup.add(shaft);

  // Platform decks at intervals up the tower.
  for (let i = 1; i <= 6; i++) {
    const y = (i / 6.4) * TOWER_HEIGHT;
    const platform = mesh(new THREE.BoxGeometry(11, 0.3, 11), Materials.structuralSteel());
    platform.position.y = y;
    towerGroup.add(platform);

    const guard = mesh(
      new THREE.BoxGeometry(11.2, 1.1, 0.12),
      Materials.agencyOrange(),
    );
    guard.position.set(0, y + 0.7, 5.5);
    towerGroup.add(guard);
  }

  // Retractable service arms reaching to the vehicle.
  for (let i = 0; i < 3; i++) {
    const arm = new THREE.Group();
    const y = 18 + i * 17;
    arm.position.set(0, y, 0);

    const boom = mesh(new THREE.BoxGeometry(20, 1.1, 2.6), Materials.structuralSteel());
    boom.position.x = 11;
    arm.add(boom);

    const walkway = mesh(new THREE.BoxGeometry(19, 0.16, 2.2), Materials.agencyOrange());
    walkway.position.set(11, 0.63, 0);
    arm.add(walkway);

    // Umbilical bundle hanging from the arm.
    const umbilical = mesh(
      new THREE.CylinderGeometry(0.42, 0.42, 5.5, 8),
      Materials.darkPlastic(),
    );
    umbilical.position.set(19.5, -2.4, 0);
    arm.add(umbilical);

    const connector = mesh(new THREE.BoxGeometry(1.6, 1.6, 2), Materials.machinedAlloy());
    connector.position.set(20.5, -4.8, 0);
    arm.add(connector);

    towerGroup.add(arm);
    serviceArms.push(arm);
  }

  // Lightning masts topping the tower.
  const mast = mesh(
    new THREE.CylinderGeometry(0.2, 0.5, 22, 8),
    Materials.structuralSteel(),
  );
  mast.position.y = TOWER_HEIGHT + 11;
  towerGroup.add(mast);

  const beacon = mesh(
    new THREE.SphereGeometry(0.55, 8, 6),
    Materials.emissive(0xff2a2a, 2.2),
    false,
    false,
  );
  beacon.position.y = TOWER_HEIGHT + 22.5;
  towerGroup.add(beacon);

  // Catenary wires from the mast down to ground anchors.
  const wires: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.7;
    const top = new THREE.Vector3(0, TOWER_HEIGHT + 21, 0);
    const anchor = new THREE.Vector3(Math.sin(a) * 78, -PAD_HEIGHT, Math.cos(a) * 78);
    const mid = top.clone().lerp(anchor, 0.5);
    mid.y -= 9;
    const curve = new THREE.CatmullRomCurve3([top, mid, anchor]);
    wires.push(new THREE.TubeGeometry(curve, 16, 0.09, 5, false));
  }
  towerGroup.add(mesh(mergeGeometries(wires), Materials.darkPlastic(), false, false));

  // -------------------------------------------------------------------------
  // Propellant farm
  // -------------------------------------------------------------------------
  const farm = new THREE.Group();
  farm.position.set(118, 0, -74);
  root.add(farm);

  for (let i = 0; i < 3; i++) {
    const r = 11 - i * 1.4;
    const tank = mesh(sphericalTank(r, 22), Materials.tankMetal());
    tank.position.set(i * 30, r + 4.5, 0);
    farm.add(tank);

    // Support skirt.
    const skirt = mesh(
      new THREE.CylinderGeometry(r * 0.72, r * 0.8, 4.5, 16, 1, true),
      Materials.structuralSteel(),
    );
    skirt.position.set(i * 30, 2.25, 0);
    farm.add(skirt);

    // Insulation banding.
    const bands: THREE.BufferGeometry[] = [];
    for (let b = 0; b < 4; b++) {
      const g = new THREE.TorusGeometry(r * (0.99 - b * 0.02), 0.14, 5, 20);
      g.rotateX(Math.PI / 2);
      g.translate(i * 30, r + 4.5 - r * 0.5 + b * (r * 0.33), 0);
      bands.push(g);
    }
    farm.add(mesh(mergeGeometries(bands), Materials.machinedAlloy()));
  }

  // Cylindrical horizontal storage tanks.
  for (let i = 0; i < 4; i++) {
    const tank = mesh(
      new THREE.CylinderGeometry(3.4, 3.4, 20, 18),
      Materials.tankMetal(),
    );
    tank.rotation.z = Math.PI / 2;
    tank.position.set(-16, 5, 26 + i * 11);
    farm.add(tank);

    const caps: THREE.BufferGeometry[] = [];
    for (const s of [-1, 1]) {
      const g = new THREE.SphereGeometry(3.4, 14, 8);
      g.scale(0.5, 1, 1);
      g.translate(-16 + s * 10, 5, 26 + i * 11);
      caps.push(g);
    }
    farm.add(mesh(mergeGeometries(caps), Materials.tankMetal()));
  }

  // Pipe runs from the farm toward the pad — cables and plumbing (spec §20).
  const pipes: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 4; i++) {
    const g = new THREE.CylinderGeometry(0.45, 0.45, 150, 8);
    g.rotateZ(Math.PI / 2);
    g.rotateY(0.56);
    g.translate(48, 1.6 + i * 1.1, -32);
    pipes.push(g);
  }
  root.add(mesh(mergeGeometries(pipes), Materials.machinedAlloy()));

  // Pipe supports.
  const supports: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 12; i++) {
    const t = i / 12;
    const g = new THREE.BoxGeometry(2.6, 3.4, 0.5);
    g.translate(24 + t * 108, 1.7, -14 - t * 72);
    g.rotateY(0);
    supports.push(g);
  }
  root.add(mesh(mergeGeometries(supports), Materials.structuralSteel()));

  // -------------------------------------------------------------------------
  // Buildings: hangar, control bunker, workshops
  // -------------------------------------------------------------------------
  root.add(buildHangar(new THREE.Vector3(-165, 0, 118), rng));
  root.add(buildControlBunker(new THREE.Vector3(148, 0, 132)));
  root.add(buildSupportBuildings(new THREE.Vector3(-95, 0, -145), rng));

  // -------------------------------------------------------------------------
  // Roads
  // -------------------------------------------------------------------------
  const roads = new THREE.Group();
  const roadMat = new THREE.MeshStandardMaterial({ color: 0x4a4a48, roughness: 0.95 });

  const mainRoad = mesh(new THREE.PlaneGeometry(16, 420), roadMat, false, true);
  mainRoad.rotation.x = -Math.PI / 2;
  mainRoad.position.set(0, 0.03, 190);
  roads.add(mainRoad);

  const crossRoad = mesh(new THREE.PlaneGeometry(12, 340), roadMat, false, true);
  crossRoad.rotation.x = -Math.PI / 2;
  crossRoad.rotation.z = Math.PI / 2;
  crossRoad.position.set(60, 0.03, 130);
  roads.add(crossRoad);

  // Centre line markings.
  const marks: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 40; i++) {
    const g = new THREE.PlaneGeometry(0.4, 5);
    g.rotateX(-Math.PI / 2);
    g.translate(0, 0.05, 20 + i * 10);
    marks.push(g);
  }
  roads.add(
    mesh(
      mergeGeometries(marks),
      new THREE.MeshStandardMaterial({ color: 0xd8d4bc, roughness: 0.9 }),
      false,
      true,
    ),
  );
  root.add(roads);

  // -------------------------------------------------------------------------
  // Ground vehicles
  // -------------------------------------------------------------------------
  root.add(buildServiceTruck(new THREE.Vector3(46, 0, 44), -0.7));
  root.add(buildServiceTruck(new THREE.Vector3(58, 0, 62), -0.5));
  root.add(buildTransporter(new THREE.Vector3(-58, 0, 78), 0.35));
  root.add(buildCrane(new THREE.Vector3(-120, 0, 62)));

  // -------------------------------------------------------------------------
  // Lighting masts, antennas, fences, signage
  // -------------------------------------------------------------------------
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.4;
    const pos = new THREE.Vector3(Math.sin(a) * 88, 0, Math.cos(a) * 88);
    const { group, light } = buildLightMast(pos);
    root.add(group);
    padLights.push(light);
  }

  root.add(buildTrackingAntenna(new THREE.Vector3(118, 0, 96)));
  root.add(buildTrackingAntenna(new THREE.Vector3(146, 0, 78)));
  root.add(buildPerimeterFence(210, rng));
  root.add(buildSignage(new THREE.Vector3(26, 0, 96)));

  // Cable trays running across the apron.
  const trays: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.2;
    const g = new THREE.BoxGeometry(0.8, 0.4, 46);
    g.translate(0, 0.25, 44);
    g.rotateY(a);
    trays.push(g);
  }
  root.add(mesh(mergeGeometries(trays), Materials.darkPlastic()));

  // Scattered ground equipment for visual density.
  const equipment: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 26; i++) {
    const a = rng.range(0, Math.PI * 2);
    const d = rng.range(46, 82);
    const w = rng.range(1.4, 3.4);
    const g = new THREE.BoxGeometry(w, rng.range(1.2, 2.6), w * rng.range(0.7, 1.6));
    g.translate(Math.sin(a) * d, 1, Math.cos(a) * d);
    g.rotateY(rng.range(0, Math.PI));
    equipment.push(g);
  }
  root.add(mesh(mergeGeometries(equipment), Materials.hullWhite()));

  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.castShadow = m.castShadow || true;
      m.receiveShadow = true;
    }
  });

  return {
    root,
    padCentre: new THREE.Vector3(0, PAD_HEIGHT, 0),
    padHeight: PAD_HEIGHT,
    towerHeight: TOWER_HEIGHT,
    serviceArms,
    padLights,
    crewMarks: [
      new THREE.Vector3(16, PAD_HEIGHT, 22),
      new THREE.Vector3(19, PAD_HEIGHT, 24.5),
    ],
    trenchMouths: [new THREE.Vector3(0, 1.2, 22), new THREE.Vector3(0, 1.2, -22)],
  };
}

// ---------------------------------------------------------------------------
// Sub-structures
// ---------------------------------------------------------------------------

function buildHangar(position: THREE.Vector3, rng: Rng): THREE.Group {
  const g = new THREE.Group();
  g.position.copy(position);

  const width = 62;
  const depth = 96;
  const wallHeight = 26;

  // Walls.
  const walls = mesh(
    new THREE.BoxGeometry(width, wallHeight, depth),
    new THREE.MeshStandardMaterial({ color: 0xbfc3c6, roughness: 0.8, metalness: 0.2 }),
  );
  walls.position.y = wallHeight / 2;
  g.add(walls);

  // Barrel roof.
  const roof = mesh(
    new THREE.CylinderGeometry(width / 2, width / 2, depth, 20, 1, false, 0, Math.PI),
    new THREE.MeshStandardMaterial({ color: 0x9aa0a4, roughness: 0.7, metalness: 0.35 }),
  );
  roof.rotation.z = Math.PI / 2;
  roof.rotation.y = Math.PI / 2;
  roof.position.y = wallHeight;
  g.add(roof);

  // Big sliding door on the pad-facing end.
  const door = mesh(
    new THREE.BoxGeometry(width * 0.72, wallHeight * 0.86, 0.8),
    new THREE.MeshStandardMaterial({ color: 0x7d848a, roughness: 0.72, metalness: 0.4 }),
  );
  door.position.set(0, wallHeight * 0.43, depth / 2 + 0.4);
  g.add(door);

  // Door panel ribs.
  const ribs: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 9; i++) {
    const r = new THREE.BoxGeometry(0.5, wallHeight * 0.86, 0.3);
    r.translate((i / 8 - 0.5) * width * 0.7, wallHeight * 0.43, depth / 2 + 0.9);
    ribs.push(r);
  }
  g.add(mesh(mergeGeometries(ribs), Materials.structuralSteel()));

  // Agency stripe and roof vents.
  const stripe = mesh(
    new THREE.BoxGeometry(width * 1.005, 2.2, depth * 1.005),
    Materials.agencyAccent(),
  );
  stripe.position.y = wallHeight * 0.78;
  g.add(stripe);

  const vents: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 6; i++) {
    const v = new THREE.CylinderGeometry(1.4, 1.4, 2.2, 10);
    v.translate(rng.range(-16, 16), wallHeight + width * 0.42, (i / 5 - 0.5) * depth * 0.8);
    vents.push(v);
  }
  g.add(mesh(mergeGeometries(vents), Materials.machinedAlloy()));

  return g;
}

function buildControlBunker(position: THREE.Vector3): THREE.Group {
  const g = new THREE.Group();
  g.position.copy(position);

  // Low, thick, half-buried — the shape a blast-rated building actually has.
  const body = mesh(
    new THREE.BoxGeometry(46, 11, 30),
    new THREE.MeshStandardMaterial({ color: 0xa8a89e, roughness: 0.95 }),
  );
  body.position.y = 5.5;
  g.add(body);

  // Earth berm around it.
  const berm = mesh(
    new THREE.CylinderGeometry(38, 46, 7, 8),
    new THREE.MeshStandardMaterial({ color: 0x6d7359, roughness: 1 }),
  );
  berm.position.y = 3.5;
  g.add(berm);

  // Angled blast windows facing the pad.
  const windows = mesh(
    new THREE.BoxGeometry(30, 2.6, 0.5),
    Materials.glass(),
  );
  windows.position.set(0, 8.4, -15.2);
  windows.rotation.x = -0.18;
  g.add(windows);

  // Roof antenna farm.
  const antennas: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 5; i++) {
    const a = new THREE.CylinderGeometry(0.1, 0.14, 7 + i, 6);
    a.translate(-16 + i * 8, 11 + (7 + i) / 2, 6);
    antennas.push(a);
  }
  g.add(mesh(mergeGeometries(antennas), Materials.machinedAlloy()));

  // Rooftop HVAC.
  const hvac = mesh(new THREE.BoxGeometry(8, 2.4, 5), Materials.machinedAlloy());
  hvac.position.set(12, 12.2, -4);
  g.add(hvac);

  return g;
}

function buildSupportBuildings(position: THREE.Vector3, rng: Rng): THREE.Group {
  const g = new THREE.Group();
  g.position.copy(position);

  const mat = new THREE.MeshStandardMaterial({ color: 0xc4c6c0, roughness: 0.85 });

  for (let i = 0; i < 5; i++) {
    const w = rng.range(14, 30);
    const d = rng.range(12, 24);
    const h = rng.range(6, 13);
    const b = mesh(new THREE.BoxGeometry(w, h, d), mat);
    b.position.set(i * 38 + rng.range(-4, 4), h / 2, rng.range(-24, 24));
    b.rotation.y = rng.range(-0.12, 0.12);
    g.add(b);

    // Flat roof lip and a door.
    const lip = mesh(new THREE.BoxGeometry(w + 1, 0.5, d + 1), Materials.structuralSteel());
    lip.position.copy(b.position);
    lip.position.y = h;
    lip.rotation.y = b.rotation.y;
    g.add(lip);

    const door = mesh(new THREE.BoxGeometry(2.2, 3, 0.2), Materials.agencyAccent());
    door.position.set(b.position.x, 1.5, b.position.z + d / 2 + 0.1);
    g.add(door);
  }

  return g;
}

function buildServiceTruck(position: THREE.Vector3, rotation: number): THREE.Group {
  const g = new THREE.Group();
  g.position.copy(position);
  g.rotation.y = rotation;

  // Cab.
  const cab = mesh(
    new THREE.BoxGeometry(2.4, 2.2, 2.6),
    new THREE.MeshStandardMaterial({ color: 0xe8e4dc, roughness: 0.55, metalness: 0.25 }),
  );
  cab.position.set(0, 1.9, 2.2);
  g.add(cab);

  const windshield = mesh(new THREE.BoxGeometry(2.2, 1, 0.12), Materials.glass());
  windshield.position.set(0, 2.5, 3.45);
  g.add(windshield);

  // Flatbed with equipment.
  const bed = mesh(
    new THREE.BoxGeometry(2.5, 0.5, 5),
    Materials.structuralSteel(),
  );
  bed.position.set(0, 1.4, -1.4);
  g.add(bed);

  const crate = mesh(new THREE.BoxGeometry(1.8, 1.2, 2.4), Materials.hullWhite());
  crate.position.set(0, 2.25, -1.6);
  g.add(crate);

  // Wheels.
  const wheels: THREE.BufferGeometry[] = [];
  for (const z of [2.2, -0.6, -2.6]) {
    for (const s of [-1, 1]) {
      const w = new THREE.CylinderGeometry(0.62, 0.62, 0.42, 12);
      w.rotateZ(Math.PI / 2);
      w.translate(s * 1.25, 0.62, z);
      wheels.push(w);
    }
  }
  g.add(mesh(mergeGeometries(wheels), Materials.rubber()));

  // Beacon.
  const beacon = mesh(
    new THREE.CylinderGeometry(0.16, 0.16, 0.22, 8),
    Materials.emissive(0xffa32a, 1.6),
    false,
    false,
  );
  beacon.position.set(0, 3.1, 2.2);
  g.add(beacon);

  return g;
}

function buildTransporter(position: THREE.Vector3, rotation: number): THREE.Group {
  const g = new THREE.Group();
  g.position.copy(position);
  g.rotation.y = rotation;

  // A long multi-axle transporter-erector trailer.
  const deck = mesh(new THREE.BoxGeometry(6, 1.2, 46), Materials.structuralSteel());
  deck.position.y = 1.6;
  g.add(deck);

  // Erector cradle arms.
  const cradles: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 5; i++) {
    const c = new THREE.BoxGeometry(6.6, 1.6, 0.8);
    c.translate(0, 3, -18 + i * 9);
    cradles.push(c);
  }
  g.add(mesh(mergeGeometries(cradles), Materials.agencyOrange()));

  // Many small wheels — the giveaway that this carries something enormous.
  const wheels: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 10; i++) {
    for (const s of [-1, 1]) {
      const w = new THREE.CylinderGeometry(0.7, 0.7, 0.5, 10);
      w.rotateZ(Math.PI / 2);
      w.translate(s * 2.8, 0.7, -20 + i * 4.5);
      wheels.push(w);
    }
  }
  g.add(mesh(mergeGeometries(wheels), Materials.rubber()));

  // Tractor unit at the front.
  const tractor = mesh(new THREE.BoxGeometry(3.4, 2.8, 5), Materials.hullWhite());
  tractor.position.set(0, 2.4, 25);
  g.add(tractor);

  return g;
}

function buildCrane(position: THREE.Vector3): THREE.Group {
  const g = new THREE.Group();
  g.position.copy(position);

  const mastHeight = 42;
  const mast = mesh(trussTower(3.2, mastHeight, 8, 0.13), Materials.agencyOrange());
  g.add(mast);

  // Horizontal jib.
  const jib = mesh(trussTower(2.4, 34, 7, 0.1), Materials.agencyOrange());
  jib.rotation.z = -Math.PI / 2;
  jib.position.y = mastHeight;
  g.add(jib);

  // Counter-jib.
  const counter = mesh(trussTower(2.2, 13, 3, 0.1), Materials.agencyOrange());
  counter.rotation.z = Math.PI / 2;
  counter.position.y = mastHeight;
  g.add(counter);

  const counterweight = mesh(new THREE.BoxGeometry(3, 2.6, 3.4), Materials.structuralSteel());
  counterweight.position.set(-13, mastHeight, 0);
  g.add(counterweight);

  // Hook block on its cable.
  const cable = mesh(
    new THREE.CylinderGeometry(0.05, 0.05, 22, 5),
    Materials.darkPlastic(),
  );
  cable.position.set(19, mastHeight - 11, 0);
  g.add(cable);

  const hook = mesh(new THREE.BoxGeometry(1, 1.4, 1), Materials.machinedAlloy());
  hook.position.set(19, mastHeight - 22.5, 0);
  g.add(hook);

  // Operator cab.
  const cab = mesh(new THREE.BoxGeometry(2, 2, 2.4), Materials.hullWhite());
  cab.position.set(2.6, mastHeight - 2, 0);
  g.add(cab);

  return g;
}

function buildLightMast(position: THREE.Vector3): {
  group: THREE.Group;
  light: THREE.SpotLight;
} {
  const g = new THREE.Group();
  g.position.copy(position);

  const height = 34;
  const pole = mesh(
    new THREE.CylinderGeometry(0.32, 0.62, height, 10),
    Materials.structuralSteel(),
  );
  pole.position.y = height / 2;
  g.add(pole);

  const head = mesh(new THREE.BoxGeometry(4.4, 0.5, 1.4), Materials.structuralSteel());
  head.position.y = height;
  g.add(head);

  // Individual luminaires.
  const lamps: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 5; i++) {
    const l = new THREE.BoxGeometry(0.7, 0.34, 1);
    l.translate((i / 4 - 0.5) * 3.8, height - 0.35, 0);
    lamps.push(l);
  }
  g.add(mesh(mergeGeometries(lamps), Materials.emissive(0xfff2d0, 1.1), false, false));

  // One real spotlight per mast, aimed at the pad.
  const light = new THREE.SpotLight(0xfff0d4, 0, 220, Math.PI / 7, 0.45, 1.6);
  light.position.set(0, height, 0);
  light.target.position.set(-position.x * 0.85, 20 - position.y, -position.z * 0.85);
  g.add(light);
  g.add(light.target);

  return { group: g, light };
}

function buildTrackingAntenna(position: THREE.Vector3): THREE.Group {
  const g = new THREE.Group();
  g.position.copy(position);

  const pedestal = mesh(
    new THREE.CylinderGeometry(2.2, 3, 7, 14),
    Materials.hullWhite(),
  );
  pedestal.position.y = 3.5;
  g.add(pedestal);

  const yoke = mesh(new THREE.BoxGeometry(5.6, 0.9, 1.4), Materials.structuralSteel());
  yoke.position.y = 7.6;
  g.add(yoke);

  // Parabolic dish, lathed properly.
  const profile: THREE.Vector2[] = [];
  const R = 7.5;
  for (let i = 0; i <= 12; i++) {
    const r = (i / 12) * R;
    profile.push(new THREE.Vector2(Math.max(r, 1e-3), (r * r) / (2.4 * R)));
  }
  const dish = mesh(new THREE.LatheGeometry(profile, 28), Materials.hullWhite());
  (dish.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
  dish.position.y = 9;
  dish.rotation.x = -0.62;
  g.add(dish);

  // Feed on a tripod.
  const feed = mesh(
    new THREE.CylinderGeometry(0.4, 0.6, 1.2, 10),
    Materials.machinedAlloy(),
  );
  feed.position.set(0, 12.6, 2.6);
  feed.rotation.x = -0.62 + Math.PI;
  g.add(feed);

  return g;
}

function buildPerimeterFence(radius: number, rng: Rng): THREE.Group {
  const g = new THREE.Group();

  const posts: THREE.BufferGeometry[] = [];
  const count = 120;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const p = new THREE.CylinderGeometry(0.08, 0.08, 2.6, 5);
    p.translate(Math.sin(a) * radius, 1.3, Math.cos(a) * radius);
    posts.push(p);
  }
  g.add(mesh(mergeGeometries(posts), Materials.structuralSteel(), false, true));

  // Fence wires as thin torus rings.
  const wires: THREE.BufferGeometry[] = [];
  for (const y of [0.7, 1.5, 2.3]) {
    const w = new THREE.TorusGeometry(radius, 0.03, 4, count);
    w.rotateX(Math.PI / 2);
    w.translate(0, y, 0);
    wires.push(w);
  }
  g.add(mesh(mergeGeometries(wires), Materials.darkPlastic(), false, false));

  // Warning placards at intervals.
  const signs: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 14; i++) {
    const a = rng.range(0, Math.PI * 2);
    const s = new THREE.BoxGeometry(1, 0.7, 0.05);
    s.translate(Math.sin(a) * radius, 1.7, Math.cos(a) * radius);
    s.rotateY(-a);
    signs.push(s);
  }
  g.add(mesh(mergeGeometries(signs), Materials.agencyOrange(), false, false));

  return g;
}

function buildSignage(position: THREE.Vector3): THREE.Group {
  const g = new THREE.Group();
  g.position.copy(position);

  // A large agency sign board beside the pad approach.
  const posts: THREE.BufferGeometry[] = [];
  for (const s of [-1, 1]) {
    const p = new THREE.CylinderGeometry(0.16, 0.16, 5, 8);
    p.translate(s * 3.4, 2.5, 0);
    posts.push(p);
  }
  g.add(mesh(mergeGeometries(posts), Materials.structuralSteel()));

  const board = mesh(new THREE.BoxGeometry(8.4, 3, 0.22), Materials.hullWhite());
  board.position.y = 5.2;
  g.add(board);

  // Agency mark: a stylised ring and chevron in accent colour.
  const ring = mesh(
    new THREE.TorusGeometry(0.95, 0.16, 8, 24),
    Materials.agencyAccent(),
  );
  ring.position.set(-2.6, 5.2, 0.16);
  g.add(ring);

  const chevron = mesh(
    new THREE.ConeGeometry(0.62, 1.5, 3),
    Materials.agencyOrange(),
  );
  chevron.position.set(-2.6, 5.4, 0.2);
  chevron.rotation.x = Math.PI / 2;
  g.add(chevron);

  // Text bars standing in for the wordmark.
  const bars: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 3; i++) {
    const b = new THREE.BoxGeometry(4.2 - i * 0.9, 0.42, 0.06);
    b.translate(1.2, 6 - i * 0.85, 0.16);
    bars.push(b);
  }
  g.add(mesh(mergeGeometries(bars), Materials.hullBlack(), false, false));

  return g;
}
