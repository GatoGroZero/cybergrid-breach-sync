import {
  ADVENTURE_MAPS,
  DUEL_MAPS,
  MAP_KINDS,
  MAP_NAMES,
  TERRITORY_MAPS,
  type MapKind,
} from '../../shared/br/map';
import {
  DUEL_FORMATS,
  ENABLED_MODES,
  GAME_MODES,
  MODES,
  TERRITORY_MAX_TEAM,
  TERRITORY_MIN_TEAM,
  isGameMode,
  type DuelFormat,
  type GameMode,
} from '../../shared/br/modes';
import { $, el } from './dom';

const MODE_KEY = 'cg_modo';

/** Mapas que existen en cada modo. */
export function mapsOf(mode: GameMode): readonly MapKind[] {
  return mode === 'techo'
    ? DUEL_MAPS
    : mode === 'territorio'
      ? TERRITORY_MAPS
      : mode === 'aventura'
        ? ADVENTURE_MAPS
        : MAP_KINDS;
}

export const FORMAT_LABELS: Record<DuelFormat, string> = {
  '1v1': '1 contra 1',
  '2v2': '2 contra 2',
};

export const teamSizeLabel = (n: number): string => `${n} contra ${n}`;

/** Llena un selector con "Mapa al azar" y los mapas del modo, sin perder lo elegido si todavia sirve. */
export function fillMapSelect(select: HTMLSelectElement, mode: GameMode): void {
  const keep = select.value;
  select.replaceChildren();
  const random = el('option', '', 'Mapa al azar');
  random.value = 'azar';
  select.append(random);
  for (const kind of mapsOf(mode)) {
    const o = el('option', '', MAP_NAMES[kind]);
    o.value = kind;
    select.append(o);
  }
  select.value = [...select.options].some((o) => o.value === keep) ? keep : 'azar';
}

export function fillModeSelect(select: HTMLSelectElement): void {
  select.replaceChildren();
  for (const mode of GAME_MODES) {
    if (!ENABLED_MODES.includes(mode)) continue;
    const o = el('option', '', MODES[mode].name);
    o.value = mode;
    select.append(o);
  }
}

export function fillFormatSelect(select: HTMLSelectElement): void {
  select.replaceChildren();
  for (const f of DUEL_FORMATS) {
    const o = el('option', '', FORMAT_LABELS[f]);
    o.value = f;
    select.append(o);
  }
}

export function fillTeamSizeSelect(select: HTMLSelectElement): void {
  select.replaceChildren();
  for (let n = TERRITORY_MAX_TEAM; n >= TERRITORY_MIN_TEAM; n--) {
    const o = el('option', '', teamSizeLabel(n));
    o.value = String(n);
    select.append(o);
  }
}

/** Lo que dice el boton de jugar solo segun el modo. */
export function soloHelp(mode: GameMode, format: DuelFormat, teamSize: number): string {
  if (mode === 'techo')
    return format === '2v2'
      ? 'Tú y un bot contra dos bots. Eliges kit y peleas a tres rondas.'
      : 'Tú contra un bot en un tejado. Eliges kit y peleas a tres rondas.';
  if (mode === 'territorio')
    return `Tu equipo de ${teamSize} (con bots) contra otro de ${teamSize}. Dominen los patios.`;
  if (mode === 'aventura') return 'Explora un bosque encantado tú solo, o invita amigos.';
  return 'Tú contra 11 bots. La partida empieza al instante.';
}

/**
 * Selector de modo del lobby: tarjetas con el nombre y una frase, el formato de cada modo y la
 * lista de mapas que le toca. Recuerda el ultimo modo elegido en este navegador.
 */
export class ModePicker {
  mode: GameMode = 'br';
  format: DuelFormat = '1v1';
  teamSize = TERRITORY_MAX_TEAM;
  onChange: () => void = () => undefined;

  private readonly box = $('mode-picker');
  private readonly mapSelect = $<HTMLSelectElement>('room-map');
  private readonly botsField = $('room-bots-field');
  private readonly formatField = $('room-format-field');
  private readonly teamField = $('room-teamsize-field');
  private readonly formatSelect = $<HTMLSelectElement>('room-format');
  private readonly teamSelect = $<HTMLSelectElement>('room-teamsize');

  constructor() {
    try {
      const saved = window.localStorage.getItem(MODE_KEY);
      if (isGameMode(saved) && ENABLED_MODES.includes(saved)) this.mode = saved;
    } catch {
      // sin almacenamiento: se queda el Battle Royale
    }
    fillFormatSelect(this.formatSelect);
    fillTeamSizeSelect(this.teamSelect);
    this.formatSelect.addEventListener('change', () => {
      this.format = this.formatSelect.value as DuelFormat;
      this.onChange();
    });
    this.teamSelect.addEventListener('change', () => {
      this.teamSize = Number(this.teamSelect.value);
      this.onChange();
    });
    this.build();
    this.sync();
  }

  private build(): void {
    this.box.replaceChildren();
    for (const mode of GAME_MODES) {
      const info = MODES[mode];
      const ready = ENABLED_MODES.includes(mode);
      const b = el('button', 'mode');
      b.type = 'button';
      b.dataset.mode = mode;
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-label', info.name + (ready ? '' : ' (próximamente)'));
      b.disabled = !ready;
      b.title = info.blurb;
      b.append(el('strong', '', info.name), el('span', '', ready ? info.blurb : 'Próximamente'));
      b.addEventListener('click', () => this.pick(mode));
      this.box.append(b);
    }
  }

  pick(mode: GameMode): void {
    if (!ENABLED_MODES.includes(mode)) return;
    this.mode = mode;
    try {
      window.localStorage.setItem(MODE_KEY, mode);
    } catch {
      // sin almacenamiento
    }
    this.sync();
    this.onChange();
  }

  /** Muestra solo lo que corresponde al modo elegido. */
  private sync(): void {
    for (const b of this.box.querySelectorAll<HTMLButtonElement>('button'))
      b.setAttribute('aria-checked', String(b.dataset.mode === this.mode));
    fillMapSelect(this.mapSelect, this.mode);
    this.botsField.hidden = this.mode !== 'br';
    this.formatField.hidden = this.mode !== 'techo';
    this.teamField.hidden = this.mode !== 'territorio';
    this.formatSelect.value = this.format;
    this.teamSelect.value = String(this.teamSize);
  }
}
