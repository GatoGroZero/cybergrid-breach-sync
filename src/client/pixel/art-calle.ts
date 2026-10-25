import { TILE } from '../../shared/br/constants';
import { G, type PropKind } from '../../shared/br/mapcore';
import { C, disc, ell, line, make, outline, px, rect, rngFor, shade, type Ctx } from './draw';

const T = TILE;

const dots = (c: Ctx, key: number[], color: string, count: number): void => {
  const rng = rngFor(...key);
  for (let i = 0; i < count; i++) rect(c, rng.int(0, T - 1), rng.int(0, T - 1), 1, 1, color);
};

/** Terreno de las calles y los patios. Cada baldosa se repite sin costuras. */
export function streetGround(id: number, variant: number): HTMLCanvasElement | null {
  const [cv, c] = make(T, T);
  switch (id) {
    case G.ASFALTO:
    case G.ASFALTO2: {
      const base = id === G.ASFALTO ? '#4a4f5e' : '#575c6c';
      rect(c, 0, 0, T, T, base);
      dots(c, [41, variant, id], '#626879', 12);
      dots(c, [42, variant, id], '#3b3f4c', 10);
      if (id === G.ASFALTO2 || variant === 3) {
        // una grieta y un parche
        line(c, 3, 2 + variant, 9, 7, '#363a46');
        line(c, 9, 7, 11, 13, '#363a46');
        rect(c, 2, 11, 5, 3, '#43485a');
      }
      return cv;
    }
    case G.ACERA: {
      // losas de 8 x 8 con juntas y tonos distintos
      const tones = ['#cdc9c1', '#c4c0b8', '#d2cec6', '#c0bcb4'];
      for (let qy = 0; qy < 2; qy++)
        for (let qx = 0; qx < 2; qx++) {
          const tone = tones[(qx + qy * 2 + variant) % 4] as string;
          rect(c, qx * 8, qy * 8, 8, 8, tone);
          rect(c, qx * 8, qy * 8, 8, 1, shade(tone, 1.1));
          rect(c, qx * 8, qy * 8, 1, 8, shade(tone, 1.06));
          rect(c, qx * 8, qy * 8 + 7, 8, 1, shade(tone, 0.8));
          rect(c, qx * 8 + 7, qy * 8, 1, 8, shade(tone, 0.84));
        }
      dots(c, [43, variant], '#b3afa7', 3);
      return cv;
    }
    case G.CEBRA: {
      rect(c, 0, 0, T, T, '#4a4f5e');
      dots(c, [44, variant], '#626879', 8);
      for (const y of [1, 9]) {
        rect(c, 0, y, T, 5, '#eceef2');
        rect(c, 0, y + 4, T, 1, '#c3c7d0');
        dots(c, [45, y, variant], '#cfd3dc', 2);
      }
      return cv;
    }
    case G.RAYA: {
      rect(c, 0, 0, T, T, '#4a4f5e');
      dots(c, [46, variant], '#626879', 10);
      dots(c, [47, variant], '#3b3f4c', 7);
      rect(c, 1, 5, 11, 3, '#f0c448');
      rect(c, 1, 5, 11, 1, '#fadc7a');
      return cv;
    }
    case G.ADOQUIN: {
      // adoquines redondeados, escalonados
      rect(c, 0, 0, T, T, '#6f6a62');
      for (let row = 0; row < 4; row++) {
        const off = row % 2 === 0 ? 0 : 4;
        for (let x = off - 4; x < T; x += 8) {
          const tone = ['#a39d92', '#9a948a', '#aca69b', '#948e84'][
            (x + row + variant) & 3
          ] as string;
          rect(c, x + 1, row * 4 + 1, 6, 3, tone);
          rect(c, x + 1, row * 4 + 1, 6, 1, shade(tone, 1.14));
          px(c, x + 1, row * 4 + 3, shade(tone, 0.8));
        }
      }
      return cv;
    }
    case G.PATIO: {
      rect(c, 0, 0, T, T, '#bcb9b0');
      rect(c, 0, 0, T, 1, '#9f9c93');
      rect(c, 0, 8, T, 1, '#a6a399');
      rect(c, 0, 0, 1, T, '#9f9c93');
      rect(c, 8, 0, 1, T, '#a6a399');
      dots(c, [48, variant], '#cfccc3', 5);
      dots(c, [49, variant], '#a6a399', 4);
      if (variant === 2) line(c, 2, 12, 6, 14, '#8f8c83');
      return cv;
    }
    case G.CESPED: {
      // cesped cortado en franjas
      const stripe = ((variant & 1) + 0) % 2 === 0;
      rect(c, 0, 0, T, T, stripe ? '#4a9b49' : '#448f44');
      rect(c, 0, 0, T, 8, stripe ? '#4f9f4d' : '#478f46');
      dots(c, [50, variant], '#3b7f3d', 10);
      dots(c, [51, variant], '#63b95a', 6);
      const rng = rngFor(52, variant);
      for (let i = 0; i < 2; i++) {
        const x = rng.int(2, 13);
        const y = rng.int(3, 14);
        px(c, x, y, '#7acb6b');
        px(c, x - 1, y - 1, '#7acb6b');
        px(c, x + 1, y - 1, '#7acb6b');
      }
      if (variant === 1) {
        px(c, 6, 9, '#f4f4f4');
        px(c, 5, 9, '#ffd25e');
        px(c, 7, 9, '#ffd25e');
      }
      return cv;
    }
    default:
      return null;
  }
}

