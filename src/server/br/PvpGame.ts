import { CAT, TICK_DT } from '../../shared/br/constants';
import { cloneItem, emptyAmmo, emptyInventory, giveItem } from '../../shared/br/inventory';
import { AMMO_KINDS, rollAmmoCrate, type AmmoKind } from '../../shared/br/items';
import {
  KITS,
  KIT_IDS,
  MAX_ROUNDS,
  ROUNDS_TO_WIN,
  TEAM_NAMES,
  isKitId,
  type KitId,
} from '../../shared/br/modes';
import type { DiedPayload, GameEndPayload, PlacementRow } from '../../shared/br/protocol';
import { fullStamina } from '../../shared/br/stamina';
import type { BRSnapshot, PvpPhase, PvpState } from '../../shared/br/types';
import { zoneAt } from '../../shared/br/zone';
import { createRng } from '../../shared/rng';
import { BotBrain } from './bots';
import { BRGame, type Cat, type GameOptions } from './Game';
import { mapHeightPx, mapWidthPx } from '../../shared/br/map';

export interface PvpOptions extends GameOptions {
  /** Gatos por equipo. */
  teamSize: number;
  roundsToWin?: number;
  pickSeconds?: number;
  readySeconds?: number;
  betweenSeconds?: number;
}

/** Mas alla de la linea de tiempo de la zona, la ronda se decide por vida restante. */
const ROUND_CAP_EXTRA_S = 12;
/** Cuanto cuesta capturar un patio estando solo (segundos) y cuanto ayuda cada companero extra. */
const CAPTURE_SECONDS = 6;
/** Segundos seguidos dominando todos los patios para ganar la ronda. */
export const HOLD_TO_WIN_S = 18;
/** Curacion por segundo de quien esta dentro de un patio que es de su equipo. */
const POINT_HEAL = 4;

interface PointState {
  owner: number;
  /** Equipo que va capturando ahora y cuanto lleva (0 a 100). */
  capTeam: number;
  prog: number;
}

/**
 * Partida por rondas entre dos equipos (Pelea en el techo y Territorio). Cada ronda tiene cuatro
 * tiempos: elegir kit, cuenta de 3, pelea y una pausa para ver quien se llevo la ronda. Gana el
 * equipo que junta dos rondas. No hay botin: todos pelean con el kit que elijan, y la zona
 * (tormenta o inundacion) empuja a pelear.
 */
export class PvpGame extends BRGame {
  phase: PvpPhase = 'pick';
  round = 1;
  wins: [number, number] = [0, 0];
  roundWinner: number | null = null;
  readonly teamSize: number;
  readonly roundsToWin: number;
  private phaseLeft: number;
  private readonly pickS: number;
  private readonly readyS: number;
  private readonly betweenS: number;
  private readonly kits = new Map<number, KitId>();
  /** Ultimo kit de cada gato: sirve de eleccion por omision en la ronda siguiente. */
  private readonly lastKit = new Map<number, KitId>();
  private readonly botPickAt = new Map<number, number>();
  private draws = 0;
  private fightTotal = 0;
  private points: PointState[] = [];
  private hold: [number, number] = [0, 0];

  constructor(options: PvpOptions) {
    super({ ...options, introSeconds: 0, graceSeconds: options.graceSeconds ?? 1.2 });
    this.teamSize = options.teamSize;
    this.roundsToWin = options.roundsToWin ?? ROUNDS_TO_WIN;
    this.pickS = options.pickSeconds ?? 14;
    this.readyS = options.readySeconds ?? 3;
    this.betweenS = options.betweenSeconds ?? 5;
    this.phaseLeft = this.pickS;
    this.dropLoot = false;
    this.initPoints();
    this.scheduleBotPicks();
  }

  // ---------------------------------------------------------------- consultas

  /** Kit que lleva (o va a llevar) un gato. */
  kitOf(catId: number): KitId | null {
    return this.kits.get(catId) ?? null;
  }

  teamAlive(team: number): number {
    return this.cats.filter((c) => c.alive && c.team === team).length;
  }

