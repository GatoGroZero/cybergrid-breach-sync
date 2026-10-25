import { HOSTILE_SHOT, MOB } from '../../shared/br/adventure';
import { C, disc, ell, flipH, line, make, outline, px, rect, type Ctx } from './draw';

/**
 * Enemigos y jefes de la Aventura, dibujados con codigo. Los pequenos miran a la derecha (el
 * renderizador los voltea) y tienen dos cuadros de animacion; los jefes se ven de frente.
 */

const shadow = (c: Ctx, cx: number, cy: number, rx: number, ry: number): void =>
  void ell(c, cx, cy, rx, ry, 'rgba(8,12,24,0.4)');

// ------------------------------------------------------------------ enemigos comunes

function rata(f: number): HTMLCanvasElement {
  const [cv, c] = make(16, 12);
  shadow(c, 8, 10, 6, 1.6);
  // cola rosada
  line(c, 3, 8, 1, 6, '#e89aa6');
  px(c, 1, 5, '#e89aa6');
  // cuerpo
  ell(c, 8, 7, 5.4, 3.4, '#8a7f91');
  ell(c, 9, 8, 4, 2, '#b9afc2');
  ell(c, 7, 5.6, 4, 1.8, '#9d93a7');
  // cabeza, hocico y orejas
  ell(c, 12, 6, 2.8, 2.4, '#8a7f91');
  rect(c, 13, 6, 3, 2, '#9d93a7');
  px(c, 15, 6, '#3a2f40');
  disc(c, 11, 3.5, 1.7, '#8a7f91');
  disc(c, 11, 3.5, 0.9, '#f0a6b4');
  px(c, 12, 5, '#d93a4a');
  // bigotes
  px(c, 14, 8, '#e8e0f0');
  px(c, 15, 9, '#e8e0f0');
  // patas
  if (f === 0) {
    rect(c, 6, 9, 1, 2, '#6b6275');
    rect(c, 10, 9, 1, 1, '#6b6275');
  } else {
    rect(c, 6, 9, 1, 1, '#6b6275');
    rect(c, 10, 9, 1, 2, '#6b6275');
  }
  return outline(cv, C.black);
}

function murcielago(f: number): HTMLCanvasElement {
  const [cv, c] = make(22, 16);
  const wing = '#6b4bb0';
  const wingD = '#4a2f8a';
  // alas: arriba o abajo
  const up = f === 0;
  for (const side of [-1, 1] as const) {
    const bx = 11 + side * 2;
    const tipY = up ? 1 : 12;
    const tipX = 11 + side * 9;
    line(c, bx, 8, tipX, tipY, wingD);
    line(c, bx, 8, tipX - side * 2, up ? 8 : 13, wingD);
    // membrana con borde festoneado
    for (let i = 0; i <= 8; i++) {
      const x = 11 + side * (2 + i);
      const topY = up ? 8 - Math.round((i / 8) * 7) : 8 + Math.round((i / 8) * 4);
      const botY = up
        ? 9 + Math.round(Math.abs(Math.sin(i * 1.2)) * 2)
        : 11 + Math.round(Math.abs(Math.sin(i * 1.2)) * 2);
      rect(c, x, Math.min(topY, botY), 1, Math.abs(botY - topY) + 1, i % 2 ? wing : '#7d5cc4');
    }
  }
  // cuerpo y cabeza
  ell(c, 11, 8, 2.6, 3.4, '#3b2a5c');
  ell(c, 11, 5, 2.4, 2.2, '#4a3470');
  px(c, 9, 2, '#4a3470');
  px(c, 13, 2, '#4a3470');
  px(c, 9, 3, '#4a3470');
  px(c, 13, 3, '#4a3470');
  px(c, 10, 5, '#ff4d5e');
  px(c, 12, 5, '#ff4d5e');
  px(c, 10, 7, '#f4f4f4');
  px(c, 12, 7, '#f4f4f4');
  return outline(cv, C.black);
}

