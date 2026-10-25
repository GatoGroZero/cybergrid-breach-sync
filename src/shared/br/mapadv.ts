import type { Rng } from '../rng';
import { TILE } from './constants';
import { BOSS_ORDER, MINIBOSSES, mobDef } from './adventure';
import {
  Builder,
  G,
  inBounds,
  isSolidTile,
  type AdventureRoom,
  type AdventureRoomKind,
  type BRMap,
  type PropKind,
  type Vec,
} from './mapcore';

/** Valor de `solid` de una puerta de enredadera cerrada. */
export const GATE_SOLID = 3;

const CELL = 25;
const COLS = 6;
const ROWS = 4;

/** Orden de las salas a lo largo del camino: cinco actos y el jefe final. */
const PLAN: { kind: AdventureRoomKind; act: number }[] = [
  { kind: 'inicio', act: 0 },
  { kind: 'combate', act: 0 },
  { kind: 'combate', act: 0 },
  { kind: 'tesoro', act: 0 },
  { kind: 'minijefe', act: 0 },
  { kind: 'combate', act: 1 },
  { kind: 'combate', act: 1 },
  { kind: 'descanso', act: 1 },
  { kind: 'minijefe', act: 1 },
  { kind: 'combate', act: 2 },
  { kind: 'combate', act: 2 },
  { kind: 'tesoro', act: 2 },
  { kind: 'minijefe', act: 2 },
  { kind: 'combate', act: 3 },
  { kind: 'combate', act: 3 },
  { kind: 'descanso', act: 3 },
  { kind: 'minijefe', act: 3 },
  { kind: 'combate', act: 4 },
  { kind: 'combate', act: 4 },
  { kind: 'tesoro', act: 4 },
  { kind: 'minijefe', act: 4 },
  { kind: 'descanso', act: 5 },
  { kind: 'jefe', act: 5 },
];

const SIZES: Record<AdventureRoomKind, [number, number]> = {
  inicio: [17, 15],
  combate: [19, 17],
  tesoro: [16, 14],
  descanso: [15, 13],
  minijefe: [21, 19],
  jefe: [23, 21],
};

const NAMES: Record<AdventureRoomKind, string[]> = {
  inicio: ['Claro de la luna'],
  combate: [
    'Claro de los susurros',
    'Sendero de las luciérnagas',
    'Hondonada del musgo',
    'Arboleda torcida',
    'Prado de los hongos',
    'Ruinas cubiertas de hiedra',
    'Charcas brillantes',
    'Bosquecillo de espinos',
  ],
  tesoro: ['Altar de las sardinas', 'Cueva de los tesoros', 'Santuario del cascabel'],
  descanso: ['Fuente de leche de luna', 'Hoguera de los gatos viejos'],
  minijefe: [],
  jefe: ['Trono de las sombras'],
};

function carveRect(b: Builder, x: number, y: number, w: number, h: number, cut: number): void {
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) {
      const dx = Math.min(xx - x, x + w - 1 - xx);
      const dy = Math.min(yy - y, y + h - 1 - yy);
      // esquinas redondeadas: se recortan escalones
      if (dx + dy < cut) continue;
      b.setGround(xx, yy, G.MUSGO);
      b.setSolid(xx, yy, 0);
    }
  }
}

/** Centro de la celda de la sala `i` en el camino en serpiente. */
function cellOf(i: number): { col: number; row: number } {
  const row = Math.floor(i / COLS);
  const k = i % COLS;
  return { col: row % 2 === 0 ? k : COLS - 1 - k, row };
}

/**
 * Bosque encantado: 23 claros unidos por senderos en forma de serpiente, rodeados de espinos. Cada
 * claro tiene su funcion (combate, tesoro, descanso, minijefe...) y puertas de enredadera que se
 * cierran mientras hay pelea.
 */
