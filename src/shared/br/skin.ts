import type { Rng } from '../rng';
import { SKIN_CELLS, SKIN_H, SKIN_W } from './constants';
import { OUTFIT_COUNT, isValidOutfit } from './outfits';

/** Paleta del pincel. El indice 0 borra (se ve el color base del gato). Basada en Sweetie 16. */
export const PAINT_PALETTE = [
  'transparent',
  '#1a1c2c',
  '#f4f4f4',
  '#94b0c2',
  '#566c86',
  '#333c57',
  '#ef7d57',
  '#ffcd75',
  '#b13e53',
  '#5d275d',
  '#3b5dc9',
  '#41a6f6',
  '#73eff7',
  '#38b764',
  '#a7f070',
  '#8b5e3c',
] as const;

export const PAINT_NAMES = [
  'Borrar',
  'Negro',
  'Blanco',
  'Gris claro',
  'Gris',
  'Carbón',
  'Naranja',
  'Crema',
  'Rojo',
  'Morado',
  'Azul',
  'Celeste',
  'Cian',
  'Verde',
  'Lima',
  'Café',
] as const;

/** Colores base del pelaje. */
export const BASE_COATS = [
  { name: 'Naranja', color: '#e8833a' },
  { name: 'Negro', color: '#2b2d42' },
  { name: 'Blanco', color: '#f1ece4' },
  { name: 'Gris', color: '#8d99ae' },
  { name: 'Café', color: '#8b5e3c' },
  { name: 'Crema', color: '#f2cc8f' },
  { name: 'Azulado', color: '#6b8fb5' },
  { name: 'Rosa', color: '#f4a6c0' },
] as const;

export interface Skin {
  /** Indice en BASE_COATS. */
  base: number;
  /** SKIN_CELLS caracteres hexadecimales: 0 sin pintar, 1 a f indice de PAINT_PALETTE. */
  paint: string;
  /** Traje de Halloween (0 o ausente = ninguno). Aparte del pelaje: se combina con cualquier pintura. */
  outfit?: number;
}

export const EMPTY_PAINT = '0'.repeat(SKIN_CELLS);
export const PAINT_PATTERN = new RegExp(`^[0-9a-f]{${SKIN_CELLS}}$`);

export function defaultSkin(base = 0): Skin {
  return { base, paint: EMPTY_PAINT };
}

export function isValidSkin(skin: unknown): skin is Skin {
  if (typeof skin !== 'object' || skin === null) return false;
  const s = skin as Partial<Skin>;
  return (
    Number.isInteger(s.base) &&
    (s.base as number) >= 0 &&
    (s.base as number) < BASE_COATS.length &&
    typeof s.paint === 'string' &&
    PAINT_PATTERN.test(s.paint) &&
    isValidOutfit(s.outfit)
  );
}

/** Traje de un pelaje (0 si no lleva), siempre dentro de rango. */
export function outfitOf(skin: Skin | undefined | null): number {
  const o = skin?.outfit ?? 0;
  return Number.isInteger(o) && o >= 0 && o <= OUTFIT_COUNT ? o : 0;
}

export const paintIndex = (x: number, y: number): number => y * SKIN_W + x;

/** Dibuja un disco o cuadro de pintura en una cadena (usado por los bots para tener pelajes variados). */
export function paintCells(paint: string, cells: [number, number][], color: number): string {
  const chars = paint.split('');
  for (const [x, y] of cells) {
    if (x >= 0 && y >= 0 && x < SKIN_W && y < SKIN_H) chars[paintIndex(x, y)] = color.toString(16);
  }
  return chars.join('');
}

/** Pelaje aleatorio: rayas, manchas o parches, para los bots. */
export function randomSkin(rng: Rng): Skin {
  const base = rng.int(0, BASE_COATS.length - 1);
  const color = rng.pick([1, 2, 5, 6, 7, 15, 3]);
  let paint = EMPTY_PAINT;
  const style = rng.int(0, 3);
  const cells: [number, number][] = [];
  if (style === 0) {
    // rayas verticales
    const phase = rng.int(0, 2);
    for (let x = 3 + phase; x < SKIN_W - 2; x += 3)
      for (let y = 3; y < SKIN_H - 3; y++) cells.push([x, y]);
  } else if (style === 1) {
    // manchas
    for (let i = 0; i < rng.int(4, 8); i++) {
      const cx = rng.int(5, SKIN_W - 5);
      const cy = rng.int(4, SKIN_H - 5);
      cells.push([cx, cy], [cx + 1, cy], [cx, cy + 1], [cx + 1, cy + 1]);
    }
  } else if (style === 2) {
    // mitad del cuerpo
    for (let x = 2; x < SKIN_W / 2; x++) for (let y = 3; y < SKIN_H - 3; y++) cells.push([x, y]);
  }
  paint = paintCells(paint, cells, color);
  // En esta temporada casi todos los bots andan disfrazados.
  const outfit = rng.chance(0.75) ? rng.int(1, OUTFIT_COUNT) : 0;
  return { base, paint, outfit };
}
