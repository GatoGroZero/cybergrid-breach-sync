import { G, generateMap } from '../shared/br/map';
import { buildAssets } from './pixel/art';
import { MOB } from '../shared/br/adventure';
import { vineGateTile } from './pixel/art-bosque';
import { hostileShotSprite, mobSprite } from './pixel/art-mobs';
import { make } from './pixel/draw';
import { paintWorld } from './pixel/world';
import {
  SCENE_INFO,
  SceneArt,
  SceneMotion,
  Stage,
  STAGE_H,
  STAGE_W,
  type SceneId,
} from './ui/escenarios';
import { buildPostal } from './ui/postales';
import { defaultSkin } from '../shared/br/skin';

/** Pagina de desarrollo del bosque encantado: terreno, props, puertas y un pedazo del mapa. */
const canvas = document.getElementById('g') as HTMLCanvasElement;
const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
ctx.imageSmoothingEnabled = false;
ctx.fillStyle = '#2a3140';
ctx.fillRect(0, 0, canvas.width, canvas.height);
const A = buildAssets();
const S = 4;
let x = 6;
let y = 6;
const put = (c: HTMLCanvasElement, k = S): void => {
  ctx.drawImage(c, x, y, c.width * k, c.height * k);
  x += c.width * k + 8;
};
const row = (h: number): void => {
  x = 6;
  y += h * S + 8;
};
const view = new URLSearchParams(window.location.search).get('ver') ?? 'mapa';
if (view === 'lobby') {
  const art = new SceneArt(A);
  canvas.width = 1300;
  canvas.height = 1100;
  ctx.fillStyle = '#2a3140';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const ids = Object.keys(SCENE_INFO) as SceneId[];
  const motions = ids.map((id) => new SceneMotion(id, STAGE_W, STAGE_H));
  const catsFor = (i: number) =>
    Array.from({ length: 1 + (i % 4) * 2 }, (_, k) => defaultSkin((i + k) % 8));
  const draw = (t: number): void => {
    ids.forEach((id, i) => {
      const [cv, c] = make(STAGE_W, STAGE_H);
      c.drawImage(art.background(id, STAGE_W, STAGE_H), 0, 0);
      motions[i]!.paint(c, t);
      const X = 8 + (i % 3) * 432;
      const Y = 8 + Math.floor(i / 3) * 250;
      ctx.drawImage(cv, X, Y, STAGE_W * 1.33, STAGE_H * 1.33);
      ctx.fillStyle = '#fff';
      ctx.font = '14px monospace';
      ctx.fillText(SCENE_INFO[id].name, X + 6, Y + 14);
    });
    (['br', 'techo', 'territorio', 'aventura'] as const).forEach((m, i) => {
      const p = buildPostal(m, art, defaultSkin(1));
      ctx.drawImage(p, 8 + i * 330, 790, p.width * 2, p.height * 2);
    });
    void catsFor;
    requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);
  void Stage;
  throw new Error('fin');
}
if (view === 'mobs') {
  // flujo simple: cada dibujo a escala 4 y salto de linea cuando no cabe
  const K = 4;
  let rowH = 0;
  const flow = (c: HTMLCanvasElement, k = K): void => {
    if (x + c.width * k > canvas.width - 6) {
      x = 6;
      y += rowH + 10;
      rowH = 0;
    }
    ctx.drawImage(c, x, y, c.width * k, c.height * k);
    x += c.width * k + 10;
    rowH = Math.max(rowH, c.height * k);
  };
  canvas.height = 1500;
  ctx.fillStyle = '#2a3140';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (const k of Object.values(MOB)) for (const f of mobSprite(k).frames) flow(f);
  x = 6;
  y += rowH + 20;
  rowH = 0;
  for (let k = 64; k <= 70; k++) flow(hostileShotSprite(k), 6);
  throw new Error('fin');
}
for (const id of [G.MUSGO, G.RUNAS, G.HONGOS, G.CHARCO, G.ZARZAL, G.PATH])
  for (let v = 0; v < 4; v++) put(A.ground(id, v, 0));
row(16);
const props = [
  'mushroom',
  'mushroom',
  'mushroom',
  'statue',
  'crystal',
  'crystal',
  'crystal',
  'stump',
  'stump',
  'ruin',
  'ruin',
  'ruin',
];
props.forEach((k, i) => {
  const s = A.prop(k as never, 1, 1, i);
  if (s) put(s);
});
for (let i = 0; i < 4; i++) put(vineGateTile(i));
row(30);
// un trozo del mapa real (el claro de inicio y los primeros)
const map = generateMap(
  'encantado',
  Number(new URLSearchParams(window.location.search).get('seed') ?? 4321),
);
const [cv, c] = make(map.w * 16, map.h * 16);
for (let ty = 0; ty < map.h; ty++)
  for (let tx = 0; tx < map.w; tx++) {
    const t = A.ground(map.ground[ty * map.w + tx] as number, tx, ty);
    if (t) c.drawImage(t, tx * 16, ty * 16);
  }
paintWorld(c, map);
for (const p of map.props) {
  const s = A.prop(p.kind, p.w, p.h, (p.x * 7 + p.y * 13) % 4);
  if (s)
    c.drawImage(
      s,
      Math.round(p.x * 16 + (p.w * 16 - s.width) / 2),
      (p.y + p.h) * 16 - s.height + 2,
    );
}
ctx.drawImage(cv, 0, 0, 440, 300, 6, y, 1260, 857);
