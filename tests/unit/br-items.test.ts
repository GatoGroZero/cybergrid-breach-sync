import { describe, expect, it } from 'vitest';
import { createRng } from '../../src/shared/rng';
import {
  AMMO_KINDS,
  RARITY_WEIGHTS,
  STACK_MAX,
  WEAPONS,
  WEAPON_KINDS,
  canStack,
  isAmmo,
  isWeapon,
  rollAmmoCrate,
  rollChest,
  rollItem,
  rollRarity,
  rollWeaponKind,
  weaponDamage,
  type WeaponKind,
} from '../../src/shared/br/items';

describe('armas y daño por rareza (tabla del diseño)', () => {
  it('cada arma hace el daño por bala pedido en común, normal y épica', () => {
    const table: Record<WeaponKind, [number, number, number]> = {
      pistol: [5, 10, 15],
      shotgun: [10, 20, 30],
      sniper: [40, 70, 80],
      bazooka: [40, 70, 90],
      rifle: [10, 15, 20],
    };
    for (const kind of WEAPON_KINDS) {
      expect([0, 1, 2].map((r) => weaponDamage(kind, r as 0 | 1 | 2))).toEqual(table[kind]);
    }
  });

  it('el fusil es automático, el resto exige un clic por bala, y la escopeta gasta 2 cartuchos', () => {
    expect(WEAPONS.rifle.auto).toBe(true);
    for (const kind of ['pistol', 'shotgun', 'sniper', 'bazooka'] as const) {
      expect(WEAPONS[kind].auto).toBe(false);
    }
    expect(WEAPONS.shotgun.ammoPerShot).toBe(2);
    expect(WEAPONS.pistol.ammoPerShot).toBe(1);
    expect(WEAPONS.bazooka.splash).toBeGreaterThan(0);
  });

  it('cada arma usa su propia munición y las pilas respetan sus topes', () => {
    for (const kind of WEAPON_KINDS) {
      expect(isAmmo(WEAPONS[kind].ammo)).toBe(true);
      expect(isWeapon(kind)).toBe(true);
      expect(STACK_MAX[kind]).toBe(1);
    }
    expect(new Set(AMMO_KINDS).size).toBe(5);
    expect(
      canStack({ kind: 'medkit', qty: 1, rarity: 0 }, { kind: 'medkit', qty: 2, rarity: 0 }),
    ).toBe(true);
    expect(
      canStack({ kind: 'pistol', qty: 1, rarity: 0 }, { kind: 'pistol', qty: 1, rarity: 0 }),
    ).toBe(false);
    expect(
      canStack({ kind: 'medkit', qty: 1, rarity: 0 }, { kind: 'shield', qty: 1, rarity: 0 }),
    ).toBe(false);
  });
});

