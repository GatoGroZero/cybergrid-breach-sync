import type { MapKind } from '../../shared/br/map';
import { G, type PropKind } from '../../shared/br/mapcore';
import type { GameMode } from '../../shared/br/modes';
import type { Assets } from '../pixel/art';
import { thicketCanopy } from '../pixel/art-bosque';
import { CAT_H, CAT_W, catSprites } from '../pixel/cat';
import { disc, ell, make, rect, rngFor, type Ctx } from '../pixel/draw';
import type { Skin } from '../../shared/br/skin';
import { TEAM_COLORS } from '../../shared/br/modes';

/**
 * Los escenarios del lobby: cada mapa tiene su postal animada (cielo, fondo, piso y clima) hecha
 * con el mismo arte del juego. El lobby los dibuja grandes detras de los gatos de la sala y chicos
 * en la tarjeta de cada modo.
 */
export type SceneId = MapKind;

/** Escenario de cada modo cuando no se eligio un mapa en concreto. */
export const DEFAULT_SCENE: Record<GameMode, SceneId> = {
  br: 'bosque',
  techo: 'tejado',
  territorio: 'calle',
  aventura: 'encantado',
};

export const sceneFor = (mode: GameMode, map: string): SceneId =>
  map !== 'azar' && map in SCENE_INFO ? (map as SceneId) : DEFAULT_SCENE[mode];

export const SCENE_INFO: Record<SceneId, { name: string; horizon: number }> = {
  bosque: { name: 'Bosque', horizon: 0.42 },
  casa: { name: 'Casa de gatitos', horizon: 0.4 },
  piscina: { name: 'Piscina', horizon: 0.4 },
  tejado: { name: 'Tejado a dos aguas', horizon: 0.44 },
  azotea: { name: 'Azotea con antenas', horizon: 0.44 },
  mansarda: { name: 'Mansarda de pizarra', horizon: 0.44 },
  calle: { name: 'Calle del barrio', horizon: 0.42 },
  patios: { name: 'Patios traseros', horizon: 0.42 },
  encantado: { name: 'Bosque encantado', horizon: 0.42 },
};

type Prop = (kind: PropKind, w: number, h: number, v?: number) => HTMLCanvasElement | null;