// ------------------------------------------------------------------ props de la calle

const shadow = (c: Ctx, cx: number, cy: number, rx: number, ry: number): void =>
  void ell(c, cx, cy, rx, ry, 'rgba(10,12,24,0.34)');

const CAR_COLORS = [
  ['#d9463e', '#a7322d'],
  ['#3d78d6', '#2b57a3'],
  ['#e8b83a', '#b88c24'],
  ['#e8e9ee', '#b4b7c2'],
  ['#3f9d62', '#2d7347'],
];

function car(variant: number): HTMLCanvasElement {
  const [body, dark] = CAR_COLORS[variant % CAR_COLORS.length] as [string, string];
  const [cv, c] = make(2 * T, 26);
  shadow(c, 16, 22, 15, 3);
  // carroceria
  rect(c, 2, 11, 28, 9, body);
  rect(c, 2, 11, 28, 2, shade(body, 1.2));
  rect(c, 2, 17, 28, 3, dark);
  // cabina
  rect(c, 8, 4, 16, 8, body);
  rect(c, 8, 4, 16, 2, shade(body, 1.2));
  rect(c, 10, 6, 5, 5, '#b9e3ff');
  rect(c, 16, 6, 6, 5, '#b9e3ff');
  rect(c, 10, 6, 2, 1, '#ffffff');
  // luces y parachoques
  rect(c, 28, 13, 2, 2, '#fff2a8');
  rect(c, 2, 13, 2, 2, '#ff5b5b');
  rect(c, 1, 18, 30, 1, '#2a2d38');
  // llantas
  for (const x of [8, 22]) {
    disc(c, x, 20, 3, '#1c1e28');
    disc(c, x, 20, 1.2, '#9097a8');
  }
  return outline(cv, C.black);
}

function dumpster(variant: number): HTMLCanvasElement {
  const [cv, c] = make(2 * T, 22);
  shadow(c, 16, 19, 14, 3);
  const body = variant % 2 ? '#3f7d5a' : '#2f6f8f';
  rect(c, 3, 7, 26, 12, body);
  rect(c, 3, 7, 26, 2, shade(body, 1.25));
  rect(c, 3, 16, 26, 3, shade(body, 0.7));
  for (const x of [8, 14, 20, 26]) rect(c, x, 9, 1, 8, shade(body, 0.75));
  // tapa
  rect(c, 2, 4, 28, 4, shade(body, 0.85));
  rect(c, 2, 4, 28, 1, shade(body, 1.2));
  rect(c, 4, 2, 10, 2, shade(body, 0.7));
  // ruedas
  for (const x of [6, 25]) rect(c, x, 19, 3, 2, '#1c1e28');
  px(c, 22, 12, '#ffcd75');
  return outline(cv, C.black);
}

function lamp(): HTMLCanvasElement {
  const [cv, c] = make(18, 46);
  shadow(c, 9, 43, 5, 2);
  rect(c, 7, 8, 3, 34, '#4a505e');
  rect(c, 7, 8, 1, 34, '#7d8597');
  rect(c, 5, 39, 7, 3, '#363b47');
  // brazo y farol
  rect(c, 7, 4, 8, 2, '#4a505e');
  rect(c, 12, 5, 5, 4, '#fff1a8');
  rect(c, 12, 5, 5, 1, '#ffffff');
  rect(c, 11, 4, 7, 1, '#363b47');
  return outline(cv, C.black);
}

