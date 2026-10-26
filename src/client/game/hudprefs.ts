/**
 * Tamano de las partes del HUD a gusto de cada quien: unos las quieren mas chicas y otros mas grandes.
 * Cada valor es una escala (1 = el tamano de siempre) que se guarda en el navegador.
 */
export interface HudPrefs {
  /** Mensajes y carteles que salen en pantalla. */
  msg: number;
  /** Barra de vida del jefe y su nombre. */
  boss: number;
  /** Vida, escudo y estamina del gato (y su armadura en la Aventura). */
  bars: number;
  /** Panel de arriba: vidas del grupo, sala o gatos vivos, y el reloj del cielo. */
  top: number;
}

export const HUD_DEFAULTS: HudPrefs = { msg: 1, boss: 1, bars: 1, top: 1 };
export const HUD_MIN = 0.5;
export const HUD_MAX = 1.6;
export const HUD_KEYS = ['msg', 'boss', 'bars', 'top'] as const;
export const HUD_LABELS: Record<keyof HudPrefs, string> = {
  msg: 'Mensajes y carteles',
  boss: 'Barra del jefe',
  bars: 'Vida, escudo y estamina',
  top: 'Panel de arriba (vidas y sala)',
};

const KEY = 'cg_hud';

/** Una escala valida: entre el minimo y el maximo, en pasos de 5 %. */
export function clampScale(v: unknown, fallback = 1): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.min(HUD_MAX, Math.max(HUD_MIN, Math.round(v * 20) / 20));
}

/** Lee lo guardado ignorando lo que no sea un numero; lo demas queda en el tamano de siempre. */
export function parseHudPrefs(raw: unknown): HudPrefs {
  const out: HudPrefs = { ...HUD_DEFAULTS };
  if (typeof raw !== 'object' || raw === null) return out;
  for (const key of HUD_KEYS) out[key] = clampScale((raw as Record<string, unknown>)[key], 1);
  return out;
}

export function loadHudPrefs(): HudPrefs {
  try {
    return parseHudPrefs(JSON.parse(window.localStorage.getItem(KEY) ?? 'null'));
  } catch {
    return { ...HUD_DEFAULTS };
  }
}

export function saveHudPrefs(prefs: HudPrefs): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // sin almacenamiento
  }
}

/** Las preferencias en uso: los ajustes las cambian en vivo y el HUD las lee en cada cuadro. */
export const hudPrefs: HudPrefs =
  typeof window === 'undefined' ? { ...HUD_DEFAULTS } : loadHudPrefs();

/** Dibuja `draw` escalado `k` veces alrededor del punto (ax, ay), que se queda donde esta. */
export function withScale(
  ctx: CanvasRenderingContext2D,
  ax: number,
  ay: number,
  k: number,
  draw: () => void,
): void {
  if (Math.abs(k - 1) < 0.01) {
    draw();
    return;
  }
  ctx.save();
  ctx.translate(ax, ay);
  ctx.scale(k, k);
  ctx.translate(-ax, -ay);
  draw();
  ctx.restore();
}
