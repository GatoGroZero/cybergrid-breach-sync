import { CLAWS } from '../../src/shared/br/items';
import { describe, expect, it } from 'vitest';
import { CAT, TICK_DT, TILE, WALL_ITEM, SPAWN_GRACE_S } from '../../src/shared/br/constants';
import type { AmmoKind, Item, Rarity, WeaponKind } from '../../src/shared/br/items';
import { G, isSolidTile } from '../../src/shared/br/map';
import { defaultSkin } from '../../src/shared/br/skin';
import { BRGame, type Cat } from '../../src/server/br/Game';

const input = (
  seq: number,
  patch: Partial<{
    mx: number;
    my: number;
    aim: number;
    fire: boolean;
    hold: boolean;
    run: boolean;
  }> = {},
) => ({
  seq,
  mx: 0,
  my: 0,
  aim: 0,
  fire: false,
  ...patch,
});

/** Partida con 3 gatos humanos alineados en un tramo despejado, listos para probar reglas. */
function arena(mapKind: 'bosque' | 'casa' | 'piscina' = 'bosque') {
  const game = new BRGame({
    seed: 11,
    mapKind,
    cats: [1, 2, 3].map((id) => ({
      id,
      name: `gato${id}`,
      userId: id,
      bot: false,
      skin: defaultSkin(),
    })),
  });
  // La proteccion inicial termina a los 10 s: las pruebas de combate empiezan despues.
  game.time = SPAWN_GRACE_S + 1;
  const m = game.map;
  let spot: { x: number; y: number } | null = null;
  for (let y = 4; y < m.h - 4 && !spot; y++) {
    for (let x = 4; x < m.w - 24 && !spot; x++) {
      let ok = true;
      for (let k = 0; k < 20 && ok; k++) {
        for (let dy = -1; dy <= 1 && ok; dy++) {
          if (isSolidTile(m, x + k, y + dy) || m.ground[(y + dy) * m.w + x + k] === G.WATER)
            ok = false;
        }
      }
      if (ok) spot = { x, y };
    }
  }
  if (!spot) throw new Error('sin tramo despejado');
  const [a, b, c] = game.cats as [Cat, Cat, Cat];
  a.x = spot.x * TILE + 8;
  a.y = spot.y * TILE + 8;
  b.x = a.x + 60;
  b.y = a.y;
  c.x = a.x + 300;
  c.y = a.y;
  return { game, a, b, c, spot };
}

const give = (cat: Cat, slot: number, item: Item): void => {
  // Las balas no ocupan espacios: van a su propio compartimento.
  if (item.kind.startsWith('ammo_')) cat.ammo[item.kind as AmmoKind] += item.qty;
  else cat.inv[slot] = item;
};
const weapon = (kind: WeaponKind, rarity: Rarity): Item => ({ kind, qty: 1, rarity });
const run = (game: BRGame, ticks: number): void => {
  for (let i = 0; i < ticks; i++) game.step();
};

