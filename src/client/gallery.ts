import { randomSkin } from '../shared/br/skin';
import { G } from '../shared/br/map';
import { createRng } from '../shared/rng';
import { ITEM_KINDS } from '../shared/br/items';
import { buildAssets, roofSprite } from './pixel/art';
import { catSprites } from './pixel/cat';

const canvas = document.getElementById('g') as HTMLCanvasElement;
const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
ctx.imageSmoothingEnabled = false;
ctx.fillStyle = '#2a3140';
ctx.fillRect(0, 0, canvas.width, canvas.height);
const A = buildAssets();
const S = 3;
let x = 4;
let y = 4;
const next = (w: number, h: number): void => {
  x += w * S + 6;
  if (x > canvas.width - 80) {
    x = 4;
    y += h * S + 6;
  }
};
const put = (c: HTMLCanvasElement): void => {
  ctx.drawImage(c, x, y, c.width * S, c.height * S);
  next(c.width, c.height);
};
const row = (h = 16): void => {
  x = 4;
  y += h * S + 8;
};
const putS = (c: HTMLCanvasElement, k: number): void => {
  ctx.drawImage(c, x, y, c.width * k, c.height * k);
  x += c.width * k + 8;
  if (x > canvas.width - 140) {
    x = 4;
    y += c.height * k + 6;
  }
};
const rng = createRng(77);
for (let i = 0; i < 8; i++) {
  const sk = i === 0 ? { base: 0, paint: '0'.repeat(384) } : randomSkin(rng);
  const s = catSprites(sk);
  for (const f of s.right) putS(f, 5);
  putS(s.left[0] as HTMLCanvasElement, 5);
  if (i % 2 === 1) {
    x = 4;
    y += 5 * 18 + 6;
  }
}

x = 4;
y += 5 * 18 + 10;
const ids = [
  G.GRASS,
  G.GRASS2,
  G.GRASS3,
  G.FLOWER,
  G.FLOWER2,
  G.PATH,
  G.WOOD,
  G.WOOD2,
  G.DECK,
  G.DECK2,
  G.CARPET,
  G.HEDGE,
  G.HOUSEWALL,
  G.WALLTOP,
  G.POOLEDGE,
  G.BEDSHADE,
];
for (const id of ids) put(A.ground(id, 3, 5));
row();
for (const w of A.water) put(w);
for (const c of [
  A.chest.closed,
  A.chest.open,
  A.chest.goldClosed,
  A.chest.goldOpen,
  A.tomb,
  ...A.wall,
])
  put(c);
row();
for (const k of ITEM_KINDS) put(A.icon[k]);
put(A.heart);
put(A.shieldBadge);
put(A.can);
put(A.paw);
row(20);
const props: [string, number, number][] = [
  ['tree', 1, 1],
  ['tree', 1, 1],
  ['pine', 1, 1],
  ['palm', 1, 1],
  ['bush', 1, 1],
  ['rock', 1, 1],
  ['log', 1, 1],
  ['crate', 1, 1],
  ['plant', 1, 1],
  ['sunbed', 2, 1],
  ['parasol', 1, 1],
];
props.forEach(([k, w, h], i) => {
  const s = A.prop(k as never, w, h, i);
  if (s) put(s);
});
row(44);
for (const [k, w, h] of [
  ['table', 3, 2],
  ['couch', 4, 2],
  ['shelf', 3, 1],
  ['cattree', 2, 2],
] as [string, number, number][]) {
  const s = A.prop(k as never, w, h, 1);
  if (s) put(s);
}
for (const k of ['house', 'bed', 'cabin'] as const) put(roofSprite(k, 6, 4, 1));
row(30);
