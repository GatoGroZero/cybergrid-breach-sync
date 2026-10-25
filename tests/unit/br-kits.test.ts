import { describe, expect, it } from 'vitest';
import { KITS, KIT_IDS, type KitId } from '../../src/shared/br/modes';
import { WEAPONS, isWeapon } from '../../src/shared/br/items';
import { INVENTORY_SLOTS } from '../../src/shared/br/constants';
import { defaultSkin } from '../../src/shared/br/skin';
import { ZONE_TECHO } from '../../src/shared/br/zone';
import { PvpGame } from '../../src/server/br/PvpGame';

describe('kits de la pelea en el techo', () => {
  it('hay cuatro, cada uno con su arma principal y todo cabe en los cinco espacios', () => {
    expect(KIT_IDS).toEqual(['cazador', 'acechador', 'vigia', 'bombardero']);
    for (const id of KIT_IDS) {
      const kit = KITS[id];
      expect(kit.id).toBe(id);
      expect(kit.items.length).toBeLessThanOrEqual(INVENTORY_SLOTS);
      expect(kit.items[0]?.kind).toBe(kit.main);
      expect(isWeapon(kit.main)).toBe(true);
      // la municion de repuesto es de armas que el kit si lleva
      const carried = new Set(
        kit.items.filter((i) => isWeapon(i.kind)).map((i) => `ammo_${i.kind}`),
      );
      for (const key of Object.keys(kit.ammo)) expect(carried.has(key)).toBe(true);
      for (const v of Object.values(kit.stats)) expect(v).toBeGreaterThanOrEqual(1);
      for (const v of Object.values(kit.stats)) expect(v).toBeLessThanOrEqual(5);
      expect(kit.blurb.length).toBeGreaterThan(20);
    }
  });

  it('cada kit se juega distinto: alcances y estilos no se repiten', () => {
    const mains = new Set(KIT_IDS.map((id) => KITS[id].main));
    expect(mains.size).toBe(4);
    const ranges = KIT_IDS.map((id) => WEAPONS[KITS[id].main].range).sort((a, b) => a - b);
    expect(new Set(ranges).size).toBe(4);
    expect(new Set(KIT_IDS.map((id) => KITS[id].style)).size).toBe(4);
  });

  it('ningun kit domina: entre bots, cada uno gana entre 30 % y 70 % de las rondas', () => {
    const won: Record<string, number> = {};
    const played: Record<string, number> = {};
    for (const mapKind of ['tejado', 'azotea', 'mansarda'] as const) {
      for (const a of KIT_IDS) {
        for (const b of KIT_IDS) {
          for (let s = 0; s < 3; s++) {
            const game = new PvpGame({
              seed: 7000 + s * 53 + KIT_IDS.indexOf(a) * 7 + KIT_IDS.indexOf(b) * 11,
              mapKind,
              mode: 'techo',
              zone: ZONE_TECHO,
              teamSize: 1,
              cats: [
                { id: 1, name: 'a', userId: null, bot: true, skin: defaultSkin(), team: 0 },
                { id: 2, name: 'b', userId: null, bot: true, skin: defaultSkin(), team: 1 },
              ],
            });
            for (let i = 0; i < 120_000 && !game.over; i++) {
              if (game.phase === 'pick') {
                game.chooseKit(1, a as KitId);
                game.chooseKit(2, b as KitId);
              }
              game.step();
            }
            const [w0, w1] = game.result?.score ?? [0, 0];
            won[a] = (won[a] ?? 0) + w0;
            won[b] = (won[b] ?? 0) + w1;
            played[a] = (played[a] ?? 0) + w0 + w1;
            played[b] = (played[b] ?? 0) + w0 + w1;
          }
        }
      }
    }
    for (const id of KIT_IDS) {
      const pct = (won[id] ?? 0) / Math.max(1, played[id] ?? 1);
      expect(pct, `${id}: ${(pct * 100).toFixed(0)} %`).toBeGreaterThan(0.3);
      expect(pct, `${id}: ${(pct * 100).toFixed(0)} %`).toBeLessThan(0.7);
    }
  }, 120_000);
});
