import type { ArmorKind } from '../../shared/br/items';
import { C, disc, ell, line, make, outline, px, rect } from './draw';

/** Iconos de 16 x 16 de la Aventura: pociones, armadura, reliquias y el botin del suelo. */

export function potionIcon(kind: 'potion_catnip' | 'potion_valerian'): HTMLCanvasElement {
  const [cv, c] = make(16, 16);
  const cat = kind === 'potion_catnip';
  const liquid = cat ? '#5bd66a' : '#a77bf0';
  const liquidL = cat ? '#b6f5a8' : '#dcc8ff';
  const liquidD = cat ? '#2f8f4a' : '#6b4bb0';
  // corcho y cuello
  rect(c, 6, 1, 4, 2, '#c28a5a');
  rect(c, 6, 1, 4, 1, '#e0b48a');
  rect(c, 6, 3, 4, 3, '#d8e8f0');
  // panza de la botella
  ell(c, 8, 10, 5.4, 4.8, '#d8e8f0');
  ell(c, 8, 10.6, 4.6, 4, liquid);
  ell(c, 8, 12, 4.6, 2.4, liquidD);
  rect(c, 5, 8, 6, 1, liquidL);
  px(c, 6, 10, '#ffffff');
  px(c, 6, 11, '#ffffff');
  if (cat) {
    // una hojita de hierba gatera
    px(c, 9, 10, '#1f6f3a');
    px(c, 10, 9, '#1f6f3a');
    px(c, 10, 11, '#1f6f3a');
  } else {
    // flor de valeriana
    disc(c, 9, 11, 0.9, '#ffffff');
  }
  return outline(cv, C.black);
}

const ARMOR_COLORS = ['#a8754f', '#7fa6c9', '#b6c0d6'];

export function armorIcon(kind: ArmorKind, tier = 0): HTMLCanvasElement {
  const [cv, c] = make(16, 16);
  const main = ARMOR_COLORS[Math.min(2, tier)] as string;
  const light = '#ffffff55';
  if (kind === 'armor_head') {
    // capucha con orejitas
    ell(c, 8, 9, 6, 5.6, main);
    rect(c, 2, 2, 3, 4, main);
    rect(c, 11, 2, 3, 4, main);
    px(c, 3, 3, '#f0a6b4');
    px(c, 12, 3, '#f0a6b4');
    ell(c, 8, 10, 3.4, 2.8, '#2b3350');
    rect(c, 6, 9, 1, 1, '#ffffff');
    rect(c, 9, 9, 1, 1, '#ffffff');
    rect(c, 4, 6, 3, 1, light);
  } else if (kind === 'armor_body') {
    // chaleco
    rect(c, 3, 3, 10, 11, main);
    rect(c, 1, 3, 3, 5, main);
    rect(c, 12, 3, 3, 5, main);
    rect(c, 6, 3, 4, 3, '#2b3350');
    rect(c, 7, 6, 2, 8, '#2b3350');
    for (const y of [8, 10, 12]) px(c, 7, y, '#ffcd75');
    rect(c, 3, 3, 10, 1, light);
  } else {
    // botitas
    rect(c, 2, 6, 5, 7, main);
    rect(c, 9, 6, 5, 7, main);
    rect(c, 1, 11, 6, 3, '#4b3a30');
    rect(c, 9, 11, 6, 3, '#4b3a30');
    rect(c, 2, 6, 5, 1, '#ffffff');
    rect(c, 9, 6, 5, 1, '#ffffff');
    px(c, 3, 9, '#ffcd75');
    px(c, 10, 9, '#ffcd75');
  }
  return outline(cv, C.black);
}