describe('vida, escudo y curación en partida', () => {
  it('empieza con 100 de vida y 0 de escudo', () => {
    const { a } = arena();
    expect(a.hp).toBe(100);
    expect(a.shield).toBe(0);
  });

  it('el botiquín cura 10 por segundo hasta 100 y se gasta al empezar', () => {
    const { game, a } = arena();
    a.hp = 70;
    give(a, 0, { kind: 'medkit', qty: 2, rarity: 0 });
    game.select(1, 0);
    game.fireControl(a, 0, true, false);
    expect(a.heal).not.toBeNull();
    expect(a.inv[0]?.qty).toBe(1);
    run(game, 30);
    expect(a.hp).toBe(80);
    run(game, 30);
    expect(a.hp).toBe(90);
    run(game, 30);
    expect(a.hp).toBe(100);
    expect(a.heal).toBeNull();
    run(game, 60);
    expect(a.hp).toBe(100);
  });

  it('cambiar de arma cancela la curación y lo que faltaba se pierde', () => {
    const { game, a } = arena();
    a.hp = 20;
    give(a, 0, { kind: 'medkit', qty: 1, rarity: 0 });
    give(a, 1, weapon('pistol', 0));
    game.select(1, 0);
    game.fireControl(a, 0, true, false);
    run(game, 125);
    expect(a.hp).toBe(60);
    game.select(1, 1);
    expect(a.heal).toBeNull();
    run(game, 120);
    expect(a.hp).toBe(60);
    expect(a.inv[0]).toBeNull();
  });

  it('el escudo sube 5 por segundo hasta 100 y también se cancela al cambiar', () => {
    const { game, a } = arena();
    give(a, 0, { kind: 'shield', qty: 1, rarity: 0 });
    give(a, 1, weapon('rifle', 0));
    game.select(1, 0);
    game.fireControl(a, 0, true, false);
    run(game, 95);
    expect(a.shield).toBe(15);
    game.select(1, 1);
    run(game, 60);
    expect(a.shield).toBe(15);
    expect(a.hp).toBe(100);
  });

  it('no se puede usar un botiquín con la vida llena', () => {
    const { game, a } = arena();
    give(a, 0, { kind: 'medkit', qty: 1, rarity: 0 });
    game.select(1, 0);
    game.fireControl(a, 0, true, false);
    expect(a.heal).toBeNull();
    expect(a.inv[0]?.qty).toBe(1);
  });
});

describe('armas, balas y daño', () => {
  it.each([
    ['pistol', 0, 5],
    ['pistol', 1, 10],
    ['pistol', 2, 15],
    ['sniper', 2, 80],
    ['rifle', 1, 15],
  ] as [WeaponKind, Rarity, number][])(
    '%s de rareza %i hace %i de daño por bala',
    (kind, rarity, dmg) => {
      const { game, a, b } = arena();
      give(a, 0, weapon(kind, rarity));
      give(a, 1, { kind: `ammo_${kind}`, qty: 10, rarity: 0 });
      game.select(1, 0);
      game.fireControl(a, 0, true, false);
      run(game, 40);
      expect(100 - b.hp).toBe(dmg);
    },
  );

  it('la pistola exige un clic por bala y el fusil dispara solo al mantener', () => {
    const pistol = arena();
    give(pistol.a, 0, weapon('pistol', 1));
    give(pistol.a, 1, { kind: 'ammo_pistol', qty: 30, rarity: 0 });
    pistol.game.select(1, 0);
    for (let i = 0; i < 60; i++) {
      pistol.game.fireControl(pistol.a, 0, true, false);
      pistol.game.step();
    }
    expect(pistol.a.ammo['ammo_pistol']).toBe(30 - 1);

    const rifle = arena();
    give(rifle.a, 0, weapon('rifle', 0));
    give(rifle.a, 1, { kind: 'ammo_rifle', qty: 90, rarity: 0 });
    rifle.game.select(1, 0);
    for (let i = 0; i < 60; i++) {
      rifle.game.fireControl(rifle.a, 0, true, false);
      rifle.game.step();
    }
    expect(90 - rifle.a.ammo['ammo_rifle']).toBeGreaterThanOrEqual(8);
  });

  it('la escopeta gasta 2 cartuchos y dispara varios perdigones; sin balas no dispara', () => {
    const { game, a, b } = arena();
    b.x = a.x + 30;
    give(a, 0, weapon('shotgun', 2));
    give(a, 1, { kind: 'ammo_shotgun', qty: 3, rarity: 0 });
    game.select(1, 0);
    game.fireControl(a, 0, true, false);
    expect(a.ammo['ammo_shotgun']).toBe(1);
    run(game, 20);
    expect(b.hp).toBeLessThan(100);
    expect(100 - b.hp).toBeGreaterThanOrEqual(30);
    game.fireControl(a, 0, false, false);
    run(game, 40);
    const hpBefore = b.hp;
    game.fireControl(a, 0, true, false);
    run(game, 20);
    expect(a.ammo['ammo_shotgun']).toBe(1);
    expect(b.hp).toBe(hpBefore);
  });

  it('el daño pasa primero por el escudo y luego a la vida', () => {
    const { game, a, b } = arena();
    b.shield = 8;
    give(a, 0, weapon('pistol', 1));
    give(a, 1, { kind: 'ammo_pistol', qty: 10, rarity: 0 });
    game.select(1, 0);
    game.fireControl(a, 0, true, false);
    run(game, 40);
    expect(b.shield).toBe(0);
    expect(b.hp).toBe(98);
    expect(a.damageDealt).toBe(10);
  });

  it('la bazuca explota y daña a los cercanos; un golpe lejano no llega', () => {
    const { game, a, b } = arena();
    b.x = a.x + 60;
    const near = game.cat(3) as Cat;
    near.x = b.x + 12;
    near.y = b.y;
    give(a, 0, weapon('bazooka', 2));
    give(a, 1, { kind: 'ammo_bazooka', qty: 2, rarity: 0 });
    game.select(1, 0);
    game.fireControl(a, 0, true, false);
    run(game, 60);
    expect(b.hp).toBeLessThanOrEqual(10);
    expect(near.hp).toBeLessThan(100);
  });

  it('sin arma en mano se usan las garras', () => {
    const { game, a, b } = arena();
    b.x = a.x + 10;
    game.select(1, 0);
    expect(game.held(a)).toBeNull();
    game.fireControl(a, 0, true, false);
    expect(b.hp).toBe(100 - CLAWS.damage);
  });

  it('el fusil automático no atraviesa un muro colocado: lo desgasta', () => {
    const { game, a, b } = arena();
    give(a, 0, { kind: 'wall', qty: 1, rarity: 0 });
    game.select(1, 0);
    game.fireControl(a, 0, true, false);
    expect(game.wallList()).toHaveLength(1);
    game.fireControl(a, 0, false, false);
    give(a, 1, weapon('rifle', 2));
    give(a, 2, { kind: 'ammo_rifle', qty: 90, rarity: 0 });
    game.select(1, 1);
    for (let i = 0; i < 12; i++) {
      game.fireControl(a, 0, true, false);
      game.step();
    }
    expect(b.hp).toBe(100);
    const wall = game.wallList()[0];
    expect(wall === undefined || wall.hp < WALL_ITEM.hp).toBe(true);
  });
});

