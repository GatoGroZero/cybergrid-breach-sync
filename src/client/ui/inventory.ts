import { AMMO_MAX, INVENTORY_SLOTS } from '../../shared/br/constants';
import { POWERS, RELICS } from '../../shared/br/adventure';
import {
  AMMO_KINDS,
  ITEM_NAMES,
  RARITY_COLORS,
  WEAPONS,
  isAmmo,
  isWeapon,
  type ArmorKind,
  type Item,
  type ItemKind,
} from '../../shared/br/items';
import {
  ammoInfo,
  armorInfo,
  clawsInfo,
  itemInfo,
  powerInfo,
  type Info,
} from '../../shared/br/iteminfo';
import type { Assets } from '../pixel/art';
import { armorIcon, powerIcon, relicIcon } from '../pixel/art-items';
import { keyLabel } from '../game/input';
import type { ClientBR } from '../game/state';
import { $, el, toast } from './dom';

type Zone = 'inv' | 'loot' | 'ammo';
type Tab = 'bolsa' | 'habilidades' | 'equipo';

/** Lo que se esta mirando: el detalle de la derecha cuenta de que se trata y que se puede hacer. */
type Pick =
  | { t: 'slot'; i: number }
  | { t: 'loot'; i: number }
  | { t: 'ammo'; i: number }
  | { t: 'power'; i: number }
  | { t: 'armor'; slot: number }
  | { t: 'relic'; id: number };

interface DragState {
  zone: Zone;
  index: number;
  startX: number;
  startY: number;
  active: boolean;
  ghost: HTMLElement | null;
  pointerId: number;
}

const ARMOR_KINDS: readonly ArmorKind[] = ['armor_head', 'armor_body', 'armor_paws'];
const SLOT_LABELS = ['Cabeza', 'Cuerpo', 'Patas'] as const;

const ARMOR_ERRORS: Record<string, string> = {
  muy_lejos: 'Está muy lejos: acércate a tu compañero',
  ya_lleva_igual_o_mejor: 'Esa persona ya lleva una pieza igual o mejor',
  sin_armadura: 'Ya no llevas esa pieza',
  sin_companero: 'Esa persona no puede recibirla ahora',
};

/** Las balas elegidas: lo que llevas se muestra aparte y en vivo (junto a la cantidad a tirar). */
const ammoChipInfo = (kind: (typeof AMMO_KINDS)[number]): Info => {
  const info = ammoInfo(kind, 0);
  return { ...info, stats: info.stats.filter(([label]) => label !== 'Llevas') };
};

const pickKey = (p: Pick | null): string => {
  if (!p) return '';
  switch (p.t) {
    case 'armor':
      return `armor:${p.slot}`;
    case 'relic':
      return `relic:${p.id}`;
    default:
      return `${p.t}:${p.i}`;
  }
};

