import { INVENTORY_SLOTS } from './constants';
import { STACK_MAX, canStack, type Item, type ItemKind } from './items';

export type Inventory = (Item | null)[];

export const emptyInventory = (): Inventory => Array.from({ length: INVENTORY_SLOTS }, () => null);

export const cloneItem = (it: Item): Item => ({ kind: it.kind, qty: it.qty, rarity: it.rarity });

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