export function buildEncantado(rng: Rng, seed: number): BRMap {
  const b = new Builder(rng, 'encantado', seed, COLS * CELL, ROWS * CELL);
  const { w, h } = b.m;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      b.setGround(x, y, G.ZARZAL);
      b.setSolid(x, y, 1);
    }
  }
  const rooms: AdventureRoom[] = [];
  const bossCount = { n: 0 };
  PLAN.forEach((p, i) => {
    const { col, row } = cellOf(i);
    const [bw, bh] = SIZES[p.kind];
    const rw = bw - (p.kind === 'combate' ? rng.int(0, 2) : 0);
    const rh = bh - (p.kind === 'combate' ? rng.int(0, 2) : 0);
    const x = col * CELL + Math.floor((CELL - rw) / 2);
    const y = row * CELL + Math.floor((CELL - rh) / 2);
    carveRect(b, x, y, rw, rh, p.kind === 'jefe' || p.kind === 'minijefe' ? 5 : 4);
    let name = rng.pick(NAMES[p.kind].length > 0 ? NAMES[p.kind] : ['Claro']);
    let boss: number | undefined;
    if (p.kind === 'minijefe') {
      boss = BOSS_ORDER[bossCount.n] as number;
      bossCount.n++;
      name = `Guarida: ${mobDef(boss).name}`;
    } else if (p.kind === 'jefe') {
      boss = BOSS_ORDER[BOSS_ORDER.length - 1] as number;
    }
    const room: AdventureRoom = {
      id: i,
      x,
      y,
      w: rw,
      h: rh,
      kind: p.kind,
      name,
      act: p.act,
      links: [],
      gates: [],
      ...(boss !== undefined ? { boss } : {}),
    };
    rooms.push(room);
  });
  // senderos entre salas consecutivas, con una puerta junto a cada claro
  for (let i = 0; i + 1 < rooms.length; i++) {
    const a = rooms[i] as AdventureRoom;
    const c = rooms[i + 1] as AdventureRoom;
    a.links.push(c.id);
    c.links.push(a.id);
    const ca = cellOf(i);
    const cb = cellOf(i + 1);
    if (ca.row === cb.row) {
      const left = ca.col < cb.col ? a : c;
      const right = ca.col < cb.col ? c : a;
      const cy = ca.row * CELL + Math.floor(CELL / 2);
      const x0 = left.x + left.w;
      const x1 = right.x - 1;
      for (let x = x0 - 1; x <= x1 + 1; x++) {
        for (let y = cy - 2; y <= cy + 1; y++) {
          b.setGround(x, y, G.PATH);
          b.setSolid(x, y, 0);
        }
      }
      for (let y = cy - 2; y <= cy + 1; y++) {
        left.gates.push({ x: x0, y });
        right.gates.push({ x: x1, y });
      }
    } else {
      const top = a.y < c.y ? a : c;
      const bottom = a.y < c.y ? c : a;
      const cx = ca.col * CELL + Math.floor(CELL / 2);
      const y0 = top.y + top.h;
      const y1 = bottom.y - 1;
      for (let y = y0 - 1; y <= y1 + 1; y++) {
        for (let x = cx - 2; x <= cx + 1; x++) {
          b.setGround(x, y, G.PATH);
          b.setSolid(x, y, 0);
        }
      }
      for (let x = cx - 2; x <= cx + 1; x++) {
        top.gates.push({ x, y: y0 });
        bottom.gates.push({ x, y: y1 });
      }
    }
  }
  b.m.rooms = rooms;
  decorate(b, rng, rooms);
  const start = rooms[0] as AdventureRoom;
  const cx = start.x + Math.floor(start.w / 2);
  const cy = start.y + Math.floor(start.h / 2);
  b.m.spawns = [
    { x: cx - 2, y: cy },
    { x: cx + 2, y: cy },
    { x: cx, y: cy - 2 },
    { x: cx, y: cy + 2 },
  ].map((p) => ({ x: p.x * TILE + TILE / 2, y: p.y * TILE + TILE / 2 }));
  b.m.landmarks = rooms
    .filter((r) => r.kind !== 'combate')
    .map((r) => ({
      name: r.name,
      x: (r.x + r.w / 2) * TILE,
      y: (r.y + r.h / 2) * TILE,
      kind: r.kind === 'tesoro' || r.kind === 'descanso' ? 'water' : 'house',
    }));
  return b.m;
}

const COVER: PropKind[] = ['tree', 'pine', 'rock', 'stump', 'ruin', 'tree', 'pine'];
const SOFT: PropKind[] = ['bush', 'mushroom', 'mushroom'];

