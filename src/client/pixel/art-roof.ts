import { TILE } from '../../shared/br/constants';
import { G, type PropKind } from '../../shared/br/mapcore';
import { C, disc, ell, hash, line, make, outline, px, rect, rngFor, shade, type Ctx } from './draw';

const T = TILE;

const dots = (c: Ctx, key: number[], color: string, count: number): void => {
  const rng = rngFor(...key);
  for (let i = 0; i < count; i++) rect(c, rng.int(0, T - 1), rng.int(0, T - 1), 1, 1, color);
};

/** Terreno de los techos. Los patrones se repiten cada 16 px, asi que no se ven costuras. */
export function roofGround(id: number, variant: number): HTMLCanvasElement | null {
  const [cv, c] = make(T, T);
  switch (id) {
    case G.TEJA:
    case G.TEJA2: {
      // tejas de barro: hileras de 4 px con las juntas corridas
      const base = id === G.TEJA ? '#c2563b' : '#a9462f';
      rect(c, 0, 0, T, T, base);
      for (let row = 0; row < 4; row++) {
        const y = row * 4;
        const off = row % 2 === 0 ? 0 : 4;
        rect(c, 0, y + 3, T, 1, shade(base, 0.68));
        rect(c, 0, y, T, 1, shade(base, 1.14));
        for (let x = off; x < T; x += 8) {
          rect(c, x, y, 1, 4, shade(base, 0.74));
          rect(c, x + 1, y + 1, 5, 1, shade(base, 1.06));
        }
      }
      dots(c, [31, variant, id], shade(base, 1.2), 4);
      if (variant === 2) rect(c, 5, 6, 3, 1, '#6f8f5a');
      return cv;
    }
    case G.PIZARRA:
    case G.PIZARRA2: {
      // pizarra azul: placas escalonadas con un brillo en la esquina
      const base = id === G.PIZARRA ? '#5d6e8e' : '#4b5b7b';
      rect(c, 0, 0, T, T, base);
      for (let row = 0; row < 4; row++) {
        const y = row * 4;
        const off = row % 2 === 0 ? 0 : 4;
        rect(c, 0, y + 3, T, 1, shade(base, 0.66));
        for (let x = off; x < T; x += 8) {
          rect(c, x, y, 1, 4, shade(base, 0.72));
          rect(c, x + 1, y, 6, 1, shade(base, 1.18));
          px(c, x + 6, y + 1, shade(base, 1.3));
        }
      }
      if (variant === 1) rect(c, 3, 9, 4, 1, '#84a08c');
      return cv;
    }
    case G.ALQUITRAN:
    case G.ALQUITRAN2: {
      // alquitran con grava y alguna mancha de agua vieja
      const base = id === G.ALQUITRAN ? '#3b404c' : '#454b59';
      rect(c, 0, 0, T, T, base);
      dots(c, [32, variant, id], '#5c6475', 14);
      dots(c, [33, variant, id], '#2c303a', 9);
      if (variant === 0) rect(c, 4, 10, 6, 2, '#2f3340');
      return cv;
    }
    case G.CANALON: {
      // lamina metalica del canalon, con remaches
      rect(c, 0, 0, T, T, '#8a98ad');
      rect(c, 0, 0, T, 2, '#c7d2e2');
      rect(c, 0, T - 3, T, 3, '#566277');
      rect(c, 0, 7, T, 2, '#6c7a90');
      for (const x of [3, 11]) px(c, x, 4, '#dde6f3');
      for (const x of [3, 11]) px(c, x, 12, '#dde6f3');
      return cv;
    }
    case G.PARAPETO: {
      const [cvb, cb] = make(T, T);
      rect(cb, 0, 0, T, T, '#8c6a5c');
      for (let y = 0; y < T; y += 4) {
        rect(cb, 0, y, T, 1, '#6f5146');
        const off = (y / 4) % 2 === 0 ? 0 : 4;
        for (let x = off; x < T; x += 8) rect(cb, x, y, 1, 4, '#6f5146');
      }
      rect(cb, 0, 0, T, 2, '#c4a090');
      dots(cb, [34, variant], '#a88572', 5);
      return cvb;
    }
    case G.CUMBRERA: {
      // lomo de teja redondeada: se ilumina de arriba hacia abajo
      rect(c, 0, 0, T, T, '#a8402b');
      rect(c, 0, 0, T, 4, '#e07a5a');
      rect(c, 0, 4, T, 3, '#c9533a');
      rect(c, 0, 11, T, 5, '#7d2e20');
      for (let x = 0; x < T; x += 8) rect(c, x, 0, 1, T, '#7d2e20');
      return cv;
    }
    default:
      return null;
  }
}

