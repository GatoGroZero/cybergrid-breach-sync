import { OUTFITS } from '../shared/br/outfits';
import { defaultSkin } from '../shared/br/skin';
import { catSprites } from './pixel/cat';

/** Pagina de desarrollo: cada traje con varios marcos y pelajes. `?o=3` muestra solo el traje 3. */
const canvas = document.getElementById('g') as HTMLCanvasElement;
const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
const only = Number(new URLSearchParams(window.location.search).get('o') ?? 0);
const S = only > 0 ? 10 : 5;
const list = OUTFITS.map((o, i) => ({ o, code: i + 1 })).filter(
  (e) => only === 0 || e.code === only,
);
const rowH = (7 + 18) * S + 22;
canvas.height = list.length * rowH + 10;
canvas.width = 1280;
ctx.imageSmoothingEnabled = false;
ctx.fillStyle = '#2a3140';
ctx.fillRect(0, 0, canvas.width, canvas.height);
list.forEach(({ o, code }, i) => {
  const y = 4 + i * rowH;
  ctx.fillStyle = '#f4f4f4';
  ctx.font = '14px monospace';
  ctx.fillText(`${code} ${o.name}`, 4, y + 14);
  let x = 4;
  const shots: [number, number][] = [
    [0, 0],
    [0, 1],
    [0, 3],
    [0, 4],
    [1, 0],
    [2, 0],
    [3, 0],
  ];
  for (const [base, frame] of shots) {
    const sprites = catSprites({ ...defaultSkin(base), outfit: code });
    const c = sprites.right[frame] as HTMLCanvasElement;
    ctx.drawImage(c, x, y + 20, c.width * S, c.height * S);
    x += c.width * S + 4;
  }
});
