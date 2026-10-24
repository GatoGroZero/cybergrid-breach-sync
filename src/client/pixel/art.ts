import { TILE } from '../../shared/br/constants';
import type { ItemKind, WeaponKind } from '../../shared/br/items';
import { G, type PropKind } from '../../shared/br/map';
import {
  C,
  art,
  disc,
  ell,
  hash,
  line,
  make,
  outline,
  px,
  rect,
  rngFor,
  shade,
  type Ctx,
} from './draw';

const T = TILE;

// ------------------------------------------------------------------ terrenos

function speckle(c: Ctx, rngKey: number[], color: string, count: number, size = 1): void {
  const rng = rngFor(...rngKey);
  for (let i = 0; i < count; i++)
    rect(c, rng.int(0, T - size), rng.int(0, T - size), size, size, color);
}

function tuft(c: Ctx, x: number, y: number, color: string): void {
  px(c, x, y, color);
  px(c, x - 1, y - 1, color);
  px(c, x + 1, y - 1, color);
}

function flower(c: Ctx, x: number, y: number, petal: string): void {
  px(c, x, y - 1, petal);
  px(c, x - 1, y, petal);
  px(c, x + 1, y, petal);
  px(c, x, y + 1, petal);
  px(c, x, y, C.yellow);
}

function grassTile(variant: number, id: number): HTMLCanvasElement {
  const [cv, c] = make(T, T);
  rect(c, 0, 0, T, T, C.grass);
  speckle(c, [1, id, variant], C.grassD, id === G.GRASS2 ? 14 : 8);
  const rng = rngFor(2, id, variant);
  for (let i = 0; i < (id === G.GRASS3 ? 6 : 3); i++)
    tuft(c, rng.int(2, 13), rng.int(3, 14), C.grassL);
  if (id === G.FLOWER || id === G.FLOWER2) {
    const petal = id === G.FLOWER ? C.white : C.pink;
    flower(c, rng.int(3, 12), rng.int(3, 12), petal);
    if (rng.chance(0.6))
      flower(c, rng.int(3, 12), rng.int(3, 12), id === G.FLOWER ? C.yellow : C.orange);
  }
  return cv;
}

function planks(base: string, line1: string, variant: number): HTMLCanvasElement {
  const [cv, c] = make(T, T);
  rect(c, 0, 0, T, T, base);
  for (let y = 0; y < T; y += 5) rect(c, 0, y, T, 1, line1);
  const rng = rngFor(3, variant);
  for (let row = 0; row < 3; row++) {
    const x = rng.int(2, 13);
    rect(c, x, row * 5 + 1, 1, 4, line1);
  }
  speckle(c, [4, variant], shade(base, 1.08), 5);
  return cv;
}

function waterFrame(f: number): HTMLCanvasElement {
  const [cv, c] = make(T, T);
  rect(c, 0, 0, T, T, C.sky);
  rect(c, 0, 8, T, 8, '#3b87e0');
  for (let i = 0; i < 3; i++) {
    const y = 2 + i * 5;
    const off = (f * 3 + i * 5) % T;
    for (let x = 0; x < 6; x++) px(c, (x + off) % T, y + (x % 2), C.cyan);
    for (let x = 0; x < 3; x++) px(c, (x + off + 9) % T, y + 2, C.white);
  }
  return cv;
}