// ------------------------------------------------------------------ props de los techos

const shadow = (c: Ctx, cx: number, cy: number, rx: number, ry: number): void =>
  void ell(c, cx, cy, rx, ry, 'rgba(10,12,24,0.34)');

function chimney(variant: number): HTMLCanvasElement {
  const W = 2 * T;
  const [cv, c] = make(W, 46);
  shadow(c, 16, 41, 15, 4);
  // fuste de ladrillo con hileras alternadas
  rect(c, 3, 10, 26, 32, '#a4553d');
  for (let y = 12; y < 42; y += 4) {
    rect(c, 3, y, 26, 1, '#7f3f2c');
    const off = ((y - 12) / 4) % 2 === 0 ? 0 : 4;
    for (let x = 3 + off; x < 29; x += 8) rect(c, x, y, 1, 4, '#7f3f2c');
  }
  rect(c, 3, 10, 3, 32, '#c26a4d');
  rect(c, 26, 10, 3, 32, '#7d3a28');
  // corona con boca oscura y hollin
  rect(c, 1, 5, 30, 6, '#b9694e');
  rect(c, 1, 5, 30, 1, '#e08a6a');
  rect(c, 1, 10, 30, 1, '#7f3f2c');
  rect(c, 5, 6, 22, 3, '#23202b');
  rect(c, 8, 6, 5, 1, '#3a3645');
  if (variant % 2 === 0) {
    // un gato de humo
    ell(c, 15, 3, 3, 2, 'rgba(210,214,224,0.5)');
    ell(c, 18, 0, 2, 1.5, 'rgba(210,214,224,0.35)');
  }
  return outline(cv, C.black);
}

function tank(): HTMLCanvasElement {
  const W = 3 * T;
  const [cv, c] = make(W, 62);
  shadow(c, 24, 58, 22, 4);
  // patas
  for (const x of [6, 40]) {
    rect(c, x, 44, 3, 15, '#6c4f3e');
    rect(c, x, 44, 1, 15, '#8d6a54');
  }
  rect(c, 22, 46, 3, 13, '#5a4033');
  line(c, 7, 48, 41, 56, '#5a4033');
  // cuerpo cilindrico
  rect(c, 4, 12, 40, 34, '#8da4b8');
  rect(c, 4, 12, 8, 34, '#b8cddd');
  rect(c, 38, 12, 6, 34, '#617a8f');
  for (const y of [20, 30, 40]) rect(c, 4, y, 40, 1, '#566e83');
  // tapa abombada
  ell(c, 24, 12, 20, 5, '#aebfce');
  ell(c, 24, 11, 14, 3, '#c9d8e5');
  rect(c, 22, 4, 4, 5, '#6c4f3e');
  rect(c, 20, 3, 8, 2, '#8d6a54');
  // escalera
  rect(c, 41, 18, 2, 28, '#6c4f3e');
  for (let y = 20; y < 46; y += 4) rect(c, 41, y, 4, 1, '#8d6a54');
  return outline(cv, C.black);
}

function antenna(variant: number): HTMLCanvasElement {
  const [cv, c] = make(18, 40);
  shadow(c, 9, 36, 6, 2.5);
  rect(c, 6, 30, 6, 6, '#59606e');
  rect(c, 8, 4, 2, 28, '#c4ccd8');
  rect(c, 8, 4, 1, 28, '#eef2f8');
  // dipolos
  for (const [y, w] of [
    [7, 14],
    [12, 12],
    [17, 10],
    [22, 8],
  ] as const) {
    rect(c, 9 - Math.floor(w / 2), y, w, 1, '#aeb8c8');
    px(c, 9 - Math.floor(w / 2), y, '#e8eef6');
  }
  rect(c, 8, 2, 2, 2, variant % 2 ? '#ff4d6d' : '#ffcd75');
  line(c, 9, 28, 3, 36, '#59606e');
  line(c, 9, 28, 15, 36, '#59606e');
  return outline(cv, C.black);
}

