import { parseSave, emptySave, type MetaSave } from '../../shared/br/progress';

export {
  addRun,
  buy,
  emptySave,
  hasProgress,
  newest,
  nextCost,
  parseSave,
  refundOf,
  sell,
} from '../../shared/br/progress';
export type { MetaSave } from '../../shared/br/progress';

/**
 * Copia del progreso de la Aventura en este navegador. Cada cuenta tiene la suya (para que dos
 * personas que comparten la computadora no se mezclen); los invitados comparten una.
 */
const LEGACY = 'cg_meta_v1';
const keyFor = (owner: string): string => `cg_meta_v2:${owner}`;

export function loadSave(owner: string): MetaSave {
  try {
    const own = window.localStorage.getItem(keyFor(owner));
    if (own) return parseSave(JSON.parse(own));
    // la copia de antes (una sola para todos) la hereda quien entre primero a esta version
    const old = window.localStorage.getItem(LEGACY);
    if (!old) return emptySave();
    const inherited = parseSave(JSON.parse(old));
    window.localStorage.setItem(keyFor(owner), JSON.stringify(inherited));
    window.localStorage.removeItem(LEGACY);
    return inherited;
  } catch {
    return emptySave();
  }
}

export function storeSave(owner: string, save: MetaSave): void {
  try {
    window.localStorage.setItem(keyFor(owner), JSON.stringify(save));
  } catch {
    // sin almacenamiento: el progreso dura lo que dure la pestana
  }
}
