/**
 * Renderer configuration.
 *
 * The visual target (spec §57, §72) needs physically-based lighting with real
 * shadows and a tone-mapping curve that can hold both a dawn sky and a
 * white-hot engine plume in the same frame. ACES filmic tone mapping does that:
 * it rolls off highlights instead of clipping them, so the plume reads as
 * intensely bright rather than as a flat white blob.
 *
 * Resolution scaling keeps it running on ordinary hardware (spec §73): the
 * renderer measures its own frame time and drops pixel ratio before it drops
 * frames.
 */
import * as THREE from 'three';
import { LAYER_FAR_SPACE } from '../data/constants';
import { clamp } from '../utils/math';

/**
 * Clip range for the far-space pass. Everything it draws is a scaled-down
 * planet a few thousand units across, so the range can be tight and the depth
 * buffer stays precise.
 */
const FAR_PASS_NEAR = 1;
const FAR_PASS_FAR = 60_000;

export class Renderer {
  readonly gl: THREE.WebGLRenderer;
  private readonly canvas: HTMLCanvasElement;

  /** Camera for the far-space pass; only ever sees LAYER_FAR_SPACE. */
  private readonly farCamera = new THREE.PerspectiveCamera();

  /** Current resolution multiplier, adapted at runtime. */
  private scale = 1;
  private frameAccumulator = 0;
  private frameCount = 0;

  /** Device pixel ratio ceiling; above 2 the cost is not worth it. */
  private readonly maxPixelRatio: number;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.maxPixelRatio = Math.min(window.devicePixelRatio || 1, 2);

    this.gl = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
      stencil: false,
    });

    this.gl.setPixelRatio(this.maxPixelRatio);
    this.gl.outputColorSpace = THREE.SRGBColorSpace;

    // Filmic response so bright emissive effects do not clip to flat white.
    this.gl.toneMapping = THREE.ACESFilmicToneMapping;
    this.gl.toneMappingExposure = 1.05;

    this.gl.shadowMap.enabled = true;
    // Soft shadows: the extra cost is small and the quality difference on
    // structural geometry is large.
    this.gl.shadowMap.type = THREE.PCFSoftShadowMap;
    this.gl.shadowMap.autoUpdate = true;

    // The far camera sees only the far-space layer, and the main camera never
    // sees it — so each pass draws its own half of the world with no filtering
    // at the call site.
    this.farCamera.layers.set(LAYER_FAR_SPACE);

    this.resize();
  }

  get width(): number {
    return this.canvas.clientWidth || window.innerWidth;
  }

  get height(): number {
    return this.canvas.clientHeight || window.innerHeight;
  }

  get aspect(): number {
    return this.width / Math.max(this.height, 1);
  }

  get pixelRatio(): number {
    return this.maxPixelRatio * this.scale;
  }

  resize(): void {
    this.gl.setSize(this.width, this.height, false);
    this.gl.setPixelRatio(this.pixelRatio);
  }

  /**
   * Adapts render resolution to the measured frame time. Sampled over a window
   * so a single slow frame (a scene build, a texture upload) does not trigger a
   * permanent quality drop.
   */
  adaptQuality(dt: number): void {
    this.frameAccumulator += dt;
    this.frameCount++;
    if (this.frameCount < 45) return;

    const averageMs = (this.frameAccumulator / this.frameCount) * 1000;
    this.frameAccumulator = 0;
    this.frameCount = 0;

    const previous = this.scale;
    if (averageMs > 26 && this.scale > 0.62) {
      this.scale = clamp(this.scale - 0.1, 0.6, 1);
    } else if (averageMs < 13 && this.scale < 1) {
      this.scale = clamp(this.scale + 0.06, 0.6, 1);
    }

    if (Math.abs(previous - this.scale) > 1e-3) {
      this.gl.setPixelRatio(this.pixelRatio);
    }
  }

  /**
   * Renders the scene, optionally preceded by a far-space pass.
   *
   * A planet is eight thousand kilometres across and the vehicle in front of it
   * is fifty metres long. No single depth buffer holds both, so anything that
   * large is drawn first through a second camera that shares this one's
   * orientation and field of view but sits at a scaled-down position — which
   * preserves every angle exactly, so the parallax is right — and then the
   * depth buffer is cleared and the real world is drawn on top of it. It is the
   * standard way to put a world behind a spacecraft, and it is why the planet
   * geometry lives on its own render layer.
   *
   * `farScale` of zero skips the pass entirely, which is the case everywhere
   * except in orbit.
   */
  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera, farScale = 0): void {
    if (farScale <= 0) {
      this.gl.render(scene, camera);
      return;
    }

    this.gl.autoClear = false;
    this.gl.clear();

    this.farCamera.fov = camera.fov;
    this.farCamera.aspect = camera.aspect;
    this.farCamera.near = FAR_PASS_NEAR;
    this.farCamera.far = FAR_PASS_FAR;
    this.farCamera.position.copy(camera.position).multiplyScalar(farScale);
    this.farCamera.quaternion.copy(camera.quaternion);
    this.farCamera.updateProjectionMatrix();
    this.farCamera.updateMatrixWorld(true);
    this.gl.render(scene, this.farCamera);

    this.gl.clearDepth();
    this.gl.render(scene, camera);
    this.gl.autoClear = true;
  }

  /** Diagnostic counters, surfaced in the console for performance work. */
  stats(): { calls: number; triangles: number; programs: number } {
    const info = this.gl.info;
    return {
      calls: info.render.calls,
      triangles: info.render.triangles,
      programs: info.programs?.length ?? 0,
    };
  }

  dispose(): void {
    this.gl.dispose();
  }
}
