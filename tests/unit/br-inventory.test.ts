import { describe, expect, it } from 'vitest';
import { INVENTORY_SLOTS } from '../../src/shared/br/constants';
import {
  addItem,
  cloneItem,
  consume,
  countKind,
  emptyInventory,
  moveSlot,
  placeInSlot,
  takeOne,
} from '../../src/shared/br/inventory';
import { STACK_MAX, type Item } from '../../src/shared/br/items';

const ammo = (qty: number): Item => ({ kind: 'ammo_pistol', qty, rarity: 0 });
const gun = (rarity: 0 | 1 | 2 = 0): Item => ({ kind: 'pistol', qty: 1, rarity });

describe('inventario de 5 espacios', () => {
  it('empieza vacío con exactamente 5 espacios', () => {
    const inv = emptyInventory();
    expect(inv).toHaveLength(INVENTORY_SLOTS);
    expect(inv.every((s) => s === null)).toBe(true);
    expect(INVENTORY_SLOTS).toBe(5);
  });

  it('las balas se apilan hasta su tope y el resto usa otro espacio', () => {
    const inv = emptyInventory();
    expect(addItem(inv, ammo(50))).toBeNull();
    expect(addItem(inv, ammo(40))).toBeNull();
    const max = STACK_MAX.ammo_pistol;
    expect(inv[0]?.qty).toBe(max);
    expect(inv[1]?.qty).toBe(90 - max);
    expect(countKind(inv, 'ammo_pistol')).toBe(90);
  });

  it('las armas no se apilan: cada una ocupa su propio espacio y al llenarse devuelve lo que sobra', () => {
    const inv = emptyInventory();
    for (let i = 0; i < INVENTORY_SLOTS; i++) expect(addItem(inv, gun())).toBeNull();
    const left = addItem(inv, gun());
    expect(left).toMatchObject({ kind: 'pistol', qty: 1 });
    expect(inv.filter(Boolean)).toHaveLength(5);
  });

  it('armas de distinta rareza nunca se mezclan', () => {
    const inv = emptyInventory();
    addItem(inv, { kind: 'medkit', qty: 1, rarity: 0 });
    addItem(inv, { kind: 'medkit', qty: 1, rarity: 1 });
    expect(inv.filter(Boolean)).toHaveLength(2);
  });

  it('placeInSlot respeta la casilla pedida, apila si puede y devuelve el sobrante', () => {
    const inv = emptyInventory();
    expect(placeInSlot(inv, 3, ammo(10))).toBeNull();
    expect(inv[3]?.qty).toBe(10);
    expect(placeInSlot(inv, 3, ammo(5))).toBeNull();
    expect(inv[3]?.qty).toBe(15);
    expect(placeInSlot(inv, 3, gun())).toMatchObject({ kind: 'pistol' });
    expect(placeInSlot(inv, 9, gun())).toMatchObject({ kind: 'pistol' });
    const big = placeInSlot(inv, 0, ammo(500));
    expect(big?.qty).toBe(500 - STACK_MAX.ammo_pistol);
  });

  it('moveSlot mueve, apila y intercambia, y rechaza movimientos sin sentido', () => {
    const inv = emptyInventory();
    inv[0] = gun();
    inv[1] = ammo(10);
    inv[2] = ammo(20);
    expect(moveSlot(inv, 0, 4)).toBe(true);
    expect(inv[4]?.kind).toBe('pistol');
    expect(inv[0]).toBeNull();
    expect(moveSlot(inv, 1, 2)).toBe(true);
    expect(inv[2]?.qty).toBe(30);
    expect(inv[1]).toBeNull();
    inv[1] = gun(2);
    expect(moveSlot(inv, 1, 4)).toBe(true);
    expect(inv[4]?.rarity).toBe(2);
    expect(inv[1]?.rarity).toBe(0);
    expect(moveSlot(inv, 3, 1)).toBe(false);
    expect(moveSlot(inv, 1, 1)).toBe(false);
    expect(moveSlot(inv, 1, 9)).toBe(false);
  });

  it('consume reparte el gasto entre pilas y falla si no alcanza; takeOne baja de a uno', () => {
    const inv = emptyInventory();
    inv[0] = ammo(STACK_MAX.ammo_pistol);
    inv[1] = ammo(5);
    expect(consume(inv, 'ammo_pistol', STACK_MAX.ammo_pistol + 3)).toBe(true);
    expect(inv[0]).toBeNull();
    expect(inv[1]?.qty).toBe(2);
    expect(consume(inv, 'ammo_pistol', 3)).toBe(false);
    expect(takeOne(inv, 1)).toBe(1);
    expect(takeOne(inv, 1)).toBe(0);
    expect(inv[1]).toBeNull();
    expect(takeOne(inv, 1)).toBe(0);
  });

  it('cloneItem copia sin compartir referencias', () => {
    const a = gun(1);
    const b = cloneItem(a);
    b.qty = 5;
    expect(a.qty).toBe(1);
    expect(b).toMatchObject({ kind: 'pistol', rarity: 1 });
  });
});