function bench(): HTMLCanvasElement {
  const [cv, c] = make(2 * T, 18);
  shadow(c, 16, 15, 13, 2.5);
  for (const x of [4, 26]) rect(c, x, 8, 2, 7, '#3a3f4c');
  rect(c, 3, 5, 26, 2, '#a8754f');
  rect(c, 3, 5, 26, 1, '#d5a27a');
  rect(c, 3, 8, 26, 2, '#8f5f3e');
  rect(c, 3, 11, 26, 2, '#a8754f');
  rect(c, 3, 2, 26, 2, '#8f5f3e');
  return outline(cv, C.black);
}

function busStop(): HTMLCanvasElement {
  const [cv, c] = make(3 * T, 38);
  shadow(c, 24, 35, 22, 3);
  // postes y techo de cristal
  for (const x of [4, 42]) rect(c, x, 8, 3, 27, '#4a505e');
  rect(c, 2, 4, 44, 5, '#5a6a8a');
  rect(c, 2, 4, 44, 1, '#a9c0e4');
  rect(c, 4, 9, 40, 18, 'rgba(170,215,255,0.42)');
  rect(c, 4, 9, 40, 1, '#d6ebff');
  // cartel del autobus
  rect(c, 22, 13, 11, 9, '#f4f4f4');
  rect(c, 23, 14, 9, 3, '#3b5dc9');
  px(c, 24, 19, '#4a505e');
  px(c, 26, 19, '#4a505e');
  px(c, 28, 19, '#4a505e');
  // banca
  rect(c, 8, 27, 28, 3, '#a8754f');
  rect(c, 8, 27, 28, 1, '#d5a27a');
  for (const x of [10, 33]) rect(c, x, 30, 2, 5, '#3a3f4c');
  return outline(cv, C.black);
}

function planter(variant: number): HTMLCanvasElement {
  const [cv, c] = make(T, 22);
  shadow(c, 8, 19, 7, 2);
  rect(c, 2, 11, 12, 8, '#a99d84');
  rect(c, 2, 11, 12, 2, '#d3c8ae');
  rect(c, 2, 17, 12, 2, '#7f7560');
  // arbustito con flores
  disc(c, 8, 8, 5.5, '#3f9d4c');
  disc(c, 6, 6, 3, '#63c74d');
  for (const [x, y] of [
    [5, 5],
    [10, 7],
    [8, 9],
  ] as const)
    px(c, x, y, variant % 2 ? '#ff7aa8' : '#ffd25e');
  return outline(cv, C.black);
}

function fence(): HTMLCanvasElement {
  const [cv, c] = make(T, 22);
  shadow(c, 8, 19, 7, 1.8);
  rect(c, 0, 8, T, 2, '#d8c9a8');
  rect(c, 0, 14, T, 2, '#d8c9a8');
  for (const x of [1, 6, 11]) {
    rect(c, x, 4, 3, 15, '#efe3c4');
    rect(c, x, 4, 1, 15, '#fffaf0');
    rect(c, x + 2, 4, 1, 15, '#c9b98f');
    px(c, x + 1, 3, '#efe3c4');
  }
  return outline(cv, C.black);
}

function swing(): HTMLCanvasElement {
  const [cv, c] = make(3 * T, 44);
  shadow(c, 24, 40, 22, 3);
  // armazon en A
  line(c, 5, 38, 14, 6, '#c9534a');
  line(c, 43, 38, 34, 6, '#c9534a');
  line(c, 6, 38, 15, 6, '#c9534a');
  line(c, 42, 38, 33, 6, '#c9534a');
  rect(c, 12, 4, 24, 3, '#e2675d');
  rect(c, 12, 4, 24, 1, '#ff9d94');
  // columpios
  for (const x of [18, 28]) {
    line(c, x, 7, x, 28, '#9aa3b5');
    rect(c, x - 3, 28, 7, 2, '#3b5dc9');
    rect(c, x - 3, 28, 7, 1, '#6f93ff');
  }
  return outline(cv, C.black);
}

/** Sprites de los props de calles y patios (null si el tipo no es de uno de ellos). */
export function streetProp(kind: PropKind, variant: number): HTMLCanvasElement | null {
  switch (kind) {
    case 'car':
      return car(variant);
    case 'dumpster':
      return dumpster(variant);
    case 'lamp':
      return lamp();
    case 'bench':
      return bench();
    case 'busstop':
      return busStop();
    case 'planter':
      return planter(variant);
    case 'fence':
      return fence();
    case 'swing':
      return swing();
    default:
      return null;
  }
}
