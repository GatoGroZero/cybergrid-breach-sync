import { AMMO_MAX, INVENTORY_SLOTS } from '../../shared/br/constants';
import {
  AMMO_KINDS,
  ITEM_NAMES,
  RARITY_NAMES,
  WEAPONS,
  isAmmo,
  isWeapon,
  type Item,
} from '../../shared/br/items';
import type { Assets } from '../pixel/art';
import type { ClientBR } from '../game/state';
import { $, el } from './dom';

type Zone = 'inv' | 'loot' | 'ammo';

interface DragState {
  zone: Zone;
  index: number;
  startX: number;
  startY: number;
  active: boolean;
  ghost: HTMLElement | null;
  pointerId: number;
}

export function describeItem(item: Item): string {
  const name = ITEM_NAMES[item.kind];
  if (isWeapon(item.kind)) {
    const def = WEAPONS[item.kind];
    const dmg = def.damage[item.rarity];
    const pellets =
      def.pellets > 1
        ? ` por perdigón (${def.pellets} perdigones, usa ${def.ammoPerShot} cartuchos)`
        : '';
    return `${name} ${RARITY_NAMES[item.rarity]}: ${dmg} de daño${pellets}. ${def.auto ? 'Ráfaga automática.' : 'Un disparo por clic.'}`;
  }
  if (isAmmo(item.kind))
    return `${name}: se guardan aparte de tus 5 espacios, hasta ${AMMO_MAX} de cada arma.`;
  if (item.kind === 'medkit')
    return `Botiquín (${item.qty}): +10 de vida por segundo hasta 100. Si cambias de objeto se cancela.`;
  if (item.kind === 'shield')
    return `Escudo (${item.qty}): +5 por segundo hasta 100. Si cambias de objeto se cancela.`;
  return `Mini muro (${item.qty}): 150 de vida, se desgasta al recibir golpes. Clic para colocarlo.`;
}

/** Inventario de 5 espacios y panel de botin, con arrastrar y soltar (raton y dedo). */
export class InventoryPanel {
  private readonly root = $('inv');
  private readonly slotsEl = $('inv-slots');
  private readonly lootEl = $('loot-items');
  private drag: DragState | null = null;
  private detail = '';
  onClose: () => void = () => undefined;

  constructor(
    private readonly assets: Assets,
    private readonly game: () => ClientBR | null,
  ) {
    $('inv-close').addEventListener('click', () => this.close());
    $('loot-all').addEventListener('click', () => void this.game()?.lootTakeAll());
    this.root.addEventListener('pointerdown', (e) => {
      if (e.target === this.root) this.close();
    });
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onUp);
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  open(): void {
    this.root.hidden = false;
    this.refresh();
    $('inv-close').focus({ preventScroll: true });
  }