describe('mini muros', () => {
  it('se colocan gastando una unidad, bloquean el paso y tienen 150 de vida', () => {
    const { game, a } = arena();
    give(a, 0, { kind: 'wall', qty: 2, rarity: 0 });
    game.select(1, 0);
    game.fireControl(a, 0, true, false);
    const walls = game.wallList();
    expect(walls).toHaveLength(1);
    expect(walls[0]?.hp).toBe(WALL_ITEM.hp);
    expect(a.inv[0]?.qty).toBe(1);
    const w = walls[0]!;
    expect(game.map.solid[w.ty * game.map.w + w.tx]).toBe(2);
    for (let i = 0; i < 80; i++) {
      game.pushInput(1, input(i + 1, { mx: 1 }));
      game.step();
    }
    expect(a.x).toBeLessThan(w.tx * TILE);
  });

  it('se desgastan con los disparos y al llegar a 0 se rompen y dejan de bloquear', () => {
    const { game, a, b } = arena();
    give(a, 0, { kind: 'wall', qty: 1, rarity: 0 });
    game.select(1, 0);
    game.fireControl(a, 0, true, false);
    const wall = game.wallList()[0]!;
    const { tx, ty, id } = wall;
    give(b, 0, weapon('sniper', 2));
    give(b, 1, { kind: 'ammo_sniper', qty: 16, rarity: 0 });
    game.select(2, 0);
    b.x = a.x + 90;
    b.aim = Math.PI;
    let hits = 0;
    while (game.wallList().some((x) => x.id === id) && hits < 10) {
      game.fireControl(b, Math.PI, false, false);
      game.step();
      game.fireControl(b, Math.PI, true, false);
      run(game, 50);
      hits++;
    }
    expect(game.wallList().some((x) => x.id === id)).toBe(false);
    expect(hits).toBe(2);
    expect(game.map.solid[ty * game.map.w + tx]).toBe(0);
  });

  it('no se puede colocar encima de un gato ni dentro de un obstáculo', () => {
    const { game, a, b } = arena();
    b.x = a.x + WALL_ITEM.placeDistance;
    give(a, 0, { kind: 'wall', qty: 3, rarity: 0 });
    game.select(1, 0);
    game.fireControl(a, 0, true, false);
    expect(game.wallList()).toHaveLength(0);
    expect(a.inv[0]?.qty).toBe(3);
  });
});

