import { META_UPGRADES, NO_META, clampMeta, type MetaLevels } from './adventure';

/**
 * Progreso permanente de la Aventura: la esencia lunar que dejan las partidas, lo que se compro en
 * el Santuario y las marcas. Se guarda en el servidor por cuenta (y en el navegador como copia).
 */
export interface MetaSave {
  levels: MetaLevels;
  /** Esencia lunar sin gastar. */
  essence: number;
  /** Partidas jugadas, victorias y la mejor cantidad de salas superadas. */
  runs: number;
  wins: number;
  best: number;
  /** Cuando cambio por ultima vez (milisegundos): la copia mas nueva gana al sincronizar. */
  updatedAt: number;
}

export const emptySave = (): MetaSave => ({
  levels: { ...NO_META },
  essence: 0,
  runs: 0,
  wins: 0,
  best: 0,
  updatedAt: 0,
});

const num = (v: unknown, max = 1_000_000): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(max, Math.floor(v))) : 0;

/** Lee y limpia lo guardado (si esta danado o no existe, se empieza de cero). */
export function parseSave(raw: unknown): MetaSave {
  if (typeof raw !== 'object' || raw === null) return emptySave();
  const r = raw as Record<string, unknown>;
  return {
    levels: clampMeta(r.levels),
    essence: num(r.essence),
    runs: num(r.runs, 100_000),
    wins: num(r.wins, 100_000),
    best: num(r.best, 100),
    updatedAt: num(r.updatedAt, 8_000_000_000_000),
  };
}

/** Si ya hay algo que conservar (si no, da igual cual copia se use). */
export const hasProgress = (s: MetaSave): boolean =>
  s.essence > 0 || s.runs > 0 || META_UPGRADES.some((u) => s.levels[u.key] > 0);

/** Costo del siguiente nivel de una mejora, o null si ya esta al maximo. */
export function nextCost(save: MetaSave, key: keyof MetaLevels): number | null {
  const up = META_UPGRADES.find((u) => u.key === key);
  if (!up) return null;
  const level = save.levels[key];
  return level >= up.max ? null : (up.costs[level] ?? null);
}

/** Cuanta esencia devuelve quitar el nivel actual de una mejora, o null si esta en cero. */
export function refundOf(save: MetaSave, key: keyof MetaLevels): number | null {
  const up = META_UPGRADES.find((u) => u.key === key);
  const level = save.levels[key];
  if (!up || level <= 0) return null;
  return up.costs[level - 1] ?? null;
}

const touch = (s: MetaSave, now: number): MetaSave => ({ ...s, updatedAt: now });

/** Compra un nivel si alcanza la esencia. Devuelve la partida nueva o null si no se pudo. */
export function buy(save: MetaSave, key: keyof MetaLevels, now = Date.now()): MetaSave | null {
  const cost = nextCost(save, key);
  if (cost === null || save.essence < cost) return null;
  return touch(
    {
      ...save,
      essence: save.essence - cost,
      levels: { ...save.levels, [key]: save.levels[key] + 1 },
    },
    now,
  );
}

/** Quita un nivel y devuelve su esencia completa: asi se puede volver a comprar cuando se quiera. */
export function sell(save: MetaSave, key: keyof MetaLevels, now = Date.now()): MetaSave | null {
  const back = refundOf(save, key);
  if (back === null) return null;
  return touch(
    {
      ...save,
      essence: num(save.essence + back),
      levels: { ...save.levels, [key]: save.levels[key] - 1 },
    },
    now,
  );
}

/** Suma lo que dejo una partida: esencia, partidas jugadas y record. */
export function addRun(
  save: MetaSave,
  essence: number,
  rooms: number,
  won: boolean,
  now = Date.now(),
): MetaSave {
  return touch(
    {
      ...save,
      essence: num(save.essence + Math.max(0, Math.floor(essence))),
      runs: save.runs + 1,
      wins: save.wins + (won ? 1 : 0),
      best: Math.max(save.best, rooms),
    },
    now,
  );
}

/** La copia que se queda al juntar la del servidor con la de este navegador: la mas nueva. */
export function newest(a: MetaSave, b: MetaSave): MetaSave {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? a : b;
  return hasProgress(a) || !hasProgress(b) ? a : b;
}