function buho(f: number): HTMLCanvasElement {
  const [cv, c] = make(18, 22);
  shadow(c, 9, 20, 6.5, 1.8);
  // alas
  const lift = f === 0 ? 0 : 1;
  ell(c, 3.5, 12 - lift, 2.6, 5.5, '#3e3158');
  ell(c, 14.5, 12 - lift, 2.6, 5.5, '#3e3158');
  // cuerpo
  ell(c, 9, 12, 5.6, 7, '#5d4a7a');
  ell(c, 9, 14, 3.8, 5, '#a695c4');
  for (const [x, y] of [
    [8, 11],
    [10, 11],
    [9, 14],
    [7, 15],
    [11, 15],
    [9, 17],
  ] as const) {
    px(c, x, y, '#6f5c92');
    px(c, x, y + 1, '#6f5c92');
  }
  // cabeza con orejas de plumas
  ell(c, 9, 6, 5.2, 4.4, '#5d4a7a');
  rect(c, 4, 1, 2, 3, '#3e3158');
  rect(c, 12, 1, 2, 3, '#3e3158');
  ell(c, 6.5, 6, 2.6, 2.6, '#cdbfe6');
  ell(c, 11.5, 6, 2.6, 2.6, '#cdbfe6');
  disc(c, 6.5, 6, 1.8, '#ffd25e');
  disc(c, 11.5, 6, 1.8, '#ffd25e');
  rect(c, 6, 5, 2, 2, '#1a1c2c');
  rect(c, 11, 5, 2, 2, '#1a1c2c');
  // ceño furioso y pico
  line(c, 4, 3, 8, 5, '#1a1c2c');
  line(c, 14, 3, 10, 5, '#1a1c2c');
  rect(c, 8, 8, 2, 2, '#ef7d57');
  // garras
  rect(c, 6, 19, 2, 1, '#ef7d57');
  rect(c, 10, 19, 2, 1, '#ef7d57');
  return outline(cv, C.black);
}

function perro(f: number): HTMLCanvasElement {
  const [cv, c] = make(26, 18);
  shadow(c, 13, 16, 10, 2);
  // cola
  line(c, 4, 6, 1, 3, '#8a5530');
  line(c, 4, 7, 1, 4, '#8a5530');
  // patas
  const a = f === 0 ? 0 : 1;
  rect(c, 7, 12, 3, 4 - a, '#7a4a28');
  rect(c, 11, 12, 3, 3 + a, '#8a5530');
  rect(c, 15, 12, 3, 4 - a, '#7a4a28');
  rect(c, 19, 12, 3, 3 + a, '#8a5530');
  rect(c, 7, 15 - a, 3, 1, '#d9c9a8');
  rect(c, 15, 15 - a, 3, 1, '#d9c9a8');
  // cuerpo
  ell(c, 12, 9, 9, 4.8, '#a0693e');
  ell(c, 12, 6.5, 8.5, 2.4, '#7a4a28');
  ell(c, 13, 11.5, 6, 1.8, '#d9b48a');
  // collar con puas
  rect(c, 17, 5, 3, 8, '#566c86');
  for (const y of [5, 8, 11]) {
    px(c, 18, y, '#d9dde6');
    px(c, 19, y - 1, '#d9dde6');
  }
  // cabeza
  ell(c, 21, 7, 4, 3.4, '#a0693e');
  rect(c, 23, 7, 3, 3, '#c28a5a');
  px(c, 25, 7, '#1a1c2c');
  rect(c, 22, 10, 3, 1, '#f4f4f4');
  px(c, 23, 10, '#d93a4a');
  // oreja caida y ojo furioso
  ell(c, 19, 5, 1.6, 3, '#5d3a21');
  px(c, 22, 5, '#ffd25e');
  line(c, 21, 4, 23, 5, '#1a1c2c');
  return outline(cv, C.black);
}

function hongo(f: number): HTMLCanvasElement {
  const [cv, c] = make(20, 22);
  shadow(c, 10, 20, 7, 1.8);
  // raices
  rect(c, 5, 18, 3, 2, '#8a6a4a');
  rect(c, 12, 18, 3, 2, '#8a6a4a');
  // tallo
  rect(c, 6, 11, 8, 8, '#efe6d2');
  rect(c, 6, 11, 2, 8, '#fffaf0');
  rect(c, 13, 11, 1, 8, '#c9bda3');
  // cara
  rect(c, 7, 13, 2, 2, '#1a1c2c');
  rect(c, 11, 13, 2, 2, '#1a1c2c');
  px(c, 8, 13, '#ff4d5e');
  px(c, 12, 13, '#ff4d5e');
  rect(c, 8, 16, 4, 1, '#1a1c2c');
  px(c, 9, 17, '#1a1c2c');
  px(c, 10, 17, '#1a1c2c');
  // sombrero
  ell(c, 10, 8, 9, 6.4, '#4d2f86');
  ell(c, 10, 7, 8.6, 5.4, '#7e57c2');
  ell(c, 8, 5, 5, 2.4, '#a98be6');
  rect(c, 2, 11, 16, 1, '#4d2f86');
  const glow = f === 0 ? '#ffe28a' : '#fff6c7';
  for (const [x, y, r] of [
    [6, 8, 1.4],
    [12, 5, 1.6],
    [15, 9, 1.2],
    [10, 9, 1],
  ] as const)
    disc(c, x, y, r, glow);
  return outline(cv, C.black);
}