  close(): void {
    if (this.root.hidden) return;
    this.root.hidden = true;
    this.cancelDrag();
    this.game()?.closeLoot();
    this.onClose();
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  refresh(): void {
    if (!this.isOpen) return;
    const g = this.game();
    if (!g) return;
    this.renderSlots(this.slotsEl, g.inv, 'inv', g.me?.sel ?? 0);
    const used = g.inv.filter((i) => i !== null).length;
    $('inv-count').textContent = `${used}/${INVENTORY_SLOTS}`;
    this.renderAmmo(g);
    const block = $('loot-block');
    if (g.loot) {
      block.hidden = false;
      $('loot-title').textContent = g.loot.title;
      this.renderSlots(this.lootEl, g.loot.items, 'loot', -1);
      ($('loot-all') as HTMLButtonElement).disabled = g.loot.items.length === 0;
    } else {
      block.hidden = true;
    }
    $('inv-detail').textContent = this.detail;
  }

  private renderAmmo(g: ClientBR): void {
    const list = $('ammo-slots');
    list.replaceChildren();
    AMMO_KINDS.forEach((kind, i) => {
      const n = g.ammo[i] ?? 0;
      const li = el('li');
      const b = el('button', `ammo-chip${n === 0 ? ' empty' : ''}${n >= AMMO_MAX ? ' full' : ''}`);
      b.type = 'button';
      b.dataset.zone = 'ammo';
      b.dataset.index = String(i);
      b.dataset.testid = 'ammo-chip';
      b.setAttribute('aria-label', `${ITEM_NAMES[kind]}: ${n} de ${AMMO_MAX}`);
      const c = el('canvas');
      c.width = 16;
      c.height = 16;
      (c.getContext('2d') as CanvasRenderingContext2D).drawImage(this.assets.icon[kind], 0, 0);
      b.append(c, el('span', 'name', ITEM_NAMES[kind]), el('span', 'count', `${n}`));
      b.addEventListener('pointerdown', (e) => {
        if (n > 0 && e.button <= 0) this.beginDrag(e, 'ammo', i);
      });
      b.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this.detail = `${ITEM_NAMES[kind]}: ${n} de ${AMMO_MAX}. Arrástralas afuera para tirarlas.`;
          this.refresh();
        }
      });
      li.append(b);
      list.append(li);
    });
  }

  private renderSlots(
    list: HTMLElement,
    items: readonly (Item | null)[],
    zone: Zone,
    selected: number,
  ): void {
    list.replaceChildren();
    const count = zone === 'inv' ? INVENTORY_SLOTS : Math.max(items.length, 1);
    for (let i = 0; i < count; i++) {
      const item = items[i] ?? null;
      const li = el('li');
      const b = el(
        'button',
        `slot${item ? '' : ' empty'}${item ? ` r${item.rarity}` : ''}${i === selected ? ' sel' : ''}`,
      );
      b.type = 'button';
      b.dataset.zone = zone;
      b.dataset.index = String(i);
      b.dataset.testid = zone === 'inv' ? 'inv-slot' : 'loot-slot';
      if (item) {
        b.setAttribute(
          'aria-label',
          `${ITEM_NAMES[item.kind]} ${RARITY_NAMES[item.rarity]}, cantidad ${item.qty}`,
        );
        const c = el('canvas');
        c.width = 16;
        c.height = 16;
        (c.getContext('2d') as CanvasRenderingContext2D).drawImage(
          this.assets.icon[item.kind],
          0,
          0,
        );
        b.append(c);
        if (item.qty > 1) b.append(el('span', 'qty', String(item.qty)));
        if (isAmmo(item.kind))
          b.append(el('span', 'cap', ITEM_NAMES[item.kind].replace('Balas de ', '')));
      } else {
        b.setAttribute('aria-label', zone === 'inv' ? `Espacio ${i + 1} vacío` : 'Vacío');
        b.disabled = zone === 'loot';
      }
      if (zone === 'inv') b.append(el('span', 'num', String(i + 1)));
      b.addEventListener('pointerdown', (e) => this.onDown(e, zone, i, item));
      b.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this.activate(zone, i, item);
        }
      });
      li.append(b);
      list.append(li);
    }
  }

  private activate(zone: Zone, index: number, item: Item | null): void {
    const g = this.game();
    if (!g) return;
    if (zone === 'inv') {
      g.select(index);
      this.detail = item ? describeItem(item) : '';
      this.refresh();
    } else if (item) {
      void g.lootTake(index);
    }
  }

  // ------------------------------------------------------------------ arrastrar

  private onDown(e: PointerEvent, zone: Zone, index: number, item: Item | null): void {
    if (!item || e.button > 0) return;
    this.beginDrag(e, zone, index);
  }

  private beginDrag(e: PointerEvent, zone: Zone, index: number): void {
    this.drag = {
      zone,
      index,
      startX: e.clientX,
      startY: e.clientY,
      active: false,
      ghost: null,
      pointerId: e.pointerId,
    };
  }

  private readonly onMove = (e: PointerEvent): void => {
    const d = this.drag;
    if (!d || e.pointerId !== d.pointerId) return;
    if (!d.active && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > 8) {
      d.active = true;
      const g = this.game();
      const kind =
        d.zone === 'ammo'
          ? AMMO_KINDS[d.index]
          : (d.zone === 'inv' ? g?.inv[d.index] : g?.loot?.items[d.index])?.kind;
      if (!kind) {
        this.cancelDrag();
        return;
      }
      const ghost = el('div', 'drag-ghost');
      const c = el('canvas');
      c.width = 16;
      c.height = 16;
      (c.getContext('2d') as CanvasRenderingContext2D).drawImage(this.assets.icon[kind], 0, 0);
      ghost.append(c);
      document.body.append(ghost);
      d.ghost = ghost;
    }
    if (d.active && d.ghost) {
      d.ghost.style.left = `${e.clientX}px`;
      d.ghost.style.top = `${e.clientY}px`;
      this.root.querySelectorAll('.drop-target').forEach((n) => n.classList.remove('drop-target'));
      const over = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('.slot');
      if (over && over.dataset.zone === 'inv') over.classList.add('drop-target');
    }
  };

  private readonly onUp = (e: PointerEvent): void => {
    const d = this.drag;
    if (!d || e.pointerId !== d.pointerId) return;
    const g = this.game();
    this.drag = null;
    d.ghost?.remove();
    this.root.querySelectorAll('.drop-target').forEach((n) => n.classList.remove('drop-target'));
    if (!g) return;
    if (!d.active) {
      if (d.zone === 'ammo') {
        const kind = AMMO_KINDS[d.index];
        if (kind)
          this.detail = `${ITEM_NAMES[kind]}: ${g.ammo[d.index] ?? 0} de ${AMMO_MAX}. Arrástralas afuera para tirarlas.`;
        this.refresh();
        return;
      }
      const item = d.zone === 'inv' ? g.inv[d.index] : g.loot?.items[d.index];
      this.activate(d.zone, d.index, item ?? null);
      return;
    }
    const target = document.elementFromPoint(e.clientX, e.clientY);
    const slot = target?.closest<HTMLElement>('.slot');
    const card = target?.closest('.inv-card');
    if (d.zone === 'ammo') {
      const kind = AMMO_KINDS[d.index];
      if (kind && !card) g.dropAmmo(kind);
    } else if (slot && slot.dataset.zone === 'inv') {
      const to = Number(slot.dataset.index);
      if (d.zone === 'inv') {
        if (to !== d.index) g.moveItem(d.index, to);
      } else {
        void g.lootTake(d.index, to);
      }
    } else if (!card && d.zone === 'inv') {
      g.dropItem(d.index);
    } else if (!card && d.zone === 'loot') {
      void g.lootTake(d.index);
    }
    window.setTimeout(() => this.refresh(), 60);
  };

  private cancelDrag(): void {
    this.drag?.ghost?.remove();
    this.drag = null;
  }
}
