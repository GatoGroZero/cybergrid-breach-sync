import { describe, expect, it } from 'vitest';
import { AMMO_MAX, INVENTORY_SLOTS } from '../../src/shared/br/constants';
import {
  addAmmo,
  addItem,
  ammoFromArray,
  ammoToArray,
  cloneItem,
  consume,
  emptyAmmo,
  emptyInventory,
  giveItem,
  moveSlot,
  placeInSlot,
  spendAmmo,
  takeOne,
} from '../../src/shared/br/inventory';
import { STACK_MAX, type Item } from '../../src/shared/br/items';

const ammoItem = (qty: number): Item => ({ kind: 'ammo_pistol', qty, rarity: 0 });
const medkit = (qty: number): Item => ({ kind: 'medkit', qty, rarity: 0 });
const gun = (rarity: 0 | 1 | 2 = 0): Item => ({ kind: 'pistol', qty: 1, rarity });

describe('inventario de 5 espacios', () => {
  it('empieza vacío con exactamente 5 espacios', () => {
    const inv = emptyInventory();
    expect(inv).toHaveLength(INVENTORY_SLOTS);
    expect(inv.every((s) => s === null)).toBe(true);
    expect(INVENTORY_SLOTS).toBe(5);
  });

  it('las balas no ocupan espacios: van a su compartimento y se detienen en 100 de cada arma', () => {
    const inv = emptyInventory();
    const ammo = emptyAmmo();
    expect(giveItem(inv, ammo, ammoItem(60))).toBeNull();
    expect(giveItem(inv, ammo, ammoItem(30))).toBeNull();
    expect(ammo.ammo_pistol).toBe(90);
    expect(inv.every((s) => s === null)).toBe(true);
    // solo caben 10 mas: el resto se queda donde estaba
    const left = giveItem(inv, ammo, ammoItem(40));
    expect(left).toMatchObject({ kind: 'ammo_pistol', qty: 30 });
    expect(ammo.ammo_pistol).toBe(AMMO_MAX);
    expect(AMMO_MAX).toBe(100);
    // cada arma tiene su propio tope
    expect(giveItem(inv, ammo, { kind: 'ammo_rifle', qty: 100, rarity: 0 })).toBeNull();
    expect(ammo.ammo_rifle).toBe(100);
    expect(ammoToArray(ammo)).toEqual([100, 0, 0, 0, 100]);
    expect(ammoFromArray([5, 6, 7, 8, 999])).toMatchObject({ ammo_pistol: 5, ammo_rifle: 100 });
  });

  it('addItem y placeInSlot rechazan las balas, y spendAmmo solo gasta lo que hay', () => {
    const inv = emptyInventory();
    expect(addItem(inv, ammoItem(10))).toMatchObject({ kind: 'ammo_pistol', qty: 10 });
    expect(placeInSlot(inv, 2, ammoItem(10))).toMatchObject({ kind: 'ammo_pistol' });
    expect(inv.every((s) => s === null)).toBe(true);
    const ammo = emptyAmmo();
    addAmmo(ammo, 'ammo_shotgun', 6);
    expect(spendAmmo(ammo, 'ammo_shotgun', 4)).toBe(true);
    expect(spendAmmo(ammo, 'ammo_shotgun', 4)).toBe(false);
    expect(ammo.ammo_shotgun).toBe(2);
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
    expect(placeInSlot(inv, 3, medkit(2))).toBeNull();
    expect(inv[3]?.qty).toBe(2);
    expect(placeInSlot(inv, 3, medkit(1))).toBeNull();
    expect(inv[3]?.qty).toBe(3);
    expect(placeInSlot(inv, 3, gun())).toMatchObject({ kind: 'pistol' });
    expect(placeInSlot(inv, 9, gun())).toMatchObject({ kind: 'pistol' });
    const big = placeInSlot(inv, 0, medkit(10));
    expect(big?.qty).toBe(10 - STACK_MAX.medkit);
  });

  it('moveSlot mueve, apila y intercambia, y rechaza movimientos sin sentido', () => {
    const inv = emptyInventory();
    inv[0] = gun();
    inv[1] = medkit(1);
    inv[2] = medkit(2);
    expect(moveSlot(inv, 0, 4)).toBe(true);
    expect(inv[4]?.kind).toBe('pistol');
    expect(inv[0]).toBeNull();
    expect(moveSlot(inv, 1, 2)).toBe(true);
    expect(inv[2]?.qty).toBe(3);
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
    inv[0] = medkit(STACK_MAX.medkit);
    inv[1] = medkit(2);
    expect(consume(inv, 'medkit', STACK_MAX.medkit + 1)).toBe(true);
    expect(inv[0]).toBeNull();
    expect(inv[1]?.qty).toBe(1);
    expect(consume(inv, 'medkit', 3)).toBe(false);
    inv[1] = medkit(2);
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
