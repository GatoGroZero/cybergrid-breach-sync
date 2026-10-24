import { z } from 'zod';
import { createRng } from './rng';

export const SEED_MIN_MATCHES = 1;
export const SEED_MAX_MATCHES = 1000;
export const SEED_DEFAULT_MATCHES = 100;

export interface SyntheticPlayer {
  kills: number;
  deaths: number;
  damageDealt: number;
  survivalS: number;
  survived: boolean;
}

export interface SyntheticMatch {
  result: 'win' | 'loss';
  durationS: number;
  wave: number;
  players: SyntheticPlayer[];
}

const syntheticPlayerSchema = z.object({
  kills: z.number().min(0).max(500),
  deaths: z.number().min(0).max(50),
  damageDealt: z.number().min(0).max(1_000_000),
  survivalS: z.number().min(0).max(3600),
  survived: z.boolean(),
});

const syntheticMatchSchema = z.object({
  result: z.enum(['win', 'loss']),
  durationS: z.number().min(1).max(3600),
  wave: z.number().int().min(0).max(100),
  players: z.array(syntheticPlayerSchema).min(1).max(4),
});

/** Cuerpo de POST /api/test/seed ya normalizado. Los rangos son los que el servidor acepta. */
export const seedRequestSchema = z.object({
  count: z.number().int().min(SEED_MIN_MATCHES).max(SEED_MAX_MATCHES).default(SEED_DEFAULT_MATCHES),
  seed: z.number().int().min(0).max(2_147_483_647).default(1337),
  winRate: z.number().min(0).max(1).optional(),
  avgKills: z.number().min(0).max(100).optional(),
  avgDeaths: z.number().min(0).max(10).optional(),
  players: z.number().int().min(1).max(4).optional(),
  replace: z.boolean().default(true),
  matches: z.array(syntheticMatchSchema).min(1).max(SEED_MAX_MATCHES).optional(),
});

export type SeedRequest = z.infer<typeof seedRequestSchema>;

const COUNT_ALIASES = [
  'count',
  'matches',
  'partidas',
  'n',
  'total',
  'size',
  'amount',
  'nummatches',
  'num_matches',
  'numpartidas',
  'games',
  'cantidad',
  'quantity',
  'num',
  'numgames',
];
const LIST_ALIASES = ['matches', 'partidas', 'games', 'data', 'items', 'records', 'rows'];

const toNumber = (v: unknown): number | undefined => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return undefined;
};

const toBool = (v: unknown): boolean | undefined => {
  if (typeof v === 'boolean') return v;
  if (v === 'true') return true;
  if (v === 'false') return false;
  return undefined;
};

const lowerKeys = (obj: Record<string, unknown>): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) out[k.toLowerCase()] = v;
  return out;
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function coerceResult(obj: Record<string, unknown>): 'win' | 'loss' {
  for (const key of ['result', 'outcome', 'resultado']) {
    const v = obj[key];
    if (typeof v === 'string')
      return /^(win|won|victory|victoria|gan)/i.test(v.trim()) ? 'win' : 'loss';
  }
  for (const key of ['win', 'won', 'victory', 'victoria', 'ganada']) {
    const b = toBool(obj[key]);
    if (b !== undefined) return b ? 'win' : 'loss';
  }
  return 'loss';
}

function coercePlayer(raw: unknown, fallbackDuration: number): SyntheticPlayer {
  const o = isRecord(raw) ? lowerKeys(raw) : {};
  const kills = toNumber(o.kills ?? o.bajas ?? o.k) ?? 0;
  const deaths = toNumber(o.deaths ?? o.muertes ?? o.d) ?? 0;
  const survivalS =
    toNumber(o.survivals ?? o.survival ?? o.survivaltime ?? o.supervivencia ?? o.tiempo) ??
    fallbackDuration;
  const survived = toBool(o.survived ?? o.alive ?? o.sobrevivio) ?? deaths === 0;
  const damageDealt = toNumber(o.damagedealt ?? o.damage ?? o.dano) ?? kills * 25;
  return {
    kills: Math.max(0, Math.min(500, kills)),
    deaths: Math.max(0, Math.min(50, deaths)),
    damageDealt: Math.max(0, Math.min(1_000_000, damageDealt)),
    survivalS: Math.max(0, Math.min(3600, survivalS)),
    survived,
  };
}

function coerceMatch(raw: unknown): SyntheticMatch {
  const o = isRecord(raw) ? lowerKeys(raw) : {};
  const durationS = Math.max(
    1,
    Math.min(3600, toNumber(o.durations ?? o.duration ?? o.duracion ?? o.durationseconds) ?? 180),
  );
  const list = o.players ?? o.jugadores;
  const players =
    Array.isArray(list) && list.length > 0
      ? list.slice(0, 4).map((p) => coercePlayer(p, durationS))
      : [coercePlayer(o, durationS)];
  return {
    result: coerceResult(o),
    durationS,
    wave: Math.max(
      0,
      Math.min(100, Math.floor(toNumber(o.wave ?? o.oleada) ?? Math.floor(durationS / 40))),
    ),
    players,
  };
}

