import { describe, expect, it } from 'vitest';
import { TICK_DT } from '../../src/shared/br/constants';
import { defaultSkin } from '../../src/shared/br/skin';
import { AdventureGame } from '../../src/server/br/AdventureGame';
import { PvpGame } from '../../src/server/br/PvpGame';
import { ZONE_TERRITORIO } from '../../src/shared/br/zone';
import type { Item } from '../../src/shared/br/items';

const cats = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    name: `gato${i + 1}`,
    userId: i + 1,
    bot: false,
    skin: defaultSkin(),
  }));

const run = (g: AdventureGame, seconds: number): void => {
  for (let i = 0; i < Math.round(seconds / TICK_DT); i++) g.step();
};

type Equipable = { equipItem(cat: unknown, item: Item): boolean };
const wear = (g: AdventureGame, id: number, kind: Item['kind'], rarity: 0 | 1 | 2): void => {
  (g as unknown as Equipable).equipItem(g.cat(id), { kind, qty: 1, rarity });
};
const equipOf = (g: AdventureGame, id: number): number[] => g.snapshotFor(id)!.adv!.equip;

describe('aventura: quitar y dar la armadura', () => {
  it('quitar una pieza la deja en el suelo y quien la tiro no la levanta de inmediato', () => {
    const g = new AdventureGame({ seed: 4321, cats: cats(2) });
    run(g, 0.5);
    wear(g, 1, 'armor_body', 2);
    expect(equipOf(g, 1)).toEqual([-1, 2, -1]);
    const maxBefore = g.snapshotFor(1)!.me.hp;

    expect(g.armorMove(1, 1)).toBeNull();
    expect(equipOf(g, 1)).toEqual([-1, -1, -1]);
    expect(g.pickups.some((p) => p.kind === 3 && p.item?.kind === 'armor_body')).toBe(true);
    // el gato sigue encima de la pieza y no se la vuelve a poner solo
    run(g, 2);
    expect(equipOf(g, 1)).toEqual([-1, -1, -1]);
    expect(g.snapshotFor(1)!.me.hp).toBeLessThanOrEqual(maxBefore);

    // un companero que pase por encima si se la pone
    const dropped = g.pickups.find((p) => p.kind === 3)!;
    const mate = g.cat(2)!;
    mate.x = dropped.x;
    mate.y = dropped.y;
    run(g, 0.2);
    expect(equipOf(g, 2)).toEqual([-1, 2, -1]);
  });

  it('dar una pieza a alguien cerca se la pasa directo; lejos o con algo mejor se rechaza', () => {
    const g = new AdventureGame({ seed: 4321, cats: cats(2) });
    run(g, 0.5);
    const a = g.cat(1)!;
    const b = g.cat(2)!;
    b.x = a.x + 30;
    b.y = a.y;
    wear(g, 1, 'armor_head', 1);

    // lejos
    b.x = a.x + 400;
    expect(g.armorMove(1, 0, 2)).toBe('muy_lejos');
    expect(equipOf(g, 1)[0]).toBe(1);
    // cerca
    b.x = a.x + 30;
    expect(g.armorMove(1, 0, 2)).toBeNull();
    expect(equipOf(g, 1)[0]).toBe(-1);
    expect(equipOf(g, 2)[0]).toBe(1);
    // nada que dar
    expect(g.armorMove(1, 0, 2)).toBe('sin_armadura');
    // el que ya lleva igual o mejor no la necesita
    wear(g, 1, 'armor_head', 1);
    expect(g.armorMove(1, 0, 2)).toBe('ya_lleva_igual_o_mejor');
    expect(equipOf(g, 1)[0]).toBe(1);
    // a si mismo o a un gato que no existe
    expect(g.armorMove(1, 0, 1)).toBe('sin_companero');
    expect(g.armorMove(1, 0, 9)).toBe('sin_companero');
    expect(g.armorMove(1, 7)).toBe('datos_invalidos');
  });

  it('al quitarte la capucha el escudo de mas se recorta al nuevo maximo', () => {
    const g = new AdventureGame({ seed: 4321, cats: cats(1) });
    run(g, 0.5);
    wear(g, 1, 'armor_head', 2);
    const cat = g.cat(1)!;
    cat.shield = 135;
    expect(g.armorMove(1, 0)).toBeNull();
    expect(g.snapshotFor(1)!.me.shield).toBe(100);
  });
});

