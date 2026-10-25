import { TILE } from '../../shared/br/constants';
import { G, type PropKind } from '../../shared/br/mapcore';
import { C, disc, ell, line, make, outline, px, rect, rngFor, type Ctx } from './draw';

const T = TILE;

/** Paleta del bosque encantado: verdes frios, piedra azulada y brillos de luna. */
export const F = {
  moss: '#2b6b4a',
  mossD: '#1f4f3b',
  mossL: '#43995a',
  mossHi: '#6cc477',
  deep: '#143329',
  thorn: '#0f241c',
  thornL: '#1f4a35',
  vine: '#2f6b3f',
  berry: '#8a3f7a',
  rune: '#73eff7',
  runeD: '#3ea7c9',
  slab: '#47516f',
  slabL: '#5a6688',
  slabD: '#333b56',
  glow: '#c9fbff',
  violet: '#a77bf0',
  violetD: '#6b4bb0',
  pink: '#ff7ab6',
} as const;

const speck = (c: Ctx, key: number[], color: string, count: number): void => {
  const rng = rngFor(...key);
  for (let i = 0; i < count; i++) rect(c, rng.int(0, T - 1), rng.int(0, T - 1), 1, 1, color);
};

const shadow = (c: Ctx, cx: number, cy: number, rx: number, ry: number): void =>
  void ell(c, cx, cy, rx, ry, 'rgba(8,12,24,0.38)');

/** Un hongo pequeno de adorno (sombrero de color con puntos). */
function tinyShroom(c: Ctx, x: number, y: number, cap: string, dot: string): void {
  rect(c, x, y + 2, 1, 2, '#e8e0cf');
  rect(c, x - 1, y, 3, 2, cap);
  px(c, x, y, dot);
}

// ------------------------------------------------------------------ terreno