function groundTile(id: number, variant: number): HTMLCanvasElement {
  switch (id) {
    case G.GRASS:
    case G.GRASS2:
    case G.GRASS3:
    case G.FLOWER:
    case G.FLOWER2:
      return grassTile(variant, id);
    case G.DIRT:
    case G.PATH: {
      const [cv, c] = make(T, T);
      rect(c, 0, 0, T, T, C.dirt);
      speckle(c, [5, variant], C.dirtD, 9);
      speckle(c, [6, variant], '#cfa577', 6);
      const r = rngFor(7, variant);
      for (let i = 0; i < 2; i++) disc(c, r.int(2, 13), r.int(2, 13), 1, C.lgray);
      return cv;
    }
    case G.WOOD:
      return planks('#d5a27a', '#a8754f', variant);
    case G.WOOD2:
      return planks('#c4906a', '#8f6240', variant + 9);
    case G.DECK:
    case G.DECK2: {
      const [cv, c] = make(T, T);
      const base = id === G.DECK ? C.deck : '#e0cfa8';
      rect(c, 0, 0, T, T, base);
      rect(c, 0, 0, T, 1, C.deckD);
      rect(c, 0, 0, 1, T, C.deckD);
      speckle(c, [8, variant, id], '#f2e6c8', 6);
      return cv;
    }
    case G.CARPET: {
      const [cv, c] = make(T, T);
      rect(c, 0, 0, T, T, '#b13e53');
      for (let y = 0; y < T; y += 4)
        for (let x = (y / 4) % 2 === 0 ? 0 : 2; x < T; x += 4) px(c, x, y, '#d9667a');
      return cv;
    }
    case G.TILE:
    case G.SAND: {
      const [cv, c] = make(T, T);
      rect(c, 0, 0, T, T, '#d9d2c0');
      rect(c, 0, 0, T, 1, '#bdb59f');
      return cv;
    }
    case G.WALLTOP: {
      const [cv, c] = make(T, T);
      rect(c, 0, 0, T, T, C.brick);
      for (let y = 0; y < T; y += 4) {
        rect(c, 0, y, T, 1, C.brickL);
        const off = (y / 4) % 2 === 0 ? 0 : 4;
        for (let x = off; x < T; x += 8) rect(c, x, y, 1, 4, C.brickL);
      }
      return cv;
    }
    case G.HEDGE: {
      const [cv, c] = make(T, T);
      rect(c, 0, 0, T, T, C.hedge);
      const r = rngFor(9, variant);
      for (let i = 0; i < 7; i++) disc(c, r.int(1, 14), r.int(1, 14), 2.2, C.hedgeL);
      speckle(c, [10, variant], '#134a2e', 8);
      return cv;
    }
    case G.POOLEDGE: {
      const [cv, c] = make(T, T);
      rect(c, 0, 0, T, T, C.stone);
      rect(c, 0, T - 2, T, 2, '#b9d6e8');
      speckle(c, [11, variant], '#cfc9b3', 6);
      return cv;
    }
    case G.HOUSEWALL: {
      const [cv, c] = make(T, T);
      rect(c, 0, 0, T, T, '#a26d3f');
      for (let x = 0; x < T; x += 4) rect(c, x, 0, 1, T, '#7a4e2c');
      rect(c, 0, 0, T, 2, '#c28b5a');
      rect(c, 0, T - 2, T, 2, '#6d4530');
      return cv;
    }
    case G.BEDSHADE: {
      const [cv, c] = make(T, T);
      rect(c, 0, 0, T, T, '#7a5539');
      speckle(c, [12, variant], '#6a4a32', 8);
      return cv;
    }
    default:
      return grassTile(variant, G.GRASS);
  }
}

// ------------------------------------------------------------------ props

export interface Sprite {
  canvas: HTMLCanvasElement;
}

function treeSprite(v: number): HTMLCanvasElement {
  const [cv, c] = make(34, 42);
  ell(c, 17, 39, 9, 2.5, 'rgba(26,28,44,0.3)');
  rect(c, 15, 28, 4, 11, C.woodDD);
  rect(c, 15, 28, 1, 11, '#8b5e3c');
  const rng = rngFor(20, v);
  const blobs: [number, number, number][] = [
    [17, 17, 10.5],
    [9, 21, 7.5],
    [25, 21, 7.5],
    [17, 9, 7],
    [11 + rng.int(-1, 1), 12, 6],
    [23 + rng.int(-1, 1), 12, 6],
  ];
  for (const [x, y, r] of blobs) disc(c, x, y, r, '#2d6a3e');
  for (const [x, y, r] of blobs) disc(c, x - 1, y - 1.5, r - 1.5, C.grass);
  for (const [x, y, r] of blobs.slice(0, 4)) disc(c, x - 3, y - 3.5, Math.max(2, r - 5), C.grassL);
  for (let i = 0; i < 18; i++) px(c, rng.int(4, 29), rng.int(4, 30), '#245a35');
  for (let i = 0; i < 10; i++) px(c, rng.int(6, 26), rng.int(4, 24), '#8ee06a');
  return outline(cv, '#16352a');
}

function pineSprite(v: number): HTMLCanvasElement {
  const [cv, c] = make(26, 44);
  ell(c, 13, 41, 7, 2.2, 'rgba(26,28,44,0.3)');
  rect(c, 11, 34, 4, 7, C.woodDD);
  const layers = 4;
  for (let i = 0; i < layers; i++) {
    const top = 3 + i * 8;
    const half = 4 + i * 2;
    for (let y = 0; y < 11; y++) {
      const w = Math.round((y / 10) * half);
      rect(c, 13 - w, top + y, w * 2 + 1, 1, y < 3 ? C.green : '#2d6a3e');
      if (w > 1) px(c, 13 - w + 1, top + y, C.lime);
    }
  }
  rngFor(21, v);
  return outline(cv, '#16352a');
}

