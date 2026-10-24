import { AMMO_MAX, INVENTORY_SLOTS } from './constants';
import {
  AMMO_KINDS,
  STACK_MAX,
  canStack,
  isAmmo,
  type AmmoKind,
  type Item,
  type ItemKind,
} from './items';

export type Inventory = (Item | null)[];

export const emptyInventory = (): Inventory => Array.from({ length: INVENTORY_SLOTS }, () => null);

export const cloneItem = (it: Item): Item => ({ kind: it.kind, qty: it.qty, rarity: it.rarity });

// ---------------------------------------------------------------- compartimento de balas

/** Balas de cada arma: viven aparte de los 5 espacios y se guardan hasta AMMO_MAX de cada una. */
export type AmmoStore = Record<AmmoKind, number>;

export const emptyAmmo = (): AmmoStore => ({
  ammo_pistol: 0,
  ammo_shotgun: 0,
  ammo_sniper: 0,
  ammo_bazooka: 0,
  ammo_rifle: 0,
});

/** El compartimento como arreglo en el orden de AMMO_KINDS (asi viaja al cliente). */
export const ammoToArray = (a: AmmoStore): number[] => AMMO_KINDS.map((k) => a[k]);

export function ammoFromArray(list: readonly number[]): AmmoStore {
  const out = emptyAmmo();
  AMMO_KINDS.forEach((k, i) => {
    out[k] = Math.max(0, Math.min(AMMO_MAX, Math.floor(list[i] ?? 0)));
  });
  return out;
}

/** Agrega balas hasta el tope. Devuelve las que no cupieron. */
export function addAmmo(store: AmmoStore, kind: AmmoKind, qty: number): number {
  const room = AMMO_MAX - store[kind];
  const put = Math.max(0, Math.min(room, qty));
  store[kind] += put;
  return qty - put;
}

export function spendAmmo(store: AmmoStore, kind: AmmoKind, n: number): boolean {
  if (store[kind] < n) return false;
  store[kind] -= n;
  return true;
}

/**
 * Recibe cualquier objeto: las balas van al compartimento y lo demas a los 5 espacios.
 * Devuelve lo que no cupo (o null si entro todo).
 */
export function giveItem(inv: Inventory, ammo: AmmoStore, item: Item): Item | null {
  if (isAmmo(item.kind)) {
    const left = addAmmo(ammo, item.kind, item.qty);
    return left > 0 ? { kind: item.kind, qty: left, rarity: item.rarity } : null;
  }
  return addItem(inv, item);
}

export function countKind(inv: Inventory, kind: ItemKind): number {
  let n = 0;
  for (const it of inv) if (it && it.kind === kind) n += it.qty;
  return n;
}

/**
 * Agrega un objeto: primero completa pilas del mismo tipo y luego usa una casilla libre.
 * Devuelve lo que no cupo (o null si entro todo).
 */
export function addItem(inv: Inventory, item: Item): Item | null {
  // Las balas nunca ocupan espacios: se guardan con addAmmo o giveItem.
  if (isAmmo(item.kind)) return item;
  let left = item.qty;
  const max = STACK_MAX[item.kind];
  for (const slot of inv) {
    if (left <= 0) break;
    if (slot && canStack(slot, item) && slot.qty < max) {
      const room = max - slot.qty;
      const put = Math.min(room, left);
      slot.qty += put;
      left -= put;
    }
  }
  for (let i = 0; i < inv.length && left > 0; i++) {
    if (inv[i] === null) {
      const put = Math.min(max, left);
      inv[i] = { kind: item.kind, qty: put, rarity: item.rarity };
      left -= put;
    }
  }
  return left > 0 ? { kind: item.kind, qty: left, rarity: item.rarity } : null;
}

/** Coloca un objeto en una casilla concreta: vacia, o una pila compatible. Devuelve lo que sobra. */
export function placeInSlot(inv: Inventory, slotIndex: number, item: Item): Item | null {
  if (isAmmo(item.kind)) return item;
  const slot = inv[slotIndex];
  const max = STACK_MAX[item.kind];
  if (slot === undefined) return item;
  if (slot === null) {
    const put = Math.min(max, item.qty);
    inv[slotIndex] = { kind: item.kind, qty: put, rarity: item.rarity };
    return put < item.qty ? { ...item, qty: item.qty - put } : null;
  }
  if (canStack(slot, item)) {
    const put = Math.min(max - slot.qty, item.qty);
    slot.qty += put;
    return put < item.qty ? { ...item, qty: item.qty - put } : null;
  }
  return item;
}

/** Arrastrar una casilla sobre otra: se apilan si se puede y si no se intercambian. */
export function moveSlot(inv: Inventory, from: number, to: number): boolean {
  if (from === to) return false;
  const a = inv[from];
  const b = inv[to];
  if (a === undefined || b === undefined || a === null) return false;
  if (b === null) {
    inv[to] = a;
    inv[from] = null;
    return true;
  }
  if (canStack(a, b)) {
    const room = STACK_MAX[b.kind] - b.qty;
    if (room > 0) {
      const put = Math.min(room, a.qty);
      b.qty += put;
      a.qty -= put;
      if (a.qty <= 0) inv[from] = null;
      return true;
    }
  }
  inv[to] = a;
  inv[from] = b;
  return true;
}

/** Gasta `n` unidades de un tipo repartidas entre sus pilas. False si no alcanzan. */
export function consume(inv: Inventory, kind: ItemKind, n: number): boolean {
  if (countKind(inv, kind) < n) return false;
  let left = n;
  for (let i = 0; i < inv.length && left > 0; i++) {
    const it = inv[i];
    if (!it || it.kind !== kind) continue;
    const take = Math.min(it.qty, left);
    it.qty -= take;
    left -= take;
    if (it.qty <= 0) inv[i] = null;
  }
  return true;
}

/** Quita una unidad de una casilla y devuelve cuantas quedan. */
export function takeOne(inv: Inventory, slotIndex: number): number {
  const it = inv[slotIndex];
  if (!it) return 0;
  it.qty -= 1;
  if (it.qty <= 0) {
    inv[slotIndex] = null;
    return 0;
  }
  return it.qty;
}