function gradient(c: Ctx, w: number, y0: number, y1: number, top: string, bottom: string): void {
  const steps = Math.max(1, y1 - y0);
  const parse = (hex: string): [number, number, number] => {
    const n = Number.parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const a = parse(top);
  const b = parse(bottom);
  for (let i = 0; i < steps; i++) {
    // bandas de 2 px: se ve a pixeles, no un degradado liso
    const kk = (Math.floor(i / 2) * 2) / steps;
    c.fillStyle = `rgb(${Math.round(a[0] + (b[0] - a[0]) * kk)},${Math.round(a[1] + (b[1] - a[1]) * kk)},${Math.round(a[2] + (b[2] - a[2]) * kk)})`;
    c.fillRect(0, y0 + i, w, 1);
  }
}

/** Pone un sprite con los pies en `baseY`. */
function put(c: Ctx, spr: HTMLCanvasElement | null, x: number, baseY: number): void {
  if (!spr) return;
  c.drawImage(spr, Math.round(x - spr.width / 2), Math.round(baseY - spr.height));
}

function stars(c: Ctx, w: number, h: number, seed: number, count: number): void {
  const rng = rngFor(seed);
  for (let i = 0; i < count; i++) {
    const x = rng.int(0, w - 1);
    const y = rng.int(0, h - 1);
    rect(c, x, y, 1, 1, i % 4 === 0 ? '#ffffff' : '#9fb4e8');
  }
}

/** Piso de baldosas del juego (con un sombreado que lo oscurece hacia el fondo). */
function floor(
  c: Ctx,
  A: Assets,
  w: number,
  y0: number,
  h: number,
  pick: (tx: number, ty: number) => number,
): void {
  for (let ty = 0; ty * 16 < h - y0 + 16; ty++) {
    for (let tx = 0; tx * 16 < w + 16; tx++) {
      c.drawImage(A.ground(pick(tx, ty), tx, ty), tx * 16, y0 + ty * 16);
    }
  }
  // luz que cae sobre el frente y sombra hacia el fondo
  for (let i = 0; i < h - y0; i++) {
    const k = 1 - i / (h - y0);
    c.fillStyle = `rgba(10,14,30,${(0.28 * k * k).toFixed(3)})`;
    c.fillRect(0, y0 + i, w, 1);
  }
}

// ------------------------------------------------------------------ cada escenario

type Painter = (c: Ctx, A: Assets, w: number, h: number, P: Prop) => void;

const treeRow = (c: Ctx, P: Prop, w: number, base: number, seed: number, gap = 26): void => {
  const rng = rngFor(seed);
  for (let x = -4; x < w + 20; x += gap + rng.int(-6, 6)) {
    const kind: PropKind = rng.chance(0.4) ? 'pine' : 'tree';
    put(c, P(kind, 1, 1, rng.int(0, 3)), x, base + rng.int(-3, 3));
  }
};

const BAKE: Record<SceneId, Painter> = {
  bosque: (c, A, w, h, P) => {
    const hz = Math.round(h * SCENE_INFO.bosque.horizon);
    gradient(c, w, 0, hz + 4, '#8fd4ff', '#d6f1ff');
    disc(c, w * 0.8, 22, 11, '#fff3b0');
    disc(c, w * 0.8, 22, 8, '#fffbe0');
    // colinas lejanas
    for (let x = 0; x < w; x++) {
      const y = hz - 8 - Math.round(Math.sin(x / 30) * 5 + Math.sin(x / 11) * 2);
      rect(c, x, y, 1, hz - y + 3, '#6fb870');
    }
    for (let x = 0; x < w; x++) {
      const y = hz - 3 - Math.round(Math.sin(x / 19 + 2) * 3);
      rect(c, x, y, 1, hz - y + 3, '#4f9a56');
    }
    floor(c, A, w, hz, h, (tx, ty) =>
      (tx * 7 + ty * 3) % 11 === 0 ? G.FLOWER : (tx + ty) % 5 === 0 ? G.GRASS2 : G.GRASS,
    );
    treeRow(c, P, w, hz + 6, 5);
    put(c, P('rock', 1, 1, 1), 28, h - 20);
    put(c, P('bush', 1, 1, 2), w - 30, h - 16);
    put(c, P('log', 1, 1, 0), w * 0.62, hz + 18);
  },
  casa: (c, A, w, h, P) => {
    const hz = Math.round(h * SCENE_INFO.casa.horizon);
    // pared del fondo con ventanas por donde entra el sol
    for (let x = 0; x * 16 < w + 16; x++)
      for (let y = 0; y * 16 < hz + 16; y++)
        c.drawImage(A.ground(G.HOUSEWALL, x, y), x * 16, y * 16);
    rect(c, 0, hz - 3, w, 3, '#6d4530');
    rect(c, 0, 0, w, 3, '#c28b5a');
    for (const wx of [w * 0.2, w * 0.5, w * 0.8]) {
      rect(c, wx - 17, 12, 34, 28, '#4a3022');
      rect(c, wx - 15, 14, 30, 24, '#bfe6ff');
      rect(c, wx - 15, 14, 30, 6, '#e8f6ff');
      rect(c, wx - 1, 14, 2, 24, '#4a3022');
      rect(c, wx - 15, 25, 30, 2, '#4a3022');
    }
    // cuadritos en la pared
    rect(c, w * 0.35 - 6, 18, 12, 14, '#3a2a40');
    rect(c, w * 0.35 - 4, 20, 8, 10, '#ef7d57');
    rect(c, w * 0.65 - 6, 18, 12, 14, '#3a2a40');
    rect(c, w * 0.65 - 4, 20, 8, 10, '#73c9ff');
    floor(c, A, w, hz, h, (tx, ty) => ((tx + ty) % 2 === 0 ? G.WOOD : G.WOOD2));
    // alfombra
    rect(c, w * 0.3, h - 26, w * 0.4, 14, '#b13e53');
    rect(c, w * 0.3 + 2, h - 24, w * 0.4 - 4, 10, '#d95a6e');
    put(c, P('couch', 4, 2, 1), 56, hz + 24);
    put(c, P('cattree', 2, 2, 0), w - 40, hz + 30);
    put(c, P('plant', 1, 1, 1), w - 76, hz + 18);
    put(c, P('shelf', 3, 1, 1), 24, hz + 4);
  },
  piscina: (c, A, w, h, P) => {
    const hz = Math.round(h * SCENE_INFO.piscina.horizon);
    gradient(c, w, 0, hz + 4, '#5fc4ff', '#cdf0ff');
    disc(c, w * 0.16, 20, 10, '#fff3b0');
    for (let x = 0; x < w; x++) {
      const y = hz - 5 - Math.round(Math.sin(x / 24) * 3);
      rect(c, x, y, 1, hz - y + 4, '#5aa86a');
    }
    // alberca: agua al fondo y un borde claro
    for (let tx = 0; tx * 16 < w + 16; tx++)
      for (let ty = 0; ty < 3; ty++)
        c.drawImage(A.water[0] as HTMLCanvasElement, tx * 16, hz + ty * 16);
    for (let tx = 0; tx * 16 < w + 16; tx++)
      c.drawImage(A.ground(G.POOLEDGE, tx, 0), tx * 16, hz + 48);
    floor(c, A, w, hz + 64, h, (tx, ty) => ((tx + ty) % 2 === 0 ? G.DECK : G.DECK2));
    put(c, P('palm', 1, 1, 0), 22, hz + 12);
    put(c, P('parasol', 1, 1, 1), w - 36, h - 14);
    put(c, P('sunbed', 2, 1, 2), w - 80, h - 8);
    put(c, P('duck', 1, 1, 0), w * 0.55, hz + 40);
  },
  tejado: (c, A, w, h, P) => {
    const hz = Math.round(h * SCENE_INFO.tejado.horizon);
    gradient(c, w, 0, hz + 6, '#1f2547', '#4a3a6a');
    stars(c, w, hz - 10, 7, 26);
    skyline(c, w, hz, 3, '#202444');
    floor(c, A, w, hz, h, (tx, ty) => ((tx + ty) % 2 === 0 ? G.TEJA : G.TEJA2));
    rect(c, 0, hz, w, 4, '#a8402b');
    rect(c, 0, hz, w, 1, '#d2704f');
    put(c, P('chimney', 2, 2, 0), w * 0.2, hz + 26);
    put(c, P('chimney', 2, 2, 1), w * 0.82, hz + 22);
    put(c, P('vent', 1, 1, 0), w * 0.55, hz + 18);
  },
  azotea: (c, A, w, h, P) => {
    const hz = Math.round(h * SCENE_INFO.azotea.horizon);
    gradient(c, w, 0, hz + 6, '#10162e', '#35416b');
    stars(c, w, hz - 10, 9, 20);
    skyline(c, w, hz, 5, '#1a2040');
    floor(c, A, w, hz, h, (tx, ty) => ((tx + ty) % 2 === 0 ? G.ALQUITRAN : G.ALQUITRAN2));
    rect(c, 0, hz, w, 5, '#8c6a5c');
    rect(c, 0, hz, w, 1, '#b99483');
    put(c, P('tank', 3, 3, 0), w * 0.78, hz + 34);
    put(c, P('antenna', 1, 1, 0), w * 0.18, hz + 28);
    put(c, P('antenna', 1, 1, 1), w * 0.32, hz + 22);
    put(c, P('ac', 2, 1, 0), w * 0.5, hz + 16);
  },
  mansarda: (c, A, w, h, P) => {
    const hz = Math.round(h * SCENE_INFO.mansarda.horizon);
    gradient(c, w, 0, hz + 6, '#241a3a', '#5a3f78');
    stars(c, w, hz - 10, 11, 18);
    skyline(c, w, hz, 8, '#2a2048');
    floor(c, A, w, hz, h, (tx, ty) => ((tx + ty) % 2 === 0 ? G.PIZARRA : G.PIZARRA2));
    rect(c, 0, hz, w, 5, '#a8402b');
    put(c, P('dormer', 3, 2, 0), w * 0.25, hz + 30);
    put(c, P('dormer', 3, 2, 1), w * 0.72, hz + 28);
    put(c, P('chimney', 2, 2, 0), w * 0.5, hz + 20);
  },
  calle: (c, A, w, h, P) => {
    const hz = Math.round(h * SCENE_INFO.calle.horizon);
    gradient(c, w, 0, hz + 6, '#ffb36b', '#ffe3b3');
    disc(c, w * 0.7, hz - 6, 12, '#ffd48a');
    // casas de la cuadra
    const rng = rngFor(21);
    const cols = ['#ef7d57', '#41a6f6', '#38b764', '#ffcd75', '#b55bf0', '#f4a6c0'];
    for (let x = 2; x < w - 20; x += 34) {
      const hw = rng.int(24, 30);
      const hh = rng.int(22, 32);
      const col = cols[rng.int(0, cols.length - 1)] as string;
      rect(c, x, hz - hh, hw, hh, col);
      rect(c, x, hz - hh, hw, 3, 'rgba(255,255,255,0.35)');
      rect(c, x - 2, hz - hh - 5, hw + 4, 6, '#7a2f2f');
      rect(c, x + 4, hz - hh + 8, 6, 7, '#bfe6ff');
      rect(c, x + hw - 10, hz - hh + 8, 6, 7, '#bfe6ff');
      rect(c, x + hw / 2 - 3, hz - 10, 6, 10, '#5d3a21');
    }
    // acera y calle
    for (let tx = 0; tx * 16 < w + 16; tx++) c.drawImage(A.ground(G.ACERA, tx, 0), tx * 16, hz);
    floor(c, A, w, hz + 16, h, (tx, ty) => (ty === 2 && tx % 3 !== 2 ? G.RAYA : G.ASFALTO));
    rect(c, 0, hz + 15, w, 1, '#8a8a92');
    put(c, P('lamp', 1, 1, 0), 30, hz + 12);
    put(c, P('lamp', 1, 1, 0), w - 40, hz + 12);
    put(c, P('car', 2, 1, 2), w * 0.22, h - 14);
    put(c, P('planter', 1, 1, 0), w * 0.5, hz + 14);
    // banderas de los equipos
    for (const [fx, col] of [
      [w * 0.38, '#ef7d57'],
      [w * 0.62, '#41a6f6'],
    ] as const) {
      rect(c, fx, hz + 20, 2, 26, '#2a2d38');
      rect(c, fx + 2, hz + 20, 14, 8, col);
      rect(c, fx + 2, hz + 20, 14, 1, 'rgba(255,255,255,0.4)');
    }
  },
  patios: (c, A, w, h, P) => {
    const hz = Math.round(h * SCENE_INFO.patios.horizon);
    gradient(c, w, 0, hz + 6, '#6a5aa8', '#f4b48a');
    for (let x = 0; x < w; x++) {
      const y = hz - 6 - Math.round(Math.sin(x / 17 + 1) * 3);
      rect(c, x, y, 1, hz - y + 3, '#3f6e56');
    }
    // fondo: casitas con luz
    for (const x of [14, 90, 168, 250]) {
      rect(c, x, hz - 26, 40, 26, '#a26d3f');
      rect(c, x - 3, hz - 32, 46, 7, '#7a2f2f');
      rect(c, x + 8, hz - 18, 7, 8, '#ffe28a');
      rect(c, x + 26, hz - 18, 7, 8, '#ffe28a');
    }
    floor(c, A, w, hz, h, (tx, ty) =>
      ty < 1 ? G.CESPED : (tx + ty) % 3 === 0 ? G.PATIO : G.CESPED,
    );
    for (let x = 0; x < w; x += 16) put(c, P('fence', 1, 1, 0), x + 8, hz + 12);
    put(c, P('laundry', 3, 1, 0), w * 0.3, hz + 30);
    put(c, P('swing', 3, 2, 0), w * 0.78, hz + 38);
    put(c, P('planter', 1, 1, 0), w * 0.55, h - 14);
  },
  encantado: (c, A, w, h, P) => {
    const hz = Math.round(h * SCENE_INFO.encantado.horizon);
    gradient(c, w, 0, hz + 6, '#0e1a3a', '#2d3a6e');
    stars(c, w, hz - 8, 3, 34);
    disc(c, w * 0.24, 22, 12, '#e8f4ff');
    disc(c, w * 0.24 + 4, 20, 10, '#2a3a74');
    disc(c, w * 0.24 - 1, 22, 5, '#ffffff');
    // espinar del fondo (copas de arbusto) en dos filas
    for (const [row, base] of [
      [0, hz - 2],
      [1, hz + 8],
    ] as const) {
      const rng = rngFor(40 + row);
      for (let x = -10; x < w + 10; x += 20) {
        const canopy = thicketCanopy(rng.int(0, 3));
        c.drawImage(canopy, x + rng.int(-4, 4), base - canopy.height + 6);
      }
    }
    floor(c, A, w, hz + 12, h, (tx, ty) =>
      ty === 3 && tx > 5 && tx < 14 ? G.RUNAS : tx % 6 === 1 && ty === 1 ? G.HONGOS : G.MUSGO,
    );
    put(c, P('mushroom', 1, 1, 1), 34, hz + 40);
    put(c, P('mushroom', 1, 1, 2), w - 44, hz + 44);
    put(c, P('crystal', 1, 1, 0), w * 0.3, hz + 30);
    put(c, P('crystal', 1, 1, 1), w * 0.7, hz + 34);
    put(c, P('statue', 1, 1, 0), w * 0.5, hz + 24);
    // tinte frio sobre todo
    c.fillStyle = 'rgba(30,20,80,0.18)';
    c.fillRect(0, 0, w, h);
  },
};

/** Edificios lejanos con ventanitas encendidas. */
function skyline(c: Ctx, w: number, hz: number, seed: number, col: string): void {
  const rng = rngFor(seed);
  for (let x = -4; x < w;) {
    const bw = rng.int(14, 30);
    const bh = rng.int(14, 34);
    rect(c, x, hz - bh, bw, bh + 4, col);
    for (let wy = hz - bh + 3; wy < hz - 3; wy += 6)
      for (let wx = x + 3; wx < x + bw - 3; wx += 6)
        if (rng.chance(0.4)) rect(c, wx, wy, 2, 3, '#ffd98a');
    x += bw + rng.int(0, 3);
  }
}

// ------------------------------------------------------------------ lo que se mueve

interface Dyn {
  x: number;
  y: number;
  v: number;
  p: number;
}

const rainFor = (n: number, w: number, h: number, seed: number): Dyn[] => {
  const rng = rngFor(seed);
  return Array.from({ length: n }, () => ({
    x: rng.range(0, w),
    y: rng.range(0, h),
    v: rng.range(150, 230),
    p: rng.range(0, 1),
  }));
};

/** Estado de lo que se mueve (lluvia, luciernagas, nubes, pajaros) de un escenario. */
export class SceneMotion {
  private readonly drops: Dyn[];
  private readonly flies: Dyn[];
  private lightning = 0;
  private nextBolt = 2400;
  private last = 0;

  constructor(
    readonly id: SceneId,
    private readonly w: number,
    private readonly h: number,
  ) {
    this.drops = rainFor(this.rainy ? 90 : 0, w, h, 5);
    this.flies = rainFor(
      this.id === 'encantado' ? 26 : this.id === 'bosque' || this.id === 'patios' ? 10 : 0,
      w,
      h,
      8,
    );
  }

  private get rainy(): boolean {
    return this.id === 'tejado' || this.id === 'azotea' || this.id === 'mansarda';
  }

  /** Dibuja lo animado de la escena encima del fondo ya horneado. */
  paint(c: Ctx, t: number): void {
    const { w, h } = this;
    const dt = this.last ? Math.min(0.1, (t - this.last) / 1000) : 0;
    this.last = t;
    const id = this.id;
    // nubes y pajaros del dia
    if (id === 'bosque' || id === 'piscina') {
      for (let i = 0; i < 3; i++) {
        const cx = ((t / 90 + i * 130) % (w + 80)) - 40;
        ell(c, cx, 12 + i * 9, 22 - i * 3, 5, 'rgba(255,255,255,0.85)');
        ell(c, cx + 8, 9 + i * 9, 14, 5, 'rgba(255,255,255,0.9)');
      }
      const bx = ((t / 40) % (w + 60)) - 30;
      const by = 30 + Math.sin(t / 400) * 4;
      c.fillStyle = '#2a2d38';
      c.fillRect(Math.round(bx), Math.round(by), 3, 1);
      c.fillRect(Math.round(bx) + (Math.floor(t / 150) % 2 ? 0 : 1), Math.round(by) - 1, 1, 1);
    }
    if (id === 'piscina') {
      for (let i = 0; i < 16; i++) {
        const x = (i * 23 + Math.floor(t / 300) * 3) % w;
        const y = h * 0.4 + 6 + ((i * 11) % 36);
        if (Math.floor(t / 220 + i) % 3 === 0) rect(c, x, y, 3, 1, 'rgba(255,255,255,0.7)');
      }
    }
    if (id === 'casa') {
      // motas de polvo en los rayos de sol
      for (let i = 0; i < 14; i++) {
        const x = (i * 29 + t / 60) % w;
        const y = 16 + ((i * 17 + t / 90) % 60);
        c.fillStyle = 'rgba(255,240,190,0.55)';
        c.fillRect(Math.round(x), Math.round(y), 1, 1);
      }
      c.globalAlpha = 0.1 + 0.04 * Math.sin(t / 900);
      c.fillStyle = '#fff3c4';
      for (const wx of [w * 0.2, w * 0.5, w * 0.8]) {
        c.beginPath();
        c.moveTo(wx - 14, 14);
        c.lineTo(wx + 14, 14);
        c.lineTo(wx + 44, h);
        c.lineTo(wx - 4, h);
        c.fill();
      }
      c.globalAlpha = 1;
    }
    if (this.rainy) {
      // lluvia en diagonal y un rayo de vez en cuando
      c.fillStyle = 'rgba(190,210,255,0.55)';
      for (const d of this.drops) {
        d.y += d.v * dt;
        d.x -= d.v * 0.28 * dt;
        if (d.y > h) {
          d.y = -6;
          d.x = Math.random() * (w + 40);
        }
        if (d.x < -4) d.x += w + 8;
        c.fillRect(Math.round(d.x), Math.round(d.y), 1, 4);
      }
      this.nextBolt -= dt * 1000;
      if (this.nextBolt <= 0) {
        this.lightning = 1;
        this.nextBolt = 3200 + Math.random() * 4200;
      }
      if (this.lightning > 0) {
        c.globalAlpha = this.lightning * 0.5;
        c.fillStyle = '#e8f0ff';
        c.fillRect(0, 0, w, h);
        c.globalAlpha = 1;
        this.lightning = Math.max(0, this.lightning - dt * 3);
      }
    }
    if (this.flies.length > 0) {
      for (const f of this.flies) {
        f.p += dt * (0.6 + f.v / 400);
        f.x += Math.sin(f.p * 1.7 + f.v) * 6 * dt;
        f.y += Math.cos(f.p * 1.3 + f.v) * 5 * dt - 1.2 * dt;
        if (f.y < 0) f.y = h;
        if (f.x < 0) f.x = w;
        if (f.x > w) f.x = 0;
        const a = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(f.p * 4));
        c.globalAlpha = a;
        c.fillStyle = id === 'encantado' ? '#c9fbff' : '#f4ffb0';
        c.fillRect(Math.round(f.x) - 1, Math.round(f.y), 3, 1);
        c.fillRect(Math.round(f.x), Math.round(f.y) - 1, 1, 3);
      }
      c.globalAlpha = 1;
    }
    if (id === 'encantado') {
      // bruma baja que se arrastra
      for (let i = 0; i < 3; i++) {
        const x = ((t / (140 + i * 40) + i * 90) % (w + 120)) - 60;
        c.globalAlpha = 0.14;
        ell(c, x, h * 0.62 + i * 12, 70, 6, '#bfa8ff');
      }
      c.globalAlpha = 1;
    }
    if (id === 'calle') {
      // un coche que cruza al fondo
      const cx = ((t / 28) % (w + 80)) - 40;
      rect(c, Math.round(cx), Math.round(h * 0.42 + 24), 18, 5, '#e8e9ee');
      rect(c, Math.round(cx) + 4, Math.round(h * 0.42 + 21), 10, 4, '#bfe6ff');
    }
    if (id === 'patios') {
      // la ropa se mece
      const sway = Math.round(Math.sin(t / 500) * 1);
      rect(c, Math.round(w * 0.3) + sway, Math.round(h * 0.42 + 28), 2, 5, '#f4f4f4');
    }
  }
}

