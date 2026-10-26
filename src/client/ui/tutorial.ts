import type { Action } from '../game/input';
import { $, el } from './dom';
import { tutorialSections, type TutorialSection } from './tutorial-data';

/** Lo que el panel necesita de afuera: las teclas del jugador y un dibujito por cada tema. */
export interface TutorialDeps {
  keys: () => Record<Action, string>;
  icon: (name: TutorialSection['icon']) => HTMLCanvasElement | null;
  /** Avisa que se abrio o cerro, para pausar o devolver el control del juego. */
  onToggle: (open: boolean) => void;
}

/**
 * El tutorial de la Aventura: una ventana con un dibujito y unas lineas por tema. Solo se abre
 * cuando el jugador lo pide (al accionar el cartel) y se cierra con el boton, la X, Escape,
 * tocando afuera o volviendo a accionar el cartel.
 */
export class Tutorial {
  private readonly root = $('tutorial');
  private readonly body = $('tutorial-body');
  /** Hasta cuando se ignoran los toques (solo si se abrio con el dedo). */
  private guardUntil = 0;

  constructor(private readonly deps: TutorialDeps) {
    $('tutorial-close').addEventListener('click', () => this.closeByTap());
    $('tutorial-x').addEventListener('click', () => this.closeByTap());
    this.root.addEventListener('click', (e) => {
      if (e.target === this.root) this.closeByTap();
    });
    window.addEventListener(
      'keydown',
      (e) => {
        if (this.isOpen && e.code === 'Escape') {
          e.preventDefault();
          e.stopImmediatePropagation();
          this.close();
        }
      },
      true,
    );
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  open(viaTouch = false): void {
    if (this.isOpen) return;
    this.render();
    this.body.scrollTop = 0;
    this.guardUntil = viaTouch ? performance.now() + 500 : 0;
    this.root.hidden = false;
    this.deps.onToggle(true);
    $('tutorial-close').focus({ preventScroll: true });
  }

  /**
   * Cierre por un toque o clic. En el celular el toque que abre el cartel termina en un "click" sobre
   * lo que haya quedado bajo el dedo (el fondo o el boton de cerrar): si se abrio con el dedo se
   * ignora el primer instante para que el tutorial no se cierre al nacer.
   */
  private closeByTap(): void {
    if (performance.now() < this.guardUntil) return;
    this.close();
  }

  close(): void {
    if (!this.isOpen) return;
    this.root.hidden = true;
    this.deps.onToggle(false);
  }

  toggle(viaTouch = false): void {
    if (this.isOpen) this.close();
    else this.open(viaTouch);
  }

  private render(): void {
    this.body.replaceChildren();
    for (const section of tutorialSections(this.deps.keys())) {
      const card = el('section', 'tut-card');
      const head = el('div', 'tut-head');
      const icon = this.deps.icon(section.icon);
      if (icon) {
        const c = el('canvas', 'tut-icon');
        c.width = icon.width;
        c.height = icon.height;
        (c.getContext('2d') as CanvasRenderingContext2D).drawImage(icon, 0, 0);
        c.setAttribute('aria-hidden', 'true');
        head.append(c);
      }
      head.append(el('h3', '', section.title));
      const list = el('ul', 'tut-list');
      for (const line of section.lines) list.append(el('li', '', line));
      card.append(head, list);
      this.body.append(card);
    }
  }
}