describe('probabilidades del botín', () => {
  const sample = (n: number, fn: () => string | number): Map<string | number, number> => {
    const counts = new Map<string | number, number>();
    for (let i = 0; i < n; i++) {
      const v = fn();
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    return counts;
  };

  it('las épicas son las más difíciles y las comunes las más frecuentes', () => {
    const rng = createRng(2026);
    const counts = sample(30000, () => rollRarity(rng, 'normal'));
    const [c, n, e] = [counts.get(0) ?? 0, counts.get(1) ?? 0, counts.get(2) ?? 0];
    expect(c).toBeGreaterThan(n);
    expect(n).toBeGreaterThan(e);
    const epicShare = e / 30000;
    const target = RARITY_WEIGHTS.normal[2] / 100;
    expect(Math.abs(epicShare - target)).toBeLessThan(0.012);
  });

  it('el cofre dorado da mejor rareza que el normal', () => {
    const rng = createRng(7);
    const epic = (tier: 'normal' | 'golden') => {
      let e = 0;
      for (let i = 0; i < 20000; i++) if (rollRarity(rng, tier) === 2) e++;
      return e / 20000;
    };
    expect(epic('golden')).toBeGreaterThan(epic('normal') * 2.5);
  });

  it('pistolas comunes, fusiles y escopetas raros, sniper y bazuca los más difíciles', () => {
    const rng = createRng(99);
    const counts = sample(40000, () => rollWeaponKind(rng));
    const get = (k: string) => counts.get(k) ?? 0;
    expect(get('pistol')).toBeGreaterThan(get('shotgun'));
    expect(get('pistol')).toBeGreaterThan(get('rifle'));
    expect(Math.min(get('shotgun'), get('rifle'))).toBeGreaterThan(
      Math.max(get('sniper'), get('bazooka')),
    );
    expect(get('sniper')).toBeGreaterThan(0);
    expect(get('bazooka')).toBeGreaterThan(0);
  });

  it('un cofre trae 3 objetos (4 si es dorado) y siempre algo para pelear', () => {
    const rng = createRng(5);
    for (let i = 0; i < 2000; i++) {
      const normal = rollChest(rng, 'normal');
      const golden = rollChest(rng, 'golden');
      expect(normal).toHaveLength(3);
      expect(golden).toHaveLength(4);
      for (const chest of [normal, golden]) {
        expect(chest.some((it) => isWeapon(it.kind) || isAmmo(it.kind))).toBe(true);
        for (const it of chest) {
          expect(it.qty).toBeGreaterThanOrEqual(1);
          expect(it.qty).toBeLessThanOrEqual(STACK_MAX[it.kind]);
        }
      }
    }
  });

  it('los muros, botiquines y escudos aparecen en cofres', () => {
    const rng = createRng(11);
    const kinds = new Set<string>();
    for (let i = 0; i < 3000; i++) kinds.add(rollItem(rng, 'normal').kind);
    expect(kinds.has('wall')).toBe(true);
    expect(kinds.has('medkit')).toBe(true);
    expect(kinds.has('shield')).toBe(true);
  });
});

describe('municion mas facil de conseguir', () => {
  it('las pilas tienen tope por casilla: 4 escudos, 3 botiquines y 5 muros', () => {
    expect(STACK_MAX.shield).toBe(4);
    expect(STACK_MAX.medkit).toBe(3);
    expect(STACK_MAX.wall).toBe(5);
  });

  it('en 4000 cofres la municion es lo mas frecuente y casi todo arma viene con sus balas', () => {
    const rng = createRng(2026);
    let items = 0;
    let ammo = 0;
    let weapons = 0;
    let orphan = 0;
    for (let i = 0; i < 4000; i++) {
      const chest = rollChest(rng, i % 7 === 0 ? 'golden' : 'normal');
      for (const it of chest) {
        items++;
        if (isAmmo(it.kind)) ammo++;
        if (isWeapon(it.kind)) {
          weapons++;
          if (!chest.some((o) => o.kind === `ammo_${it.kind}`)) orphan++;
        }
      }
    }
    expect(ammo / items).toBeGreaterThan(0.38);
    expect(ammo).toBeGreaterThan(weapons);
    // Antes casi nunca coincidian; ahora la mayoria de las armas trae sus balas.
    expect(orphan / weapons).toBeLessThan(0.45);
  });

  it('una caja de municion da 4 clases distintas, cantidades grandes y nunca mas de 120', () => {
    const rng = createRng(77);
    const totals: Record<string, number> = {};
    for (let i = 0; i < 500; i++) {
      const crate = rollAmmoCrate(rng);
      expect(crate).toHaveLength(4);
      expect(new Set(crate.map((c) => c.kind)).size).toBe(4);
      for (const c of crate) {
        expect(c.qty).toBeGreaterThan(0);
        expect(c.qty).toBeLessThanOrEqual(120);
        totals[c.kind] = (totals[c.kind] ?? 0) + c.qty;
      }
    }
    // El fusil y la pistola traen mas balas que la bazuca.
    expect(totals.ammo_rifle ?? 0).toBeGreaterThan(totals.ammo_bazooka ?? 0);
    expect(AMMO_KINDS).toHaveLength(5);
  });
});