/** Inventario con detalle al lado, pestañas de Aventura y arrastrar y soltar (raton y dedo). */
export class InventoryPanel {
  private readonly root = $('inv');
  private readonly slotsEl = $('inv-slots');
  private readonly lootEl = $('loot-items');
  private readonly detailEl = $('inv-detail');
  private drag: DragState | null = null;
  private tab: Tab = 'bolsa';
  private pick: Pick | null = null;
  private hover: Pick | null = null;
  private detailSig = '';
  private tabSig = '';
  /** Cantidad que se va a tirar de las balas elegidas (se conserva mientras se tecla). */
  private dropQty = 0;
  private dropKey = '';
  /** Pedazos del detalle de balas que se actualizan sin reconstruir (para no perder el foco). */
  private ammoUi: {
    kind: (typeof AMMO_KINDS)[number];
    have: HTMLElement;
    input: HTMLInputElement;
    go: HTMLButtonElement;
    presets: { b: HTMLButtonElement; n: () => number }[];
  } | null = null;
  private timer: number | null = null;
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
    for (const b of document.querySelectorAll<HTMLButtonElement>('#inv-tabs [data-tab]'))
      b.addEventListener('click', () => this.setTab(b.dataset.tab as Tab));
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onUp);
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  open(): void {
    this.root.hidden = false;
    this.tab = 'bolsa';
    this.pick = null;
    this.hover = null;
    this.detailSig = '';
    this.tabSig = '';
    this.refresh();
    $('inv-close').focus({ preventScroll: true });
    // las esperas de las habilidades y la armadura cambian solas: se vigilan mientras esta abierto
    if (this.timer === null) this.timer = window.setInterval(() => this.tick(), 400);
  }

  close(): void {
    if (this.root.hidden) return;
    this.root.hidden = true;
    this.cancelDrag();
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    this.game()?.closeLoot();
    this.onClose();
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  private setTab(tab: Tab): void {
    if (tab === this.tab) return;
    this.tab = tab;
    this.pick = null;
    this.hover = null;
    this.detailSig = '';
    this.tabSig = '';
    this.refresh();
  }

  /** Cada 0.4 s: pone al dia lo que cambia solo (esperas, armadura puesta) sin tocar lo que se teclea. */
  private tick(): void {
    if (!this.isOpen) return;
    const g = this.game();
    if (!g) return;
    if (this.tab !== 'bolsa') this.renderTab(g);
    if (this.tab === 'habilidades') this.updateCooldowns(g);
  }

  refresh(): void {
    if (!this.isOpen) return;
    const g = this.game();
    if (!g) return;
    const adv = g.mode === 'aventura';
    $('inv-tabs').hidden = !adv;
    if (!adv) this.tab = 'bolsa';
    for (const b of document.querySelectorAll<HTMLButtonElement>('#inv-tabs [data-tab]'))
      b.setAttribute('aria-selected', String(b.dataset.tab === this.tab));
    for (const pane of document.querySelectorAll<HTMLElement>('#inv-panes [data-pane]'))
      pane.hidden = pane.dataset.pane !== this.tab;

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
    this.renderTab(g);
    $('inv-hint').textContent = this.hintText(g);
    this.renderDetail(g);
  }

  private hintText(g: ClientBR): string {
    const drop =
      g.input.mode === 'touch'
        ? ''
        : ` ${keyLabel(g.input.keys.drop).toUpperCase()} tira lo que llevas en la mano; Mayús + ${keyLabel(g.input.keys.drop).toUpperCase()}, la mitad de sus balas.`;
    return `Toca algo para ver qué hace. Arrastra para ordenar y suelta fuera de la tarjeta para tirar.${drop}`;
  }

  // ------------------------------------------------------------------ mochila

  private renderAmmo(g: ClientBR): void {
    const list = $('ammo-slots');
    list.replaceChildren();
    const sel = this.current();
    AMMO_KINDS.forEach((kind, i) => {
      const n = g.ammo[i] ?? 0;
      const li = el('li');
      const b = el(
        'button',
        `ammo-chip${n === 0 ? ' empty' : ''}${n >= AMMO_MAX ? ' full' : ''}${sel?.t === 'ammo' && sel.i === i ? ' sel' : ''}`,
      );
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
      b.addEventListener('pointerenter', (e) => this.setHover(e, { t: 'ammo', i }));
      b.addEventListener('pointerleave', () => this.setHover(null, null));
      b.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this.choose({ t: 'ammo', i });
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
    const sel = this.current();
    for (let i = 0; i < count; i++) {
      const item = items[i] ?? null;
      const li = el('li');
      const picked = zone === 'inv' && sel?.t === 'slot' && sel.i === i;
      const b = el(
        'button',
        `slot${item ? '' : ' empty'}${item ? ` r${item.rarity}` : ''}${i === selected ? ' sel' : ''}${picked ? ' picked' : ''}`,
      );
      b.type = 'button';
      b.dataset.zone = zone;
      b.dataset.index = String(i);
      b.dataset.testid = zone === 'inv' ? 'inv-slot' : 'loot-slot';
      if (item) {
        b.setAttribute(
          'aria-label',
          `${ITEM_NAMES[item.kind]} ${['común', 'normal', 'épica'][item.rarity]}, cantidad ${item.qty}`,
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
      if (item) {
        b.addEventListener('pointerenter', (e) =>
          this.setHover(e, { t: zone === 'inv' ? 'slot' : 'loot', i }),
        );
        b.addEventListener('pointerleave', () => this.setHover(null, null));
      }
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

  /** Pasar el raton por encima muestra el detalle sin cambiar lo elegido (no aplica a los dedos). */
  private setHover(e: PointerEvent | null, pick: Pick | null): void {
    if (e && e.pointerType !== 'mouse') return;
    if (this.drag?.active) return;
    this.hover = pick;
    const g = this.game();
    if (g) this.renderDetail(g);
  }

  private activate(zone: Zone, index: number, item: Item | null): void {
    const g = this.game();
    if (!g) return;
    if (zone === 'inv') {
      g.select(index);
      this.choose({ t: 'slot', i: index });
    } else if (item) {
      void g.lootTake(index);
    }
  }

  private choose(pick: Pick): void {
    this.pick = pick;
    this.hover = null;
    this.refresh();
  }

  /** Lo que se esta mostrando ahora: lo que apunta el raton, lo elegido o lo que llevas en la mano. */
  private current(): Pick | null {
    if (this.hover) return this.hover;
    if (this.pick) return this.pick;
    const g = this.game();
    // cada pestana empieza mostrando lo primero que hay en ella
    if (this.tab === 'habilidades' && g?.adv?.powers[0]) return { t: 'power', i: 0 };
    if (this.tab === 'equipo' && g?.adv) {
      const slot = g.adv.equip.findIndex((t) => t >= 0);
      if (slot >= 0) return { t: 'armor', slot };
      const relic = g.adv.relics[0];
      if (relic !== undefined) return { t: 'relic', id: relic };
    }
    return g?.me ? { t: 'slot', i: g.me.sel } : null;
  }

  // ------------------------------------------------------------------ pestanas de la Aventura

  private renderTab(g: ClientBR): void {
    const adv = g.adv;
    if (g.mode !== 'aventura' || !adv) return;
    const sig = JSON.stringify([
      this.tab,
      pickKey(this.pick),
      adv.equip,
      adv.relics,
      adv.powers.map((p) => [p[0], p[1]]),
      g.mates.map((m) => [m[0], m[1] > 0]),
    ]);
    if (sig === this.tabSig) return;
    this.tabSig = sig;
    if (this.tab === 'habilidades') this.renderPowers(g);
    else if (this.tab === 'equipo') this.renderGear(g);
  }

  private row(
    icon: HTMLCanvasElement | null,
    title: string,
    sub: string,
    color: string,
    on: boolean,
    pick: Pick,
    cd = '',
  ): HTMLLIElement {
    const li = el('li');
    const b = el('button', `inv-row${on ? ' picked' : ''}`);
    b.type = 'button';
    b.dataset.testid = `row-${pickKey(pick)}`;
    if (icon) {
      const c = el('canvas');
      c.width = icon.width;
      c.height = icon.height;
      (c.getContext('2d') as CanvasRenderingContext2D).drawImage(icon, 0, 0);
      b.append(c);
    } else {
      b.append(el('span', 'ph'));
    }
    const text = el('span', 'txt');
    const name = el('strong', '', title);
    name.style.color = color;
    text.append(name, el('span', 'sub', sub));
    b.append(text);
    if (cd) {
      const c = el('span', 'cd', cd);
      c.dataset.cd = '1';
      b.append(c);
    }
    b.addEventListener('click', () => this.choose(pick));
    li.append(b);
    return li;
  }

  private renderPowers(g: ClientBR): void {
    const list = $('inv-powers');
    list.replaceChildren();
    const powers = g.adv?.powers ?? [];
    const sel = this.current();
    for (let i = 0; i < 3; i++) {
      const p = powers[i];
      const def = p ? POWERS[p[0]] : null;
      if (!p || !def) {
        const li = el('li');
        li.append(
          el('div', 'inv-row empty', 'Casilla libre: derrota a un jefe para ganar una habilidad'),
        );
        list.append(li);
        continue;
      }
      list.append(
        this.row(
          powerIcon(p[0]),
          def.name,
          `Nivel ${p[1]} · ${def.desc}`,
          '#73eff7',
          sel?.t === 'power' && sel.i === i,
          { t: 'power', i },
          this.cooldownText(p),
        ),
      );
    }
    this.updateCooldowns(g);
  }

  private cooldownText(p: [number, number, number, number]): string {
    if (p[3] > 0.05) return `Activa ${Math.ceil(p[3])} s`;
    if (p[2] > 0.05) return `En ${Math.ceil(p[2])} s`;
    return 'Lista';
  }

  /** Cambia solo el texto de espera (sin reconstruir las filas). */
  private updateCooldowns(g: ClientBR): void {
    const powers = g.adv?.powers ?? [];
    const cds = [...$('inv-powers').querySelectorAll<HTMLElement>('[data-cd]')];
    cds.forEach((n, i) => {
      const p = powers[i];
      if (p) n.textContent = this.cooldownText(p);
    });
  }

  private renderGear(g: ClientBR): void {
    const adv = g.adv;
    if (!adv) return;
    const sel = this.current();
    const armor = $('inv-armor');
    armor.replaceChildren();
    for (let slot = 0; slot < 3; slot++) {
      const tier = adv.equip[slot as 0 | 1 | 2];
      const kind = ARMOR_KINDS[slot] as ArmorKind;
      if (tier < 0) {
        const li = el('li');
        const d = el('div', 'inv-row empty');
        d.append(el('strong', '', SLOT_LABELS[slot]), el('span', 'sub', ' sin pieza puesta'));
        li.append(d);
        armor.append(li);
        continue;
      }
      const info = armorInfo(slot, tier);
      armor.append(
        this.row(
          armorIcon(kind, tier),
          info.name,
          info.stats.map(([a, b]) => `${a} ${b}`).join(' · '),
          info.color,
          sel?.t === 'armor' && sel.slot === slot,
          { t: 'armor', slot },
        ),
      );
    }
    const relics = $('inv-relics');
    relics.replaceChildren();
    const counts = new Map<number, number>();
    for (const id of adv.relics) counts.set(id, (counts.get(id) ?? 0) + 1);
    if (counts.size === 0) {
      const li = el('li');
      li.append(el('div', 'inv-row empty', 'Aún no tienes reliquias: las eliges al superar salas'));
      relics.append(li);
    }
    for (const [id, n] of counts) {
      const def = RELICS[id];
      if (!def) continue;
      relics.append(
        this.row(
          relicIcon(id),
          n > 1 ? `${def.name} x${n}` : def.name,
          def.desc,
          RARITY_COLORS[1],
          sel?.t === 'relic' && sel.id === id,
          { t: 'relic', id },
        ),
      );
    }
  }

  // ------------------------------------------------------------------ detalle

  private iconFor(kind: ItemKind): HTMLCanvasElement {
    return this.assets.icon[kind];
  }

  /** La ficha de lo que se esta mirando: icono, datos, para que sirve y lo que se puede hacer. */
  private describe(
    g: ClientBR,
    p: Pick,
  ): {
    info: Info;
    icon: HTMLCanvasElement | null;
    sig: string;
    actions: (box: HTMLElement) => void;
  } | null {
    const noActions = (): void => undefined;
    const territory = g.mode === 'territorio';
    switch (p.t) {
      case 'slot': {
        const item = g.inv[p.i] ?? null;
        if (!item)
          return {
            info: clawsInfo(),
            icon: null,
            sig: `claws:${p.i}`,
            actions: noActions,
          };
        const have = isWeapon(item.kind) ? g.ammoOf(WEAPONS[item.kind].ammo) : 0;
        return {
          info: itemInfo(item, have, territory),
          icon: this.iconFor(item.kind),
          sig: `slot:${p.i}:${item.kind}:${item.rarity}:${item.qty}:${item.mag ?? ''}:${have}`,
          actions: (box) => this.slotActions(g, box, p.i, item),
        };
      }
      case 'loot': {
        const item = g.loot?.items[p.i];
        if (!item) return null;
        const have = isWeapon(item.kind) ? g.ammoOf(WEAPONS[item.kind].ammo) : 0;
        return {
          info: itemInfo(item, have, territory),
          icon: this.iconFor(item.kind),
          sig: `loot:${p.i}:${item.kind}:${item.rarity}:${item.qty}`,
          actions: (box) => {
            this.act(box, 'Tomar', () => void g.lootTake(p.i), 'primary');
          },
        };
      }
      case 'ammo': {
        const kind = AMMO_KINDS[p.i];
        if (!kind) return null;
        return {
          info: ammoChipInfo(kind),
          icon: this.iconFor(kind),
          sig: `ammo:${p.i}`,
          actions: (box) => this.ammoActions(g, box, p.i),
        };
      }
      case 'power': {
        const pw = g.adv?.powers[p.i];
        const def = pw ? POWERS[pw[0]] : null;
        if (!pw || !def) return null;
        const key =
          g.input.mode === 'touch'
            ? `botón de habilidad ${p.i + 1}`
            : keyLabel(g.input.keys[`power${p.i + 1}` as 'power1']).toUpperCase();
        return {
          info: powerInfo(def, pw[1], key),
          icon: powerIcon(pw[0]),
          sig: `power:${p.i}:${pw[0]}:${pw[1]}:${key}`,
          actions: noActions,
        };
      }
      case 'armor': {
        const tier = g.adv?.equip[p.slot as 0 | 1 | 2] ?? -1;
        if (tier < 0) return null;
        const mates = g.mates.filter((m) => g.cats.get(m[0]) && !g.cats.get(m[0])?.bot);
        return {
          info: armorInfo(p.slot, tier),
          icon: armorIcon(ARMOR_KINDS[p.slot] as ArmorKind, tier),
          sig: `armor:${p.slot}:${tier}:${mates.map((m) => `${m[0]}${m[1] > 0 ? 'v' : 'x'}`).join('')}`,
          actions: (box) => this.armorActions(g, box, p.slot, mates),
        };
      }
      default: {
        const def = RELICS[p.id];
        if (!def) return null;
        return {
          info: {
            name: def.name,
            sub: 'Reliquia · dura toda la aventura',
            color: RARITY_COLORS[1],
            stats: [],
            text: `${def.desc}. Si te ofrecen la misma otra vez, el efecto se suma.`,
          },
          icon: relicIcon(p.id),
          sig: `relic:${p.id}:${g.adv?.relics.filter((r) => r === p.id).length ?? 0}`,
          actions: noActions,
        };
      }
    }
  }

  private renderDetail(g: ClientBR): void {
    const cur = this.current();
    const d = cur ? this.describe(g, cur) : null;
    if (!d) {
      if (this.detailSig !== 'none') {
        this.detailEl.replaceChildren(
          el('p', 'muted', 'Elige algo para ver qué hace y qué puedes hacer con él.'),
        );
        this.detailSig = 'none';
        this.ammoUi = null;
      }
      return;
    }
    if (d.sig === this.detailSig) {
      this.syncAmmo(g, false);
      return;
    }
    this.detailSig = d.sig;
    this.ammoUi = null;
    const box = el('div', 'inv-info');
    const head = el('div', 'inv-info-head');
    if (d.icon) {
      const c = el('canvas');
      c.width = d.icon.width;
      c.height = d.icon.height;
      (c.getContext('2d') as CanvasRenderingContext2D).drawImage(d.icon, 0, 0);
      head.append(c);
    }
    const title = el('div', 'inv-info-title');
    const name = el('strong', '', d.info.name);
    name.style.color = d.info.color;
    title.append(name, el('span', 'muted', d.info.sub));
    head.append(title);
    box.append(head);
    if (d.info.stats.length > 0) {
      const dl = el('dl', 'inv-stats');
      for (const [label, value] of d.info.stats) {
        dl.append(el('dt', '', label), el('dd', '', value));
      }
      box.append(dl);
    }
    if (d.info.text) box.append(el('p', 'muted inv-text', d.info.text));
    const actions = el('div', 'inv-actions');
    d.actions(actions);
    if (actions.childElementCount > 0) box.append(actions);
    this.detailEl.replaceChildren(box);
    this.syncAmmo(g);
  }

  private act(
    box: HTMLElement,
    label: string,
    on: () => void,
    cls = '',
    testid?: string,
  ): HTMLButtonElement {
    const b = el('button', `btn small inv-act${cls ? ` ${cls}` : ''}`, label);
    b.type = 'button';
    if (testid) b.dataset.testid = testid;
    b.addEventListener('click', on);
    box.append(b);
    return b;
  }

  private slotActions(g: ClientBR, box: HTMLElement, slot: number, item: Item): void {
    if (item.kind === 'wall' || item.kind === 'medkit' || item.kind === 'shield') {
      this.act(
        box,
        item.kind === 'wall' ? 'Poner' : 'Usar',
        () => this.useSlot(g, slot),
        'primary',
      );
    } else if (item.kind.startsWith('potion_')) {
      this.act(box, 'Beber', () => this.useSlot(g, slot), 'primary');
    }
    if (item.qty > 1) this.act(box, 'Tirar 1', () => this.dropSlot(g, slot, 1), '', 'drop-one');
    if (item.qty >= 4)
      this.act(
        box,
        `Tirar mitad (${Math.floor(item.qty / 2)})`,
        () => this.dropSlot(g, slot, Math.floor(item.qty / 2)),
        '',
        'drop-half',
      );
    this.act(
      box,
      item.qty > 1 ? 'Tirar todo' : 'Tirar',
      () => this.dropSlot(g, slot),
      'danger',
      'drop-all',
    );
  }

  /** Para usar algo hay que tenerlo en la mano: se elige y se usa (si se puede en este momento). */
  private useSlot(g: ClientBR, slot: number): void {
    g.select(slot);
    window.setTimeout(() => {
      g.useSelected();
      this.refresh();
    }, 60);
  }

  private dropSlot(g: ClientBR, slot: number, qty?: number): void {
    g.dropItem(slot, qty);
    window.setTimeout(() => this.refresh(), 80);
  }

  private ammoActions(g: ClientBR, box: HTMLElement, index: number): void {
    const kind = AMMO_KINDS[index];
    if (!kind) return;
    if (this.dropKey !== `ammo:${index}`) {
      this.dropKey = `ammo:${index}`;
      this.dropQty = 0;
    }
    const have = el('p', 'inv-have');
    const row = el('div', 'inv-qty');
    const minus = el('button', 'btn small step', '−');
    minus.type = 'button';
    minus.setAttribute('aria-label', 'Menos balas');
    const input = el('input', 'qty-input');
    input.type = 'number';
    input.inputMode = 'numeric';
    input.min = '1';
    input.dataset.testid = 'drop-qty';
    input.setAttribute('aria-label', 'Cuántas balas tirar');
    const plus = el('button', 'btn small step', '+');
    plus.type = 'button';
    plus.setAttribute('aria-label', 'Más balas');
    row.append(minus, input, plus);

    const presetBox = el('div', 'inv-presets');
    const presets: { b: HTMLButtonElement; n: () => number }[] = [];
    const mk = (label: string, n: () => number, testid: string): void => {
      const b = el('button', 'btn small ghost', label);
      b.type = 'button';
      b.dataset.testid = testid;
      b.addEventListener('click', () => {
        this.dropQty = Math.max(1, Math.min(n(), g.ammo[index] ?? 0));
        this.syncAmmo(g);
      });
      presetBox.append(b);
      presets.push({ b, n });
    };
    mk('10', () => 10, 'preset-10');
    mk('25', () => 25, 'preset-25');
    mk('50', () => 50, 'preset-50');
    mk('Mitad', () => Math.floor((g.ammo[index] ?? 0) / 2), 'preset-half');
    mk('Todas', () => g.ammo[index] ?? 0, 'preset-all');

    const set = (v: number): void => {
      this.dropQty = Math.max(1, Math.min(v, g.ammo[index] ?? 0));
      this.syncAmmo(g);
    };
    minus.addEventListener('click', () => set((this.dropQty || 1) - 1));
    plus.addEventListener('click', () => set((this.dropQty || 0) + 1));
    input.addEventListener('input', () => {
      const v = Number.parseInt(input.value, 10);
      this.dropQty = Number.isFinite(v) ? Math.max(0, Math.min(v, g.ammo[index] ?? 0)) : 0;
      this.syncAmmo(g, false);
    });
    // teclear no debe disparar atajos del juego (E, X, I...) ni cerrar el panel
    input.addEventListener('keydown', (e) => e.stopPropagation());

    const go = this.act(
      box,
      'Tirar',
      () => {
        const have = g.ammo[index] ?? 0;
        const n = Math.min(this.dropQty, have);
        if (n <= 0) return;
        // "todas" no manda cantidad (el servidor tira las que haya, tambien si pasan de 100)
        g.dropAmmo(kind, n >= have ? undefined : n);
        this.dropQty = 0;
        window.setTimeout(() => this.refresh(), 80);
      },
      'danger',
      'drop-go',
    );
    box.prepend(have, row, presetBox);
    box.append(go);
    this.ammoUi = { kind, have, input, go, presets };
  }

  /** Pone al dia el control de las balas: lo que se tiene, lo que se va a tirar y que atajos caben. */
  private syncAmmo(g: ClientBR, force = true): void {
    const ui = this.ammoUi;
    const cur = this.current();
    if (!ui || cur?.t !== 'ammo') return;
    const have = g.ammo[cur.i] ?? 0;
    if (this.dropQty > have) this.dropQty = have;
    ui.have.textContent = `Llevas ${have} de ${AMMO_MAX}. ¿Cuántas quieres tirar?`;
    ui.input.max = String(have);
    // mientras se teclea no se pisa el numero (solo lo cambian los botones)
    if (force || document.activeElement !== ui.input)
      ui.input.value = this.dropQty > 0 ? String(this.dropQty) : '';
    ui.go.disabled = this.dropQty <= 0 || have <= 0;
    ui.go.textContent = this.dropQty > 0 ? `Tirar ${this.dropQty}` : 'Tirar';
    for (const p of ui.presets) {
      const n = p.n();
      p.b.disabled = have <= 0 || n <= 0 || (n > have && n !== have);
      p.b.classList.toggle('on', n === this.dropQty && n > 0);
    }
  }

  private armorActions(
    g: ClientBR,
    box: HTMLElement,
    slot: number,
    mates: readonly [number, number, number, number, number][],
  ): void {
    const run = async (to?: number): Promise<void> => {
      const why = await g.moveArmor(slot, to);
      if (why) toast(ARMOR_ERRORS[why] ?? 'No se pudo');
      else {
        this.detailSig = '';
        this.tabSig = '';
        this.pick = null;
        window.setTimeout(() => this.refresh(), 120);
      }
    };
    this.act(box, 'Quitármela', () => void run(), '', 'armor-take');
    for (const m of mates) {
      const name = g.cats.get(m[0])?.name ?? `Gato ${m[0]}`;
      const b = this.act(
        box,
        `Dar a ${name}`,
        () => void run(m[0]),
        'primary',
        `armor-give-${m[0]}`,
      );
      b.disabled = m[1] <= 0;
    }
    if (mates.length > 0)
      box.append(
        el('p', 'muted inv-text', 'Para dársela, acércate a tu compañero (menos de 90 px).'),
      );
    else
      box.append(el('p', 'muted inv-text', 'Quitártela la deja en el suelo para quien la quiera.'));
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
        this.choose({ t: 'ammo', i: d.index });
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
