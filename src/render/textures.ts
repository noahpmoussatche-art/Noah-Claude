/**
 * Procedurally generated textures.
 *
 * The game ships with no binary art assets: every texture here is drawn to a
 * canvas at load time. That keeps the repository self-contained while still
 * giving surfaces the panel lines, weld seams, cell grids and weave patterns
 * that separate "real hardware" from "grey plastic" (spec §56, §72).
 */
import * as THREE from 'three';

type Ctx = CanvasRenderingContext2D;

const cache = new Map<string, THREE.Texture>();

function makeCanvas(size: number): { canvas: HTMLCanvasElement; ctx: Ctx } {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  return { canvas, ctx };
}

function finish(
  canvas: HTMLCanvasElement,
  repeat: number,
  colorSpace: THREE.ColorSpace = THREE.SRGBColorSpace,
): THREE.Texture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.colorSpace = colorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** Seeded value noise used for grain, so textures are stable between runs. */
function seededNoise(x: number, y: number, seed: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
  return n - Math.floor(n);
}

function grain(ctx: Ctx, size: number, amount: number, seed: number): void {
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const px = (i / 4) % size;
    const py = Math.floor(i / 4 / size);
    const n = (seededNoise(px, py, seed) - 0.5) * amount;
    d[i] = Math.max(0, Math.min(255, d[i] + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
  }
  ctx.putImageData(img, 0, 0);
}

/**
 * Brushed / rolled metal skin with faint longitudinal streaks and weld seams.
 * Used for tank barrels and structural skins.
 */
export function metalSkin(base = '#c8ccd2', repeat = 1): THREE.Texture {
  const key = `metal:${base}:${repeat}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const size = 512;
  const { canvas, ctx } = makeCanvas(size);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);

  // Rolling direction streaks.
  ctx.globalAlpha = 0.05;
  for (let i = 0; i < 400; i++) {
    const y = seededNoise(i, 3, 11) * size;
    ctx.strokeStyle = seededNoise(i, 7, 5) > 0.5 ? '#ffffff' : '#5c6068';
    ctx.lineWidth = 0.5 + seededNoise(i, 9, 2) * 1.5;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(size, y + (seededNoise(i, 13, 4) - 0.5) * 6);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // Horizontal weld seams between barrel sections.
  ctx.globalAlpha = 0.22;
  for (const y of [0.25, 0.5, 0.75]) {
    ctx.strokeStyle = '#6b7079';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(0, y * size);
    ctx.lineTo(size, y * size);
    ctx.stroke();
    ctx.strokeStyle = '#eef1f5';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, y * size - 2);
    ctx.lineTo(size, y * size - 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  grain(ctx, size, 14, 3);
  const tex = finish(canvas, repeat);
  cache.set(key, tex);
  return tex;
}

/**
 * Painted aerospace skin: white paint over panel joints, with rivet lines and
 * light service staining. This is the dominant look of a launch vehicle.
 */
export function paintedPanels(
  base = '#eef1f4',
  line = '#b9c0c8',
  repeat = 1,
): THREE.Texture {
  const key = `panel:${base}:${line}:${repeat}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const size = 512;
  const { canvas, ctx } = makeCanvas(size);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);

  // Panel grid.
  ctx.strokeStyle = line;
  ctx.lineWidth = 1.6;
  ctx.globalAlpha = 0.55;
  const cells = 4;
  for (let i = 1; i < cells; i++) {
    const p = (i / cells) * size;
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, size);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, p);
    ctx.lineTo(size, p);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // Rivets along the panel joints.
  ctx.fillStyle = line;
  ctx.globalAlpha = 0.45;
  for (let i = 1; i < cells; i++) {
    const p = (i / cells) * size;
    for (let r = 0; r < size; r += 16) {
      ctx.beginPath();
      ctx.arc(p, r + 8, 1.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(r + 8, p, 1.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;

  // Faint service staining so the paint is not perfectly clean.
  ctx.globalAlpha = 0.05;
  for (let i = 0; i < 26; i++) {
    const x = seededNoise(i, 1, 21) * size;
    const y = seededNoise(i, 2, 22) * size;
    const r = 12 + seededNoise(i, 3, 23) * 46;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, '#7d848d');
    g.addColorStop(1, 'rgba(125,132,141,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  ctx.globalAlpha = 1;

  grain(ctx, size, 8, 9);
  const tex = finish(canvas, repeat);
  cache.set(key, tex);
  return tex;
}

/** Photovoltaic cell grid with busbars — used by solar arrays (spec §40). */
export function solarCells(repeat = 1): THREE.Texture {
  const key = `solar:${repeat}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const size = 512;
  const { canvas, ctx } = makeCanvas(size);
  ctx.fillStyle = '#0d1b3d';
  ctx.fillRect(0, 0, size, size);

  const cells = 8;
  const cell = size / cells;
  for (let x = 0; x < cells; x++) {
    for (let y = 0; y < cells; y++) {
      // Slight per-cell tint variation reads as real silicon.
      const t = seededNoise(x, y, 31);
      ctx.fillStyle = `rgb(${18 + t * 10}, ${34 + t * 16}, ${86 + t * 26})`;
      ctx.fillRect(x * cell + 2, y * cell + 2, cell - 4, cell - 4);

      // Fine collector fingers.
      ctx.strokeStyle = 'rgba(190,205,230,0.22)';
      ctx.lineWidth = 0.7;
      for (let f = 1; f < 7; f++) {
        const fx = x * cell + (f / 7) * cell;
        ctx.beginPath();
        ctx.moveTo(fx, y * cell + 3);
        ctx.lineTo(fx, y * cell + cell - 3);
        ctx.stroke();
      }
      // Busbars.
      ctx.strokeStyle = 'rgba(206,218,238,0.5)';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(x * cell + cell * 0.33, y * cell + 2);
      ctx.lineTo(x * cell + cell * 0.33, y * cell + cell - 2);
      ctx.moveTo(x * cell + cell * 0.66, y * cell + 2);
      ctx.lineTo(x * cell + cell * 0.66, y * cell + cell - 2);
      ctx.stroke();
    }
  }

  const tex = finish(canvas, repeat);
  cache.set(key, tex);
  return tex;
}

/**
 * Multi-layer insulation: crinkled gold/amber foil. Reads instantly as
 * spacecraft thermal hardware.
 */
export function thermalBlanket(repeat = 1): THREE.Texture {
  const key = `mli:${repeat}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const size = 512;
  const { canvas, ctx } = makeCanvas(size);
  ctx.fillStyle = '#c8952f';
  ctx.fillRect(0, 0, size, size);

  // Crinkle facets.
  for (let i = 0; i < 900; i++) {
    const x = seededNoise(i, 1, 41) * size;
    const y = seededNoise(i, 2, 42) * size;
    const w = 8 + seededNoise(i, 3, 43) * 40;
    const h = 4 + seededNoise(i, 4, 44) * 22;
    const bright = seededNoise(i, 5, 45);
    ctx.globalAlpha = 0.16;
    ctx.fillStyle =
      bright > 0.6 ? '#f7dc8a' : bright > 0.3 ? '#a5701c' : '#6f4a10';
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(seededNoise(i, 6, 46) * Math.PI);
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.restore();
  }
  ctx.globalAlpha = 1;

  // Tape lines holding the blanket down.
  ctx.globalAlpha = 0.3;
  ctx.strokeStyle = '#8a5f18';
  ctx.lineWidth = 4;
  for (let i = 0; i < 4; i++) {
    const y = (i / 4) * size + 20;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(size, y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  const tex = finish(canvas, repeat);
  cache.set(key, tex);
  return tex;
}

/** Ablative heat shield: dark phenolic tiles with radial segmentation. */
export function ablator(repeat = 1): THREE.Texture {
  const key = `ablator:${repeat}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const size = 512;
  const { canvas, ctx } = makeCanvas(size);
  ctx.fillStyle = '#3a332e';
  ctx.fillRect(0, 0, size, size);

  // Tiled ablator blocks.
  const cells = 10;
  const cell = size / cells;
  for (let x = 0; x < cells; x++) {
    for (let y = 0; y < cells; y++) {
      const t = seededNoise(x, y, 57);
      ctx.fillStyle = `rgb(${44 + t * 22}, ${38 + t * 18}, ${33 + t * 14})`;
      ctx.fillRect(x * cell + 1.5, y * cell + 1.5, cell - 3, cell - 3);
    }
  }

  grain(ctx, size, 20, 13);
  const tex = finish(canvas, repeat);
  cache.set(key, tex);
  return tex;
}

/** Carbon-fibre twill weave for fairings and composite structure. */
export function carbonWeave(repeat = 1): THREE.Texture {
  const key = `carbon:${repeat}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const size = 256;
  const { canvas, ctx } = makeCanvas(size);
  ctx.fillStyle = '#1b1d21';
  ctx.fillRect(0, 0, size, size);

  const tow = 16;
  for (let x = 0; x < size; x += tow) {
    for (let y = 0; y < size; y += tow) {
      const over = ((x / tow) + (y / tow)) % 2 === 0;
      ctx.fillStyle = over ? '#33373d' : '#232629';
      ctx.fillRect(x, y, tow, tow);
      ctx.globalAlpha = 0.25;
      ctx.strokeStyle = over ? '#4c525a' : '#15171a';
      ctx.lineWidth = 1;
      ctx.beginPath();
      if (over) {
        ctx.moveTo(x, y);
        ctx.lineTo(x + tow, y + tow);
      } else {
        ctx.moveTo(x + tow, y);
        ctx.lineTo(x, y + tow);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  const tex = finish(canvas, repeat);
  cache.set(key, tex);
  return tex;
}

/** Concrete pad / roadway surface with expansion joints and scorch marks. */
export function concrete(repeat = 1, scorched = false): THREE.Texture {
  const key = `concrete:${repeat}:${scorched}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const size = 512;
  const { canvas, ctx } = makeCanvas(size);
  ctx.fillStyle = '#8b8b86';
  ctx.fillRect(0, 0, size, size);

  // Aggregate speckle.
  for (let i = 0; i < 5000; i++) {
    const x = seededNoise(i, 1, 61) * size;
    const y = seededNoise(i, 2, 62) * size;
    const v = seededNoise(i, 3, 63);
    ctx.fillStyle = v > 0.5 ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.10)';
    ctx.fillRect(x, y, 1.6, 1.6);
  }

  // Expansion joints.
  ctx.strokeStyle = 'rgba(50,50,48,0.55)';
  ctx.lineWidth = 3;
  for (let i = 1; i < 4; i++) {
    const p = (i / 4) * size;
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, size);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, p);
    ctx.lineTo(size, p);
    ctx.stroke();
  }

  if (scorched) {
    for (let i = 0; i < 30; i++) {
      const x = seededNoise(i, 4, 71) * size;
      const y = seededNoise(i, 5, 72) * size;
      const r = 20 + seededNoise(i, 6, 73) * 90;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(24,20,18,0.55)');
      g.addColorStop(1, 'rgba(24,20,18,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
  }

  grain(ctx, size, 12, 17);
  const tex = finish(canvas, repeat);
  cache.set(key, tex);
  return tex;
}

/** Martian regolith: dusty ochre with darker basaltic fines. */
export function regolith(repeat = 1): THREE.Texture {
  const key = `regolith:${repeat}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const size = 512;
  const { canvas, ctx } = makeCanvas(size);
  ctx.fillStyle = '#a1552f';
  ctx.fillRect(0, 0, size, size);

  for (let i = 0; i < 340; i++) {
    const x = seededNoise(i, 1, 81) * size;
    const y = seededNoise(i, 2, 82) * size;
    const r = 8 + seededNoise(i, 3, 83) * 70;
    const v = seededNoise(i, 4, 84);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    if (v > 0.55) {
      g.addColorStop(0, 'rgba(196,120,70,0.35)');
      g.addColorStop(1, 'rgba(196,120,70,0)');
    } else {
      g.addColorStop(0, 'rgba(88,44,26,0.32)');
      g.addColorStop(1, 'rgba(88,44,26,0)');
    }
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  // Scattered small clasts.
  for (let i = 0; i < 1400; i++) {
    const x = seededNoise(i, 5, 85) * size;
    const y = seededNoise(i, 6, 86) * size;
    const v = seededNoise(i, 7, 87);
    ctx.fillStyle = v > 0.5 ? 'rgba(60,34,22,0.42)' : 'rgba(214,150,102,0.30)';
    ctx.fillRect(x, y, 1.6 + v * 2.4, 1.6 + v * 2);
  }

  grain(ctx, size, 16, 23);
  const tex = finish(canvas, repeat);
  cache.set(key, tex);
  return tex;
}

/** Soft radial particle sprite for smoke, dust and flame billboards. */
export function softParticle(
  inner = 'rgba(255,255,255,1)',
  outer = 'rgba(255,255,255,0)',
): THREE.Texture {
  const key = `soft:${inner}:${outer}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const size = 128;
  const { canvas, ctx } = makeCanvas(size);
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner);
  g.addColorStop(0.45, inner.replace(/[\d.]+\)$/, '0.55)'));
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, tex);
  return tex;
}

/**
 * Puffy smoke sprite — a radial falloff broken up by lobes so a cloud made of
 * these does not read as a stack of perfect circles.
 */
export function smokePuff(): THREE.Texture {
  const key = 'smokePuff';
  const hit = cache.get(key);
  if (hit) return hit;

  const size = 256;
  const { canvas, ctx } = makeCanvas(size);
  ctx.clearRect(0, 0, size, size);

  const lobes = 11;
  for (let i = 0; i < lobes; i++) {
    const a = (i / lobes) * Math.PI * 2 + seededNoise(i, 1, 91);
    const d = 26 + seededNoise(i, 2, 92) * 40;
    const x = size / 2 + Math.cos(a) * d;
    const y = size / 2 + Math.sin(a) * d;
    const r = 34 + seededNoise(i, 3, 93) * 44;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.42)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // Dense core.
  const cg = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size * 0.42);
  cg.addColorStop(0, 'rgba(255,255,255,0.85)');
  cg.addColorStop(0.6, 'rgba(255,255,255,0.32)');
  cg.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = cg;
  ctx.fillRect(0, 0, size, size);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, tex);
  return tex;
}

/** Star field sprite used by the point-based starfield. */
export function starSprite(): THREE.Texture {
  return softParticle('rgba(255,255,255,1)', 'rgba(255,255,255,0)');
}

/** Releases every cached GPU texture. Called on teardown. */
export function disposeTextureCache(): void {
  for (const tex of cache.values()) tex.dispose();
  cache.clear();
}