  // ---------------------------------------------------------------- elegir kit

  /** Un jugador elige su kit mientras dura el tiempo de eleccion. */
  chooseKit(catId: number, kit: unknown): boolean {
    const cat = this.cat(catId);
    if (!cat || this.phase !== 'pick' || !isKitId(kit)) return false;
    this.kits.set(catId, kit);
    // Si todas las personas conectadas ya eligieron, no hay que esperar: se acorta la espera.
    const pending = this.cats.some((c) => !c.bot && c.connected && !this.kits.has(c.id));
    if (!pending) this.phaseLeft = Math.min(this.phaseLeft, 1.2);
    return true;
  }

  private scheduleBotPicks(): void {
    this.botPickAt.clear();
    for (const c of this.cats) {
      if (c.bot) this.botPickAt.set(c.id, this.rng.range(1.5, Math.max(2, this.pickS - 4)));
    }
  }

  private equip(cat: Cat, id: KitId): void {
    const kit = KITS[id];
    cat.inv = emptyInventory();
    cat.ammo = emptyAmmo();
    for (const item of kit.items) giveItem(cat.inv, cat.ammo, cloneItem(item));
    for (const k of AMMO_KINDS) {
      const qty = kit.ammo[k as AmmoKind] ?? 0;
      if (qty > 0) giveItem(cat.inv, cat.ammo, { kind: k, qty, rarity: 0 });
    }
    cat.sel = 0;
    cat.invDirty = true;
  }

  // ---------------------------------------------------------------- fases

  protected override beforeSim(): boolean {
    if (this.phase === 'fight') return false;
    // Todos quietos: se confirman las entradas para que el cliente no repita pasos.
    for (const cat of this.cats) {
      cat.moving = false;
      cat.running = false;
      while (cat.queue.length > 0) cat.lastSeq = (cat.queue.shift() as { seq: number }).seq;
    }
    if (this.phase === 'over') return true;
    this.phaseLeft -= TICK_DT;

    if (this.phase === 'pick') {
      const elapsed = this.pickS - this.phaseLeft;
      for (const [id, at] of this.botPickAt) {
        if (elapsed >= at && !this.kits.has(id)) {
          this.kits.set(id, this.rng.pick([...KIT_IDS]));
        }
      }
      if (this.phaseLeft <= 0) this.startReady();
    } else if (this.phase === 'ready') {
      if (this.phaseLeft <= 0) this.startFight();
    } else if (this.phase === 'between') {
      if (this.phaseLeft <= 0) this.nextRound();
    }
    return true;
  }

  private startReady(): void {
    for (const cat of this.cats) {
      let kit = this.kits.get(cat.id);
      if (!kit) kit = this.lastKit.get(cat.id) ?? this.rng.pick([...KIT_IDS]);
      this.kits.set(cat.id, kit);
      this.lastKit.set(cat.id, kit);
      this.equip(cat, kit);
    }
    this.phase = 'ready';
    this.phaseLeft = this.readyS;
  }

  private startFight(): void {
    this.phase = 'fight';
    this.phaseLeft = 0;
    this.time = 0;
    this.emit({ e: 'zone', phase: 0, shrinking: false });
  }

  private nextRound(): void {
    if (this.roundWinner !== null && this.roundWinner >= 0) this.round++;
    this.resetRound();
  }

