import * as THREE from 'three';
import { makeRng } from '../core/math';

function surface(size: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  return { canvas, ctx };
}

/** Soft radial falloff used for glows, cursors and pinch rings. */
export function glowTexture(size = 128): THREE.Texture {
  const { canvas, ctx } = surface(size);
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.28, 'rgba(255,255,255,0.65)');
  g.addColorStop(0.62, 'rgba(255,255,255,0.16)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Wavy cristae stripes for the inner mitochondrial membrane. */
export function cristaeTexture(): THREE.Texture {
  const size = 512;
  const { canvas, ctx } = surface(size);
  ctx.fillStyle = '#2a1005';
  ctx.fillRect(0, 0, size, size);
  const rng = makeRng(7717);
  ctx.lineCap = 'round';
  for (let i = 0; i < 26; i++) {
    const y0 = (i / 26) * size + rng() * 8;
    ctx.beginPath();
    ctx.strokeStyle = `rgba(255, ${150 + Math.floor(rng() * 70)}, ${60 + Math.floor(rng() * 60)}, ${
      0.55 + rng() * 0.35
    })`;
    ctx.lineWidth = 5 + rng() * 9;
    for (let x = 0; x <= size; x += 8) {
      const y = y0 + Math.sin((x / size) * Math.PI * (2 + Math.floor(rng() * 3)) + i) * 14;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Low-contrast organic grain for bump maps. */
export function grainTexture(size = 256, seed = 42): THREE.Texture {
  const { canvas, ctx } = surface(size);
  const rng = makeRng(seed);
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const v = 108 + Math.floor(rng() * 60);
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 3);
  return tex;
}

/** Fine speckle used for cytoplasm particles and ribosome sparkle. */
export function speckleTexture(size = 256): THREE.Texture {
  const { canvas, ctx } = surface(size);
  ctx.fillStyle = 'rgba(0,0,0,0)';
  ctx.clearRect(0, 0, size, size);
  const rng = makeRng(913);
  for (let i = 0; i < 900; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const r = 0.4 + rng() * 1.7;
    ctx.beginPath();
    ctx.fillStyle = `rgba(190,235,255,${0.08 + rng() * 0.5})`;
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Canvas label texture for knowledge nodes / organelle name chips. */
export function labelTexture(text: string, color = '#dff6ff', sub?: string): THREE.Texture {
  const pad = 24;
  const measure = document.createElement('canvas').getContext('2d');
  if (!measure) throw new Error('2D canvas unavailable');
  const font = '600 52px "Space Grotesk", system-ui, sans-serif';
  measure.font = font;
  const width = Math.ceil(measure.measureText(text).width) + pad * 2;
  const height = sub ? 118 : 76;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(64, width);
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');

  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  const y = sub ? 42 : height / 2;
  // A dark halo, drawn before the coloured fill, keeps labels readable when a node or a bloom
  // halo sits behind them. depthTest is off, so the label itself is always on top; without the
  // halo a yellow label over a yellow node simply disappeared.
  ctx.strokeStyle = 'rgba(2, 7, 14, 0.92)';
  ctx.lineWidth = 10;
  ctx.strokeText(text, canvas.width / 2, y);

  ctx.shadowColor = color;
  ctx.shadowBlur = 16;
  // Near-white text with a category-coloured glow: a label filled with its node's colour vanished
  // whenever it drifted over another node of the same colour.
  ctx.fillStyle = 'rgba(240, 250, 255, 0.98)';
  ctx.fillText(text, canvas.width / 2, y);
  if (sub) {
    ctx.shadowBlur = 0;
    ctx.font = '500 32px Inter, system-ui, sans-serif';
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(2, 7, 14, 0.9)';
    ctx.strokeText(sub, canvas.width / 2, 84);
    ctx.fillStyle = 'rgba(200,226,245,0.66)';
    ctx.fillText(sub, canvas.width / 2, 84);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
