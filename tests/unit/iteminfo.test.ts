import { describe, expect, it } from 'vitest';
import { ARMOR_BONUS, POTION, POWERS, computeMods } from '../../src/shared/br/adventure';
import { armorInfo, itemInfo, powerInfo, weaponInfo } from '../../src/shared/br/iteminfo';
import { WEAPONS, type Item } from '../../src/shared/br/items';

const flat = (i: ReturnType<typeof itemInfo>): string =>
  [i.name, i.sub, ...i.stats.flat(), i.text].join(' ');

describe('informacion de objetos del inventario', () => {
  it('un arma cuenta todos sus datos con los numeros reales', () => {
    const rifle: Item = { kind: 'rifle', qty: 1, rarity: 2, mag: 12 };
    const info = weaponInfo(rifle, 90);
    const def = WEAPONS.rifle;
    const stat = (k: string): string => info.stats.find(([l]) => l === k)?.[1] ?? '';
    expect(stat('Daño')).toBe(String(def.damage[2]));
    expect(stat('Cargador')).toBe(`12 de ${def.magazine}`);
    expect(stat('Disparo')).toContain('Automático');
    expect(stat('Balas de fusil')).toBe('90 de 120');
    expect(info.sub).toContain('Épica');
    // la escopeta dice cuantos perdigones lanza
    const shotgun = weaponInfo({ kind: 'shotgun', qty: 1, rarity: 0 }, 0);
    expect(shotgun.stats[0]?.[1]).toContain('5 perdigones');
  });

  it('las pociones y curas explican que hacen con los mismos numeros del juego', () => {
    const catnip = itemInfo({ kind: 'potion_catnip', qty: 2, rarity: 0 });
    expect(flat(catnip)).toContain(`${POTION.catnip.seconds} s`);
    expect(flat(catnip)).toContain('+40 %');
    const valerian = itemInfo({ kind: 'potion_valerian', qty: 1, rarity: 0 });
    expect(flat(valerian)).toContain(`${POTION.valerian.seconds} s`);
    expect(flat(valerian)).toContain('+30 %');
    expect(flat(itemInfo({ kind: 'medkit', qty: 1, rarity: 0 }))).toContain('10 de vida');
  });

  it('la armadura muestra lo mismo que aplica computeMods', () => {
    for (const tier of [0, 1, 2] as const) {
      const head = computeMods([], [tier, -1, -1]).maxShield - 100;
      expect(head).toBe(ARMOR_BONUS.head.shield[tier]);
      expect(armorInfo(0, tier).stats[0]?.[1]).toBe(`+${head}`);
      const body = 1 - computeMods([], [-1, tier, -1]).taken;
      expect(body).toBeCloseTo(ARMOR_BONUS.body.less[tier], 5);
    }
  });

  it('cada habilidad da sus numeros por nivel y la espera baja al subir', () => {
    for (const def of POWERS) {
      const one = powerInfo(def, 1, 'F');
      const three = powerInfo(def, 3, 'F');
      const cd = (i: typeof one): number =>
        Number(
          (i.stats.find(([l]) => l === 'Espera')?.[1] ?? '0').replace(',', '.').replace(' s', ''),
        );
      expect(cd(three)).toBeLessThan(cd(one));
      expect(one.stats.find(([l]) => l === 'Tecla')?.[1]).toBe('F');
    }
    // la furia: el doble de rapido y mas daño
    const fury = powerInfo(POWERS[0]!, 1, 'F');
    expect(fury.stats[0]).toEqual(['Cadencia', 'x2']);
    expect(fury.stats[1]).toEqual(['Daño de cada bala', '+40 %']);
  });
});
