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

/** Cuantas salas hay de cada clase: 23 en total, con 5 minijefes y el jefe final. */
const KIND_COUNT: Record<AdventureRoomKind, number> = {
  inicio: 1,
  combate: 10,
  tesoro: 3,
  descanso: 3,
  minijefe: MINIBOSSES,
  jefe: 1,
};
const ROOM_TOTAL = Object.values(KIND_COUNT).reduce((a, b) => a + b, 0);

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

interface Cell {
  col: number;
  row: number;
}

/** Una sala del trazado: su celda, su clase y su profundidad (pasos desde el inicio). */
interface Slot {
  cell: Cell;
  kind: AdventureRoomKind;
  depth: number;
  act: number;
  boss?: number;
}

interface Layout {
  /** Salas ya en su orden definitivo: 0 es el inicio, el jefe final va al ultimo. */
  slots: Slot[];
  /** Pares de salas unidas por un sendero. */
  edges: [number, number][];
}

const key = (c: Cell): number => c.row * COLS + c.col;
const NEIGHBORS: readonly [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/**
 * Traza el bosque como una red de caminos y no como una fila: un arbol que se abre en ramas, con
 * algunos lazos para poder dar la vuelta. Los jefes quedan al fondo de ramas sin salida, lo que
 * obliga a explorar: no hay un camino unico, cada grupo decide a donde ir y que tan fuerte llega.
 * Devuelve `null` si esta semilla no dio un trazado que sirva (se prueba otra tirada).
 */
function tryLayout(rng: Rng): Layout | null {
  // 24 celdas y 23 salas: una celda queda vacia
  const all: Cell[] = [];
  for (let row = 0; row < ROWS; row++) for (let col = 0; col < COLS; col++) all.push({ col, row });
  const hole = rng.int(0, all.length - 1);
  const cells = all.filter((_, i) => i !== hole);
  const index = new Map<number, number>(cells.map((c, i) => [key(c), i]));
  const adjacent = (i: number): number[] => {
    const c = cells[i] as Cell;
    const out: number[] = [];
    for (const [dx, dy] of NEIGHBORS) {
      const j = index.get(key({ col: c.col + dx, row: c.row + dy }));
      if (j !== undefined && c.col + dx >= 0 && c.col + dx < COLS) out.push(j);
    }
    return out;
  };

  // arbol por Prim: crece desde el inicio por un lado al azar
  const start = rng.int(0, cells.length - 1);
  const inTree = new Set<number>([start]);
  const tree: [number, number][] = [];
  const frontier: [number, number][] = adjacent(start).map((j) => [start, j]);
  while (frontier.length > 0) {
    const [from, to] = frontier.splice(rng.int(0, frontier.length - 1), 1)[0] as [number, number];
    if (inTree.has(to)) continue;
    inTree.add(to);
    tree.push([from, to]);
    for (const j of adjacent(to)) if (!inTree.has(j)) frontier.push([to, j]);
  }
  if (tree.length !== cells.length - 1) return null;

  const degree = new Array<number>(cells.length).fill(0);
  for (const [a, b] of tree) {
    degree[a]!++;
    degree[b]!++;
  }
  const depthOf = (edges: [number, number][]): number[] => {
    const nb: number[][] = cells.map(() => []);
    for (const [a, b] of edges) {
      nb[a]!.push(b);
      nb[b]!.push(a);
    }
    const d = new Array<number>(cells.length).fill(-1);
    d[start] = 0;
    const q = [start];
    for (let i = 0; i < q.length; i++)
      for (const n of nb[q[i] as number] as number[])
        if (d[n] === -1) {
          d[n] = (d[q[i] as number] as number) + 1;
          q.push(n);
        }
    return d;
  };
  const d0 = depthOf(tree);
  const maxDepth = Math.max(...d0);
  // el inicio debe dar a elegir (dos salidas por lo menos) y el bosque debe tener fondo
  if (degree[start]! < 2 || maxDepth < 6) return null;

  // los jefes viven al fondo de ramas sin salida; junto al inicio solo hay combates
  const leaves = cells
    .map((_, i) => i)
    .filter((i) => i !== start && degree[i] === 1 && (d0[i] as number) >= 2);
  if (leaves.length < MINIBOSSES + 1) return null;
  const byDepth = [...leaves].sort((a, b) => (d0[a] as number) - (d0[b] as number));
  // el jefe final: una de las ramas mas hondas (a veces no la mas lejana)
  const deepHalf = byDepth.slice(Math.floor(byDepth.length / 2));
  const bossAt = rng.pick(deepHalf);
  const rest = byDepth.filter((i) => i !== bossAt);
  // los minijefes repartidos a lo largo de la profundidad: uno por tramo
  const minis: number[] = [];
  for (let k = 0; k < MINIBOSSES; k++) {
    const lo = Math.floor((k * rest.length) / MINIBOSSES);
    const hi = Math.max(lo, Math.floor(((k + 1) * rest.length) / MINIBOSSES) - 1);
    minis.push(rest[rng.int(lo, hi)] as number);
  }
  const taken = new Set<number>([start, bossAt, ...minis]);
  // tesoros y descansos: primero en ramas sin salida, luego donde haya lugar (nunca junto al inicio)
  const spare = cells.map((_, i) => i).filter((i) => !taken.has(i) && (d0[i] as number) >= 2);
  const spareLeaves = rng.shuffle(spare.filter((i) => degree[i] === 1));
  const spareOthers = rng.shuffle(spare.filter((i) => degree[i] !== 1));
  const specials = [...spareLeaves, ...spareOthers];
  const need = KIND_COUNT.tesoro + KIND_COUNT.descanso;
  if (specials.length < need) return null;
  const treasure = specials.slice(0, KIND_COUNT.tesoro);
  const rests = specials.slice(KIND_COUNT.tesoro, need);

  // lazos extra entre salas vecinas (nunca con los jefes: siguen siendo callejones)
  const edges = [...tree];
  const sealed = new Set<number>([bossAt, ...minis]);
  const have = new Set(tree.map(([a, b]) => `${Math.min(a, b)}-${Math.max(a, b)}`));
  for (let i = 0; i < cells.length; i++)
    for (const j of adjacent(i)) {
      if (j < i || sealed.has(i) || sealed.has(j) || i === start || j === start) continue;
      const id = `${i}-${j}`;
      if (have.has(id) || !rng.chance(0.3)) continue;
      have.add(id);
      edges.push([i, j]);
    }
  const depth = depthOf(edges);
  const deepest = Math.max(...depth);

  // orden definitivo: el inicio, luego por profundidad y el jefe final al ultimo
  const order = cells
    .map((_, i) => i)
    .filter((i) => i !== start && i !== bossAt)
    .sort((a, b) => (depth[a] as number) - (depth[b] as number) || a - b);
  order.unshift(start);
  order.push(bossAt);
  const slot = new Map<number, number>(order.map((cell, id) => [cell, id]));
  const miniOrder = [...minis].sort((a, b) => (depth[a] as number) - (depth[b] as number) || a - b);
  const slots: Slot[] = order.map((cell) => {
    const dp = depth[cell] as number;
    let kind: AdventureRoomKind = 'combate';
    let boss: number | undefined;
    let act = Math.min(4, Math.floor((dp * 5) / (deepest + 1)));
    if (cell === start) kind = 'inicio';
    else if (cell === bossAt) {
      kind = 'jefe';
      act = 5;
      boss = BOSS_ORDER[BOSS_ORDER.length - 1];
    } else if (miniOrder.includes(cell)) {
      kind = 'minijefe';
      const rank = miniOrder.indexOf(cell);
      act = rank;
      boss = BOSS_ORDER[rank];
    } else if (treasure.includes(cell)) kind = 'tesoro';
    else if (rests.includes(cell)) kind = 'descanso';
    return {
      cell: cells[cell] as Cell,
      kind,
      depth: dp,
      act,
      ...(boss !== undefined ? { boss } : {}),
    };
  });
  return {
    slots,
    edges: edges.map(([a, b]) => [slot.get(a) as number, slot.get(b) as number]),
  };
}

function layoutFor(rng: Rng): Layout {
  for (let i = 0; i < 80; i++) {
    const l = tryLayout(rng);
    if (l) return l;
  }
  throw new Error('no se pudo trazar el bosque');
}

/**
 * Bosque encantado: 23 claros unidos por una red de senderos que se ramifica (no hay un camino unico), rodeados de espinos. Cada
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
  const layout = layoutFor(rng);
  const rooms: AdventureRoom[] = [];
  layout.slots.forEach((p, i) => {
    const { col, row } = p.cell;
    const [bw, bh] = SIZES[p.kind];
    const rw = bw - (p.kind === 'combate' ? rng.int(0, 2) : 0);
    const rh = bh - (p.kind === 'combate' ? rng.int(0, 2) : 0);
    const x = col * CELL + Math.floor((CELL - rw) / 2);
    const y = row * CELL + Math.floor((CELL - rh) / 2);
    carveRect(b, x, y, rw, rh, p.kind === 'jefe' || p.kind === 'minijefe' ? 5 : 4);
    let name = rng.pick(NAMES[p.kind].length > 0 ? NAMES[p.kind] : ['Claro']);
    if (p.kind === 'minijefe' && p.boss !== undefined) name = `Guarida: ${mobDef(p.boss).name}`;
    rooms.push({
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
      ...(p.boss !== undefined ? { boss: p.boss } : {}),
    });
  });
  // senderos entre las salas unidas, con una puerta junto a cada claro
  for (const [ia, ic] of layout.edges) {
    const a = rooms[ia] as AdventureRoom;
    const c = rooms[ic] as AdventureRoom;
    a.links.push(c.id);
    c.links.push(a.id);
    const ca = (layout.slots[ia] as Slot).cell;
    const cb = (layout.slots[ic] as Slot).cell;
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
      const top = ca.row < cb.row ? a : c;
      const bottom = ca.row < cb.row ? c : a;
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
  if (!rooms || rooms.length !== ROOM_TOTAL) return 'salas';
  if (rooms.filter((r) => r.kind === 'minijefe').length !== MINIBOSSES) return 'minijefes';
  if (rooms.filter((r) => r.kind === 'jefe').length !== 1) return 'jefe';
  if (m.spawns.length < 4) return 'apariciones';
  if (rooms[0]?.kind !== 'inicio' || (rooms[0]?.links.length ?? 0) < 2)
    return 'inicio_sin_opciones';
  const last = rooms[rooms.length - 1];
  if (last?.kind !== 'jefe' || last.links.length !== 1) return 'jefe_no_es_callejon';
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
