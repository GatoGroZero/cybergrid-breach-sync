import { AMMO_MAX } from './constants';
import {
  ARMOR_BONUS,
  ARMOR_NAMES,
  POTION,
  POWER_MAX_LEVEL,
  powerCooldown,
  powerEffect,
  type PowerDef,
} from './adventure';
import {
  CLAWS,
  ITEM_NAMES,
  RARITY_COLORS,
  RARITY_NAMES,
  WEAPONS,
  isAmmo,
  isArmor,
  isWeapon,
  magOf,
  type Item,
  type Rarity,
} from './items';

/** Lo que el inventario cuenta de un objeto: nombre, tipo, datos sueltos y para que sirve. */
export interface Info {
  name: string;
  /** Tipo y rareza, en una linea corta. */
  sub: string;
  /** Color del nombre (el de la rareza). */
  color: string;
  /** Datos como pares etiqueta, valor. */
  stats: [string, string][];
  text: string;
}

const pct = (v: number): string => `${Math.round(v * 100)} %`;
const num = (v: number): string => String(Math.round(v * 10) / 10).replace('.', ',');

/** Un arma con todos sus datos: la pantalla del inventario los muestra al tocarla. */
export function weaponInfo(item: Item, ammoHave: number, infinite = false): Info {
  const def = WEAPONS[item.kind as keyof typeof WEAPONS];
  const dmg = def.damage[item.rarity];
  const volley = dmg * def.pellets;
  return {
    name: def.name,
    sub: `Arma · ${RARITY_NAMES[item.rarity]}`,
    color: RARITY_COLORS[item.rarity],
    stats: [
      ['Daño', def.pellets > 1 ? `${dmg} x ${def.pellets} perdigones` : `${dmg}`],
      ['Daño por segundo', `${num(volley / def.cooldown)}`],
      ['Cadencia', `${num(1 / def.cooldown)} disparos por segundo`],
      ['Disparo', def.auto ? 'Automático (mantén pulsado)' : 'Uno por clic'],
      ['Alcance', `${def.range} px`],
      ['Cargador', `${magOf(item)} de ${def.magazine}`],
      ['Recarga', `${num(def.reload)} s`],
      ['Gasta', `${def.ammoPerShot} ${def.ammoPerShot === 1 ? 'bala' : 'balas'} por disparo`],
      ...(def.splash > 0
        ? ([['Explosión', `radio de ${def.splash} px`]] as [string, string][])
        : []),
      [ITEM_NAMES[def.ammo], infinite ? 'sin límite' : `${ammoHave} de ${AMMO_MAX}`],
    ],
    text: `Con rareza distinta pega ${def.damage.join(', ')} (común, normal, épica). Los números son los base: las reliquias y las habilidades los mejoran.`,
  };
}

export function ammoInfo(kind: keyof typeof ITEM_NAMES, have: number): Info {
  const weapon = WEAPONS[(kind as string).replace('ammo_', '') as keyof typeof WEAPONS];
  return {
    name: ITEM_NAMES[kind],
    sub: 'Balas',
    color: RARITY_COLORS[0],
    stats: [
      ['Para', weapon.name],
      ['Llevas', `${have} de ${AMMO_MAX}`],
    ],
    text: 'Las balas se guardan aparte de tus 5 espacios. Puedes tirar las que quieras para dárselas a alguien.',
  };
}

/** Datos de una pieza de armadura: cual es y que da. */
export function armorInfo(slot: number, tier: number): Info {
  const key = (['head', 'body', 'paws'] as const)[slot] ?? 'head';
  const t = Math.min(2, Math.max(0, tier)) as Rarity;
  const name = ARMOR_NAMES[key][t];
  const stats: [string, string][] =
    key === 'head'
      ? [['Escudo máximo', `+${ARMOR_BONUS.head.shield[t]}`]]
      : key === 'body'
        ? [['Daño recibido', `-${pct(ARMOR_BONUS.body.less[t])}`]]
        : [
            ['Velocidad', `+${pct(ARMOR_BONUS.paws.speed[t])}`],
            ['Voltereta', `se recupera ${pct(ARMOR_BONUS.paws.dash[t])} antes`],
          ];
  return {
    name,
    sub: `Armadura de ${key === 'head' ? 'cabeza' : key === 'body' ? 'cuerpo' : 'patas'} · ${RARITY_NAMES[t]}`,
    color: RARITY_COLORS[t],
    stats,
    text: 'Se pone sola al recogerla si es mejor que la que llevas. Puedes quitártela para dejarla en el suelo o dársela a alguien de tu grupo que esté cerca.',
  };
}