/**
 * Lector tolerante del cuerpo de /seed. El PDF no fija el formato, asi que acepta un numero
 * suelto, un arreglo de partidas, o un objeto con la cantidad bajo varios alias comunes.
 */
export function normalizeSeedPayload(raw: unknown): Record<string, unknown> {
  if (raw === null || raw === undefined || raw === '') return {};
  const direct = typeof raw === 'number' || typeof raw === 'string' ? toNumber(raw) : undefined;
  if (direct !== undefined) return { count: direct };
  if (Array.isArray(raw)) return { matches: raw.map(coerceMatch) };
  if (!isRecord(raw)) return {};

  const obj = lowerKeys(raw);
  const out: Record<string, unknown> = {};

  for (const key of LIST_ALIASES) {
    const v = obj[key];
    if (Array.isArray(v) && v.length > 0) {
      out.matches = v.map(coerceMatch);
      break;
    }
  }
  if (out.matches === undefined) {
    for (const key of COUNT_ALIASES) {
      const n = toNumber(obj[key]);
      if (n !== undefined) {
        out.count = n;
        break;
      }
    }
  }

  const seed = toNumber(obj.seed ?? obj.semilla);
  if (seed !== undefined) out.seed = seed;

  let winRate = toNumber(obj.winrate ?? obj.win_rate ?? obj.tasavictorias);
  if (winRate !== undefined && winRate > 1 && winRate <= 100) winRate /= 100;
  if (winRate !== undefined) out.winRate = winRate;

  const avgKills = toNumber(obj.avgkills ?? obj.avg_kills ?? obj.kills);
  if (avgKills !== undefined) out.avgKills = avgKills;
  const avgDeaths = toNumber(obj.avgdeaths ?? obj.avg_deaths ?? obj.deaths);
  if (avgDeaths !== undefined) out.avgDeaths = avgDeaths;
  const players = toNumber(obj.players ?? obj.jugadores);
  if (players !== undefined) out.players = players;
  const replace = toBool(obj.replace ?? obj.reset ?? obj.reemplazar);
  if (replace !== undefined) out.replace = replace;
  return out;
}

/** Normaliza y valida. Lanza ZodError si algo esta fuera de rango (por ejemplo count = 5000). */
export function parseSeedPayload(raw: unknown): SeedRequest {
  const normalized = normalizeSeedPayload(raw);
  const parsed = seedRequestSchema.parse(normalized);
  if (parsed.matches) return { ...parsed, count: parsed.matches.length };
  return parsed;
}

export interface SyntheticParams {
  count: number;
  seed: number;
  winRate?: number | undefined;
  avgKills?: number | undefined;
  avgDeaths?: number | undefined;
  players?: number | undefined;
}

/**
 * Partidas sinteticas deterministas. El numero de victorias es exacto (round(count * winRate)),
 * asi quien consulte la telemetria despues puede verificar el resultado esperado.
 */
export function generateSyntheticMatches(params: SyntheticParams): SyntheticMatch[] {
  const rng = createRng(params.seed);
  const winRate = params.winRate ?? 0.55;
  const avgKills = params.avgKills ?? 9;
  const avgDeaths = params.avgDeaths ?? 0.9;
  const wins = Math.round(params.count * winRate);

  const results: ('win' | 'loss')[] = [];
  for (let i = 0; i < params.count; i++) results.push(i < wins ? 'win' : 'loss');
  rng.shuffle(results);

  return results.map((result): SyntheticMatch => {
    const durationS = Math.round(result === 'win' ? rng.range(150, 290) : rng.range(60, 300));
    const playerCount = params.players ?? rng.int(1, 4);
    const players: SyntheticPlayer[] = [];
    for (let p = 0; p < playerCount; p++) {
      const survived = result === 'win' ? rng.chance(0.8) : rng.chance(0.15);
      const kills = Math.max(0, Math.round(avgKills * rng.range(0.5, 1.5)));
      let deaths = Math.min(3, Math.round(avgDeaths * rng.range(0, 2)));
      if (!survived && deaths === 0) deaths = 1;
      players.push({
        kills,
        deaths,
        damageDealt: Math.round(kills * rng.range(18, 40)),
        survivalS: survived ? durationS : Math.round(rng.range(10, durationS * 0.9)),
        survived,
      });
    }
    return {
      result,
      durationS,
      wave: Math.floor(durationS / 40) + (result === 'win' ? 3 : rng.int(0, 2)),
      players,
    };
  });
}