function vent(variant: number): HTMLCanvasElement {
  const [cv, c] = make(16, 26);
  shadow(c, 8, 22, 6, 2.5);
  rect(c, 4, 10, 8, 12, '#a3aab8');
  rect(c, 4, 10, 2, 12, '#d5dbe6');
  rect(c, 10, 10, 2, 12, '#707887');
  // sombrerete
  ell(c, 8, 8, 7, 3.5, '#c9d0dc');
  ell(c, 8, 7, 5, 2, '#e4e9f2');
  rect(c, 7, 3, 2, 4, '#707887');
  if (variant % 2 === 0) {
    rect(c, 2, 14, 12, 2, '#8f97a6');
    rect(c, 2, 14, 12, 1, '#cfd6e2');
  }
  return outline(cv, C.black);
}

function acUnit(): HTMLCanvasElement {
  const W = 2 * T;
  const [cv, c] = make(W, 28);
  shadow(c, 16, 24, 14, 3);
  rect(c, 2, 8, 28, 16, '#d4dae4');
  rect(c, 2, 8, 28, 3, '#f1f4f9');
  rect(c, 2, 21, 28, 3, '#8a93a4');
  // rejilla del ventilador
  disc(c, 12, 16, 6, '#58606f');
  disc(c, 12, 16, 4.5, '#2f3542');
  for (let a = 0; a < 4; a++) {
    const r = (a * Math.PI) / 2;
    line(c, 12, 16, 12 + Math.cos(r) * 4, 16 + Math.sin(r) * 4, '#8d97a8');
  }
  px(c, 12, 16, '#d7deea');
  // controles
  rect(c, 22, 12, 6, 2, '#58606f');
  px(c, 24, 12, '#38b764');
  px(c, 26, 12, '#ffcd75');
  rect(c, 22, 16, 6, 4, '#aab3c3');
  for (let y = 16; y < 20; y += 2) rect(c, 22, y, 6, 1, '#7c8597');
  return outline(cv, C.black);
}

function dormer(variant: number): HTMLCanvasElement {
  const W = 3 * T;
  const [cv, c] = make(W, 44);
  shadow(c, 24, 40, 22, 3.5);
  // paredes
  rect(c, 4, 18, 40, 22, '#e6dcc6');
  rect(c, 4, 18, 4, 22, '#fbf4e4');
  rect(c, 40, 18, 4, 22, '#b9ad94');
  // ventana con cortina
  rect(c, 14, 22, 20, 15, '#4d3a2e');
  rect(c, 16, 24, 16, 11, variant % 2 ? '#a9d8ff' : '#ffd98a');
  rect(c, 23, 24, 2, 11, '#4d3a2e');
  rect(c, 16, 29, 16, 1, '#4d3a2e');
  px(c, 18, 25, '#ffffff');
  // tejadillo a dos aguas
  for (let i = 0; i < 12; i++) {
    const w = 46 - i * 3;
    rect(c, 24 - Math.floor(w / 2), 18 - i, w, 1, i % 3 === 0 ? '#8a3a29' : '#b04a35');
  }
  rect(c, 2, 17, 44, 2, '#6f2e22');
  rect(c, 22, 5, 4, 3, '#6f2e22');
  return outline(cv, C.black);
}

function skylight(): HTMLCanvasElement {
  const W = 2 * T;
  const [cv, c] = make(W, W);
  rect(c, 2, 2, 28, 28, '#59606e');
  rect(c, 4, 4, 24, 24, '#9fd3ff');
  rect(c, 4, 4, 24, 24, 'rgba(255,255,255,0.12)');
  rect(c, 15, 4, 2, 24, '#59606e');
  rect(c, 4, 15, 24, 2, '#59606e');
  // reflejo
  for (let i = 0; i < 6; i++) {
    px(c, 6 + i, 8 - Math.floor(i / 2), '#ffffff');
    px(c, 19 + i, 20 - Math.floor(i / 2), '#e0f1ff');
  }
  rect(c, 2, 2, 28, 1, '#c7d0dc');
  return cv;
}