describe('cofres, lápidas e inventario de 5 cosas', () => {
  it('abrir un cofre muestra su contenido y se pasa al inventario; lejos no se puede', () => {
    const { game, a } = arena();
    const chest = game.allContainers().find((c) => c.kind === 'chest')!;
    a.x = chest.x + 10;
    a.y = chest.y + 8;
    const contents = game.interact(1);
    expect(contents?.items.length).toBeGreaterThanOrEqual(3);
    expect(chest.opened).toBe(true);
    const first = contents!.items[0]!;
    game.lootTake(1, chest.id, 0);
    expect(a.inv.some((it) => it && it.kind === first.kind)).toBe(true);
    a.x = chest.x + 200;
    expect(game.lootTake(1, chest.id, 0)).toBeNull();
    expect(game.interact(1)).toBeNull();
  });

  it('el inventario tiene máximo 5 casillas y lo que no cabe se queda en el cofre', () => {
    const { game, a } = arena();
    const chest = game.allContainers().find((c) => c.kind === 'chest')!;
    a.x = chest.x + 10;
    a.y = chest.y + 8;
    const kinds = ['pistol', 'shotgun', 'sniper', 'bazooka', 'rifle'] as const;
    kinds.forEach((k, i) => give(a, i, weapon(k, 0)));
    chest.items = [weapon('pistol', 2), { kind: 'medkit', qty: 1, rarity: 0 }];
    game.interact(1);
    game.lootTake(1, chest.id, 0);
    game.lootTakeAll(1, chest.id);
    expect(a.inv.filter(Boolean)).toHaveLength(5);
    expect(chest.items).toHaveLength(2);
  });

  it('al morir se genera una lápida con su inventario que otro gato puede saquear', () => {
    const { game, a, b } = arena();
    give(b, 0, weapon('rifle', 1));
    give(b, 1, { kind: 'medkit', qty: 2, rarity: 0 });
    game.damageCat(b, 999, a);
    expect(b.alive).toBe(false);
    expect(a.kills).toBe(1);
    expect(b.placement).toBe(3);
    const tomb = game.allContainers().find((c) => c.kind === 'tomb')!;
    expect(tomb.title).toContain('gato2');
    expect(tomb.items.map((i) => i.kind).sort()).toEqual(['medkit', 'rifle']);
    a.x = tomb.x + 6;
    a.y = tomb.y;
    const view = game.interact(1);
    expect(view?.items).toHaveLength(2);
    game.lootTakeAll(1, tomb.id);
    expect(a.inv.some((it) => it?.kind === 'rifle')).toBe(true);
    expect(game.allContainers().some((c) => c.id === tomb.id)).toBe(false);
  });

  it('arrastrar ordena o tira objetos al suelo, donde se pueden volver a recoger', () => {
    const { game, a } = arena();
    give(a, 0, weapon('pistol', 0));
    give(a, 1, weapon('rifle', 1));
    expect(game.invMove(1, 0, 3)).toBe(true);
    expect(a.inv[3]?.kind).toBe('pistol');
    expect(a.inv[0]).toBeNull();
    expect(game.invDrop(1, 1)).toBe(true);
    expect(a.inv[1]).toBeNull();
    const drop = game.allContainers().find((c) => c.kind === 'drop')!;
    expect(drop.items[0]?.kind).toBe('rifle');
    expect(game.interact(1)?.items[0]?.kind).toBe('rifle');
  });
});