/** Terreno del bosque encantado. Cada baldosa se repite sin costuras. */
export function forestGround(id: number, variant: number): HTMLCanvasElement | null {
  const [cv, c] = make(T, T);
  switch (id) {
    case G.MUSGO: {
      rect(c, 0, 0, T, T, F.moss);
      speck(c, [61, variant], F.mossD, 16);
      speck(c, [62, variant], F.mossL, 12);
      const rng = rngFor(63, variant);
      // matas de hierba corta
      for (let i = 0; i < 3; i++) {
        const x = rng.int(2, 13);
        const y = rng.int(3, 14);
        px(c, x, y, F.mossHi);
        px(c, x - 1, y - 1, F.mossHi);
        px(c, x + 1, y - 1, F.mossHi);
      }
      if (variant === 2) tinyShroom(c, 11, 10, '#d9616f', '#fff2e8');
      if (variant === 3) {
        px(c, 4, 6, '#fff2e8');
        px(c, 3, 6, '#ffd25e');
        px(c, 5, 6, '#ffd25e');
      }
      return cv;
    }
    case G.RUNAS: {
      // losa de piedra con una runa que brilla
      rect(c, 0, 0, T, T, F.slab);
      rect(c, 0, 0, T, 1, F.slabL);
      rect(c, 0, 0, 1, T, F.slabL);
      rect(c, 0, T - 1, T, 1, F.slabD);
      rect(c, T - 1, 0, 1, T, F.slabD);
      speck(c, [64, variant], F.slabD, 8);
      speck(c, [65, variant], F.slabL, 6);
      const glyph = variant % 4;
      const col = F.rune;
      if (glyph === 0) {
        line(c, 8, 3, 8, 12, col);
        line(c, 5, 6, 8, 3, col);
        line(c, 11, 6, 8, 3, col);
      } else if (glyph === 1) {
        disc(c, 8, 8, 3.2, col);
        disc(c, 8, 8, 1.6, F.slab);
        px(c, 8, 8, col);
      } else if (glyph === 2) {
        line(c, 4, 4, 12, 12, col);
        line(c, 12, 4, 4, 12, col);
      } else {
        rect(c, 5, 5, 6, 1, col);
        rect(c, 5, 10, 6, 1, col);
        rect(c, 5, 5, 1, 6, col);
        px(c, 10, 8, col);
      }
      px(c, 8, 8, F.glow);
      return cv;
    }
    case G.HONGOS: {
      rect(c, 0, 0, T, T, F.moss);
      speck(c, [66, variant], F.mossD, 14);
      speck(c, [67, variant], F.mossL, 10);
      tinyShroom(c, 4, 4, '#d9616f', '#fff2e8');
      tinyShroom(c, 10, 8, '#7fb5ff', '#ecf6ff');
      tinyShroom(c, 6, 11, '#ff9bd0', '#fff2f8');
      if (variant % 2) tinyShroom(c, 12, 3, '#ffd25e', '#fff6d6');
      return cv;
    }
    case G.CHARCO: {
      rect(c, 0, 0, T, T, F.moss);
      speck(c, [68, variant], F.mossD, 12);
      speck(c, [69, variant], F.mossL, 8);
      ell(c, 8, 9, 6.5, 4.5, '#1c4d6a');
      ell(c, 8, 8.5, 5.5, 3.6, '#2f86b4');
      ell(c, 7, 7.5, 3.2, 1.6, '#73eff7');
      px(c, 5, 7, F.glow);
      px(c, 6, 7, F.glow);
      px(c, 11, 10, '#a8f4ff');
      return cv;
    }
    case G.ZARZAL: {
      // espinos densos: casi negro, con zarcillos y alguna baya
      rect(c, 0, 0, T, T, F.thorn);
      speck(c, [70, variant], F.thornL, 18);
      speck(c, [71, variant], '#08150f', 12);
      const rng = rngFor(72, variant);
      for (let i = 0; i < 2; i++) {
        const x = rng.int(1, 12);
        const y = rng.int(1, 12);
        line(c, x, y, x + 3, y + 2, F.vine);
        line(c, x + 3, y + 2, x + 2, y + 5, F.vine);
        px(c, x + 3, y + 1, '#c9d98a');
      }
      if (variant % 3 === 0) px(c, rng.int(2, 13), rng.int(2, 13), F.berry);
      return cv;
    }
    default:
      return null;
  }
}

// ------------------------------------------------------------------ props

function giantMushroom(variant: number): HTMLCanvasElement {
  const glow = variant % 3 === 1;
  const caps = glow
    ? ['#4a86d8', '#73b3ff', '#2d5aa3', '#ecf6ff']
    : variant % 3 === 2
      ? ['#8a5fd0', '#b794f4', '#5b3d99', '#f4ecff']
      : ['#cf4f63', '#ec7a8a', '#9c3248', '#fff2e8'];
  const [cv, c] = make(24, 28);
  shadow(c, 12, 25, 9, 2.4);
  // tallo
  rect(c, 9, 14, 6, 11, '#efe6d2');
  rect(c, 9, 14, 2, 11, '#fffaf0');
  rect(c, 14, 14, 1, 11, '#c9bda3');
  rect(c, 8, 23, 8, 2, '#d7ccb2');
  // sombrero
  ell(c, 12, 11, 11, 8, caps[2] as string);
  ell(c, 12, 10, 10.5, 7, caps[0] as string);
  ell(c, 10, 7.5, 6, 3.4, caps[1] as string);
  rect(c, 3, 15, 18, 1, caps[2] as string);
  for (const [x, y, r] of [
    [7, 10, 1.6],
    [14, 7, 1.4],
    [17, 12, 1.5],
    [11, 13, 1.1],
  ] as const)
    disc(c, x, y, r, caps[3] as string);
  return outline(cv, C.black);
}