function palmSprite(v: number): HTMLCanvasElement {
  const [cv, c] = make(36, 44);
  ell(c, 18, 41, 7, 2.2, 'rgba(26,28,44,0.3)');
  const pts: [number, number][] = [
    [17, 40],
    [18, 32],
    [19, 24],
    [21, 17],
    [22, 11],
  ];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1] as [number, number];
    const b = pts[i] as [number, number];
    line(c, a[0], a[1], b[0], b[1], '#a8754f');
    line(c, a[0] + 1, a[1], b[0] + 1, b[1], '#8b5e3c');
    line(c, a[0] + 2, a[1], b[0] + 2, b[1], '#a8754f');
  }
  const frond = (dx: number, dy: number, droop: number): void => {
    let x = 22;
    let y = 11;
    for (let i = 0; i < 11; i++) {
      x += dx;
      y += dy + (i > 4 ? droop : 0);
      px(c, x, y, C.green);
      px(c, x, y + 1, '#2d6a3e');
      px(c, x, y - 1, C.lime);
    }
  };
  frond(-1.5, -0.3, 0.5);
  frond(1.5, -0.3, 0.5);
  frond(-1, -1, 0.6);
  frond(1, -1, 0.6);
  frond(0, -1.1, 0.3);
  disc(c, 22, 12, 1.6, '#6d4530');
  rngFor(22, v);
  return outline(cv, '#16352a');
}

function bushSprite(): HTMLCanvasElement {
  const [cv, c] = make(16, 12);
  for (const [x, y, r] of [
    [5, 7, 4.5],
    [11, 7, 4.5],
    [8, 5, 4.5],
  ] as const) {
    disc(c, x, y, r, '#2d6a3e');
    disc(c, x - 0.5, y - 1, r - 1.3, C.grass);
  }
  px(c, 6, 3, C.grassL);
  px(c, 10, 5, C.grassL);
  px(c, 9, 4, C.pink);
  return outline(cv, '#16352a');
}

function rockSprite(): HTMLCanvasElement {
  const [cv, c] = make(16, 12);
  ell(c, 8, 7, 7, 4.5, C.gray);
  ell(c, 7, 6, 5.5, 3.2, C.lgray);
  px(c, 5, 4, C.white);
  px(c, 6, 4, C.white);
  px(c, 11, 8, C.dgray);
  return outline(cv, C.black);
}

function logSprite(): HTMLCanvasElement {
  const [cv, c] = make(16, 10);
  rect(c, 1, 2, 14, 6, '#8b5e3c');
  rect(c, 1, 2, 14, 2, '#a8754f');
  rect(c, 1, 6, 14, 2, '#6d4530');
  ell(c, 2, 5, 1.8, 3, '#d5a27a');
  px(c, 2, 5, '#8b5e3c');
  return outline(cv, C.black);
}

function crateSprite(): HTMLCanvasElement {
  const [cv, c] = make(16, 16);
  rect(c, 1, 2, 14, 13, '#c28b5a');
  rect(c, 1, 2, 14, 2, '#d9a574');
  rect(c, 1, 2, 2, 13, '#8b5e3c');
  rect(c, 13, 2, 2, 13, '#8b5e3c');
  rect(c, 1, 13, 14, 2, '#8b5e3c');
  line(c, 3, 4, 12, 12, '#8b5e3c');
  line(c, 12, 4, 3, 12, '#8b5e3c');
  return outline(cv, C.black);
}

function tableSprite(w: number, h: number): HTMLCanvasElement {
  const W = w * T;
  const H = h * T;
  const [cv, c] = make(W, H + 6);
  ell(c, W / 2, H + 3, W / 2 - 2, 3, 'rgba(26,28,44,0.28)');
  rect(c, 2, H - 3, 3, 8, C.woodDD);
  rect(c, W - 5, H - 3, 3, 8, C.woodDD);
  rect(c, 1, 2, W - 2, H - 8, '#c28b5a');
  rect(c, 1, 2, W - 2, 2, '#e0b088');
  rect(c, 1, H - 8 + 2, W - 2, 3, '#8b5e3c');
  px(c, 4, 5, '#a8754f');
  px(c, W - 6, 6, '#a8754f');
  return outline(cv, C.black);
}

function couchSprite(w: number, h: number, v: number): HTMLCanvasElement {
  const W = w * T;
  const H = h * T;
  const col = [C.purple, C.teal, C.red, C.navy][v % 4] as string;
  const [cv, c] = make(W, H + 10);
  ell(c, W / 2, H + 7, W / 2 - 3, 3, 'rgba(26,28,44,0.28)');
  rect(c, 3, H + 4, 4, 4, C.woodDD);
  rect(c, W - 7, H + 4, 4, 4, C.woodDD);
  rect(c, 1, 2, W - 2, 16, shade(col, 1.25));
  rect(c, 1, 2, W - 2, 3, shade(col, 1.5));
  rect(c, 1, 12, 8, H - 6, col);
  rect(c, W - 9, 12, 8, H - 6, col);
  rect(c, 9, 16, W - 18, H - 8, shade(col, 1.12));
  const mid = Math.round(W / 2);
  rect(c, mid, 17, 1, H - 9, shade(col, 0.8));
  rect(c, 9, H + 5 - 3, W - 18, 2, shade(col, 0.8));
  return outline(cv, C.black);
}