function zorro(f: number): HTMLCanvasElement {
  const [cv, c] = make(26, 16);
  shadow(c, 13, 14, 9, 1.8);
  // cola tupida con punta blanca
  ell(c, 5, 8, 4.4, 2.6, '#ef7d57');
  ell(c, 2.5, 8, 2, 1.8, '#f4f4f4');
  // patas negras
  const a = f === 0 ? 0 : 1;
  rect(c, 9, 11, 2, 3 - a, '#3a2a30');
  rect(c, 13, 11, 2, 2 + a, '#3a2a30');
  rect(c, 17, 11, 2, 3 - a, '#3a2a30');
  // cuerpo
  ell(c, 13, 9, 7, 3.6, '#ef7d57');
  ell(c, 14, 10.5, 5, 1.6, '#f4e6d2');
  ell(c, 12, 7, 6, 1.6, '#d65f3a');
  // cabeza
  ell(c, 20, 7, 3.4, 2.8, '#ef7d57');
  rect(c, 22, 7, 4, 2, '#f4e6d2');
  px(c, 25, 7, '#1a1c2c');
  // orejas
  rect(c, 18, 2, 2, 3, '#ef7d57');
  rect(c, 21, 2, 2, 3, '#ef7d57');
  px(c, 18, 2, '#3a2a30');
  px(c, 22, 2, '#3a2a30');
  // ojo astuto
  line(c, 20, 6, 23, 6, '#1a1c2c');
  px(c, 22, 7, '#ffd25e');
  return outline(cv, C.black);
}

function golem(f: number): HTMLCanvasElement {
  const [cv, c] = make(32, 34);
  shadow(c, 16, 32, 12, 2.4);
  const a = f === 0 ? 0 : 1;
  // piernas
  rect(c, 9, 24, 6, 7 - a, '#5a647e');
  rect(c, 17, 24, 6, 6 + a, '#5a647e');
  rect(c, 8, 30 - a, 8, 2, '#47516f');
  rect(c, 16, 29 + a, 8, 2, '#47516f');
  // brazos y punos
  rect(c, 2, 12, 5, 12 + a, '#6f7a96');
  rect(c, 25, 12, 5, 12 - a + 1, '#6f7a96');
  rect(c, 1, 22 + a, 7, 6, '#7c869e');
  rect(c, 24, 22 - a + 1, 7, 6, '#7c869e');
  rect(c, 1, 22 + a, 7, 1, '#a2aec6');
  rect(c, 24, 22 - a + 1, 7, 1, '#a2aec6');
  // torso
  rect(c, 7, 10, 18, 16, '#7c869e');
  rect(c, 7, 10, 18, 2, '#a2aec6');
  rect(c, 7, 10, 2, 16, '#a2aec6');
  rect(c, 23, 10, 2, 16, '#5a647e');
  rect(c, 7, 24, 18, 2, '#5a647e');
  // runa del pecho
  disc(c, 16, 18, 4, '#2b3350');
  disc(c, 16, 18, 3, '#73eff7');
  disc(c, 16, 18, 1.4, '#c9fbff');
  line(c, 16, 14, 16, 22, '#2b3350');
  // cabeza
  rect(c, 11, 3, 10, 8, '#8e9bb5');
  rect(c, 11, 3, 10, 1, '#b6c0d6');
  rect(c, 12, 6, 3, 2, '#73eff7');
  rect(c, 17, 6, 3, 2, '#73eff7');
  px(c, 13, 6, '#ffffff');
  px(c, 18, 6, '#ffffff');
  // grietas y musgo
  line(c, 9, 14, 12, 19, '#47516f');
  line(c, 22, 20, 19, 25, '#47516f');
  rect(c, 8, 10, 5, 2, '#43995a');
  rect(c, 19, 10, 4, 1, '#6cc477');
  rect(c, 9, 24, 4, 1, '#43995a');
  return outline(cv, C.black);
}

function sombra(f: number): HTMLCanvasElement {
  const [cv, c] = make(18, 20);
  c.globalAlpha = 0.88;
  // cuerpo de humo con la parte de abajo ondulada
  ell(c, 9, 9, 6, 6.6, '#2a2147');
  rect(c, 3, 9, 12, 7, '#2a2147');
  for (let x = 3; x < 15; x++) {
    const wob = Math.round(Math.sin(x * 0.9 + f * 2) * 1.5);
    rect(c, x, 16, 1, 2 + wob, '#2a2147');
  }
  ell(c, 9, 7, 5, 4, '#3d2f66');
  // orejas
  rect(c, 4, 1, 2, 3, '#2a2147');
  rect(c, 12, 1, 2, 3, '#2a2147');
  c.globalAlpha = 1;
  rect(c, 6, 7, 2, 2, '#e08cff');
  rect(c, 11, 7, 2, 2, '#e08cff');
  px(c, 6, 7, '#ffffff');
  px(c, 11, 7, '#ffffff');
  return outline(cv, '#120d24');
}