describe('agua y zona de ola', () => {
  it('el agua de la piscina hace 5 de daño cada medio segundo', () => {
    const { game, a } = arena('piscina');
    const m = game.map;
    const i = Array.from(m.ground).findIndex((g) => g === G.WATER);
    a.x = (i % m.w) * TILE + 8;
    a.y = Math.floor(i / m.w) * TILE + 8;
    run(game, 31);
    expect(a.hp).toBe(90);
  });

  it('antes de los 4 minutos la ola no hace daño y después daña a quien queda fuera', () => {
    const { game, a } = arena();
    a.x = 20;
    a.y = 20;
    run(game, 30 * 10);
    expect(a.hp).toBe(100);
    game.time = 300;
    a.x = game.zone.circle.cx + game.zone.circle.r + 500;
    a.y = game.zone.circle.cy;
    game.step();
    const hp0 = a.hp;
    run(game, 30 * 5);
    expect(a.hp).toBeLessThan(hp0);
  });
});

describe('fin de la partida', () => {
  it('gana el último gato en pie, con puestos y bajas', () => {
    const { game, a, b, c } = arena();
    game.damageCat(c, 999, b);
    expect(c.placement).toBe(3);
    game.step();
    expect(game.over).toBe(false);
    game.damageCat(b, 999, a);
    game.step();
    expect(game.over).toBe(true);
    expect(game.result?.winnerId).toBe(1);
    expect(game.result?.humanWon).toBe(true);
    expect(game.result?.rows.map((r) => r.placement)).toEqual([1, 2, 3]);
    expect(game.result?.rows[0]?.kills).toBe(1);
  });

  it('si el humano cae la partida sigue para que la vea y termina cuando se va', () => {
    const game = new BRGame({
      seed: 3,
      mapKind: 'bosque',
      cats: [
        { id: 1, name: 'yo', userId: 1, bot: false, skin: defaultSkin() },
        { id: 2, name: 'bot1', userId: null, bot: true, skin: defaultSkin() },
        { id: 3, name: 'bot2', userId: null, bot: true, skin: defaultSkin() },
      ],
    });
    game.time = SPAWN_GRACE_S + 1;
    game.damageCat(game.cat(1) as Cat, 999, game.cat(2) as Cat);
    game.step();
    expect(game.over).toBe(false);
    expect(game.drainDeaths()[0]?.payload.placement).toBe(3);
    game.setConnected(1, false);
    game.step();
    expect(game.over).toBe(true);
    expect(game.result?.humanWon).toBe(false);
  });

  it('nadie recibe dano durante la proteccion inicial', () => {
    const game = new BRGame({
      seed: 3,
      mapKind: 'bosque',
      cats: [
        { id: 1, name: 'yo', userId: 1, bot: false, skin: defaultSkin() },
        { id: 2, name: 'bot1', userId: null, bot: true, skin: defaultSkin() },
      ],
    });
    const me = game.cat(1) as Cat;
    game.damageCat(me, 50, game.cat(2) as Cat);
    expect(me.hp).toBe(100);
    game.time = SPAWN_GRACE_S + 0.1;
    game.damageCat(me, 50, game.cat(2) as Cat);
    expect(me.hp).toBe(50);
  });
});

describe('autoridad del servidor', () => {
  it('no deja avanzar más rápido aunque el cliente mande cientos de inputs de golpe', () => {
    const { game, a } = arena();
    const x0 = a.x;
    for (let i = 0; i < 400; i++) game.pushInput(1, input(i, { mx: 1 }));
    run(game, 30);
    expect(a.x - x0).toBeLessThanOrEqual(CAT.speed * (30 * TICK_DT * 1.05 + 5 * TICK_DT) + 1);
    expect(a.x - x0).toBeGreaterThan(30);
  });

  it('no atiende curar, disparar ni usar objetos a un gato muerto', () => {
    const { game, a, b } = arena();
    give(b, 0, { kind: 'medkit', qty: 1, rarity: 0 });
    b.hp = 10;
    game.damageCat(b, 999, a);
    expect(game.select(2, 0)).toBe(false);
    expect(game.interact(2)).toBeNull();
    expect(game.invDrop(2, 0)).toBe(false);
    game.pushInput(2, input(1, { fire: true }));
    expect(b.queue).toHaveLength(0);
  });

  it('cada cliente solo recibe lo cercano: los lejanos no aparecen en su instantánea', () => {
    const { game, a, b, c } = arena();
    c.x = a.x + 700;
    const snap = game.snapshotFor(1)!;
    expect(snap.cats.map((t) => t[0])).toContain(b.id);
    expect(snap.cats.map((t) => t[0])).not.toContain(c.id);
    expect(snap.me.x).toBeCloseTo(a.x, 0);
    expect(snap.inv).toBeDefined();
    game.endTick();
    expect(game.snapshotFor(1)!.inv).toBeUndefined();
  });
});