function shelfSprite(w: number, v: number): HTMLCanvasElement {
  const W = w * T;
  const [cv, c] = make(W, 30);
  rect(c, 0, 0, W, 28, '#6d4530');
  rect(c, 2, 2, W - 4, 11, '#3a2a22');
  rect(c, 2, 15, W - 4, 11, '#3a2a22');
  const rng = rngFor(30, v);
  const books = [C.red, C.blue, C.green, C.yellow, C.orange, C.purple, C.sky];
  for (const y of [3, 16]) {
    let x = 3;
    while (x < W - 6) {
      const bw = rng.int(2, 3);
      rect(c, x, y, bw, 9, rng.pick(books));
      x += bw + 1;
    }
  }
  rect(c, 0, 27, W, 2, '#4a3224');
  return outline(cv, C.black);
}

function plantSprite(v: number): HTMLCanvasElement {
  const [cv, c] = make(16, 24);
  ell(c, 8, 21, 6, 2, 'rgba(26,28,44,0.28)');
  rect(c, 4, 14, 8, 7, '#c4663f');
  rect(c, 3, 13, 10, 2, '#e08a5e');
  for (const [x, y, r] of [
    [8, 8, 4],
    [4, 10, 3],
    [12, 10, 3],
    [8, 4, 3],
  ] as const) {
    disc(c, x, y, r, '#2d6a3e');
    disc(c, x - 0.5, y - 0.5, r - 1, C.green);
  }
  px(c, 7, 3, C.lime);
  rngFor(31, v);
  return outline(cv, C.black);
}

function catTreeSprite(): HTMLCanvasElement {
  const [cv, c] = make(32, 50);
  ell(c, 16, 46, 14, 3, 'rgba(26,28,44,0.28)');
  rect(c, 3, 40, 26, 5, '#8b5e3c');
  rect(c, 3, 40, 26, 2, '#a8754f');
  rect(c, 13, 14, 6, 27, '#d9b98a');
  for (let y = 16; y < 40; y += 3) rect(c, 13, y, 6, 1, '#b89868');
  rect(c, 4, 22, 14, 4, '#5d275d');
  rect(c, 4, 22, 14, 1, '#8a4a8a');
  rect(c, 8, 8, 18, 5, '#b13e53');
  rect(c, 8, 8, 18, 1, '#d9667a');
  line(c, 24, 13, 24, 19, C.gray);
  disc(c, 24, 20, 1.5, C.yellow);
  return outline(cv, C.black);
}

function sunbedSprite(v: number): HTMLCanvasElement {
  const [cv, c] = make(32, 16);
  ell(c, 16, 13, 14, 2.5, 'rgba(26,28,44,0.28)');
  rect(c, 1, 5, 30, 6, '#f4f4f4');
  for (let x = 1; x < 30; x += 6) rect(c, x, 5, 3, 6, v % 2 ? C.sky : C.pink);
  rect(c, 1, 3, 8, 3, C.lgray);
  rect(c, 2, 11, 2, 3, C.gray);
  rect(c, 27, 11, 2, 3, C.gray);
  return outline(cv, C.black);
}

function parasolSprite(v: number): HTMLCanvasElement {
  const [cv, c] = make(38, 44);
  ell(c, 19, 41, 6, 2, 'rgba(26,28,44,0.28)');
  rect(c, 18, 14, 2, 27, '#d9d2c0');
  const colors = v % 2 ? [C.red, C.white] : [C.sky, C.white];
  for (let y = 0; y < 14; y++) {
    const w = Math.round(17 * Math.sqrt(1 - ((13 - y) / 14) ** 2));
    for (let x = -w; x <= w; x++)
      px(c, 19 + x, 2 + y, colors[Math.floor((x + w) / 4) % 2] as string);
  }
  rect(c, 12, 15, 14, 1, C.lgray);
  return outline(cv, C.black);
}

function duckSprite(): HTMLCanvasElement {
  const [cv, c] = make(10, 9);
  ell(c, 4, 6, 3.5, 2.2, C.yellow);
  disc(c, 7, 3, 2, C.yellow);
  px(c, 9, 4, C.orange);
  px(c, 8, 2, C.black);
  return outline(cv, C.black);
}

// ------------------------------------------------------------------ cofres, lapidas, muros