/** Pone el suelo, las coberturas y los tesoros de cada claro segun su funcion. */
function decorate(b: Builder, rng: Rng, rooms: AdventureRoom[]): void {
  for (const r of rooms) {
    const cx = r.x + Math.floor(r.w / 2);
    const cy = r.y + Math.floor(r.h / 2);
    // el suelo cambia de tono: charcos que brillan y manchas de hongos
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        if (b.m.solid[b.at(x, y)]) continue;
        const roll = rng.next();
        if (roll < 0.04) b.setGround(x, y, G.HONGOS);
        else if (roll < 0.055 && r.kind === 'combate') b.setGround(x, y, G.CHARCO);
      }
    }
    // las puertas y su paso siempre libres
    for (const g of r.gates) b.reserve(g.x - 2, g.y - 2, 5, 5);
    b.reserve(cx - 5, cy - 5, 11, 11);
    const spot = (x0: number, y0: number, x1: number, y1: number): Vec | null => {
      for (let i = 0; i < 60; i++) {
        const x = rng.int(x0, x1);
        const y = rng.int(y0, y1);
        if (b.isFree(x, y) && b.m.ground[b.at(x, y)] !== G.PATH) return { x, y };
      }
      return null;
    };
    switch (r.kind) {
      case 'inicio': {
        b.addProp('statue', cx, r.y + 2, 1, 1, 'all');
        b.addProp('crystal', r.x + 2, r.y + 2, 1, 1, 'all');
        b.addProp('crystal', r.x + r.w - 3, r.y + 2, 1, 1, 'all');
        for (let i = 0; i < 6; i++) {
          const p = spot(r.x + 1, r.y + 1, r.x + r.w - 2, r.y + r.h - 2);
          if (p) b.addProp(rng.pick(SOFT), p.x, p.y, 1, 1, 'none');
        }
        break;
      }
      case 'tesoro': {
        for (let y = cy - 3; y <= cy + 3; y++)
          for (let x = cx - 3; x <= cx + 3; x++)
            if ((x - cx) ** 2 + (y - cy) ** 2 <= 10) b.setGround(x, y, G.RUNAS);
        b.chest(cx, cy, true, false);
        b.chest(cx - 4, cy + 3, false, true);
        b.addProp('crystal', cx - 3, cy - 3, 1, 1, 'all');
        b.addProp('crystal', cx + 3, cy - 3, 1, 1, 'all');
        break;
      }
      case 'descanso': {
        for (let y = cy - 3; y <= cy + 3; y++)
          for (let x = cx - 3; x <= cx + 3; x++)
            if ((x - cx) ** 2 + (y - cy) ** 2 <= 10) b.setGround(x, y, G.HONGOS);
        b.addProp('statue', cx, cy, 1, 1, 'all');
        for (const [dx, dy] of [
          [-3, -2],
          [3, -2],
          [-3, 2],
          [3, 2],
        ] as const)
          b.addProp('mushroom', cx + dx, cy + dy, 1, 1, 'none');
        break;
      }
      case 'minijefe':
      case 'jefe': {
        // arena: suelo de runas al centro y un anillo de ruinas y estatuas en los bordes
        const rr = r.kind === 'jefe' ? 8 : 6;
        for (let y = cy - rr; y <= cy + rr; y++)
          for (let x = cx - rr; x <= cx + rr; x++) {
            const d = Math.hypot(x - cx, y - cy);
            if (d <= rr && d >= rr - 1.2) b.setGround(x, y, G.RUNAS);
            else if (d < 2.2) b.setGround(x, y, G.RUNAS);
          }
        const n = r.kind === 'jefe' ? 8 : 6;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2 + 0.4;
          const x = Math.round(cx + Math.cos(a) * (rr + 2.2));
          const y = Math.round(cy + Math.sin(a) * (rr + 1.4));
          if (b.isFree(x, y) && inBounds(b.m, x, y) && b.m.ground[b.at(x, y)] !== G.PATH)
            b.addProp(i % 2 === 0 ? 'statue' : 'ruin', x, y, 1, 1, 'all');
        }
        break;
      }
      default: {
        const pieces = rng.int(6, 10);
        for (let i = 0; i < pieces; i++) {
          const p = spot(r.x + 2, r.y + 2, r.x + r.w - 3, r.y + r.h - 3);
          if (!p) continue;
          b.addProp(rng.pick(COVER), p.x, p.y, 1, 1, 'all');
          b.reserve(p.x, p.y, 1, 1);
        }
        for (let i = 0; i < 6; i++) {
          const p = spot(r.x + 1, r.y + 1, r.x + r.w - 2, r.y + r.h - 2);
          if (p) b.addProp(rng.pick(SOFT), p.x, p.y, 1, 1, 'none');
        }
      }
    }
  }
}

/** Motivo por el que un bosque encantado no sirve, o `null` si esta bien. */
export function adventureProblem(m: BRMap): string | null {
  const rooms = m.rooms;
  if (!rooms || rooms.length !== PLAN.length) return 'salas';
  if (rooms.filter((r) => r.kind === 'minijefe').length !== MINIBOSSES) return 'minijefes';
  if (rooms.filter((r) => r.kind === 'jefe').length !== 1) return 'jefe';
  if (m.spawns.length < 4) return 'apariciones';
  const start = m.spawns[0] as Vec;
  const sx = Math.floor(start.x / TILE);
  const sy = Math.floor(start.y / TILE);
  if (isSolidTile(m, sx, sy)) return 'inicio_bloqueado';
  const seen = new Uint8Array(m.w * m.h);
  const stack = [sy * m.w + sx];
  seen[stack[0] as number] = 1;
  while (stack.length > 0) {
    const i = stack.pop() as number;
    const x = i % m.w;
    const y = (i / m.w) | 0;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (isSolidTile(m, nx, ny)) continue;
      const ni = ny * m.w + nx;
      if (seen[ni]) continue;
      seen[ni] = 1;
      stack.push(ni);
    }
  }
  for (const r of rooms) {
    // el centro puede tener un cofre o una estatua: basta con alcanzar algo junto a el
    const cx = r.x + Math.floor(r.w / 2);
    const cy = r.y + Math.floor(r.h / 2);
    let reached = false;
    for (let dy = -2; dy <= 2 && !reached; dy++)
      for (let dx = -2; dx <= 2 && !reached; dx++)
        if (seen[(cy + dy) * m.w + cx + dx]) reached = true;
    if (!reached) return 'sala_incomunicada';
    if (r.links.length === 0) return 'sala_aislada';
    if (r.gates.length < 4) return 'sin_puertas';
  }
  for (const c of m.chests) {
    const tx = Math.floor(c.x / TILE);
    const ty = Math.floor(c.y / TILE);
    const near = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ].some(([dx, dy]) => seen[(ty + (dy as number)) * m.w + tx + (dx as number)]);
    if (!near) return 'cofre_incomunicado';
  }
  return null;
}