function catStatue(): HTMLCanvasElement {
  const [cv, c] = make(18, 30);
  shadow(c, 9, 27, 8, 2.2);
  // plinto con musgo
  rect(c, 2, 20, 14, 7, F.slab);
  rect(c, 2, 20, 14, 1, F.slabL);
  rect(c, 2, 25, 14, 2, F.slabD);
  rect(c, 3, 26, 5, 1, F.mossL);
  rect(c, 11, 25, 4, 2, F.mossL);
  // gato sentado de piedra
  ell(c, 9, 17, 5.2, 5, '#8e9bb5');
  ell(c, 9, 7, 4.4, 4, '#a2aec6');
  rect(c, 5, 2, 3, 3, '#a2aec6');
  rect(c, 10, 2, 3, 3, '#a2aec6');
  px(c, 6, 3, '#d3dbea');
  px(c, 11, 3, '#d3dbea');
  rect(c, 6, 7, 2, 1, F.rune);
  rect(c, 10, 7, 2, 1, F.rune);
  px(c, 9, 9, '#6c7894');
  // cola enroscada
  line(c, 13, 20, 16, 17, '#8e9bb5');
  line(c, 16, 17, 15, 14, '#8e9bb5');
  rect(c, 7, 14, 4, 6, '#a2aec6');
  rect(c, 7, 14, 1, 6, '#d3dbea');
  return outline(cv, C.black);
}

function crystalCluster(variant: number): HTMLCanvasElement {
  const pal =
    variant % 3 === 0
      ? ['#73eff7', '#3ea7c9', '#c9fbff', '#1f6f8f']
      : variant % 3 === 1
        ? ['#b794f4', '#7b55c9', '#efe5ff', '#4a2f8a']
        : ['#ff9bd0', '#d4559a', '#ffe3f2', '#8a2f66'];
  const [cv, c] = make(22, 26);
  shadow(c, 11, 23, 9, 2.4);
  const shard = (x: number, base: number, h: number, w: number): void => {
    for (let i = 0; i < h; i++) {
      const half = Math.max(0, (w * (h - i)) / h / 2);
      rect(c, Math.round(x - half), base - i, Math.round(half * 2) + 1, 1, pal[0] as string);
    }
    // cara iluminada y cara oscura
    for (let i = 0; i < h; i++) {
      const half = Math.max(0, (w * (h - i)) / h / 2);
      rect(c, Math.round(x - half), base - i, 1, 1, pal[2] as string);
      rect(c, Math.round(x + half), base - i, 1, 1, pal[1] as string);
    }
  };
  shard(11, 22, 20, 7);
  shard(5, 22, 12, 5);
  shard(17, 22, 14, 6);
  rect(c, 3, 21, 16, 2, '#3a4560');
  px(c, 11, 8, pal[2] as string);
  px(c, 5, 15, pal[2] as string);
  return outline(cv, C.black);
}

function stump(variant: number): HTMLCanvasElement {
  const [cv, c] = make(22, 20);
  shadow(c, 11, 17, 9, 2.4);
  rect(c, 3, 8, 16, 9, '#7a4e2c');
  rect(c, 3, 8, 3, 9, '#9a6a3d');
  rect(c, 16, 8, 3, 9, '#5d3a21');
  ell(c, 11, 8, 8.5, 4, '#b78452');
  ell(c, 11, 8, 6.5, 2.8, '#d4a06a');
  ell(c, 11, 8, 3.8, 1.5, '#b78452');
  px(c, 11, 8, '#8d5d36');
  // raices y musgo
  rect(c, 2, 16, 4, 2, '#5d3a21');
  rect(c, 16, 16, 4, 2, '#5d3a21');
  rect(c, 5, 6, 5, 2, F.mossL);
  rect(c, 6, 5, 3, 1, F.mossHi);
  if (variant % 2) tinyShroom(c, 15, 6, '#d9616f', '#fff2e8');
  return outline(cv, C.black);
}