function chestSprite(open: boolean, golden: boolean): HTMLCanvasElement {
  const body = golden ? '#ffcd75' : '#a8754f';
  const bodyD = golden ? '#ef7d57' : '#6d4530';
  const lid = golden ? '#ffe9a8' : '#c28b5a';
  const [cv, c] = make(16, 16);
  ell(c, 8, 14, 7, 2, 'rgba(26,28,44,0.3)');
  rect(c, 2, 7, 12, 7, body);
  rect(c, 2, 7, 12, 1, lid);
  rect(c, 2, 12, 12, 2, bodyD);
  rect(c, 2, 7, 2, 7, bodyD);
  rect(c, 12, 7, 2, 7, bodyD);
  if (!open) {
    rect(c, 2, 3, 12, 5, lid);
    rect(c, 3, 2, 10, 2, lid);
    rect(c, 2, 7, 12, 1, bodyD);
    rect(c, 2, 3, 2, 5, bodyD);
    rect(c, 12, 3, 2, 5, bodyD);
    rect(c, 7, 6, 2, 3, golden ? C.red : C.yellow);
    px(c, 7, 7, C.white);
  } else {
    rect(c, 3, 7, 10, 2, '#1a1c2c');
    rect(c, 3, 0, 10, 4, lid);
    rect(c, 3, 0, 2, 4, bodyD);
    rect(c, 11, 0, 2, 4, bodyD);
    px(c, 5, 8, C.yellow);
    px(c, 9, 7, C.white);
    px(c, 11, 8, C.yellow);
  }
  return outline(cv, C.black);
}

function tombSprite(): HTMLCanvasElement {
  const [cv, c] = make(16, 16);
  ell(c, 8, 14, 7, 2, 'rgba(26,28,44,0.3)');
  ell(c, 8, 10, 5, 4, C.lgray);
  ell(c, 8, 10, 4, 3, '#b7c6d2');
  for (const [x, y] of [
    [2.5, 6],
    [5.5, 3],
    [10.5, 3],
    [13.5, 6],
  ] as const) {
    disc(c, x, y, 1.9, C.lgray);
    px(c, x - 0.5, y - 0.5, '#b7c6d2');
  }
  px(c, 7, 11, C.gray);
  px(c, 9, 11, C.gray);
  return outline(cv, C.black);
}

/** 4 etapas de desgaste: entero, rajado, muy rajado y casi roto. */
function wallSprite(stage: number): HTMLCanvasElement {
  const [cv, c] = make(T, T);
  rect(c, 0, 0, T, T, '#b9835a');
  for (let y = 0; y < T; y += 5) rect(c, 0, y, T, 1, '#7a4e2c');
  for (let y = 0; y < T; y += 5) {
    const x = (y / 5) % 2 === 0 ? 5 : 11;
    rect(c, x, y, 1, 5, '#7a4e2c');
  }
  rect(c, 0, 0, T, 2, '#d9a574');
  px(c, 2, 3, C.gray);
  px(c, 13, 3, C.gray);
  px(c, 2, 12, C.gray);
  px(c, 13, 12, C.gray);
  if (stage >= 1) {
    line(c, 8, 1, 6, 6, C.black);
    line(c, 6, 6, 9, 10, C.black);
  }
  if (stage >= 2) {
    line(c, 3, 14, 7, 9, C.black);
    line(c, 12, 2, 14, 8, C.black);
    rect(c, 10, 11, 3, 3, 'rgba(0,0,0,0)');
    c.clearRect(10, 11, 3, 3);
  }
  if (stage >= 3) {
    c.clearRect(1, 1, 4, 5);
    c.clearRect(8, 7, 5, 4);
    line(c, 5, 5, 9, 12, C.black);
  }
  return outline(cv, C.black);
}

// ------------------------------------------------------------------ iconos de objetos

const GUN = { body: '#566c86', dark: '#333c57', light: '#94b0c2', grip: '#8b5e3c', gold: C.yellow };

function weaponIcon(kind: WeaponKind): HTMLCanvasElement {
  const [cv, c] = make(16, 16);
  switch (kind) {
    case 'pistol':
      rect(c, 3, 5, 10, 3, GUN.body);
      rect(c, 3, 5, 10, 1, GUN.light);
      rect(c, 9, 8, 4, 1, GUN.dark);
      rect(c, 4, 8, 3, 5, GUN.grip);
      rect(c, 7, 8, 2, 2, GUN.dark);
      px(c, 12, 4, GUN.dark);
      break;
    case 'shotgun':
      rect(c, 1, 6, 14, 2, GUN.body);
      rect(c, 1, 6, 14, 1, GUN.light);
      rect(c, 1, 8, 9, 1, GUN.dark);
      rect(c, 1, 9, 5, 3, GUN.grip);
      rect(c, 6, 9, 3, 2, '#6d4530');
      rect(c, 14, 5, 1, 1, GUN.gold);
      break;
    case 'sniper':
      rect(c, 0, 7, 16, 2, GUN.dark);
      rect(c, 0, 7, 16, 1, GUN.body);
      rect(c, 3, 4, 6, 3, GUN.dark);
      disc(c, 4.5, 5.5, 1, C.cyan);
      rect(c, 2, 9, 5, 3, GUN.grip);
      rect(c, 8, 9, 2, 3, GUN.dark);
      break;
    case 'bazooka':
      rect(c, 1, 5, 14, 5, '#5a6b3f');
      rect(c, 1, 5, 14, 2, '#7d9358');
      rect(c, 0, 4, 3, 7, GUN.dark);
      rect(c, 14, 4, 2, 7, C.red);
      rect(c, 6, 10, 2, 4, GUN.grip);
      rect(c, 9, 3, 3, 2, GUN.dark);
      break;
    case 'rifle':
      rect(c, 0, 7, 15, 2, GUN.body);
      rect(c, 0, 7, 15, 1, GUN.light);
      rect(c, 0, 8, 5, 3, GUN.grip);
      rect(c, 6, 9, 3, 4, GUN.dark);
      rect(c, 5, 5, 6, 2, GUN.dark);
      px(c, 14, 6, GUN.gold);
      break;
  }
  return outline(cv, C.black);
}

