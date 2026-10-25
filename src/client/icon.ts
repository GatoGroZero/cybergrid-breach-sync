// Herramienta de desarrollo: dibuja el icono del juego (gato con corona) para generar los PNG y el SVG.
// Se abre con /icon.html?size=512 y se captura con Playwright.
import { defaultSkin } from '../shared/br/skin';
import { C, art, make, outline } from './pixel/draw';
import { CAT_PAD, catSprites } from './pixel/cat';

const params = new URLSearchParams(window.location.search);
const size = Number(params.get('size') ?? 512);
const mode = params.get('mode') ?? 'png';

/** Dibujo base en una cuadricula de 32 x 32 pixeles. */
function build(): HTMLCanvasElement {
  const [cv, c] = make(32, 32);
  c.fillStyle = C.black;
  c.fillRect(0, 0, 32, 32);
  c.fillStyle = '#232a4a';
  for (const [x, y] of [
    [3, 3],
    [9, 6],
    [27, 4],
    [14, 2],
    [29, 12],
    [2, 13],
  ] as const)
    c.fillRect(x, y, 1, 1);
  c.fillStyle = '#29366f';
  c.fillRect(0, 24, 32, 8);
  c.fillStyle = C.blue;
  c.fillRect(0, 24, 32, 1);
  const cat = catSprites(defaultSkin(0)).right[0] as HTMLCanvasElement;
  c.drawImage(cat, 3, 9 - CAT_PAD);
  const crown = outline(
    art(['G...G...G', 'GG.GGG.GG', 'GGGGGGGGG', 'GGGRGGGGG', 'OOOOOOOOO'], {
      G: C.yellow,
      O: C.orange,
      R: C.red,
    }),
    C.black,
  );
  c.drawImage(crown, 18, 7);
  return cv;
}

const base = build();
const out = document.getElementById('c') as HTMLCanvasElement;
if (mode === 'svg') {
  const ctx = base.getContext('2d') as CanvasRenderingContext2D;
  const data = ctx.getImageData(0, 0, 32, 32).data;
  const rects: string[] = [];
  for (let y = 0; y < 32; y++) {
    let x = 0;
    while (x < 32) {
      const i = (y * 32 + x) * 4;
      const col = `#${[0, 1, 2].map((k) => (data[i + k] as number).toString(16).padStart(2, '0')).join('')}`;
      let w = 1;
      while (x + w < 32) {
        const j = (y * 32 + x + w) * 4;
        if (data[j] === data[i] && data[j + 1] === data[i + 1] && data[j + 2] === data[i + 2]) w++;
        else break;
      }
      rects.push(`<rect x="${x}" y="${y}" width="${w}" height="1" fill="${col}"/>`);
      x += w;
    }
  }
  document.body.dataset.svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" shape-rendering="crispEdges">${rects.join('')}</svg>`;
  out.width = out.height = 1;
} else {
  out.width = out.height = size;
  const ctx = out.getContext('2d') as CanvasRenderingContext2D;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(base, 0, 0, size, size);
}
document.body.dataset.ready = '1';