// ------------------------------------------------------------------ interfaz publica

/** Dibuja escenarios y los guarda ya horneados (fondo sin movimiento) por tamano. */
export class SceneArt {
  private readonly baked = new Map<string, HTMLCanvasElement>();
  private readonly P: Prop;

  constructor(private readonly assets: Assets) {
    this.P = (kind, w, h, v = 0) => assets.prop(kind, w, h, v);
  }

  /** El fondo quieto del escenario, a este tamano. */
  background(id: SceneId, w: number, h: number): HTMLCanvasElement {
    const key = `${id}:${w}x${h}`;
    let cv = this.baked.get(key);
    if (!cv) {
      const [canvas, c] = make(w, h);
      BAKE[id](c, this.assets, w, h, this.P);
      // un velo oscuro abajo da fondo al piso para que se lean los nombres
      const grad = c.createLinearGradient(0, h * 0.7, 0, h);
      grad.addColorStop(0, 'rgba(10,12,24,0)');
      grad.addColorStop(1, 'rgba(10,12,24,0.35)');
      c.fillStyle = grad;
      c.fillRect(0, h * 0.7, w, h * 0.3);
      cv = canvas;
      this.baked.set(key, cv);
    }
    return cv;
  }
}

// ------------------------------------------------------------------ el escenario del lobby

