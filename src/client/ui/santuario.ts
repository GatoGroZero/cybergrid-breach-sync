import { META_UPGRADES, type MetaLevels } from '../../shared/br/adventure';
import { $, el } from './dom';
import { addRun, buy, loadSave, nextCost, storeSave, type MetaSave } from './meta';

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
 * Santuario de la luna: la tienda donde se gasta la esencia lunar. Lo comprado se guarda en este
 * navegador y se avisa al servidor para que cada partida lo tome en cuenta.
 */
export class Shrine {
  save: MetaSave = loadSave();
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

  /** Al terminar una partida: la esencia ganada entra a la bolsa. */
  bank(essence: number, rooms: number, won: boolean): void {
    this.save = addRun(this.save, essence, rooms, won);
    storeSave(this.save);
    this.refresh();
  }

  private purchase(key: keyof MetaLevels): void {
    const next = buy(this.save, key);
    if (!next) return;
    this.save = next;
    storeSave(next);
    this.refresh();
    this.onChange(next.levels);
  }

  refresh(): void {
    $('shrine-essence').textContent = String(this.save.essence);
    $('shrine-badge').textContent = String(this.save.essence);
    $('shrine-stats').textContent =
      this.save.runs === 0
        ? 'Todavía no has explorado el bosque.'
        : `${this.save.runs} ${this.save.runs === 1 ? 'aventura' : 'aventuras'}, ${this.save.wins} ${this.save.wins === 1 ? 'victoria' : 'victorias'}. Tu mejor marcha: ${this.save.best} salas.`;
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
      li.append(info, b);
      this.list.append(li);
    }
  }
}