describe('correr y estamina', () => {
  /** Avanza `ticks` pasos con el gato 1 empujando a la derecha, corriendo o no. */
  function walk(game: BRGame, ticks: number, run: boolean, mx = 1): void {
    for (let i = 0; i < ticks; i++) {
      game.pushInput(1, input(1000 + game.tick, { mx, run }));
      game.step();
    }
  }

  it('corre a 1.55 veces la velocidad de caminar y gasta la barra en unos 5 segundos', () => {
    const walking = arena();
    const x0 = walking.a.x;
    walk(walking.game, 30, false);
    const walked = walking.a.x - x0;

    const running = arena();
    const r0 = running.a.x;
    walk(running.game, 30, true);
    const ran = running.a.x - r0;
    expect(ran / walked).toBeGreaterThan(1.5);
    expect(ran / walked).toBeLessThan(1.6);
    expect(running.a.running).toBe(true);
    expect(running.a.stamina.value).toBeLessThan(85);
    expect(running.a.stamina.value).toBeGreaterThan(75);
  });

  it('al agotarse deja de correr hasta recuperar un poco y la barra tarda 4 s en llenarse', () => {
    const { game, a } = arena();
    walk(game, 200, true, 0.1);
    // con un vector tan chico no cuenta como moverse: no gasta nada
    expect(a.stamina.value).toBe(100);
    const bounds = arena();
    walk(bounds.game, 150, true, 1);
    expect(bounds.a.stamina.value).toBeLessThan(0.5);
    expect(bounds.a.stamina.tired).toBe(true);
    const xTired = bounds.a.x;
    walk(bounds.game, 10, true, 1);
    // cansado: camina a velocidad normal aunque pida correr
    expect(bounds.a.running).toBe(false);
    expect(bounds.a.x - xTired).toBeLessThan(10 * (CAT.speed * TICK_DT) + 0.5);
    // quieto o caminando se recupera: 100 en 4 segundos
    walk(bounds.game, 120, false, 0);
    expect(bounds.a.stamina.value).toBe(100);
    expect(bounds.a.stamina.tired).toBe(false);
  });

  it('a media recuperacion se puede volver a correr y la recuperacion se detiene ahi', () => {
    const { game, a } = arena();
    walk(game, 90, true, 1);
    const low = a.stamina.value;
    expect(low).toBeLessThan(60);
    walk(game, 30, false, 0);
    const half = a.stamina.value;
    expect(half).toBeGreaterThan(low + 20);
    walk(game, 5, true, 1);
    expect(a.running).toBe(true);
    // mientras corre no se recupera: solo baja
    expect(a.stamina.value).toBeLessThan(half);
  });

  it('pedir correr sin moverse no gasta nada, y la estamina viaja en la instantanea', () => {
    const { game, a } = arena();
    walk(game, 20, true, 0);
    expect(a.stamina.value).toBe(100);
    walk(game, 30, true, 1);
    const snap = game.snapshotFor(1);
    expect(snap?.me.stamina).toBeLessThan(100);
    expect(snap?.me.tired).toBe(false);
    // los demas ven que corre: la bandera 64 va en la tupla del gato
    const seenByOther = game.snapshotFor(2)?.cats.find((t) => t[0] === 1);
    expect(((seenByOther?.[3] ?? 0) & 64) !== 0).toBe(true);
  });
});