/** Icono de una reliquia por su numero (0 a 13). */
export function relicIcon(id: number): HTMLCanvasElement {
  const [cv, c] = make(16, 16);
  switch (id) {
    case 0: {
      // cascabel dorado
      disc(c, 8, 9, 5, '#e0a93a');
      disc(c, 8, 9, 4, '#ffcd75');
      rect(c, 5, 6, 3, 1, '#fff0b8');
      rect(c, 4, 11, 8, 1, '#e0a93a');
      rect(c, 7, 11, 2, 2, '#8a5a1a');
      rect(c, 7, 2, 2, 2, '#c9534a');
      break;
    }
    case 1: {
      // tres rayones de garra
      for (const x of [4, 8, 12]) {
        line(c, x - 2, 2, x + 1, 13, '#f4f4f4');
        line(c, x - 1, 2, x + 2, 13, '#d93a4a');
      }
      break;
    }
    case 2: {
      // bigotes y un rayo
      line(c, 1, 5, 7, 7, '#e8e0f0');
      line(c, 1, 11, 7, 9, '#e8e0f0');
      line(c, 15, 5, 9, 7, '#e8e0f0');
      line(c, 15, 11, 9, 9, '#e8e0f0');
      rect(c, 7, 2, 3, 3, '#ffd25e');
      rect(c, 6, 5, 3, 3, '#ffd25e');
      rect(c, 8, 8, 3, 3, '#ffd25e');
      rect(c, 7, 11, 2, 3, '#ffd25e');
      break;
    }
    case 3: {
      // sardina dorada
      ell(c, 8, 8, 6.4, 3.4, '#e0a93a');
      ell(c, 8, 7.4, 5.4, 2.2, '#ffcd75');
      line(c, 14, 8, 15, 5, '#e0a93a');
      line(c, 14, 8, 15, 11, '#e0a93a');
      px(c, 4, 7, '#1a1c2c');
      rect(c, 7, 8, 5, 1, '#fff0b8');
      break;
    }
    case 4: {
      // ovillo de lana
      disc(c, 8, 8, 5.6, '#e8738a');
      disc(c, 7, 7, 3.4, '#f4a6c0');
      line(c, 3, 9, 12, 5, '#b13e53');
      line(c, 4, 12, 13, 8, '#b13e53');
      line(c, 6, 3, 11, 13, '#b13e53');
      line(c, 12, 13, 15, 14, '#e8738a');
      break;
    }
    case 5: {
      // collar con luna creciente
      line(c, 2, 2, 8, 7, '#94b0c2');
      line(c, 14, 2, 8, 7, '#94b0c2');
      disc(c, 8, 10, 4.6, '#f4f4f4');
      c.globalCompositeOperation = 'destination-out';
      disc(c, 10.4, 9.2, 3.8, '#000000');
      c.globalCompositeOperation = 'source-over';
      px(c, 5, 8, '#ffffff');
      break;
    }
    case 6: {
      // almohadilla rosa
      ell(c, 8, 10, 4.6, 3.8, '#f4a6c0');
      for (const [x, y] of [
        [3.4, 6],
        [6.4, 3.6],
        [9.6, 3.6],
        [12.6, 6],
      ] as const)
        ell(c, x, y, 1.9, 2.2, '#f4a6c0');
      px(c, 7, 9, '#ffd6e4');
      break;
    }
    case 7: {
      // ojo de buho
      disc(c, 8, 8, 6, '#a695c4');
      disc(c, 8, 8, 4.6, '#ffd25e');
      disc(c, 8, 8, 2.2, '#1a1c2c');
      px(c, 7, 7, '#ffffff');
      line(c, 2, 3, 6, 5, '#5d4a7a');
      line(c, 14, 3, 10, 5, '#5d4a7a');
      break;
    }
    case 8: {
      // botella de leche tibia
      rect(c, 6, 1, 4, 3, '#f4f4f4');
      rect(c, 5, 4, 6, 2, '#d8e8f0');
      rect(c, 4, 6, 8, 8, '#f4f4f4');
      rect(c, 4, 6, 2, 8, '#d8e8f0');
      rect(c, 6, 8, 4, 3, '#73c9ff');
      px(c, 7, 9, '#ffffff');
      rect(c, 4, 13, 8, 1, '#b6c0d6');
      break;
    }
    case 9: {
      // resorte
      for (let y = 2; y < 14; y += 3) {
        rect(c, 4, y, 8, 1, '#b6c0d6');
        rect(c, 4, y + 1, 1, 1, '#b6c0d6');
        rect(c, 11, y + 1, 1, 1, '#94b0c2');
      }
      rect(c, 3, 1, 10, 1, '#73eff7');
      rect(c, 3, 14, 10, 1, '#73eff7');
      break;
    }
    case 10: {
      // corazon con el siete
      ell(c, 5, 6, 3.6, 3.6, '#d93a4a');
      ell(c, 11, 6, 3.6, 3.6, '#d93a4a');
      for (let y = 7; y < 14; y++)
        rect(c, 8 - Math.round((13 - y) * 0.8), y, Math.round((13 - y) * 1.6) + 1, 1, '#d93a4a');
      rect(c, 6, 5, 4, 1, '#ffffff');
      rect(c, 9, 6, 1, 1, '#ffffff');
      rect(c, 8, 7, 1, 2, '#ffffff');
      rect(c, 7, 9, 1, 2, '#ffffff');
      break;
    }
    case 11: {
      // mira de cazador
      for (let a = 0; a < 40; a++)
        px(
          c,
          8 + Math.round(Math.cos(a / 6.4) * 5.4),
          8 + Math.round(Math.sin(a / 6.4) * 5.4),
          '#ff7a3a',
        );
      rect(c, 7, 1, 2, 4, '#ff7a3a');
      rect(c, 7, 11, 2, 4, '#ff7a3a');
      rect(c, 1, 7, 4, 2, '#ff7a3a');
      rect(c, 11, 7, 4, 2, '#ff7a3a');
      px(c, 8, 8, '#ffffff');
      break;
    }
    case 12: {
      // hocico de sabueso con balas
      ell(c, 8, 9, 6, 4.4, '#a0693e');
      ell(c, 8, 11, 3.6, 2.6, '#d9b48a');
      rect(c, 6, 9, 4, 3, '#1a1c2c');
      px(c, 6, 5, '#1a1c2c');
      px(c, 10, 5, '#1a1c2c');
      rect(c, 3, 3, 2, 4, '#7a4a28');
      rect(c, 11, 3, 2, 4, '#7a4a28');
      break;
    }
    default: {
      // lengueta curativa: lengua rosa con una cruz
      ell(c, 8, 8, 4.4, 6, '#f08aa6');
      ell(c, 8, 7, 3, 4, '#ffb3c8');
      line(c, 8, 2, 8, 14, '#d9617f');
      rect(c, 6, 7, 5, 1, '#ffffff');
      rect(c, 8, 5, 1, 5, '#ffffff');
    }
  }
  return outline(cv, C.black);
}