function clon(f: number): HTMLCanvasElement {
  const [cv, c] = make(18, 22);
  c.globalAlpha = 0.78;
  shadow(c, 9, 20, 5, 1.4);
  ell(c, 9, 13, 5, 6, '#bfe9ff');
  ell(c, 9, 15, 3.4, 4, '#e6f6ff');
  ell(c, 9, 7, 5, 4.4, '#bfe9ff');
  rect(c, 4, 2, 3, 3, '#bfe9ff');
  rect(c, 11, 2, 3, 3, '#bfe9ff');
  // cola
  line(c, 13, 17, 16, 14 + f, '#bfe9ff');
  line(c, 16, 14 + f, 15, 11 + f, '#bfe9ff');
  c.globalAlpha = 1;
  rect(c, 6, 7, 2, 2, '#3b5dc9');
  rect(c, 11, 7, 2, 2, '#3b5dc9');
  px(c, 9, 10, '#6fa8e8');
  return outline(cv, '#3a6ea5');
}

// ------------------------------------------------------------------ jefes (de frente)

function reinaRata(f: number): HTMLCanvasElement {
  const [cv, c] = make(44, 42);
  shadow(c, 22, 39, 17, 3);
  // cola larga a un lado
  line(c, 33, 32, 40, 30, '#e89aa6');
  line(c, 40, 30, 41, 24, '#e89aa6');
  line(c, 41, 24, 39, 20 + f, '#e89aa6');
  // capa morada
  ell(c, 22, 27, 15, 11, '#5d275d');
  ell(c, 22, 29, 13, 8, '#7b3a7b');
  rect(c, 7, 32, 30, 3, '#5d275d');
  for (let x = 8; x < 36; x += 4) rect(c, x, 34, 2, 2, '#ffd25e');
  // cuerpo y panza
  ell(c, 22, 26, 10, 10, '#8a7f91');
  ell(c, 22, 29, 7, 7, '#cfc6d8');
  // brazos con el cetro de queso
  rect(c, 8, 22, 4, 8, '#8a7f91');
  rect(c, 32, 22, 4, 8, '#8a7f91');
  const qy = 18 + f;
  rect(c, 6, qy + 5, 2, 14, '#a8754f');
  line(c, 3, qy + 5, 9, qy, '#ffcd75');
  rect(c, 2, qy + 2, 8, 5, '#ffcd75');
  rect(c, 2, qy + 2, 8, 1, '#fff0b8');
  disc(c, 4, qy + 4, 1, '#e0a93a');
  disc(c, 7, qy + 5, 1, '#e0a93a');
  // cabeza
  ell(c, 22, 14, 9, 8, '#8a7f91');
  disc(c, 13, 8, 4.4, '#8a7f91');
  disc(c, 31, 8, 4.4, '#8a7f91');
  disc(c, 13, 8, 2.8, '#f0a6b4');
  disc(c, 31, 8, 2.8, '#f0a6b4');
  ell(c, 22, 17, 5, 4, '#b9afc2');
  rect(c, 21, 15, 3, 2, '#e07a8a');
  // ojos y dientes
  rect(c, 16, 11, 3, 3, '#1a1c2c');
  rect(c, 25, 11, 3, 3, '#1a1c2c');
  px(c, 17, 11, '#ff4d5e');
  px(c, 26, 11, '#ff4d5e');
  line(c, 15, 9, 19, 11, '#1a1c2c');
  line(c, 29, 9, 25, 11, '#1a1c2c');
  rect(c, 20, 19, 2, 3, '#f4f4f4');
  rect(c, 23, 19, 2, 3, '#f4f4f4');
  // bigotes
  for (const [x0, y0, x1, y1] of [
    [16, 17, 8, 16],
    [16, 18, 8, 20],
    [28, 17, 36, 16],
    [28, 18, 36, 20],
  ] as const)
    line(c, x0, y0, x1, y1, '#e8e0f0');
  // corona
  rect(c, 15, 4, 14, 3, '#ffcd75');
  rect(c, 15, 4, 14, 1, '#fff0b8');
  for (const x of [15, 20, 25, 28]) {
    rect(c, x, 1, 2, 3, '#ffcd75');
    px(c, x, 1, '#fff0b8');
  }
  disc(c, 22, 5, 1.3, '#ff4d5e');
  disc(c, 17, 5, 0.9, '#73eff7');
  disc(c, 27, 5, 0.9, '#73eff7');
  return outline(cv, C.black);
}