export interface StageCat {
  id: number | string;
  name: string;
  skin: Skin;
  /** Equipo (0 o 1) en los modos por equipos. */
  team?: number;
  ready?: boolean;
  me?: boolean;
  host?: boolean;
}

/** Medidas internas del escenario: se escala con numeros enteros para que los pixeles se vean nitidos. */
export const STAGE_W = 320;
export const STAGE_H = 176;

/**
 * El escenario del lobby: el fondo del mapa elegido (animado) con los gatos de la sala parados
 * al frente. Dibuja a 320 x 176 y el navegador lo agranda sin suavizar.
 */
export class Stage {
  private readonly ctx: Ctx;
  private scene: SceneId = 'bosque';
  private motion: SceneMotion;
  private cats: StageCat[] = [];
  private raf = 0;
  private fade = 1;
  /** Tamano logico del lienzo: el ancho es fijo y el alto sigue la forma del marco para no recortar gatos. */
  private w = STAGE_W;
  private h = STAGE_H;
  private watcher: ResizeObserver | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly art: SceneArt,
    private readonly crown: HTMLCanvasElement,
  ) {
    canvas.width = STAGE_W;
    canvas.height = STAGE_H;
    this.ctx = canvas.getContext('2d') as Ctx;
    this.ctx.imageSmoothingEnabled = false;
    this.motion = new SceneMotion(this.scene, STAGE_W, STAGE_H);
    const frame = canvas.parentElement;
    if (frame && typeof ResizeObserver !== 'undefined') {
      this.watcher = new ResizeObserver(() => this.fit(frame));
      this.watcher.observe(frame);
    }
  }

  /** Ajusta el alto logico a la forma del marco (alto en PC, bajo en celular). */
  private fit(frame: HTMLElement): void {
    const box = frame.getBoundingClientRect();
    if (box.width < 40 || box.height < 40) return;
    const h = Math.max(130, Math.min(420, Math.round((STAGE_W * box.height) / box.width)));
    if (h === this.h) return;
    this.h = h;
    this.canvas.width = this.w;
    this.canvas.height = h;
    this.ctx.imageSmoothingEnabled = false;
    this.motion = new SceneMotion(this.scene, this.w, h);
  }

  /** Cambia el escenario con un fundido corto. */
  setScene(id: SceneId): void {
    if (id === this.scene) return;
    this.scene = id;
    this.motion = new SceneMotion(id, this.w, this.h);
    this.fade = 0;
  }

  setCats(cats: StageCat[]): void {
    this.cats = cats;
  }

  start(): void {
    if (this.raf) return;
    const tick = (t: number): void => {
      this.raf = requestAnimationFrame(tick);
      // oculto (otra pestana del lobby o en partida): no se gasta nada
      if (this.canvas.offsetParent === null || document.hidden) return;
      this.draw(t);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private draw(t: number): void {
    const c = this.ctx;
    c.drawImage(this.art.background(this.scene, this.w, this.h), 0, 0);
    this.motion.paint(c, t);
    this.paintCats(c, t);
    if (this.fade < 1) {
      this.fade = Math.min(1, this.fade + 0.06);
      c.globalAlpha = 1 - this.fade;
      c.fillStyle = '#0e101c';
      c.fillRect(0, 0, this.w, this.h);
      c.globalAlpha = 1;
    }
  }

  private paintCats(c: Ctx, t: number): void {
    const list = this.cats;
    if (list.length === 0) return;
    const teams = list.some((k) => k.team !== undefined);
    // en equipos, cada uno ocupa su mitad; si no, una o dos filas centradas
    const groups: StageCat[][] = teams
      ? [list.filter((k) => k.team !== 1), list.filter((k) => k.team === 1)]
      : [list];
    const tall = this.h >= this.w * 0.85;
    const region = teams ? this.w / 2 : this.w;
    // un marco alto tiene espacio para dos filas: los gatos salen mas grandes
    const rowsOf = (len: number): number =>
      len > (tall ? (teams ? 1 : 3) : teams ? 3 : 6) ? 2 : 1;
    const perRowOf = (len: number): number => Math.ceil(len / rowsOf(len));
    const widest = Math.max(...groups.map((g) => perRowOf(g.length)));
    // pocos gatos se ven grandes; cuantos mas, mas chicos, siempre dentro del marco
    let scale = 4;
    while (scale > 2 && widest * CAT_W * scale * 0.85 > region - 16) scale--;
    if (!tall) scale = Math.min(scale, widest <= 1 ? 3 : 2);
    const baseY = this.h - 14;
    const rowGap = Math.round(CAT_H * scale * 0.55);
    const drawn: {
      k: StageCat;
      x: number;
      y: number;
      face: 'left' | 'right';
      i: number;
    }[] = [];
    groups.forEach((group, gi) => {
      if (group.length === 0) return;
      const rows = rowsOf(group.length);
      const perRow = perRowOf(group.length);
      const left = teams ? gi * region : 0;
      const stepX = Math.min(CAT_W * scale + 6, (region - 16) / perRow);
      group.forEach((k, i) => {
        const row = i % rows;
        const col = Math.floor(i / rows);
        const rowCount = Math.ceil((group.length - row) / rows);
        const startX = left + region / 2 - ((rowCount - 1) * stepX) / 2;
        drawn.push({
          k,
          x: Math.round(startX + col * stepX),
          y: baseY - (rows - 1 - row) * rowGap,
          face: teams ? (k.team === 1 ? 'left' : 'right') : i % 2 ? 'left' : 'right',
          i: gi * 20 + i,
        });
      });
    });
    // primero la fila de atras: los de adelante tapan a los de atras, no al reves
    drawn.sort((a, b) => a.y - b.y);
    // los nombres van al final para que ningun gato de adelante los tape
    const labels: (() => void)[] = [];
    for (const d of drawn) this.paintCat(c, d.k, d.x, d.y, scale, t + d.i * 330, d.face, labels);
    for (const paint of labels) paint();
  }

  private paintCat(
    c: Ctx,
    k: StageCat,
    x: number,
    baseY: number,
    scale: number,
    t: number,
    face: 'left' | 'right',
    labels: (() => void)[],
  ): void {
    const sprites = catSprites(k.skin);
    const set = face === 'left' ? sprites.left : sprites.right;
    // respira: sube un pixel cada rato; de vez en cuando mueve las patas
    const bob = Math.round(Math.sin(t / 420) * 0.6);
    const step = Math.floor(t / 700) % 9 === 0 ? (Math.floor(t / 140) % 2 === 0 ? 1 : 2) : 0;
    const frame = set[step] as HTMLCanvasElement;
    const w = CAT_W * scale;
    const h = CAT_H * scale;
    const dx = Math.round(x - w / 2);
    const dy = baseY - h + bob * scale;
    // sombra
    c.fillStyle = 'rgba(8,12,24,0.4)';
    c.beginPath();
    c.ellipse(x, baseY - 2, w * 0.38, 3 * (scale / 2), 0, 0, Math.PI * 2);
    c.fill();
    if (k.team !== undefined) {
      c.strokeStyle = TEAM_COLORS[k.team as 0 | 1] as string;
      c.lineWidth = 1;
      c.beginPath();
      c.ellipse(x, baseY - 2, w * 0.46, 4 * (scale / 2), 0, 0, Math.PI * 2);
      c.stroke();
    }
    c.drawImage(frame, dx, dy, w, h);
    labels.push(() => {
      if (k.host) c.drawImage(this.crown, x - 6, dy - 7 + bob, 12, 8);
      // nombre y "listo"
      c.font = '10px VT323, monospace';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      const name = k.name.length > 12 ? `${k.name.slice(0, 11)}.` : k.name;
      c.lineWidth = 3;
      c.strokeStyle = '#0e101c';
      c.strokeText(name, x, baseY + 5);
      c.fillStyle = k.me ? '#ffcd75' : '#f4f4f4';
      c.fillText(name, x, baseY + 5);
      if (k.ready) {
        c.fillStyle = '#a7f070';
        c.fillRect(x - 3, dy - 3, 6, 2);
        c.fillRect(x - 4, dy - 5, 2, 2);
        c.fillRect(x + 2, dy - 5, 2, 2);
      }
    });
  }
}