  /** Vuelve todo al principio de una ronda: gatos, muros, cajas, zona y cerebros de los bots. */
  private resetRound(): void {
    this.shots.length = 0;
    this.shotLog.length = 0;
    for (const w of this.walls.values()) this.map.solid[w.ty * this.map.w + w.tx] = 0;
    this.walls.clear();
    this.wallByTile.clear();
    this.containers.clear();
    const lootRng = createRng(
      (this.seed ^ 0xc0ffee ^ (this.round * 7919 + this.draws * 131)) >>> 0,
    );
    for (const spot of this.map.chests) {
      this.containers.set(spot.id, {
        id: spot.id,
        kind: 'ammo',
        x: spot.x,
        y: spot.y,
        items: rollAmmoCrate(lootRng),
        opened: false,
        title: 'Caja de munición',
      });
    }
    this.time = 0;
    this.lastZoneKey = -1;
    this.zone = zoneAt(this.plan, mapWidthPx(this.map), mapHeightPx(this.map), 0, this.zoneSpec);
    for (const cat of this.cats) {
      cat.x = cat.spawn.x;
      cat.y = cat.spawn.y;
      cat.hp = CAT.maxHp;
      cat.shield = CAT.startShield;
      cat.alive = true;
      cat.aim = cat.team === 1 ? Math.PI : 0;
      cat.inv = emptyInventory();
      cat.ammo = emptyAmmo();
      cat.stamina = fullStamina();
      cat.running = false;
      cat.moving = false;
      cat.sel = 0;
      cat.heal = null;
      cat.reload = null;
      cat.cooldownUntil = 0;
      cat.emoteUntil = 0;
      cat.hurtUntil = 0;
      cat.prevFire = false;
      cat.queue.length = 0;
      cat.budget = 3 * TICK_DT;
      cat.killerId = null;
      cat.diedAt = 0;
      cat.placement = 0;
      cat.zoneAcc = 0;
      cat.waterAcc = 0;
      cat.spectate = null;
      cat.invDirty = true;
      if (cat.bot)
        this.brains.set(
          cat.id,
          new BotBrain(
            this,
            cat,
            createRng((this.seed + cat.id * 7919 + this.round * 104729) >>> 0),
          ),
        );
    }
    this.kits.clear();
    this.hold = [0, 0];
    this.initPoints();
    this.roundWinner = null;
    this.phase = 'pick';
    this.phaseLeft = this.pickS;
    this.scheduleBotPicks();
  }

  // ---------------------------------------------------------------- fin de ronda y de partida

  protected override afterSim(dt: number): void {
    if (this.phase !== 'fight') return;
    this.fightTotal += dt;
    this.updatePoints(dt);
  }

  protected override checkEnd(): void {
    if (this.phase !== 'fight') return;
    const a0 = this.teamAlive(0);
    const a1 = this.teamAlive(1);
    // Si todas las personas se fueron, no tiene caso seguir
    const humans = this.cats.filter((c) => !c.bot);
    if (humans.length > 0 && humans.every((c) => !c.connected)) return this.finishMatch(null);
    if (a0 > 0 && a1 > 0) {
      // Dominar todos los patios mucho tiempo da la ronda
      if (this.points.length > 0) {
        for (const t of [0, 1] as const) {
          if (this.hold[t] >= HOLD_TO_WIN_S) return this.endRound(t);
        }
      }
      if (this.time >= this.zoneSpec.timeline.end / this.zoneScale + ROUND_CAP_EXTRA_S) {
        // Se acabo el tiempo: gana quien conserve mas vida entre todos sus gatos
        const hp = (t: number): number =>
          this.cats.filter((c) => c.alive && c.team === t).reduce((s, c) => s + c.hp + c.shield, 0);
        const h0 = hp(0);
        const h1 = hp(1);
        return this.endRound(h0 === h1 ? -1 : h0 > h1 ? 0 : 1);
      }
      return;
    }
    this.endRound(a0 > 0 ? 0 : a1 > 0 ? 1 : -1);
  }

  private endRound(winner: number): void {
    // Dos empates seguidos y el tercero se resuelve a favor de quien hizo mas dano
    let w = winner;
    if (w < 0) {
      this.draws++;
      if (this.draws > 2) {
        const dmg = (t: number): number =>
          this.cats.filter((c) => c.team === t).reduce((s, c) => s + c.damageDealt, 0);
        w = dmg(0) >= dmg(1) ? 0 : 1;
      }
    }
    if (w >= 0) {
      this.draws = 0;
      this.wins[w as 0 | 1]++;
    }
    this.roundWinner = w;
    const msg = w < 0 ? 'Empate: se repite la ronda' : `Ronda para ${TEAM_NAMES[w as 0 | 1]}`;
    this.feed.push({ k: null, v: msg, m: msg });
    if (w >= 0 && (this.wins[w as 0 | 1] as number) >= this.roundsToWin) return this.finishMatch(w);
    if (this.round >= MAX_ROUNDS + 2) return this.finishMatch(this.wins[0] >= this.wins[1] ? 0 : 1);
    this.phase = 'between';
    this.phaseLeft = this.betweenS;
  }