function buhoAnciano(f: number): HTMLCanvasElement {
  const [cv, c] = make(52, 50);
  shadow(c, 26, 47, 18, 3);
  const flap = f === 0 ? 0 : 2;
  // alas abiertas
  for (const side of [-1, 1] as const) {
    const x0 = 26 + side * 9;
    for (let i = 0; i < 6; i++) {
      const len = 17 - i * 1.5;
      const y = 14 + i * 5 - flap;
      rect(
        c,
        side < 0 ? Math.round(x0 - len) : x0,
        y,
        Math.round(len),
        4,
        i % 2 ? '#8791a8' : '#a0abc2',
      );
      rect(c, side < 0 ? Math.round(x0 - len) : x0, y + 3, Math.round(len), 1, '#5f6a85');
    }
  }
  // cuerpo
  ell(c, 26, 28, 12, 16, '#8791a8');
  ell(c, 26, 31, 8.4, 12.5, '#e6ebf5');
  for (let y = 22; y < 42; y += 4)
    for (let x = 21; x < 32; x += 4) {
      px(c, x + (y % 8 === 2 ? 2 : 0), y, '#9aa5bf');
      px(c, x + (y % 8 === 2 ? 2 : 0), y + 1, '#9aa5bf');
    }
  // cabeza
  ell(c, 26, 12, 11, 9, '#8791a8');
  rect(c, 14, 0, 4, 7, '#6e7893');
  rect(c, 34, 0, 4, 7, '#6e7893');
  ell(c, 20, 12, 5, 5, '#f4f7ff');
  ell(c, 32, 12, 5, 5, '#f4f7ff');
  disc(c, 20, 12, 3.4, '#73c9ff');
  disc(c, 32, 12, 3.4, '#73c9ff');
  disc(c, 20, 12, 1.6, '#12203a');
  disc(c, 32, 12, 1.6, '#12203a');
  px(c, 19, 11, '#ffffff');
  px(c, 31, 11, '#ffffff');
  // cejas largas de anciano
  line(c, 13, 8, 22, 7, '#f4f7ff');
  line(c, 39, 8, 30, 7, '#f4f7ff');
  line(c, 12, 10, 16, 14, '#f4f7ff');
  line(c, 40, 10, 36, 14, '#f4f7ff');
  // pico y barba
  rect(c, 24, 15, 4, 4, '#ffcd75');
  px(c, 25, 19, '#e0a93a');
  rect(c, 22, 20, 8, 3, '#f4f7ff');
  // garras
  rect(c, 19, 44, 4, 2, '#ffcd75');
  rect(c, 29, 44, 4, 2, '#ffcd75');
  // estrellitas de sabiduria
  px(c, 8, 6 + f, '#fff6d6');
  px(c, 44, 8 - f, '#fff6d6');
  return outline(cv, C.black);
}

function mamaHongo(f: number): HTMLCanvasElement {
  const [cv, c] = make(58, 54);
  shadow(c, 29, 51, 22, 3);
  // hongitos hijos
  for (const [x, y, col] of [
    [6, 42, '#d9616f'],
    [49, 43, '#7fb5ff'],
    [14, 47, '#ffd25e'],
  ] as const) {
    rect(c, x, y + 2, 2, 5, '#efe6d2');
    ell(c, x + 1, y + 1, 4, 3, col);
    px(c, x, y, '#ffffff');
  }
  // tallo grueso
  rect(c, 19, 26, 20, 22, '#efe6d2');
  rect(c, 19, 26, 5, 22, '#fffaf0');
  rect(c, 36, 26, 3, 22, '#c9bda3');
  ell(c, 29, 47, 13, 3, '#d7ccb2');
  // cara dulce pero enojada
  rect(c, 23, 32, 4, 4, '#1a1c2c');
  rect(c, 32, 32, 4, 4, '#1a1c2c');
  px(c, 24, 32, '#ff4d5e');
  px(c, 33, 32, '#ff4d5e');
  line(c, 21, 30, 27, 32, '#1a1c2c');
  line(c, 37, 30, 31, 32, '#1a1c2c');
  rect(c, 26, 40, 7, 1, '#1a1c2c');
  rect(c, 27, 41, 5, 1, '#1a1c2c');
  disc(c, 22, 38, 2, '#f7a6b8');
  disc(c, 37, 38, 2, '#f7a6b8');
  // sombrero enorme
  ell(c, 29, 18, 28, 16, '#7a2c4d');
  ell(c, 29, 16, 27, 14, '#b13e66');
  ell(c, 22, 10, 14, 5.5, '#d96a8e');
  rect(c, 2, 27, 54, 2, '#7a2c4d');
  const pulse = f === 0 ? 0 : 1;
  for (const [x, y, r] of [
    [10, 20, 3.2],
    [20, 8, 3.8],
    [33, 6, 3],
    [44, 14, 4],
    [48, 23, 2.6],
    [30, 19, 4.2],
    [16, 24, 2.4],
  ] as const)
    disc(c, x, y, r + pulse * 0.4, '#fff0f4');
  // esporas flotando
  for (const [x, y] of [
    [3, 8],
    [54, 6],
    [10, 2],
    [46, 3],
  ] as const)
    px(c, x, y + pulse, '#d6ffb0');
  return outline(cv, C.black);
}

