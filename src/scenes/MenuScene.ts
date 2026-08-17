/**
 * The title scene (spec §24, §78).
 *
 * The spec's opening beat is "abrir o jogo → ver os dois patos", and the two
 * ducks are explicitly not icons and not interface elements. The menu used to
 * satisfy that with a pair of emoji in a DOM heading, which is exactly the thing
 * §24 rules out — so the title screen is now a real 3D vignette: both characters
 * standing on the apron at dawn with the vehicle behind them, lit by the same
 * sun and rendered by the same pipeline as the rest of the game.
 *
 * It is deliberately cheap. Nothing here simulates; it is a held shot with two
 * idle-animated characters and a slow camera drift, so the menu costs a couple
 * of hundred triangles and no physics.
 */
import * as THREE from 'three';
import { SkyDome } from '../planets/Sky';
import { createCrew, type DuckActor } from '../characters/DuckActor';
import { Materials } from '../render/materials';
import { mergeGeometries, mesh, ogiveNose, trussTower } from '../render/geometry';
import { DUCK_HEIGHT } from '../characters/Duck';

export class MenuScene {
  readonly scene = new THREE.Scene();
  readonly crew: { engineer: DuckActor; pilot: DuckActor };

  private readonly sky = new SkyDome(6_000);
  private time = 0;

  /** The point the camera is meant to hold: between the two characters. */
  private readonly focus = new THREE.Vector3();

  constructor() {
    // ---- Sky and light, matched to the launch complex's dawn ----
    const sunDir = new THREE.Vector3(0.42, 0.14, -0.88).normalize();
    this.sky.setSunDirection(sunDir);
    this.scene.add(this.sky.mesh);

    const sun = new THREE.DirectionalLight(0xffd2a0, 2.6);
    sun.position.copy(sunDir).multiplyScalar(400);
    this.scene.add(sun, sun.target);

    // A cool bounce from the opposite side, so the shaded half of each duck is
    // readable rather than black.
    const fill = new THREE.DirectionalLight(0x8fb4e8, 0.75);
    fill.position.set(-60, 40, 70);
    this.scene.add(fill);

    this.scene.add(new THREE.HemisphereLight(0xbcd2ea, 0x50463a, 0.65));

    // ---- Ground ----
    const apron = mesh(
      new THREE.CylinderGeometry(240, 240, 0.5, 48),
      Materials.concrete(),
      false,
      true,
    );
    apron.position.y = -0.25;
    this.scene.add(apron);

    // ---- The vehicle, far enough back to tower over the characters ----
    // Not a real Vehicle: the menu has no design to build from, and the point of
    // the shot is the silhouette and the scale relationship, not the hardware.
    this.scene.add(this.buildSilhouette());

    // ---- The two characters, centre frame ----
    // Turned toward the camera in three-quarter view. The title screen has to
    // introduce the two characters, and a shot of the backs of their heads
    // introduces nobody — they look up at the vehicle with their heads, not by
    // turning their whole bodies away from the audience.
    this.crew = createCrew();
    this.crew.engineer.placeAt(-0.42, 0, 2.6, Math.PI * 0.86);
    this.crew.pilot.placeAt(0.44, 0, 2.35, Math.PI * 1.14);
    this.crew.engineer.setPose('inspect');
    this.crew.pilot.setPose('look-up');
    this.scene.add(this.crew.engineer.object, this.crew.pilot.object);

    // The camera looks a little to the right of the crew, which pushes both
    // characters into the left third of the frame — the half the menu panel
    // leaves clear.
    this.focus.set(0.62, DUCK_HEIGHT * 0.62, 2.5);
  }

  /** A launch vehicle and its tower, standing off behind the crew. */
  private buildSilhouette(): THREE.Group {
    const g = new THREE.Group();
    // On the axis the camera actually looks down, far enough back that the
    // lower two-thirds of the stack and its tower fill the background behind
    // the crew. The vehicle running out of the top of frame is the point: it is
    // what puts a 0.55 m character against a 38 m one (spec §21).
    g.position.set(1.6, 0, -58);

    const R = 1.85;
    const bodyH = 38;

    const body = mesh(
      new THREE.CylinderGeometry(R, R, bodyH, 28, 1),
      Materials.hullWhite(),
      true,
      true,
    );
    body.position.y = bodyH / 2;
    g.add(body);

    // Roll-pattern band, so the silhouette is not one blank tube.
    const band = mesh(
      new THREE.CylinderGeometry(R * 1.005, R * 1.005, 3.4, 28, 1),
      Materials.hullBlack(),
    );
    band.position.y = bodyH * 0.63;
    g.add(band);

    const interstage = mesh(
      new THREE.CylinderGeometry(R * 1.01, R * 1.01, 2.2, 28, 1),
      Materials.tankMetal(),
    );
    interstage.position.y = bodyH * 0.34;
    g.add(interstage);

    const nose = mesh(ogiveNose(R, R * 3.1, 28), Materials.hullWhite(), true, true);
    nose.position.y = bodyH;
    g.add(nose);

    // Engine bells at the base, so the bottom of the stack is not a flat disc.
    const bells: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const b = new THREE.CylinderGeometry(0.28, 0.62, 1.7, 12, 1, true);
      b.translate(Math.sin(a) * R * 0.55, -0.85, Math.cos(a) * R * 0.55);
      bells.push(b);
    }
    g.add(mesh(mergeGeometries(bells), Materials.nozzleAlloy(), true, false));

    const tower = mesh(trussTower(4.6, 46, 11, 0.2), Materials.structuralSteel(), true, true);
    tower.position.set(-7.5, 0, 0);
    g.add(tower);

    return g;
  }

  /** Where the camera should look. */
  focusPoint(target = new THREE.Vector3()): THREE.Vector3 {
    return target.copy(this.focus);
  }

  /**
   * Camera position for a given time — a very slow arc, so the title screen
   * breathes without ever pulling focus from the menu itself.
   */
  cameraPosition(target = new THREE.Vector3()): THREE.Vector3 {
    const a = -0.06 + Math.sin(this.time * 0.055) * 0.1;
    const d = 3.4;
    return target.set(
      this.focus.x + Math.sin(a) * d,
      this.focus.y + 0.52 + Math.sin(this.time * 0.08) * 0.05,
      this.focus.z + Math.cos(a) * d,
    );
  }

  update(dt: number): void {
    this.time += dt;

    // The pilot keeps looking up at the vehicle; the engineer glances between
    // the vehicle and their colleague, which is enough to read as a scene with
    // two people in it rather than two props.
    this.crew.pilot.lookAt(new THREE.Vector3(1.6, 30, -58));
    const glance = Math.sin(this.time * 0.31) > 0;
    this.crew.engineer.lookAt(
      glance
        ? new THREE.Vector3(1.6, 22, -58)
        : this.crew.pilot.object.getWorldPosition(new THREE.Vector3()),
    );

    this.crew.engineer.update(dt);
    this.crew.pilot.update(dt);
    this.sky.update(dt);
  }

  dispose(): void {
    this.crew.engineer.dispose();
    this.crew.pilot.dispose();
    this.sky.dispose();
  }
}
