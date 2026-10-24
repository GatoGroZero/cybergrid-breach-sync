import express, { Router, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { performance } from 'node:perf_hooks';
import { ZodError } from 'zod';
import { generateSyntheticMatches, parseSeedPayload, SEED_MAX_MATCHES } from '../shared/seed';
import { computeStats, type Totals } from '../shared/stats';
import type { Config } from './config';
import type { Repo } from './db';
import type { Metrics } from './metrics';

export interface RuntimeInfo {
  rooms: number;
  players: number;
  sockets: number;
}

export interface TestApiDeps {
  repo: Repo;
  config: Config;
  metrics: Metrics;
  runtime: () => RuntimeInfo;
}

const sumTotals = (a: Totals, b: Totals): Totals => ({
  matches: a.matches + b.matches,
  wins: a.wins + b.wins,
  kills: a.kills + b.kills,
  deaths: a.deaths + b.deaths,
  appearances: a.appearances + b.appearances,
  survived: a.survived + b.survived,
  survivalSeconds: a.survivalSeconds + b.survivalSeconds,
});

const ms = (v: number): number => Math.round(v * 100) / 100;

function summary(t: Totals) {
  const s = computeStats(t);
  return { matches: t.matches, winRate: s.winRate, kdr: s.kdr, survivalRate: s.survivalRate };
}

/** Cuerpo de GET /api/test/telemetry. Las metricas salen de agregaciones SQL, no de recorrer filas. */
export function buildTelemetry(deps: TestApiDeps) {
  const t0 = performance.now();
  const totals = deps.repo.totals();
  const queryMs = performance.now() - t0;
  const all = sumTotals(totals.real, totals.seed);
  const stats = computeStats(all);
  const runtime = deps.runtime();
  return {
    status: 'ok',
    generatedAt: new Date().toISOString(),
    matches: { total: all.matches, wins: all.wins, losses: all.matches - all.wins },
    winRate: stats.winRate,
    kdr: stats.kdr,
    survivability: { survivalRate: stats.survivalRate, avgSurvivalSec: stats.avgSurvivalSec },
    combat: { kills: all.kills, deaths: all.deaths },
    network: { ...deps.metrics.rttStats(), targetMs: 100 },
    server: {
      version: deps.config.version,
      uptimeS: deps.metrics.uptimeS(),
      tickHz: deps.config.tickHz,
      eventLoopLagMs: deps.metrics.eventLoop(),
      rooms: runtime.rooms,
      playersOnline: runtime.players,
      sockets: runtime.sockets,
    },
    breakdown: { real: summary(totals.real), seed: summary(totals.seed) },
    meta: { queryMs: ms(queryMs), serverMs: 0, source: 'sqlite' },
  };
}

function rawBody(req: Request): unknown {
  const text = typeof req.body === 'string' ? req.body.trim() : '';
  if (text === '') return undefined;
  try {
    return JSON.parse(text);
  } catch {
    // curl -d 'count=100' sin cabecera: se lee como formulario en vez de fallar.
    const form = Object.fromEntries(new URLSearchParams(text));
    return Object.keys(form).length > 0 ? form : undefined;
  }
}

function timing(res: Response, parts: Record<string, number>): void {
  res.setHeader(
    'Server-Timing',
    Object.entries(parts)
      .map(([name, dur]) => `${name};dur=${ms(dur)}`)
      .join(', '),
  );
}

/**
 * Endpoints de evaluacion. Son publicos a proposito porque el enunciado los exige; se protegen
 * con limites de tasa, tamano de cuerpo y un tope de partidas, y se leen de forma tolerante.
 */
export function testRouter(deps: TestApiDeps): Router {
  const router = Router();
  const { config, repo } = deps;

  router.use((req, res, next) => {
    res.set({
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Expose-Headers': 'Server-Timing',
      'Cache-Control': 'no-store',
    });
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    if (!config.testEndpoints) {
      res.status(404).json({ error: 'no_disponible', mensaje: 'Endpoints de prueba desactivados' });
      return;
    }
    next();
  });

  const limited = (limit: number) =>
    rateLimit({
      windowMs: 60 * 1000,
      limit,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      message: {
        error: 'demasiadas_peticiones',
        mensaje: 'Demasiadas peticiones, espera un momento',
      },
    });

  router.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      version: config.version,
      uptimeS: deps.metrics.uptimeS(),
      time: new Date().toISOString(),
      clientIp: req.ip,
    });
  });

  router.get('/telemetry', limited(config.limits.telemetry), (_req, res) => {
    const t0 = performance.now();
    const body = buildTelemetry(deps);
    body.meta.serverMs = ms(performance.now() - t0);
    timing(res, { db: body.meta.queryMs, total: body.meta.serverMs });
    res.json(body);
  });

  router.post(
    '/seed',
    limited(config.limits.seed),
    express.text({ type: () => true, limit: '256kb' }),
    (req, res) => {
      const t0 = performance.now();
      let payload;
      try {
        payload = parseSeedPayload(rawBody(req));
      } catch (err) {
        if (!(err instanceof ZodError)) throw err;
        res.status(400).json({
          error: 'payload_invalido',
          mensaje: `La cantidad de partidas debe estar entre 1 y ${SEED_MAX_MATCHES} (rango oficial: 100 a 1000)`,
          detalles: err.issues.map((i) => ({
            campo: i.path.join('.') || '(cuerpo)',
            mensaje: i.message,
          })),
        });
        return;
      }

      const matches = payload.matches ?? generateSyntheticMatches(payload);
      const t1 = performance.now();
      const inserted = repo.seedMatches(matches, payload.seed, payload.replace);
      const insertMs = performance.now() - t1;
      const telemetry = buildTelemetry(deps);
      const total = performance.now() - t0;
      timing(res, { insert: insertMs, db: telemetry.meta.queryMs, total });
      res.status(200).json({
        status: 'ok',
        inserted,
        replaced: payload.replace,
        seed: payload.seed,
        durationMs: ms(total),
        insertMs: ms(insertMs),
        queryMs: telemetry.meta.queryMs,
        telemetry: {
          matches: telemetry.matches,
          winRate: telemetry.winRate,
          kdr: telemetry.kdr,
          survivability: telemetry.survivability,
        },
      });
    },
  );

  router.delete('/seed', limited(config.limits.seed), (_req, res) => {
    const removed = repo.clearSeeded();
    res.status(200).json({ status: 'ok', removed });
  });

  return router;
}
