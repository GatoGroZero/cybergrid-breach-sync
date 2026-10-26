import { META_UPGRADES, type MetaLevels } from '../../shared/br/adventure';
import { $, el } from './dom';
import { api, type User } from '../api';
import {
  addRun,
  buy,
  emptySave,
  hasProgress,
  loadSave,
  newest,
  nextCost,
  refundOf,
  sell,
  storeSave,
  type MetaSave,
} from './meta';

/** Luna creciente de pixeles para la esencia lunar. */
export function drawMoon(c: HTMLCanvasElement): void {
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, c.width, c.height);
  const s = c.width;
  ctx.fillStyle = '#c9fbff';
  ctx.beginPath();
  ctx.arc(s / 2, s / 2, s * 0.42, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath();
  ctx.arc(s * 0.64, s * 0.4, s * 0.38, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#73eff7';
  ctx.fillRect(Math.round(s * 0.28), Math.round(s * 0.62), 2, 2);
}

/**
 * Santuario de la luna: la tienda donde se gasta la esencia lunar. Lo comprado se guarda en la
 * cuenta (Google o correo) y en este navegador, y se avisa al servidor para que cada partida lo tome
 * en cuenta. Cada mejora se puede subir o quitar (al quitarla se devuelve su esencia).
 */
export class Shrine {
  save: MetaSave = emptySave();
  /** De quien es el progreso que se esta mostrando (cada cuenta tiene el suyo). */
  private owner = 'guest';
  /** Si la cuenta puede guardar el progreso en el servidor. */
  private remote = false;
  /** Si el servidor lo guarda de forma que sobrevive a un reinicio. */
  private durable = false;
  private pushTimer: number | null = null;
  /** Avisa las mejoras vigentes (al abrir la sesion y despues de cada compra). */
  onChange: (levels: MetaLevels) => void = () => undefined;
  onClose: () => void = () => undefined;

  private readonly root = $('shrine');
  private readonly list = $('shrine-list');

  constructor() {
    drawMoon($<HTMLCanvasElement>('shrine-moon'));
    $('shrine-close').addEventListener('click', () => this.close());
    this.root.addEventListener('click', (e) => {
      if (e.target === this.root) this.close();
    });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && !this.root.hidden) {
        e.stopImmediatePropagation();
        this.close();
      }
    });
    this.refresh();
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  open(): void {
    this.refresh();
    this.root.hidden = false;
    $('shrine-close').focus({ preventScroll: true });
  }

  close(): void {
    this.root.hidden = true;
    this.onClose();
  }

  /**
   * Cuando alguien entra: se muestra lo que hay en este navegador y, si la cuenta lo permite, se
   * junta con lo guardado en el servidor (se queda la copia mas nueva).
   */
  async attach(user: User): Promise<void> {
    this.owner = user.provider === 'guest' ? 'guest' : `u${user.id}`;
    this.remote = user.provider === 'google' || user.provider === 'email';
    this.save = loadSave(this.owner);
    this.refresh();
    this.onChange(this.save.levels);
    if (!this.remote) return;
    try {
      const { save: server, durable } = await api.progressGet();
      this.durable = durable;
      if (server) {
        const best = newest(server, this.save);
        const changed = best !== this.save;
        this.save = best;
        storeSave(this.owner, best);
        // lo de este navegador era mas nuevo: se sube
        if (!changed && best.updatedAt > server.updatedAt) this.schedulePush();
      } else if (hasProgress(this.save)) {
        this.schedulePush();
      }
    } catch {
      // sin conexion con el guardado: se sigue con la copia del navegador
    }
    this.refresh();
    this.onChange(this.save.levels);
  }

  private schedulePush(): void {
    if (!this.remote) return;
    if (this.pushTimer !== null) window.clearTimeout(this.pushTimer);
    this.pushTimer = window.setTimeout(() => {
      this.pushTimer = null;
      void this.push();
    }, 400);
  }

  private async push(): Promise<void> {
    try {
      const out = await api.progressPut(this.save);
      this.durable = out.durable;
      if (out.conflict) {
        // otra pestana o dispositivo guardo algo mas nuevo: se toma esa copia
        this.save = out.save;
        storeSave(this.owner, out.save);
        this.onChange(out.save.levels);
      }
    } catch {
      // se reintenta con el siguiente cambio
    }
    this.refresh();
  }

  private commit(next: MetaSave): void {
    this.save = next;
    storeSave(this.owner, next);
    this.refresh();
    this.schedulePush();
    this.onChange(next.levels);
  }

  /** Al terminar una partida: la esencia ganada entra a la bolsa. */
  bank(essence: number, rooms: number, won: boolean): void {
    this.save = addRun(this.save, essence, rooms, won);
    storeSave(this.owner, this.save);
    this.schedulePush();
    this.refresh();
  }

  private purchase(key: keyof MetaLevels): void {
    const next = buy(this.save, key);
    if (next) this.commit(next);
  }

  private remove(key: keyof MetaLevels): void {
    const next = sell(this.save, key);
    if (next) this.commit(next);
  }

  refresh(): void {
    $('shrine-essence').textContent = String(this.save.essence);
    $('shrine-badge').textContent = String(this.save.essence);
    $('shrine-stats').textContent =
      this.save.runs === 0
        ? 'Todavía no has explorado el bosque.'
        : `${this.save.runs} ${this.save.runs === 1 ? 'aventura' : 'aventuras'}, ${this.save.wins} ${this.save.wins === 1 ? 'victoria' : 'victorias'}. Tu mejor marcha: ${this.save.best} salas.`;
    const note = $('shrine-note');
    note.textContent = !this.remote
      ? 'Estás de invitado: tu progreso se queda solo en este navegador. Crea una cuenta para conservarlo.'
      : this.durable
        ? 'Tu progreso se guarda en tu cuenta: lo tendrás en cualquier dispositivo.'
        : 'Tu progreso se guarda en este navegador y en tu cuenta.';
    this.list.replaceChildren();
    for (const up of META_UPGRADES) {
      const level = this.save.levels[up.key];
      const cost = nextCost(this.save, up.key);
      const li = el('li', 'shrine-item');
      li.dataset.testid = `shrine-${up.key}`;
      const info = el('div');
      info.append(el('h3', '', up.name), el('p', '', up.desc));
      const pips = el('div', 'shrine-pips');
      for (let i = 0; i < up.max; i++) {
        const pip = el('i');
        pip.dataset.on = String(i < level);
        pips.append(pip);
      }
      info.append(pips);
      const b = el('button', 'btn small', cost === null ? 'Al máximo' : `Mejorar (${cost})`);
      b.type = 'button';
      b.disabled = cost === null || this.save.essence < cost;
      b.addEventListener('click', () => this.purchase(up.key));
      const back = refundOf(this.save, up.key);
      const off = el(
        'button',
        'btn small ghost',
        back === null ? 'Sin nivel' : `Quitar (+${back})`,
      );
      off.type = 'button';
      off.dataset.testid = `shrine-quitar-${up.key}`;
      off.disabled = back === null;
      off.title = 'Quita un nivel y te devuelve su esencia';
      off.addEventListener('click', () => this.remove(up.key));
      const actions = el('div', 'shrine-actions');
      actions.append(b, off);
      li.append(info, actions);
      this.list.append(li);
    }
  }
}
