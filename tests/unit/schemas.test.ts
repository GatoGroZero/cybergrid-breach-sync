import { describe, expect, it } from 'vitest';
import {
  createRoomSchema,
  credentialsSchema,
  inputSchema,
  joinRoomSchema,
  pingSchema,
  moveItemSchema,
  selectSchema,
  skinSchema,
} from '../../src/shared/br/protocol';
import {
  generateSyntheticMatches,
  parseSeedPayload,
  SEED_DEFAULT_MATCHES,
} from '../../src/shared/seed';

describe('esquemas Zod del payload de seed', () => {
  it('acepta el formato esperado, cuerpo vacio, numero suelto y alias de la cantidad', () => {
    expect(parseSeedPayload({ count: 500 }).count).toBe(500);
    expect(parseSeedPayload(undefined).count).toBe(SEED_DEFAULT_MATCHES);
    expect(parseSeedPayload({}).count).toBe(SEED_DEFAULT_MATCHES);
    expect(parseSeedPayload(250).count).toBe(250);
    expect(parseSeedPayload('300').count).toBe(300);
    expect(parseSeedPayload({ partidas: 120 }).count).toBe(120);
    expect(parseSeedPayload({ Matches: '777' }).count).toBe(777);
    expect(parseSeedPayload({ count: 100, winRate: 60 }).winRate).toBe(0.6);
    expect(parseSeedPayload({ count: 100, replace: 'false' }).replace).toBe(false);
  });

  it('rechaza cantidades fuera del rango permitido y valores malformados', () => {
    expect(() => parseSeedPayload({ count: 0 })).toThrow();
    expect(() => parseSeedPayload({ count: 1001 })).toThrow();
    expect(() => parseSeedPayload({ count: 5000 })).toThrow();
    expect(() => parseSeedPayload({ count: 100.5 })).toThrow();
    expect(() => parseSeedPayload({ count: 100, winRate: 400 })).toThrow();
    expect(() => parseSeedPayload({ count: 100, players: 9 })).toThrow();
  });

  it('el generador de partidas es determinista y respeta exacto el winRate pedido', () => {
    const a = generateSyntheticMatches({ count: 200, seed: 7, winRate: 0.6 });
    const b = generateSyntheticMatches({ count: 200, seed: 7, winRate: 0.6 });
    expect(a).toEqual(b);
    expect(a.filter((m) => m.result === 'win')).toHaveLength(120);
    for (const m of a) {
      expect(m.players.length).toBeGreaterThanOrEqual(1);
      expect(m.players.length).toBeLessThanOrEqual(4);
      for (const p of m.players) {
        expect(p.kills).toBeGreaterThanOrEqual(0);
        if (!p.survived) expect(p.deaths).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('convierte partidas explicitas con nombres de campo en espanol o ingles', () => {
    const parsed = parseSeedPayload({
      partidas: [
        { resultado: 'victoria', kills: 12, muertes: 1, duracion: 200 },
        { result: 'loss', players: [{ kills: 3, deaths: 2 }] },
      ],
    });
    expect(parsed.count).toBe(2);
    expect(parsed.matches?.[0]?.result).toBe('win');
    expect(parsed.matches?.[1]?.result).toBe('loss');
  });
});

describe('esquemas Zod del inventario y del pelaje', () => {
  it('limita los espacios del inventario a 5 y rechaza indices fuera de rango', () => {
    expect(selectSchema.safeParse({ slot: 4 }).success).toBe(true);
    expect(selectSchema.safeParse({ slot: 5 }).success).toBe(false);
    expect(selectSchema.safeParse({ slot: -1 }).success).toBe(false);
    expect(moveItemSchema.safeParse({ from: 0, to: 4 }).success).toBe(true);
    expect(moveItemSchema.safeParse({ from: 0, to: 9 }).success).toBe(false);
  });

  it('el pelaje solo acepta 384 celdas hexadecimales y una base valida', () => {
    const paint = '0'.repeat(384);
    expect(skinSchema.safeParse({ base: 2, paint }).success).toBe(true);
    expect(skinSchema.safeParse({ base: 99, paint }).success).toBe(false);
    expect(skinSchema.safeParse({ base: 0, paint: 'x'.repeat(384) }).success).toBe(false);
    expect(skinSchema.safeParse({ base: 0, paint: '0'.repeat(383) }).success).toBe(false);
  });
});

describe('esquemas Zod del protocolo de juego', () => {
  const valid = { seq: 10, mx: 1, my: -0.5, aim: 1.2, fire: true };

  it('acepta un input valido', () => {
    expect(inputSchema.safeParse(valid).success).toBe(true);
  });

  it('rechaza inputs con NaN, infinito, fuera de rango o con tipos incorrectos', () => {
    expect(inputSchema.safeParse({ ...valid, mx: Number.NaN }).success).toBe(false);
    expect(inputSchema.safeParse({ ...valid, my: Infinity }).success).toBe(false);
    expect(inputSchema.safeParse({ ...valid, mx: 5 }).success).toBe(false);
    expect(inputSchema.safeParse({ ...valid, seq: -1 }).success).toBe(false);
    expect(inputSchema.safeParse({ ...valid, seq: 1.5 }).success).toBe(false);
    expect(inputSchema.safeParse({ ...valid, fire: 'si' }).success).toBe(false);
    expect(inputSchema.safeParse({ seq: 1 }).success).toBe(false);
  });

  it('valida credenciales, codigos de sala y mensajes de latencia', () => {
    expect(credentialsSchema.safeParse({ username: 'luis_01', password: '12345678' }).success).toBe(
      true,
    );
    expect(credentialsSchema.safeParse({ username: 'a', password: '12345678' }).success).toBe(
      false,
    );
    expect(credentialsSchema.safeParse({ username: 'luis', password: 'corta' }).success).toBe(
      false,
    );
    expect(credentialsSchema.safeParse({ username: 'lu is', password: '12345678' }).success).toBe(
      false,
    );
    expect(joinRoomSchema.parse({ code: ' ab3cd ' }).code).toBe('AB3CD');
    expect(joinRoomSchema.safeParse({ code: 'AB10O' }).success).toBe(false);
    expect(createRoomSchema.parse({}).isPrivate).toBe(false);
    expect(createRoomSchema.parse({}).map).toBe('azar');
    expect(createRoomSchema.safeParse({ map: 'luna' }).success).toBe(false);
    expect(pingSchema.safeParse({ t: 123.4 }).success).toBe(true);
    expect(pingSchema.safeParse({ t: 'x' }).success).toBe(false);
  });
});