// ------------------------------------------------------------------ botin del suelo

const pickCache = new Map<string, HTMLCanvasElement>();

/** Lo que se ve tirado en el suelo: 0 corazon, 1 balas, 2 pocion, 3 armadura. */
export function pickupSprite(kind: number, frame: number): HTMLCanvasElement {
  const key = `${kind}:${frame}`;
  let s = pickCache.get(key);
  if (s) return s;
  const [cv, c] = make(12, 12);
  switch (kind) {
    case 0: {
      ell(c, 4, 4.4, 2.8, 2.8, '#ff4d6e');
      ell(c, 8, 4.4, 2.8, 2.8, '#ff4d6e');
      for (let y = 5; y < 11; y++)
        rect(c, 6 - Math.round((10 - y) * 0.9), y, Math.round((10 - y) * 1.8) + 1, 1, '#ff4d6e');
      px(c, 3, 3, '#ffd0da');
      px(c, 4, 3, '#ffd0da');
      break;
    }
    case 1: {
      rect(c, 1, 5, 10, 6, '#6b5a3a');
      rect(c, 1, 5, 10, 1, '#9a8458');
      for (const x of [2, 5, 8]) {
        rect(c, x, 2, 2, 4, frame ? '#fff0b8' : '#ffd25e');
        rect(c, x, 2, 2, 1, '#e08a3a');
      }
      break;
    }
    case 2: {
      const col = frame ? '#5bd66a' : '#a77bf0';
      rect(c, 5, 1, 2, 2, '#c28a5a');
      rect(c, 5, 3, 2, 2, '#d8e8f0');
      ell(c, 6, 8, 4, 3.4, '#d8e8f0');
      ell(c, 6, 8.4, 3.2, 2.6, col);
      px(c, 4, 7, '#ffffff');
      break;
    }
    default: {
      rect(c, 2, 1, 8, 8, '#ffcd75');
      rect(c, 3, 9, 6, 1, '#ffcd75');
      rect(c, 4, 10, 4, 1, '#ffcd75');
      rect(c, 3, 2, 6, 6, '#7fa6c9');
      rect(c, 5, 3, 2, 4, '#ffffff');
      rect(c, 4, 4, 4, 2, '#ffffff');
      px(c, frame ? 2 : 9, 2, '#ffffff');
    }
  }
  s = outline(cv, C.black);
  pickCache.set(key, s);
  return s;
}

// ------------------------------------------------------------------ habilidades de jefe