function ammoIcon(kind: WeaponKind): HTMLCanvasElement {
  const [cv, c] = make(16, 16);
  const tint: Record<WeaponKind, string> = {
    pistol: C.yellow,
    shotgun: C.red,
    sniper: C.sky,
    bazooka: C.orange,
    rifle: C.lime,
  };
  rect(c, 2, 6, 12, 8, '#6b5b4a');
  rect(c, 2, 6, 12, 2, '#8a7660');
  rect(c, 2, 11, 12, 1, tint[kind]);
  if (kind === 'pistol' || kind === 'rifle') {
    for (let i = 0; i < 3; i++) {
      rect(c, 4 + i * 3, 2, 2, 4, tint[kind]);
      px(c, 4 + i * 3, 1, '#d9a574');
    }
  } else if (kind === 'shotgun') {
    for (let i = 0; i < 3; i++) {
      rect(c, 4 + i * 3, 3, 2, 3, C.red);
      rect(c, 4 + i * 3, 2, 2, 1, C.yellow);
    }
  } else if (kind === 'sniper') {
    for (let i = 0; i < 2; i++) {
      rect(c, 5 + i * 4, 0, 2, 6, C.sky);
      px(c, 5 + i * 4, 0, C.white);
    }
  } else {
    rect(c, 6, 1, 4, 5, C.gray);
    rect(c, 5, 5, 6, 2, C.red);
    px(c, 7, 0, C.orange);
  }
  return outline(cv, C.black);
}

function medkitIcon(): HTMLCanvasElement {
  const [cv, c] = make(16, 16);
  rect(c, 2, 4, 12, 10, C.white);
  rect(c, 2, 4, 12, 2, '#d8e2ea');
  rect(c, 5, 2, 6, 3, C.lgray);
  rect(c, 7, 6, 2, 6, C.red);
  rect(c, 5, 8, 6, 2, C.red);
  return outline(cv, C.black);
}

function shieldIcon(): HTMLCanvasElement {
  const [cv, c] = make(16, 16);
  disc(c, 8, 10, 5, C.blue);
  disc(c, 7, 9, 3.5, C.sky);
  rect(c, 6, 2, 4, 4, '#d9d2c0');
  rect(c, 7, 1, 2, 2, '#8b5e3c');
  px(c, 5, 8, C.white);
  px(c, 6, 7, C.white);
  return outline(cv, C.black);
}

function wallIcon(): HTMLCanvasElement {
  const [cv, c] = make(16, 16);
  rect(c, 2, 2, 12, 12, '#b9835a');
  for (let y = 2; y < 14; y += 4) rect(c, 2, y, 12, 1, '#7a4e2c');
  rect(c, 8, 3, 1, 4, '#7a4e2c');
  rect(c, 5, 7, 1, 4, '#7a4e2c');
  rect(c, 2, 2, 12, 2, '#d9a574');
  px(c, 3, 4, C.gray);
  px(c, 12, 11, C.gray);
  return outline(cv, C.black);
}

// ------------------------------------------------------------------ interfaz

function heartIcon(): HTMLCanvasElement {
  return art(['.oo..oo.', 'orroorro', 'rwrrrrro', 'rrrrrrro', '.orrrro.', '..orro..', '...oo...'], {
    o: C.black,
    r: C.red,
    w: '#ff9fb2',
  });
}

function shieldBadge(): HTMLCanvasElement {
  return art(
    [
      '.oooooo.',
      'obbbbbbo',
      'obwbbbbo',
      'obbbbbbo',
      'obbbbbbo',
      '.obbbbo.',
      '..obbo..',
      '...oo...',
    ],
    {
      o: C.black,
      b: C.sky,
      w: C.white,
    },
  );
}

/** Lata de sardinas: el boton del inventario. */
function sardineCan(): HTMLCanvasElement {
  const [cv, c] = make(20, 14);
  ell(c, 10, 8, 9, 5, C.lgray);
  ell(c, 10, 7, 8, 4, '#d8e2ea');
  ell(c, 10, 7, 6, 3, C.sky);
  rect(c, 6, 6, 8, 2, C.red);
  px(c, 8, 6, C.white);
  px(c, 12, 7, C.white);
  rect(c, 16, 3, 3, 1, C.gray);
  px(c, 18, 4, C.gray);
  return outline(cv, C.black);
}

