import { META_UPGRADES, NO_META, clampMeta, type MetaLevels } from '../../shared/br/adventure';

/**
 * Progreso permanente de la Aventura. Se guarda en este navegador (el disco del servidor gratis no
 * dura): la esencia lunar que dejan las partidas se gasta en mejoras en el Santuario.
 */
export interface MetaSave {
  levels: MetaLevels;
  /** Esencia lunar sin gastar. */
  essence: number;
  /** Partidas jugadas, victorias y la mejor cantidad de salas superadas. */
  runs: number;
  wins: number;
  best: number;
}

const KEY = 'cg_meta_v1';

export const emptySave = (): MetaSave => ({
  levels: { ...NO_META },
  essence: 0,
  runs: 0,
  wins: 0,
  best: 0,
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
  };
}

export function loadSave(): MetaSave {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? parseSave(JSON.parse(raw)) : emptySave();
  } catch {
    return emptySave();
  }
}

export function storeSave(save: MetaSave): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(save));
  } catch {
    // sin almacenamiento: el progreso dura lo que dure la pestana
  }
}

/** Costo del siguiente nivel de una mejora, o null si ya esta al maximo. */
export function nextCost(save: MetaSave, key: keyof MetaLevels): number | null {
  const up = META_UPGRADES.find((u) => u.key === key);
  if (!up) return null;
  const level = save.levels[key];
  return level >= up.max ? null : (up.costs[level] ?? null);
}

/** Compra un nivel si alcanza la esencia. Devuelve la partida nueva o null si no se pudo. */
export function buy(save: MetaSave, key: keyof MetaLevels): MetaSave | null {
  const cost = nextCost(save, key);
  if (cost === null || save.essence < cost) return null;
  return {
    ...save,
    essence: save.essence - cost,
    levels: { ...save.levels, [key]: save.levels[key] + 1 },
  };
}

/** Suma lo que dejo una partida: esencia, partidas jugadas y record. */
export function addRun(save: MetaSave, essence: number, rooms: number, won: boolean): MetaSave {
  return {
    ...save,
    essence: num(save.essence + Math.max(0, Math.floor(essence))),
    runs: save.runs + 1,
    wins: save.wins + (won ? 1 : 0),
    best: Math.max(save.best, rooms),
  };
}