function perroGuardian(f: number): HTMLCanvasElement {
  const [cv, c] = make(56, 46);
  shadow(c, 28, 43, 21, 3);
  const bob = f === 0 ? 0 : 1;
  // cuerpo con armadura
  ell(c, 28, 32, 18, 11, '#5d3a21');
  ell(c, 28, 30, 17, 9, '#7a4a28');
  rect(c, 12, 26, 32, 4, '#566c86');
  rect(c, 12, 26, 32, 1, '#a9bdd2');
  for (let x = 13; x < 43; x += 5) {
    px(c, x, 25, '#d9dde6');
    px(c, x + 1, 24, '#d9dde6');
  }
  // patas
  rect(c, 11, 36, 6, 7 - bob, '#7a4a28');
  rect(c, 39, 36, 6, 6 + bob, '#7a4a28');
  rect(c, 10, 42 - bob, 8, 2, '#47516f');
  rect(c, 38, 41 + bob, 8, 2, '#47516f');
  // cuellos
  rect(c, 8, 18, 6, 10, '#6b4326');
  rect(c, 42, 18, 6, 10, '#6b4326');
  rect(c, 24, 16, 8, 12, '#7a4a28');
  // tres cabezas: centro grande y dos laterales
  const head = (cx: number, cy: number, s: number): void => {
    ell(c, cx, cy, 6.5 * s, 5.5 * s, '#8a5530');
    ell(c, cx, cy + 2 * s, 4 * s, 3 * s, '#c28a5a');
    rect(
      c,
      Math.round(cx - 1.4 * s),
      Math.round(cy + 1 * s),
      Math.round(3 * s),
      Math.round(2 * s),
      '#1a1c2c',
    );
    // orejas puntiagudas
    for (const side of [-1, 1] as const)
      for (let i = 0; i < 6; i++) {
        const w = Math.max(1, Math.round((3.4 - i * 0.55) * s));
        const x = Math.round(cx + side * 4.4 * s - (side < 0 ? w - 1 : 0) + side * i * 0.3);
        rect(c, x, Math.round(cy - 3 * s) - i, w, 1, i === 5 ? '#3a2214' : '#5d3a21');
      }
    // ojos de fuego
    rect(
      c,
      Math.round(cx - 4.4 * s),
      Math.round(cy - 2.4 * s),
      Math.round(2.4 * s),
      Math.round(2 * s),
      '#ff7a3a',
    );
    rect(
      c,
      Math.round(cx + 2.2 * s),
      Math.round(cy - 2.4 * s),
      Math.round(2.4 * s),
      Math.round(2 * s),
      '#ff7a3a',
    );
    px(c, Math.round(cx - 3.6 * s), Math.round(cy - 2 * s), '#fff2a8');
    px(c, Math.round(cx + 3 * s), Math.round(cy - 2 * s), '#fff2a8');
    // colmillos
    rect(c, Math.round(cx - 3 * s), Math.round(cy + 4 * s), 1, Math.round(2 * s), '#f4f4f4');
    rect(c, Math.round(cx + 2 * s), Math.round(cy + 4 * s), 1, Math.round(2 * s), '#f4f4f4');
  };
  head(11, 16 - bob, 0.82);
  head(45, 16 - bob, 0.82);
  head(28, 11 + bob, 1.08);
  // collar de puas
  rect(c, 19, 21, 18, 3, '#566c86');
  for (const x of [20, 24, 28, 32, 36]) {
    px(c, x, 20, '#d9dde6');
    px(c, x, 19, '#d9dde6');
  }
  return outline(cv, C.black);
}

function zorroEspectral(f: number): HTMLCanvasElement {
  const [cv, c] = make(48, 34);
  c.globalAlpha = 0.9;
  // tres colas de fuego frio
  const sw = f === 0 ? 0 : 2;
  for (const [dy, len, col] of [
    [-6, 14, '#4a86d8'],
    [0, 16, '#73b3ff'],
    [6, 13, '#4a86d8'],
  ] as const) {
    for (let i = 0; i < len; i++) {
      const y = 16 + dy + Math.round(Math.sin(i / 3 + f * 1.4) * 2) + Math.round((dy * i) / 14);
      rect(c, 4 + i, y - 1 - Math.round((len - i) / 9), 1, 3 + Math.round((len - i) / 5), col);
    }
    px(c, 4, 16 + dy, '#e6f6ff');
  }
  // cuerpo
  ell(c, 27, 18, 10, 6, '#9cc7ff');
  ell(c, 28, 20, 7, 3, '#e6f6ff');
  // patas de bruma
  for (const x of [22, 26, 30, 34]) rect(c, x, 22, 2, 4 + ((x + f) % 2), '#7fb2f2');
  // cabeza
  ell(c, 38, 14, 5, 4.4, '#9cc7ff');
  rect(c, 41, 14, 6, 3, '#e6f6ff');
  px(c, 46, 14, '#1a1c2c');
  // orejas
  rect(c, 34, 6 - sw / 2, 3, 5, '#9cc7ff');
  rect(c, 39, 6 - sw / 2, 3, 5, '#9cc7ff');
  px(c, 35, 6 - sw / 2, '#e6f6ff');
  // ojos que brillan
  rect(c, 39, 12, 3, 2, '#ffffff');
  px(c, 40, 12, '#41a6f6');
  // llamitas
  for (const [x, y] of [
    [14, 6],
    [22, 4],
    [30, 3],
  ] as const)
    px(c, x, y + f, '#e6f6ff');
  c.globalAlpha = 1;
  return outline(cv, '#2a5ca8');
}