/** Datos de un objeto de la mochila (arma, cura, pocion, muro, armadura...). */
export function itemInfo(item: Item, ammoHave = 0, infinite = false): Info {
  if (isWeapon(item.kind)) return weaponInfo(item, ammoHave, infinite);
  if (isAmmo(item.kind)) return ammoInfo(item.kind, ammoHave);
  if (isArmor(item.kind))
    return armorInfo(['armor_head', 'armor_body', 'armor_paws'].indexOf(item.kind), item.rarity);
  const base = { name: ITEM_NAMES[item.kind], color: RARITY_COLORS[0] };
  switch (item.kind) {
    case 'medkit':
      return {
        ...base,
        sub: 'Cura',
        stats: [
          ['Cura', '+10 de vida por segundo'],
          ['Hasta', 'llenar la vida'],
          ['Tienes', `${item.qty}`],
        ],
        text: 'Ponlo en la mano y pulsa E o haz clic. Si cambias de objeto mientras te curas, se cancela.',
      };
    case 'shield':
      return {
        ...base,
        sub: 'Cura',
        stats: [
          ['Escudo', '+10 por segundo durante 5 s'],
          ['Total', '+50 de escudo'],
          ['Tienes', `${item.qty}`],
        ],
        text: 'Ponlo en la mano y pulsa E o haz clic. Si cambias de objeto mientras lo usas, se cancela.',
      };
    case 'wall':
      return {
        ...base,
        sub: 'Defensa',
        stats: [
          ['Vida del muro', '150'],
          ['Tienes', `${item.qty}`],
        ],
        text: 'Haz clic para colocarlo delante de ti. Se desgasta con cada golpe y lo rompen las garras.',
      };
    case 'potion_catnip':
      return {
        ...base,
        sub: 'Poción',
        color: '#7fe08a',
        stats: [
          ['Daño', `+${Math.round((POTION.catnip.dmg - 1) * 100)} %`],
          ['Velocidad', `+${Math.round((POTION.catnip.speed - 1) * 100)} %`],
          ['Dura', `${POTION.catnip.seconds} s`],
          ['Tienes', `${item.qty}`],
        ],
        text: 'Te pone bravo: pegas más fuerte y corres más. Ponla en la mano y pulsa E o haz clic.',
      };
    case 'potion_valerian':
      return {
        ...base,
        sub: 'Poción',
        color: '#8fb4ff',
        stats: [
          ['Velocidad', `+${Math.round((POTION.valerian.speed - 1) * 100)} %`],
          ['Voltereta', `se recupera ${Math.round((1 - POTION.valerian.dash) * 100)} % antes`],
          ['Dura', `${POTION.valerian.seconds} s`],
          ['Tienes', `${item.qty}`],
        ],
        text: 'Te deja ligero y escurridizo: más velocidad y más voltereta. Ponla en la mano y pulsa E o haz clic.',
      };
    default:
      return { ...base, sub: 'Objeto', stats: [['Tienes', `${item.qty}`]], text: '' };
  }
}

/** Las garras: lo que tienes cuando no llevas nada en la mano. */
export function clawsInfo(): Info {
  return {
    name: 'Garras',
    sub: 'Siempre disponibles',
    color: RARITY_COLORS[0],
    stats: [
      ['Daño', `${CLAWS.damage}`],
      ['Contra muros', `${CLAWS.wallDamage}`],
      ['Alcance', `${CLAWS.range} px`],
    ],
    text: 'No gastan balas. Rompen los muros que ponen los demás.',
  };
}

/** Datos de una habilidad a un nivel: lo que hace con numeros y cada cuanto se puede usar. */
export function powerInfo(def: PowerDef, level: number, key: string): Info {
  const lvl = Math.min(POWER_MAX_LEVEL, Math.max(1, level));
  const eff = powerEffect(lvl);
  const dur = def.duration * eff;
  const stats: [string, string][] = [];
  switch (def.id) {
    case 0:
      stats.push(
        ['Cadencia', `x${num(2 * eff)}`],
        ['Daño de cada bala', `+${Math.round(40 * eff)} %`],
      );
      break;
    case 1:
      stats.push(['Daño', `+${Math.round(80 * eff)} %`], ['Alcance', `+${Math.round(30 * eff)} %`]);
      break;
    case 2:
      stats.push(
        ['Cura', `${num(11 * eff)} por segundo`],
        ['Radio de la nube', `${62 + 8 * lvl} px`],
      );
      break;
    case 3:
      stats.push(
        ['Daño', `${Math.round(22 * eff)}`],
        ['Radio', `${82 + 10 * (lvl - 1)} px`],
        ['Aturde', `${num(1.4 + 0.3 * (lvl - 1))} s`],
      );
      break;
    case 4:
      stats.push(['Velocidad', '+40 %'], ['Daño recibido', 'ninguno']);
      break;
    case 5:
      stats.push(['Daño', `${Math.round(36 * eff)}`], ['Radio', `${105 + 8 * (lvl - 1)} px`]);
      break;
    case 6:
      stats.push(['Escudo', `+${Math.round(55 * eff)}`], ['Radio', '92 px']);
      break;
    default:
      stats.push(['Enemigos más lentos', 'los de 150 px a la redonda']);
  }
  if (dur > 0) stats.push(['Dura', `${num(dur)} s`]);
  stats.push(
    ['Espera', `${num(powerCooldown(def, lvl))} s`],
    ['Nivel', `${lvl} de ${POWER_MAX_LEVEL}`],
    ['Tecla', key],
  );
  return {
    name: def.name,
    sub: `Habilidad · nivel ${lvl}`,
    color: '#73eff7',
    stats,
    text: `${def.desc}. Si un jefe te vuelve a ofrecer esta habilidad, sube de nivel y mejora.`,
  };
}
