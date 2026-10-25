import { describe, expect, it, vi } from 'vitest';
import { ClientBR } from '../../src/client/game/state';
import type { GameStartPayload } from '../../src/shared/br/protocol';
import type { BRSnapshot, MeState } from '../../src/shared/br/types';

function make(): { g: ClientBR; use: ReturnType<typeof vi.fn> } {
  const use = vi.fn();
  const start: GameStartPayload = {
    seed: 11,
    map: 'bosque',
    you: 1,
    cats: [{ id: 1, name: 'yo', bot: false, skin: { base: 0, paint: '0'.repeat(384) } }],
    tickHz: 30,
  };
  const net = { connected: true, socket: { emit: vi.fn() } };
  const input = { requestUse: use, dashEnabled: false, sample: vi.fn() };
  const sfx = { click: vi.fn() };
  const g = new ClientBR(start, net as never, input as never, sfx as never);
  return { g, use };
}

const me = (over: Partial<MeState>): MeState =>
  ({
    x: 100,
    y: 100,
    hp: 100,
    shield: 0,
    sel: 0,
    alive: true,
    kills: 0,
    healLeft: 0,
    healKind: null,
    cooldown: 0,
    reload: 0,
    stamina: 100,
    tired: false,
    ...over,
  }) as MeState;

function feed(g: ClientBR, m: MeState, inv: BRSnapshot['inv']): void {
  g.me = m;
  g.inv = inv ?? [];
}

describe('usar el objeto en mano con un toque', () => {
  it('un botiquín con la vida llena no se gasta y lo dice', () => {
    const { g, use } = make();
    feed(g, me({ hp: 100 }), [{ kind: 'medkit', qty: 2, rarity: 0 }, null, null, null, null]);
    expect(g.useKind).toBe('heal');
    expect(g.useSelected()).toBe(false);
    expect(use).not.toHaveBeenCalled();
    expect(g.banner?.text).toBe('Ya tienes la vida llena');
  });

  it('con la vida baja el botiquín sí se pide, y también el escudo y las pociones', () => {
    const { g, use } = make();
    feed(g, me({ hp: 40 }), [{ kind: 'medkit', qty: 1, rarity: 0 }, null, null, null, null]);
    expect(g.useSelected()).toBe(true);
    feed(g, me({ shield: 0 }), [{ kind: 'shield', qty: 1, rarity: 0 }, null, null, null, null]);
    expect(g.useSelected()).toBe(true);
    feed(g, me({ shield: 100 }), [{ kind: 'shield', qty: 1, rarity: 0 }, null, null, null, null]);
    expect(g.useSelected()).toBe(false);
    feed(g, me({}), [{ kind: 'potion_catnip', qty: 1, rarity: 0 }, null, null, null, null]);
    expect(g.useKind).toBe('potion');
    expect(g.useSelected()).toBe(true);
    expect(use).toHaveBeenCalledTimes(3);
  });

  it('las armas no se "usan": el toque no hace nada', () => {
    const { g, use } = make();
    feed(g, me({}), [{ kind: 'pistol', qty: 1, rarity: 0 }, null, null, null, null]);
    expect(g.useKind).toBeNull();
    expect(g.useSelected()).toBe(false);
    expect(use).not.toHaveBeenCalled();
  });

  it('con la curación en marcha no se pide otra', () => {
    const { g, use } = make();
    feed(g, me({ hp: 30, healLeft: 4, healKind: 'medkit' }), [
      { kind: 'medkit', qty: 1, rarity: 0 },
      null,
      null,
      null,
      null,
    ]);
    expect(g.useSelected()).toBe(false);
    expect(use).not.toHaveBeenCalled();
  });
});