function reyGato(f: number): HTMLCanvasElement {
  const [cv, c] = make(60, 60);
  shadow(c, 30, 56, 20, 3.4);
  const wave = f === 0 ? 0 : 1;
  // capa de sombras que ondea
  for (let x = 6; x < 54; x++) {
    const reach = 52 + Math.round(Math.sin(x * 0.5 + f * 2.4) * 2);
    rect(
      c,
      x,
      24,
      1,
      reach - 24 - (Math.abs(x - 30) > 20 ? 6 : 0),
      x % 3 === 0 ? '#2c1f4d' : '#231a40',
    );
  }
  // cuerpo sentado con luz de luna en el borde
  ell(c, 30, 40, 13.6, 14.6, '#4b3a86');
  ell(c, 30, 40.6, 13, 14, '#171326');
  ell(c, 30, 42, 8, 10, '#241c3d');
  rect(c, 20, 30, 2, 12, '#3a2d63');
  rect(c, 12, 40, 4, 14, '#171326');
  rect(c, 44, 40, 4, 14, '#171326');
  // cola enroscada
  line(c, 43, 52, 52, 50, '#171326');
  line(c, 52, 50, 55, 42 + wave, '#171326');
  line(c, 55, 42 + wave, 52, 36 + wave, '#171326');
  rect(c, 50, 36 + wave, 3, 2, '#6b4bb0');
  // collar con gema
  rect(c, 22, 29, 16, 3, '#6b4bb0');
  disc(c, 30, 33, 2.6, '#e08cff');
  disc(c, 30, 33, 1.2, '#ffffff');
  // cabeza
  ell(c, 30, 19, 13.6, 11.6, '#4b3a86');
  ell(c, 30, 19.5, 13, 11, '#171326');
  ell(c, 30, 17, 12, 8.5, '#241c3d');
  rect(c, 21, 10, 8, 1, '#3a2d63');
  // orejas puntiagudas
  for (let i = 0; i < 9; i++) {
    rect(c, 17 + Math.floor(i / 2), 4 + i - 1, 3 - Math.floor(i / 4), 1, '#171326');
    rect(c, 40 - Math.floor(i / 2) - 1, 4 + i - 1, 3 - Math.floor(i / 4), 1, '#171326');
  }
  px(c, 19, 8, '#e08cff');
  px(c, 40, 8, '#e08cff');
  // ojos de rendija
  ell(c, 24, 18, 3.2, 2.2, '#e08cff');
  ell(c, 36, 18, 3.2, 2.2, '#e08cff');
  rect(c, 24, 16, 1, 5, '#120d24');
  rect(c, 36, 16, 1, 5, '#120d24');
  px(c, 23, 17, '#ffffff');
  px(c, 35, 17, '#ffffff');
  line(c, 19, 14, 27, 17, '#120d24');
  line(c, 41, 14, 33, 17, '#120d24');
  // hocico, colmillos y bigotes
  rect(c, 29, 22, 2, 2, '#e08cff');
  rect(c, 26, 25, 8, 1, '#120d24');
  px(c, 27, 26, '#f4f4f4');
  px(c, 32, 26, '#f4f4f4');
  for (const [x0, y0, x1, y1] of [
    [22, 22, 12, 20],
    [22, 24, 12, 26],
    [38, 22, 48, 20],
    [38, 24, 48, 26],
  ] as const)
    line(c, x0, y0, x1, y1, '#8d7bc4');
  // corona de puas moradas
  rect(c, 21, 6, 18, 3, '#6b4bb0');
  rect(c, 21, 6, 18, 1, '#b794f4');
  for (const [x, h] of [
    [21, 4],
    [25, 6],
    [29, 8],
    [33, 6],
    [37, 4],
  ] as const) {
    rect(c, x, 6 - h, 2, h, '#6b4bb0');
    px(c, x, 6 - h, '#e0c9ff');
  }
  disc(c, 30, 7, 1.4, '#ff7ab6');
  return outline(cv, '#0d0a1a');
}

// ------------------------------------------------------------------ catalogo

export interface MobSprite {
  /** Cuadros de animacion (dos). */
  frames: HTMLCanvasElement[];
  /** Si dibuja al enemigo mirando a la derecha y hay que voltearlo al ir a la izquierda. */
  sided: boolean;
}