/** Icono de una habilidad (0 a 7), con su color propio para reconocerla de un vistazo. */
export function powerIcon(id: number): HTMLCanvasElement {
  const [cv, c] = make(16, 16);
  switch (id) {
    case 0: {
      // furia felina: una llama con zarpazos
      for (let y = 2; y < 14; y++) {
        const half = Math.max(1, Math.round(Math.sin(((y - 2) / 12) * Math.PI) * 5.4));
        rect(c, 8 - half, y, half * 2, 1, '#ef7d57');
      }
      for (let y = 5; y < 14; y++) {
        const half = Math.max(0, Math.round(Math.sin(((y - 5) / 9) * Math.PI) * 3));
        rect(c, 8 - half, y, half * 2, 1, '#ffcd75');
      }
      line(c, 4, 3, 7, 12, '#f4f4f4');
      line(c, 8, 2, 11, 12, '#f4f4f4');
      break;
    }
    case 1: {
      // mirada de buho: un ojo con rayos
      disc(c, 8, 8, 5.2, '#ffd25e');
      disc(c, 8, 8, 3, '#1a1c2c');
      px(c, 7, 7, '#ffffff');
      for (const [x0, y0, x1, y1] of [
        [8, 0, 8, 2],
        [8, 14, 8, 15],
        [0, 8, 2, 8],
        [14, 8, 15, 8],
        [2, 2, 3, 3],
        [13, 2, 12, 3],
        [2, 13, 3, 12],
        [13, 13, 12, 12],
      ] as const)
        line(c, x0, y0, x1, y1, '#fff2a8');
      break;
    }
    case 2: {
      // esporas curativas: hongo con una cruz
      ell(c, 8, 6, 6.4, 4.4, '#7be08a');
      rect(c, 6, 9, 4, 5, '#efe6d2');
      rect(c, 7, 4, 2, 5, '#ffffff');
      rect(c, 5, 6, 6, 2, '#ffffff');
      for (const [x, y] of [
        [2, 12],
        [13, 11],
        [4, 14],
      ] as const)
        px(c, x, y, '#d6ffb0');
      break;
    }
    case 3: {
      // rugido guardian: una boca y ondas
      ell(c, 7, 8, 4.5, 5, '#b13e53');
      ell(c, 7, 8, 2.6, 3.4, '#5d1f2c');
      for (const y of [4, 12]) rect(c, 5, y, 4, 1, '#f4f4f4');
      for (const r of [7, 10]) {
        for (let a = -0.8; a <= 0.8; a += 0.12)
          px(c, 8 + Math.cos(a) * r * 1.0, 8 + Math.sin(a) * r, '#ffcd75');
      }
      break;
    }
    case 4: {
      // paso espectral: un fantasma
      ell(c, 8, 7, 5, 5.4, '#bfe9ff');
      rect(c, 3, 8, 10, 6, '#bfe9ff');
      for (const x of [3, 6, 9, 12]) rect(c, x, 13, 2, 2, '#bfe9ff');
      for (const x of [4, 7, 10]) rect(c, x, 13, 2, 2, '#00000000');
      rect(c, 5, 6, 2, 3, '#3b5dc9');
      rect(c, 9, 6, 2, 3, '#3b5dc9');
      break;
    }
    case 5: {
      // nova de fuego: una estrella de llamas
      disc(c, 8, 8, 3.2, '#ffcd75');
      disc(c, 8, 8, 1.6, '#ffffff');
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        line(
          c,
          8 + Math.cos(a) * 4,
          8 + Math.sin(a) * 4,
          8 + Math.cos(a) * 7.4,
          8 + Math.sin(a) * 7.4,
          k % 2 ? '#ef7d57' : '#d9461f',
        );
      }
      break;
    }
    case 6: {
      // escudo de luna: escudo con una luna
      for (let y = 1; y <= 14; y++) {
        const half = y < 9 ? 5.6 : Math.max(0, 5.6 - (y - 8) * 0.9);
        rect(c, Math.round(8 - half), y, Math.round(half * 2), 1, '#41a6f6');
      }
      rect(c, 3, 1, 10, 1, '#c9e6ff');
      disc(c, 8, 7, 3, '#f4f4f4');
      c.globalCompositeOperation = 'destination-out';
      disc(c, 9.6, 6.2, 2.6, '#000000');
      c.globalCompositeOperation = 'source-over';
      disc(c, 7, 7, 1.2, '#f4f4f4');
      break;
    }
    default: {
      // maullido hipnotico: una espiral
      for (let t = 0; t < 60; t++) {
        const a = t * 0.34;
        const r = 0.9 + t * 0.105;
        px(c, 8 + Math.cos(a) * r, 8 + Math.sin(a) * r, t % 6 < 3 ? '#b794f4' : '#e0c9ff');
      }
      disc(c, 8, 8, 1, '#ffffff');
    }
  }
  return outline(cv, C.black);
}