/** Silueta de pez de 64 x 11: la barra de estamina. Se llena de izquierda (cola) a derecha (cabeza). */
function fishMask(): HTMLCanvasElement {
  const [cv, c] = make(64, 11);
  ell(c, 38, 5.5, 23, 4.9, '#ffffff');
  for (let x = 0; x < 16; x++) {
    const half = 5 - x * 0.18;
    for (let y = 0; y < 11; y++) {
      const dy = Math.abs(y - 5);
      // muesca de la cola: la deja en horquilla
      if (dy <= half && !(x < 7 && dy < 2.6 - x * 0.37)) px(c, x, y, '#ffffff');
    }
  }
  // aleta de arriba y de abajo
  for (let x = 33; x <= 41; x++) {
    px(c, x, 0, '#ffffff');
    if (x > 35 && x < 40) px(c, x, 10, '#ffffff');
  }
  return cv;
}

function tint(mask: HTMLCanvasElement, top: string, mid: string, belly: string): HTMLCanvasElement {
  const [cv, c] = make(mask.width, mask.height);
  c.drawImage(mask, 0, 0);
  c.globalCompositeOperation = 'source-in';
  c.fillStyle = mid;
  c.fillRect(0, 0, mask.width, mask.height);
  c.globalCompositeOperation = 'source-atop';
  c.fillStyle = top;
  c.fillRect(0, 0, mask.width, 3);
  c.fillStyle = belly;
  c.fillRect(0, mask.height - 3, mask.width, 3);
  c.globalCompositeOperation = 'source-over';
  // escamas y ojo
  c.fillStyle = 'rgba(26,28,44,0.28)';
  for (let x = 22; x < 54; x += 4)
    for (let y = 3; y < 9; y += 2) c.fillRect(x + (y % 4 === 3 ? 2 : 0), y, 1, 1);
  px(c, 55, 3, '#1a1c2c');
  px(c, 56, 3, '#f4f4f4');
  return cv;
}

function fishAssets(): {
  empty: HTMLCanvasElement;
  full: HTMLCanvasElement;
  tired: HTMLCanvasElement;
} {
  const mask = fishMask();
  const empty = outline(tint(mask, '#4a5578', '#333c57', '#262b44'), C.black);
  return {
    empty,
    full: tint(mask, C.cyan, C.sky, C.blue),
    tired: tint(mask, C.orange, C.red, C.purple),
  };
}

/** Corona dorada del ganador (17 x 11, con contorno). */
function crownSprite(): HTMLCanvasElement {
  const cv = art(
    [
      '.G.......G.......G.',
      '.GG.....GGG.....GG.',
      '.GGG...GGGGG...GGG.',
      '.GGGG.GGGGGGG.GGGG.',
      '.GGGGGGGGGGGGGGGGG.',
      '.GGGRGGGGBGGGGRGGG.',
      '.GGGGGGGGGGGGGGGGG.',
      '.OOOOOOOOOOOOOOOOO.',
    ],
    { G: C.yellow, O: C.orange, R: C.red, B: C.sky },
  );
  return outline(cv, C.black);
}

function pawIcon(): HTMLCanvasElement {
  const [cv, c] = make(14, 14);
  ell(c, 7, 9, 4, 3.5, C.white);
  for (const [x, y] of [
    [2, 5],
    [5, 2.5],
    [9, 2.5],
    [12, 5],
  ] as const) {
    disc(c, x, y, 1.6, C.white);
  }
  return outline(cv, C.black);
}

// ------------------------------------------------------------------ catalogo

export interface Assets {
  ground(id: number, tx: number, ty: number): HTMLCanvasElement;
  water: HTMLCanvasElement[];
  chest: {
    closed: HTMLCanvasElement;
    open: HTMLCanvasElement;
    goldClosed: HTMLCanvasElement;
    goldOpen: HTMLCanvasElement;
  };
  tomb: HTMLCanvasElement;
  wall: HTMLCanvasElement[];
  icon: Record<ItemKind, HTMLCanvasElement>;
  heart: HTMLCanvasElement;
  shieldBadge: HTMLCanvasElement;
  can: HTMLCanvasElement;
  paw: HTMLCanvasElement;
  fish: { empty: HTMLCanvasElement; full: HTMLCanvasElement; tired: HTMLCanvasElement };
  crown: HTMLCanvasElement;
  duck: HTMLCanvasElement;
  prop(kind: PropKind, w: number, h: number, variant: number): HTMLCanvasElement | null;
}