  protected override finish(winner: Cat | null): void {
    const team = winner
      ? winner.team
      : this.wins[0] === this.wins[1]
        ? null
        : this.wins[0] > this.wins[1]
          ? 0
          : 1;
    this.finishMatch(team !== null && team >= 0 ? team : null);
  }

  private finishMatch(winnerTeam: number | null): void {
    this.phase = 'over';
    this.phaseLeft = 0;
    this.roundWinner = winnerTeam ?? -1;
    const rows: PlacementRow[] = this.cats
      .map((c) => ({
        id: c.id,
        name: c.name,
        bot: c.bot,
        placement: winnerTeam !== null && c.team === winnerTeam ? 1 : 2,
        kills: c.kills,
        survivalS: Math.round(this.fightTotal * 10) / 10,
        damageDealt: Math.round(c.damageDealt),
        team: c.team,
      }))
      .sort((a, b) => a.placement - b.placement || b.kills - a.kills);
    const top = rows[0];
    const winners = this.cats.filter((c) => winnerTeam !== null && c.team === winnerTeam);
    // Los que ya caerian eliminados siguen la celebracion de su equipo
    const star = winners.find((c) => c.alive) ?? winners[0] ?? null;
    if (star) for (const c of this.cats) if (!c.alive && !c.bot) c.spectate = star.id;
    const result: GameEndPayload = {
      winnerId: star?.id ?? top?.id ?? null,
      humanWon: winners.some((c) => !c.bot),
      durationS: Math.round(this.fightTotal * 10) / 10,
      rows,
      winnerTeam,
      score: [this.wins[0], this.wins[1]],
      mode: this.mode,
    };
    this.result = result;
  }

  // ---------------------------------------------------------------- territorio

  private initPoints(): void {
    this.points = (this.map.points ?? []).map(() => ({ owner: -1, capTeam: -1, prog: 0 }));
  }

  private updatePoints(dt: number): void {
    const defs = this.map.points ?? [];
    for (let i = 0; i < defs.length; i++) {
      const def = defs[i] as NonNullable<typeof this.map.points>[number];
      const st = this.points[i] as PointState;
      const inside = [0, 0];
      for (const c of this.cats) {
        if (!c.alive || c.team < 0) continue;
        if (Math.hypot(c.x - def.x, c.y - def.y) <= def.r) {
          inside[c.team] = (inside[c.team] as number) + 1;
          // los patios propios curan despacio a quien se queda
          if (st.owner === c.team && c.hp < CAT.maxHp)
            c.hp = Math.min(CAT.maxHp, c.hp + POINT_HEAL * dt);
        }
      }
      const [n0, n1] = inside as [number, number];
      if (n0 > 0 && n1 > 0) continue; // disputado: nadie avanza
      const team = n0 > 0 ? 0 : n1 > 0 ? 1 : -1;
      if (team < 0) {
        // sin nadie, la captura a medias se va deshaciendo
        if (st.owner < 0 && st.prog > 0) st.prog = Math.max(0, st.prog - 10 * dt);
        continue;
      }
      if (st.owner === team) continue;
      const crowd = Math.min(3, team === 0 ? n0 : n1);
      const rate = (100 / CAPTURE_SECONDS) * (1 + 0.45 * (crowd - 1));
      if (st.capTeam !== team) {
        st.prog = Math.max(0, st.prog - rate * dt);
        if (st.prog <= 0) {
          st.capTeam = team;
          if (st.owner >= 0 && st.owner !== team) st.owner = -1;
        }
      } else {
        st.prog = Math.min(100, st.prog + rate * dt);
        if (st.prog >= 100) {
          st.owner = team;
          st.prog = 100;
          const msg = `${TEAM_NAMES[team as 0 | 1]} toma ${def.name}`;
          this.feed.push({ k: null, v: msg, m: msg });
        }
      }
    }
    // dominio: todos los patios de un mismo equipo
    if (defs.length > 0) {
      const owner = this.points[0]?.owner ?? -1;
      const all = owner >= 0 && this.points.every((p) => p.owner === owner);
      this.hold = [
        all && owner === 0 ? this.hold[0] + dt : 0,
        all && owner === 1 ? this.hold[1] + dt : 0,
      ];
    }
  }