const MAKERS: Record<number, { make: (f: number) => HTMLCanvasElement; sided: boolean }> = {
  [MOB.rata]: { make: rata, sided: true },
  [MOB.murcielago]: { make: murcielago, sided: false },
  [MOB.buho]: { make: buho, sided: false },
  [MOB.perro]: { make: perro, sided: true },
  [MOB.hongo]: { make: hongo, sided: false },
  [MOB.zorro]: { make: zorro, sided: true },
  [MOB.golem]: { make: golem, sided: false },
  [MOB.reinaRata]: { make: reinaRata, sided: false },
  [MOB.buhoAnciano]: { make: buhoAnciano, sided: false },
  [MOB.mamaHongo]: { make: mamaHongo, sided: false },
  [MOB.perroGuardian]: { make: perroGuardian, sided: false },
  [MOB.zorroEspectral]: { make: zorroEspectral, sided: true },
  [MOB.reyGato]: { make: reyGato, sided: false },
  [MOB.sombra]: { make: sombra, sided: false },
  [MOB.clon]: { make: clon, sided: false },
};

const cache = new Map<number, MobSprite>();

/** Sprites de un enemigo (se dibujan una vez y se guardan). */
export function mobSprite(kind: number): MobSprite {
  let s = cache.get(kind);
  if (!s) {
    const m = MAKERS[kind] ?? (MAKERS[MOB.rata] as NonNullable<(typeof MAKERS)[number]>);
    s = { frames: [m.make(0), m.make(1)], sided: m.sided };
    cache.set(kind, s);
  }
  return s;
}

const flashCache = new WeakMap<HTMLCanvasElement, HTMLCanvasElement>();
const flipCache = new WeakMap<HTMLCanvasElement, HTMLCanvasElement>();

/** El mismo dibujo teñido de blanco (cuando recibe un golpe). */
export function flashed(src: HTMLCanvasElement, color = '#ffffff'): HTMLCanvasElement {
  let out = flashCache.get(src);
  if (!out) {
    const [cv, c] = make(src.width, src.height);
    c.drawImage(src, 0, 0);
    c.globalCompositeOperation = 'source-atop';
    c.fillStyle = color;
    c.globalAlpha = 0.78;
    c.fillRect(0, 0, src.width, src.height);
    out = cv;
    flashCache.set(src, out);
  }
  return out;
}

export function flippedOf(src: HTMLCanvasElement): HTMLCanvasElement {
  let out = flipCache.get(src);
  if (!out) {
    out = flipH(src);
    flipCache.set(src, out);
  }
  return out;
}

// ------------------------------------------------------------------ balas enemigas

const shotCache = new Map<number, HTMLCanvasElement>();

/** Dibujo de una bala enemiga (apunta a la derecha; el renderizador la gira). */
export function hostileShotSprite(kind: number): HTMLCanvasElement {
  const s = shotCache.get(kind);
  if (s) return s;
  const [cv, c] = make(14, 14);
  switch (kind) {
    case HOSTILE_SHOT.pluma:
      line(c, 2, 7, 11, 7, '#8a6a4a');
      for (let i = 0; i < 4; i++) {
        px(c, 4 + i * 2, 6 - (i % 2), '#d9c9a8');
        px(c, 4 + i * 2, 8 + (i % 2), '#d9c9a8');
      }
      px(c, 12, 7, '#f4f4f4');
      break;
    case HOSTILE_SHOT.espora:
      disc(c, 7, 7, 4.2, '#2f8f4a');
      disc(c, 7, 7, 3, '#7be08a');
      disc(c, 6, 6, 1.3, '#e6ffd8');
      break;
    case HOSTILE_SHOT.fuego:
      disc(c, 6, 7, 4.4, '#d9461f');
      disc(c, 7, 7, 3.2, '#ff9a3a');
      disc(c, 8, 7, 1.8, '#fff2a8');
      px(c, 2, 5, '#ff6a2a');
      px(c, 1, 8, '#ff6a2a');
      break;
    case HOSTILE_SHOT.orbe:
      disc(c, 7, 7, 5, '#5a2fa8');
      disc(c, 7, 7, 3.6, '#b794f4');
      disc(c, 6, 6, 1.6, '#f4ecff');
      break;
    case HOSTILE_SHOT.onda:
      for (let y = 2; y < 12; y++) {
        const x = 8 - Math.round(Math.abs(y - 7) * 0.7);
        rect(c, x, y, 2, 1, '#73c9ff');
        px(c, x + 2, y, '#e6f6ff');
      }
      break;
    case HOSTILE_SHOT.chispa:
      line(c, 2, 7, 12, 7, '#ffd25e');
      line(c, 5, 4, 9, 10, '#fff2a8');
      line(c, 5, 10, 9, 4, '#fff2a8');
      px(c, 7, 7, '#ffffff');
      break;
    case HOSTILE_SHOT.dardo:
      line(c, 2, 7, 11, 7, '#3a2f40');
      px(c, 12, 7, '#d93a4a');
      px(c, 2, 6, '#8a7f91');
      px(c, 2, 8, '#8a7f91');
      break;
    default:
      disc(c, 7, 7, 3.4, '#ff4d5e');
  }
  shotCache.set(kind, cv);
  return cv;
}
