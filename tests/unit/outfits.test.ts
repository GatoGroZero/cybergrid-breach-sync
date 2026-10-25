import { describe, expect, it } from 'vitest';
import {
  OUTFITS,
  OUTFIT_COUNT,
  OUTFIT_PAD,
  isValidOutfit,
  outfitInfo,
  outfitName,
} from '../../src/shared/br/outfits';
import { skinSchema } from '../../src/shared/br/protocol';
import { createRng } from '../../src/shared/rng';
import {
  EMPTY_PAINT,
  defaultSkin,
  isValidSkin,
  outfitOf,
  randomSkin,
} from '../../src/shared/br/skin';

describe('trajes de Halloween', () => {
  it('hay al menos ocho, con identificador, nombre y descripcion propios', () => {
    expect(OUTFIT_COUNT).toBeGreaterThanOrEqual(8);
    const ids = new Set(OUTFITS.map((o) => o.id));
    const names = new Set(OUTFITS.map((o) => o.name));
    expect(ids.size).toBe(OUTFIT_COUNT);
    expect(names.size).toBe(OUTFIT_COUNT);
    for (const o of OUTFITS) {
      expect(o.blurb.length).toBeGreaterThan(8);
      expect(o.height).toBeGreaterThanOrEqual(0);
      // el lienzo del gato tiene aire suficiente para el sombrero mas alto
      expect(o.height).toBeLessThanOrEqual(OUTFIT_PAD);
    }
  });

  it('el codigo 0 es sin traje y los demas apuntan a la lista', () => {
    expect(outfitInfo(0)).toBeNull();
    expect(outfitInfo(undefined)).toBeNull();
    expect(outfitInfo(1)?.id).toBe(OUTFITS[0]?.id);
    expect(outfitInfo(OUTFIT_COUNT)?.id).toBe(OUTFITS[OUTFIT_COUNT - 1]?.id);
    expect(outfitInfo(OUTFIT_COUNT + 1)).toBeNull();
    expect(outfitName(0)).toBe('Sin traje');
    expect(outfitName(1)).toBe(OUTFITS[0]?.name);
  });

  it('un traje viaja con el pelaje sin tocar el color ni la pintura', () => {
    const base = { ...defaultSkin(3), outfit: 4 };
    expect(isValidSkin(base)).toBe(true);
    expect(base.base).toBe(3);
    expect(base.paint).toBe(EMPTY_PAINT);
    expect(outfitOf(base)).toBe(4);
    // los pelajes guardados antes de los trajes siguen siendo validos y no llevan traje
    expect(isValidSkin({ base: 1, paint: EMPTY_PAINT })).toBe(true);
    expect(outfitOf({ base: 1, paint: EMPTY_PAINT })).toBe(0);
    expect(isValidSkin({ base: 1, paint: EMPTY_PAINT, outfit: OUTFIT_COUNT + 1 })).toBe(false);
    expect(isValidSkin({ base: 1, paint: EMPTY_PAINT, outfit: -1 })).toBe(false);
    expect(isValidSkin({ base: 1, paint: EMPTY_PAINT, outfit: 1.5 })).toBe(false);
    expect(isValidOutfit('3')).toBe(false);
  });

  it('el servidor acepta el traje, usa 0 si falta y rechaza lo que no existe', () => {
    const paint = EMPTY_PAINT;
    expect(skinSchema.parse({ base: 0, paint }).outfit).toBe(0);
    expect(skinSchema.parse({ base: 0, paint, outfit: 5 }).outfit).toBe(5);
    expect(skinSchema.safeParse({ base: 0, paint, outfit: OUTFIT_COUNT + 1 }).success).toBe(false);
    expect(skinSchema.safeParse({ base: 0, paint, outfit: -2 }).success).toBe(false);
    expect(skinSchema.safeParse({ base: 0, paint, outfit: 'bruja' }).success).toBe(false);
  });

  it('los bots salen disfrazados casi siempre y con todos los trajes posibles', () => {
    const rng = createRng(2026);
    const seen = new Set<number>();
    let dressed = 0;
    for (let i = 0; i < 600; i++) {
      const skin = randomSkin(rng);
      expect(isValidSkin(skin)).toBe(true);
      const o = outfitOf(skin);
      seen.add(o);
      if (o > 0) dressed++;
    }
    expect(dressed / 600).toBeGreaterThan(0.6);
    expect(dressed / 600).toBeLessThan(0.9);
    for (let o = 1; o <= OUTFIT_COUNT; o++) expect(seen.has(o)).toBe(true);
  });
});