describe('aventura: vida y escudo de los companeros en la instantanea', () => {
  it('cada gato ve a los demas del grupo y nunca a si mismo; el caido aparece con vida 0', () => {
    const g = new AdventureGame({ seed: 4321, cats: cats(3) });
    run(g, 0.5);
    g.cat(2)!.hp = 40;
    g.cat(2)!.shield = 25;
    const mates = g.snapshotFor(1)!.mates!;
    expect(mates.map((m) => m[0]).sort()).toEqual([2, 3]);
    expect(mates.find((m) => m[0] === 2)).toEqual([2, 40, 25, 100, 100]);
    g.debugKill(3);
    expect(g.snapshotFor(1)!.mates!.find((m) => m[0] === 3)?.[1]).toBe(0);
  });

  it('en solitario no hay companeros', () => {
    const g = new AdventureGame({ seed: 4321, cats: cats(1) });
    run(g, 0.2);
    expect(g.snapshotFor(1)!.mates).toBeUndefined();
  });
});

describe('equipos: solo se ven los de tu equipo', () => {
  it('en Territorio cada gato ve la vida de su equipo y no la del rival', () => {
    const list = cats(4).map((c, i) => ({ ...c, team: i % 2 }));
    const g = new PvpGame({
      seed: 777,
      mapKind: 'patios',
      mode: 'territorio',
      cats: list,
      teamSize: 2,
      zone: ZONE_TERRITORIO,
      zoneScale: 1,
      pickSeconds: 0,
    } as ConstructorParameters<typeof PvpGame>[0]);
    for (let i = 0; i < 40; i++) g.step();
    const mates = g.snapshotFor(1)!.mates!;
    // el gato 1 es del equipo 0 junto con el 3
    expect(mates.map((m) => m[0])).toEqual([3]);
  });
});

describe('tirar cosas por cantidad', () => {
  it('de una pila se tiran solo algunas y el resto se queda', () => {
    const g = new AdventureGame({ seed: 4321, cats: cats(1) });
    run(g, 0.5);
    const cat = g.cat(1)!;
    cat.inv[2] = { kind: 'medkit', qty: 3, rarity: 0 };
    expect(g.invDrop(1, 2, 2)).toBe(true);
    expect(cat.inv[2]?.qty).toBe(1);
    const boxes = (g as unknown as { containers: Map<number, { kind: string; items: Item[] }> })
      .containers;
    const drop = [...boxes.values()].find((c) => c.kind === 'drop');
    expect(drop?.items.find((i) => i.kind === 'medkit')?.qty).toBe(2);
    // tirar de mas tira lo que hay y deja la casilla vacia
    expect(g.invDrop(1, 2, 50)).toBe(true);
    expect(cat.inv[2]).toBeNull();
    // un arma sale completa aunque se pida una cantidad
    cat.inv[3] = { kind: 'pistol', qty: 1, rarity: 1, mag: 12 };
    expect(g.invDrop(1, 3, 1)).toBe(true);
    expect(cat.inv[3]).toBeNull();
  });

  it('de las balas se tira la cantidad pedida y nunca mas de las que se tienen', () => {
    const g = new AdventureGame({ seed: 4321, cats: cats(1) });
    run(g, 0.5);
    const cat = g.cat(1)!;
    cat.ammo.ammo_rifle = 100;
    expect(g.ammoDrop(1, 'ammo_rifle', 45)).toBe(true);
    expect(cat.ammo.ammo_rifle).toBe(55);
    expect(g.ammoDrop(1, 'ammo_rifle', 999)).toBe(true);
    expect(cat.ammo.ammo_rifle).toBe(0);
    expect(g.ammoDrop(1, 'ammo_rifle', 5)).toBe(false);
  });
});