  // ---------------------------------------------------------------- bots

  override botGoal(cat: Cat): { x: number; y: number } | null {
    const defs = this.map.points ?? [];
    if (defs.length > 0) {
      // el patio mas cercano que no sea del equipo
      let best: { x: number; y: number } | null = null;
      let bestD = Infinity;
      defs.forEach((d, i) => {
        const st = this.points[i] as PointState;
        if (st.owner === cat.team) return;
        const dd = Math.hypot(d.x - cat.x, d.y - cat.y);
        if (dd < bestD) {
          bestD = dd;
          best = { x: d.x, y: d.y };
        }
      });
      if (best) return best;
      // si ya es todo suyo, defiende el que tenga enemigos cerca (el del medio)
      const mid = defs[Math.floor(defs.length / 2)] as { x: number; y: number };
      return { x: mid.x, y: mid.y };
    }
    // Pelea en el techo: hacia el centro de la tormenta, que es donde acaba todo
    return { x: this.zone.circle.cx, y: this.zone.circle.cy };
  }

  /** Solo para pruebas: el equipo `team` gana la ronda en curso eliminando al otro. */
  forceRoundWin(team: number): void {
    if (this.phase !== 'fight') return;
    this.time = Math.max(this.time, this.graceS + 0.1);
    for (const c of this.cats) {
      if (c.alive && c.team !== team) this.damageCat(c, 99999, null);
    }
  }

  // ---------------------------------------------------------------- jugadores eliminados

  protected override spectateTarget(target: Cat, killer: Cat | null): number | null {
    const mate = this.cats.find((c) => c.alive && c.team === target.team && c.id !== target.id);
    if (mate) return mate.id;
    return killer && killer.alive ? killer.id : (this.aliveCats()[0]?.id ?? null);
  }

  /** Aqui nadie queda "en el puesto N": se queda mirando a su equipo hasta que acabe la ronda. */
  override drainDeaths(): { catId: number; payload: DiedPayload }[] {
    super.drainDeaths();
    return [];
  }

  // ---------------------------------------------------------------- instantanea

  protected override extendSnapshot(snap: BRSnapshot, cat: Cat): void {
    snap.mode = this.mode;
    const revealed = this.phase !== 'pick';
    const picks: PvpState['picks'] = [];
    for (const c of this.cats) {
      if (c.team !== cat.team && !revealed) continue;
      picks.push({ id: c.id, kit: this.kits.get(c.id) ?? null });
    }
    const pvp: PvpState = {
      phase: this.phase,
      round: this.round,
      wins: [this.wins[0], this.wins[1]],
      left: Math.max(0, Math.ceil(this.phaseLeft - 1e-6)),
      team: cat.team,
      teamSize: this.teamSize,
      kit: this.kits.get(cat.id) ?? this.lastKit.get(cat.id) ?? null,
      picks,
      roundWinner: this.roundWinner,
    };
    if (this.points.length > 0) {
      pvp.points = this.points.map((p) => [
        p.owner,
        p.owner >= 0 ? 100 : Math.round(p.prog),
        p.capTeam,
      ]);
      pvp.hold = [Math.round(this.hold[0]), Math.round(this.hold[1])];
    }
    snap.pvp = pvp;
    // Mientras se elige o se cuenta, el cliente se queda quieto
    snap.intro = 0;
  }
}