export function buildAssets(): Assets {
  const groundCache = new Map<number, HTMLCanvasElement[]>();
  const VARIANTS = 4;
  const ground = (id: number, tx: number, ty: number): HTMLCanvasElement => {
    let list = groundCache.get(id);
    if (!list) {
      list = Array.from({ length: VARIANTS }, (_, v) => groundTile(id, v));
      groundCache.set(id, list);
    }
    return list[Math.floor(hash(tx, ty, id) * VARIANTS)] as HTMLCanvasElement;
  };

  const propCache = new Map<string, HTMLCanvasElement | null>();
  const prop = (
    kind: PropKind,
    w: number,
    h: number,
    variant: number,
  ): HTMLCanvasElement | null => {
    const key = `${kind}:${w}:${h}:${variant}`;
    if (propCache.has(key)) return propCache.get(key) ?? null;
    let sprite: HTMLCanvasElement | null;
    switch (kind) {
      case 'tree':
        sprite = treeSprite(variant);
        break;
      case 'pine':
        sprite = pineSprite(variant);
        break;
      case 'palm':
        sprite = palmSprite(variant);
        break;
      case 'bush':
        sprite = bushSprite();
        break;
      case 'rock':
        sprite = rockSprite();
        break;
      case 'log':
        sprite = logSprite();
        break;
      case 'crate':
        sprite = crateSprite();
        break;
      case 'table':
        sprite = tableSprite(w, h);
        break;
      case 'couch':
        sprite = couchSprite(w, h, variant);
        break;
      case 'shelf':
        sprite = shelfSprite(w, variant);
        break;
      case 'plant':
        sprite = plantSprite(variant);
        break;
      case 'cattree':
        sprite = catTreeSprite();
        break;
      case 'sunbed':
        sprite = sunbedSprite(variant);
        break;
      case 'parasol':
        sprite = parasolSprite(variant);
        break;
      case 'duck':
        sprite = duckSprite();
        break;
      default:
        sprite = null;
    }
    propCache.set(key, sprite);
    return sprite;
  };

  const icon = {} as Record<ItemKind, HTMLCanvasElement>;
  for (const w of ['pistol', 'shotgun', 'sniper', 'bazooka', 'rifle'] as const) {
    icon[w] = weaponIcon(w);
    icon[`ammo_${w}`] = ammoIcon(w);
  }
  icon.medkit = medkitIcon();
  icon.shield = shieldIcon();
  icon.wall = wallIcon();

  return {
    ground,
    water: [0, 1, 2, 3].map(waterFrame),
    chest: {
      closed: chestSprite(false, false),
      open: chestSprite(true, false),
      goldClosed: chestSprite(false, true),
      goldOpen: chestSprite(true, true),
    },
    tomb: tombSprite(),
    wall: [0, 1, 2, 3].map(wallSprite),
    icon,
    heart: heartIcon(),
    shieldBadge: shieldBadge(),
    can: sardineCan(),
    paw: pawIcon(),
    fish: fishAssets(),
    crown: crownSprite(),
    duck: duckSprite(),
    prop,
  };
}

/** Dibuja un tejado, una cama o una cabana del tamano de la casa (en pixeles). */
export function roofSprite(
  kind: 'house' | 'bed' | 'cabin',
  w: number,
  h: number,
  style: number,
): HTMLCanvasElement {
  const W = w * T;
  const H = h * T;
  const [cv, c] = make(W + 6, H + 8);
  const palettes = [
    ['#b13e53', '#8a2f41', '#d9667a'],
    ['#3b5dc9', '#2a449a', '#6c8be6'],
    ['#38b764', '#257179', '#8ee06a'],
    ['#ef7d57', '#b8573a', '#ffa985'],
  ];
  const pal = palettes[style % palettes.length] as string[];
  if (kind === 'bed') {
    // colchon con cobija y almohadas
    rect(c, 2, 2, W + 2, H + 2, '#f4f4f4');
    const stripe = pal[0] as string;
    for (let x = 12; x < W; x += 12) rect(c, 2 + x, 2, 6, H + 2, stripe);
    rect(c, 2, 2, W + 2, 3, '#e0e6ec');
    rect(c, 6, 6, 16, 9, '#ffffff');
    rect(c, 6, H - 10, 16, 9, '#ffffff');
    rect(c, 2, H + 2, W + 2, 3, shade(stripe, 0.7));
    return outline(cv, C.black);
  }
  const base = kind === 'cabin' ? ['#41a6f6', '#2f78c4', '#73eff7'] : pal;
  rect(c, 0, 0, W + 6, H + 6, base[0] as string);
  for (let y = 0; y < H + 6; y += 6) {
    rect(c, 0, y, W + 6, 1, base[1] as string);
    const off = (y / 6) % 2 === 0 ? 0 : 6;
    for (let x = off; x < W + 6; x += 12) rect(c, x, y, 1, 6, base[1] as string);
  }
  rect(c, 0, 0, W + 6, 2, base[2] as string);
  rect(c, 0, H + 4, W + 6, 2, shade(base[1] as string, 0.7));
  // chimenea
  if (kind === 'house' && style % 2 === 0) {
    rect(c, W - 14, 6, 8, 10, '#6b5b73');
    rect(c, W - 15, 5, 10, 2, '#8a7a92');
  }
  return outline(cv, C.black);
}
