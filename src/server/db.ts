import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { SyntheticMatch } from '../shared/seed';
import { EMPTY_TOTALS, type Totals } from '../shared/stats';

export interface UserRow {
  id: number;
  username: string;
  pass_hash: string;
  created_at: number;
}

export interface MatchRecord {
  code: string;
  seed: number;
  startedAt: number;
  durationS: number;
  result: 'win' | 'loss';
  wave: number;
  players: {
    userId: number | null;
    username: string;
    kills: number;
    deaths: number;
    damageDealt: number;
    survivalS: number;
    survived: boolean;
  }[];
}

export type Source = 'real' | 'seed';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  pass_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT,
  seed INTEGER,
  started_at INTEGER NOT NULL,
  duration_s REAL NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('win', 'loss')),
  players INTEGER NOT NULL,
  wave INTEGER NOT NULL,
  source TEXT NOT NULL DEFAULT 'real'
);
CREATE TABLE IF NOT EXISTS match_players (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  user_id INTEGER,
  username TEXT,
  kills INTEGER NOT NULL,
  deaths INTEGER NOT NULL,
  damage_dealt REAL NOT NULL,
  survival_s REAL NOT NULL,
  survived INTEGER NOT NULL,
  source TEXT NOT NULL DEFAULT 'real'
);
CREATE INDEX IF NOT EXISTS idx_matches_source ON matches(source);
CREATE INDEX IF NOT EXISTS idx_mp_match ON match_players(match_id);
CREATE INDEX IF NOT EXISTS idx_mp_source ON match_players(source);
`;

interface MatchAgg {
  source: Source;
  matches: number;
  wins: number | null;
}

interface PlayerAgg {
  source: Source;
  appearances: number;
  kills: number | null;
  deaths: number | null;
  survived: number | null;
  survival_seconds: number | null;
}

export class Repo {
  readonly db: Database.Database;
  private readonly insertUser;
  private readonly findByName;
  private readonly findById;
  private readonly insertMatch;
  private readonly insertPlayer;
  private readonly aggMatches;
  private readonly aggPlayers;
  private readonly deleteSeeded;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('foreign_keys = ON');
    this.db.exec(SCHEMA);

    this.insertUser = this.db.prepare(
      'INSERT INTO users (username, pass_hash, created_at) VALUES (?, ?, ?)',
    );
    this.findByName = this.db.prepare('SELECT * FROM users WHERE username = ?');
    this.findById = this.db.prepare('SELECT * FROM users WHERE id = ?');
    this.insertMatch = this.db.prepare(
      `INSERT INTO matches (code, seed, started_at, duration_s, result, players, wave, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    this.insertPlayer = this.db.prepare(
      `INSERT INTO match_players
         (match_id, user_id, username, kills, deaths, damage_dealt, survival_s, survived, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    this.aggMatches = this.db.prepare(
      `SELECT source, COUNT(*) AS matches, SUM(result = 'win') AS wins FROM matches GROUP BY source`,
    );
    this.aggPlayers = this.db.prepare(
      `SELECT source, COUNT(*) AS appearances, SUM(kills) AS kills, SUM(deaths) AS deaths,
              SUM(survived) AS survived, SUM(survival_s) AS survival_seconds
         FROM match_players GROUP BY source`,
    );
    this.deleteSeeded = this.db.prepare(`DELETE FROM matches WHERE source = 'seed'`);
  }

  close(): void {
    this.db.close();
  }

  /** Devuelve el id nuevo, o null si el usuario ya existe (sin distinguir mayusculas). */
  createUser(username: string, passHash: string): number | null {
    try {
      const info = this.insertUser.run(username, passHash, Date.now());
      return Number(info.lastInsertRowid);
    } catch (err) {
      if ((err as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE') return null;
      throw err;
    }
  }

  getUserByName(username: string): UserRow | undefined {
    return this.findByName.get(username) as UserRow | undefined;
  }

  getUserById(id: number): UserRow | undefined {
    return this.findById.get(id) as UserRow | undefined;
  }

  saveMatch(record: MatchRecord, source: Source = 'real'): number {
    const run = this.db.transaction((): number => {
      const info = this.insertMatch.run(
        record.code,
        record.seed,
        record.startedAt,
        record.durationS,
        record.result,
        record.players.length,
        record.wave,
        source,
      );
      const matchId = Number(info.lastInsertRowid);
      for (const p of record.players) {
        this.insertPlayer.run(
          matchId,
          p.userId,
          p.username,
          p.kills,
          p.deaths,
          p.damageDealt,
          p.survivalS,
          p.survived ? 1 : 0,
          source,
        );
      }
      return matchId;
    });
    return run();
  }

  /** Inserta partidas sinteticas en una sola transaccion; con replace borra las sembradas antes. */
  seedMatches(matches: SyntheticMatch[], seed: number, replace: boolean): number {
    const run = this.db.transaction((): number => {
      if (replace) this.deleteSeeded.run();
      const now = Date.now();
      matches.forEach((m, i) => {
        const info = this.insertMatch.run(
          `S${i}`,
          seed,
          now - i * 1000,
          m.durationS,
          m.result,
          m.players.length,
          m.wave,
          'seed',
        );
        const matchId = Number(info.lastInsertRowid);
        m.players.forEach((p, j) => {
          this.insertPlayer.run(
            matchId,
            null,
            `seed${j + 1}`,
            Math.round(p.kills),
            Math.round(p.deaths),
            p.damageDealt,
            p.survivalS,
            p.survived ? 1 : 0,
            'seed',
          );
        });
      });
      return matches.length;
    });
    return run();
  }

  /** Totales por origen. Dos agregaciones sobre tablas indexadas, rapidas aun con miles de filas. */
  totals(): Record<Source, Totals> {
    const out: Record<Source, Totals> = {
      real: { ...EMPTY_TOTALS },
      seed: { ...EMPTY_TOTALS },
    };
    for (const row of this.aggMatches.all() as MatchAgg[]) {
      out[row.source].matches = row.matches;
      out[row.source].wins = row.wins ?? 0;
    }
    for (const row of this.aggPlayers.all() as PlayerAgg[]) {
      const t = out[row.source];
      t.appearances = row.appearances;
      t.kills = row.kills ?? 0;
      t.deaths = row.deaths ?? 0;
      t.survived = row.survived ?? 0;
      t.survivalSeconds = row.survival_seconds ?? 0;
    }
    return out;
  }
}