function dome(): HTMLCanvasElement {
  const W = 4 * T;
  const [cv, c] = make(W, 74);
  shadow(c, 32, 68, 30, 5);
  // tambor
  rect(c, 6, 36, 52, 30, '#e6dcc6');
  rect(c, 6, 36, 6, 30, '#fbf4e4');
  rect(c, 52, 36, 6, 30, '#b9ad94');
  for (let x = 14; x < 52; x += 12) {
    rect(c, x, 44, 7, 14, '#4d3a2e');
    rect(c, x + 1, 45, 5, 12, '#a9d8ff');
    px(c, x + 2, 46, '#ffffff');
  }
  rect(c, 4, 64, 56, 3, '#8d8470');
  // cupula de cobre oxidado
  ell(c, 32, 36, 28, 22, '#3f9d8a');
  ell(c, 28, 31, 22, 16, '#5cc2a8');
  ell(c, 24, 26, 10, 7, '#8de4c9');
  for (let i = -3; i <= 3; i++) line(c, 32, 14, 32 + i * 9, 56, 'rgba(20,70,60,0.55)');
  rect(c, 30, 6, 4, 10, '#8d6a54');
  disc(c, 32, 5, 2.5, '#ffcd75');
  return outline(cv, C.black);
}

function stairHouse(): HTMLCanvasElement {
  const W = 4 * T;
  const [cv, c] = make(W, 78);
  shadow(c, 32, 72, 30, 5);
  rect(c, 4, 22, 56, 48, '#d9cdb4');
  rect(c, 4, 22, 5, 48, '#f3ead6');
  rect(c, 55, 22, 5, 48, '#a99d82');
  // puerta metalica
  rect(c, 22, 40, 20, 30, '#3a4150');
  rect(c, 24, 42, 16, 28, '#566177');
  rect(c, 31, 42, 2, 28, '#3a4150');
  px(c, 28, 56, '#ffcd75');
  px(c, 35, 56, '#ffcd75');
  rect(c, 22, 36, 20, 4, '#e8b04a');
  for (let x = 22; x < 42; x += 4) rect(c, x, 36, 2, 4, '#3a4150');
  // ventanita y cartel
  rect(c, 8, 30, 10, 8, '#4d3a2e');
  rect(c, 9, 31, 8, 6, '#a9d8ff');
  rect(c, 46, 30, 10, 8, '#4d3a2e');
  rect(c, 47, 31, 8, 6, '#ffd98a');
  // techo plano con borde
  rect(c, 2, 16, 60, 8, '#9a5a44');
  rect(c, 2, 16, 60, 2, '#c47a60');
  rect(c, 2, 23, 60, 2, '#5f3326');
  rect(c, 14, 10, 10, 7, '#a3aab8');
  rect(c, 14, 10, 10, 2, '#d5dbe6');
  return outline(cv, C.black);
}

function laundry(variant: number): HTMLCanvasElement {
  const [cv, c] = make(3 * T, 28);
  for (const x of [3, 44]) {
    rect(c, x, 3, 2, 22, '#6c4f3e');
    shadow(c, x + 1, 25, 4, 1.5);
  }
  line(c, 4, 6, 45, 6, '#c9c4b8');
  const colors =
    variant % 2 ? ['#f4f4f4', '#f4a6c0', '#73eff7'] : ['#ffcd75', '#f4f4f4', '#b6a4ff'];
  colors.forEach((col, i) => {
    const x = 9 + i * 12;
    const sway = Math.round(Math.sin(i * 1.7 + variant) * 1);
    rect(c, x, 7, 9, 12 + (i % 2) * 3, col);
    rect(c, x, 7, 9, 1, shade(col, 0.8));
    rect(c, x + sway, 17 + (i % 2) * 3, 9, 1, shade(col, 0.82));
    px(c, x + 1, 6, '#6c4f3e');
    px(c, x + 7, 6, '#6c4f3e');
  });
  return outline(cv, C.black);
}

/** Sprites de los props de los techos (null si el tipo no es de un techo). */
export function roofProp(kind: PropKind, variant: number): HTMLCanvasElement | null {
  switch (kind) {
    case 'chimney':
      return chimney(variant);
    case 'tank':
      return tank();
    case 'antenna':
      return antenna(variant);
    case 'vent':
      return vent(variant);
    case 'ac':
      return acUnit();
    case 'dormer':
      return dormer(variant);
    case 'skylight':
      return skylight();
    case 'dome':
      return dome();
    case 'shed':
      return stairHouse();
    case 'laundry':
      return laundry(variant);
    default:
      return null;
  }
}

/** Para no repetir los mismos numeros semilla en los pocos sitios que los necesitan. */
export const roofHash = hash;