function ruin(variant: number): HTMLCanvasElement {
  const [cv, c] = make(20, 30);
  shadow(c, 10, 27, 8, 2.3);
  const h = 14 + (variant % 3) * 3;
  // fuste roto
  rect(c, 4, 26 - h, 12, h, '#7c869e');
  rect(c, 4, 26 - h, 3, h, '#a2aec6');
  rect(c, 13, 26 - h, 3, h, '#5a647e');
  for (let y = 26 - h + 3; y < 26; y += 4) rect(c, 4, y, 12, 1, '#566078');
  // corte irregular arriba
  px(c, 5, 26 - h, '#d3dbea');
  px(c, 9, 26 - h, '#d3dbea');
  // base y bloque caido
  rect(c, 2, 24, 16, 3, '#5a647e');
  rect(c, 2, 24, 16, 1, '#7c869e');
  rect(c, 13, 20, 6, 4, '#8e9bb5');
  rect(c, 13, 20, 6, 1, '#b6c0d6');
  // hiedra
  line(c, 5, 26 - h + 2, 6, 24, F.mossL);
  line(c, 6, 24, 9, 22, F.mossHi);
  rect(c, 4, 22, 3, 2, F.vine);
  px(c, 8, 19, F.rune);
  return outline(cv, C.black);
}

/** Sprites de los props del bosque (null si el tipo no es de uno de ellos). */
export function forestProp(kind: PropKind, variant: number): HTMLCanvasElement | null {
  switch (kind) {
    case 'mushroom':
      return giantMushroom(variant);
    case 'statue':
      return catStatue();
    case 'crystal':
      return crystalCluster(variant);
    case 'stump':
      return stump(variant);
    case 'ruin':
      return ruin(variant);
    default:
      return null;
  }
}

// ------------------------------------------------------------------ puertas de enredadera

/**
 * Una casilla de la puerta de enredadera: tallos gruesos entrelazados con espinas y una flor. Es mas
 * alta que la casilla para que se vea con volumen. `grow` (0 a 1) la hace brotar del suelo.
 */
export function vineGateTile(variant: number): HTMLCanvasElement {
  const [cv, c] = make(T, 26);
  shadow(c, 8, 22, 7, 2);
  const stalks = [3, 7, 11];
  stalks.forEach((x, i) => {
    const sway = (variant + i) % 2 === 0 ? 1 : -1;
    for (let y = 22; y > 2; y--) {
      const wob = Math.round(Math.sin((y + i * 3) / 3.2) * 1.4) * sway;
      rect(c, x + wob, y, 3, 1, i === 1 ? F.vine : '#264f33');
      px(c, x + wob, y, F.mossHi);
      px(c, x + wob + 2, y, F.mossD);
    }
    px(c, x, 2, F.mossHi);
  });
  // espinas
  for (const [x, y] of [
    [1, 16],
    [14, 12],
    [5, 8],
    [10, 18],
    [13, 5],
  ] as const) {
    px(c, x, y, '#c9d98a');
    px(c, x + (x > 8 ? 1 : -1), y - 1, '#c9d98a');
  }
  // flor que brilla
  disc(c, 8, 10, 2.4, '#ff7ab6');
  disc(c, 8, 10, 1, '#fff2e8');
  px(c, 8, 7, '#ffd25e');
  return outline(cv, C.black);
}

/** Hierba alta y arbustos que se pintan sobre el espinar para que parezca un bosque cerrado. */
export function thicketCanopy(variant: number): HTMLCanvasElement {
  const [cv, c] = make(26, 26);
  const rng = rngFor(80, variant);
  ell(c, 13, 17, 11, 7, '#0a1c14');
  ell(c, 13, 14, 11.5, 9, '#143a2b');
  ell(c, 13, 12, 10, 8, '#1d5239');
  for (let i = 0; i < 7; i++) {
    const x = rng.int(5, 20);
    const y = rng.int(5, 15);
    disc(c, x, y, rng.int(3, 5), i % 2 ? '#2a6e4a' : '#23603f');
  }
  for (let i = 0; i < 6; i++) rect(c, rng.int(4, 21), rng.int(4, 15), 2, 1, '#43995a');
  px(c, rng.int(7, 18), rng.int(7, 12), F.berry);
  return cv;
}
