/**
 * Trajes de Halloween. Son aparte del pelaje: cualquier traje se puede combinar con cualquier
 * color y pintura. El codigo 0 es "sin traje" y el traje N es `OUTFITS[N - 1]`.
 */
export interface OutfitInfo {
  id: string;
  name: string;
  /** Una linea para la lista de eleccion. */
  blurb: string;
  /** Pixeles que sobresalen por encima de la cabeza (para ubicar el nombre). */
  height: number;
}

export const OUTFITS: readonly OutfitInfo[] = [
  { id: 'bruja', name: 'Bruja', blurb: 'Sombrero puntiagudo, capa y luna', height: 7 },
  { id: 'calabaza', name: 'Calabaza', blurb: 'Una calabaza con cara que brilla', height: 5 },
  { id: 'fantasma', name: 'Fantasma', blurb: 'Sábana blanca con dos ojitos', height: 3 },
  { id: 'vampiro', name: 'Vampiro', blurb: 'Capa roja, colmillos y ojos rojos', height: 3 },
  { id: 'momia', name: 'Momia', blurb: 'Vendas viejas con una punta suelta', height: 3 },
  { id: 'esqueleto', name: 'Esqueleto', blurb: 'Huesos blancos sobre negro', height: 3 },
  { id: 'pirata', name: 'Pirata', blurb: 'Tricornio, parche y camisa de rayas', height: 5 },
  { id: 'murcielago', name: 'Murciélago', blurb: 'Alas que aletean y orejas largas', height: 5 },
  { id: 'diablillo', name: 'Diablillo', blurb: 'Cuernitos, capa y llamas', height: 4 },
  { id: 'frankenstein', name: 'Frankenstein', blurb: 'Tornillos, cicatriz y saco', height: 3 },
] as const;

export const OUTFIT_COUNT = OUTFITS.length;

/** Pixeles que sube el lienzo del gato para que quepan los sombreros. */
export const OUTFIT_PAD = 7;

export function outfitInfo(code: number | undefined): OutfitInfo | null {
  if (code === undefined || !Number.isInteger(code) || code < 1 || code > OUTFIT_COUNT) return null;
  return OUTFITS[code - 1] ?? null;
}

export function outfitName(code: number | undefined): string {
  return outfitInfo(code)?.name ?? 'Sin traje';
}

export function isValidOutfit(code: unknown): boolean {
  return (
    code === undefined ||
    (Number.isInteger(code) && (code as number) >= 0 && (code as number) <= OUTFIT_COUNT)
  );
}