describe('balas en su propio compartimento', () => {
  it('recoger balas de un cofre no ocupa espacios y respeta el tope de 100', () => {
    const { game, a } = arena();
    const chest = [...game['containers'].values()][0];
    expect(chest).toBeDefined();
    chest!.x = a.x;
    chest!.y = a.y;
    chest!.items = [
      { kind: 'ammo_pistol', qty: 70, rarity: 0 },
      { kind: 'ammo_pistol', qty: 50, rarity: 0 },
      { kind: 'ammo_rifle', qty: 30, rarity: 0 },
      { kind: 'medkit', qty: 1, rarity: 0 },
    ];
    const opened = game.interact(1);
    expect(opened?.items).toHaveLength(4);
    const left = game.lootTakeAll(1, chest!.id);
    expect(a.ammo.ammo_pistol).toBe(100);
    expect(a.ammo.ammo_rifle).toBe(30);
    expect(a.inv.filter(Boolean)).toHaveLength(1);
    expect(a.inv[0]?.kind).toBe('medkit');
    // 70 + 50 = 120: sobran 20 en el cofre
    expect(left?.items).toEqual([{ kind: 'ammo_pistol', qty: 20, rarity: 0 }]);
    const snap = game.snapshotFor(1);
    expect(snap?.ammo).toEqual([100, 0, 0, 0, 30]);
  });

  it('tirar balas las deja en el suelo y se pueden volver a tomar; al morir van a la lapida', () => {
    const { game, a, b } = arena();
    a.ammo.ammo_shotgun = 40;
    expect(game.ammoDrop(1, 'ammo_shotgun', 15)).toBe(true);
    expect(a.ammo.ammo_shotgun).toBe(25);
    expect(game.ammoDrop(1, 'ammo_sniper')).toBe(false);
    const dropped = game.interact(1);
    expect(dropped?.items).toEqual([{ kind: 'ammo_shotgun', qty: 15, rarity: 0 }]);

    a.ammo.ammo_rifle = 60;
    game.damageCat(a, 999, b);
    expect(a.ammo.ammo_rifle).toBe(0);
    const tomb = [...game['containers'].values()].find((c) => c.kind === 'tomb');
    expect(tomb?.items).toEqual(
      expect.arrayContaining([
        { kind: 'ammo_shotgun', qty: 25, rarity: 0 },
        { kind: 'ammo_rifle', qty: 60, rarity: 0 },
      ]),
    );
  });

  it('con hold el arma de un clic repite sola al cargarse; sin hold exige un clic por bala', () => {
    const held = arena();
    give(held.a, 0, weapon('pistol', 2));
    give(held.a, 1, { kind: 'ammo_pistol', qty: 50, rarity: 0 });
    held.game.select(1, 0);
    for (let i = 0; i < 60; i++) {
      held.game.pushInput(1, input(i + 1, { fire: true, hold: true }));
      held.game.step();
    }
    // 2 segundos con cooldown de 0.32 s: unas 6 balas
    expect(50 - held.a.ammo.ammo_pistol).toBeGreaterThanOrEqual(5);

    const clicked = arena();
    give(clicked.a, 0, weapon('pistol', 2));
    give(clicked.a, 1, { kind: 'ammo_pistol', qty: 50, rarity: 0 });
    clicked.game.select(1, 0);
    for (let i = 0; i < 60; i++) {
      clicked.game.pushInput(1, input(i + 1, { fire: true }));
      clicked.game.step();
    }
    expect(50 - clicked.a.ammo.ammo_pistol).toBe(1);
  });

  it('ya no existe el auto apuntado: el disparo sale exactamente hacia donde se apunta', () => {
    const { game, a, b } = arena();
    give(a, 0, weapon('rifle', 2));
    give(a, 1, { kind: 'ammo_rifle', qty: 90, rarity: 0 });
    game.select(1, 0);
    b.hp = 100;
    // se apunta hacia arriba, lejos del enemigo que esta a la derecha
    for (let i = 0; i < 30; i++) {
      game.pushInput(1, input(i + 1, { fire: true, aim: -Math.PI / 2 }));
      game.step();
    }
    expect(b.hp).toBe(100);
  });
});
