import { describe, expect, it } from 'vitest';
import { PLAYER, SIM_DT, TILE } from '../../src/shared/constants';
import { computeFlowField, flowDirection } from '../../src/shared/flow';
import { hasLineOfSight, moveBody, normalizeMove, stepPlayer } from '../../src/shared/physics';
import { computeStats, EMPTY_TOTALS, percentile } from '../../src/shared/stats';
import { WALL } from '../../src/shared/map';
import { openMap } from './helpers';

describe('fisica compartida entre cliente y servidor', () => {
  it('el movimiento es el mismo para la misma secuencia de inputs (determinista)', () => {
    const run = () => {
      const map = openMap();
      const m = { x: 100, y: 100 };
      for (let i = 0; i < 60; i++)
        stepPlayer(map, m, { mx: Math.cos(i / 9), my: Math.sin(i / 9) }, SIM_DT);
      return m;
    };
    expect(run()).toEqual(run());
  });

  it('no permite atravesar muros ni superar la velocidad maxima, aunque se pida mas', () => {
    const map = openMap();
    const m = { x: 100, y: 100 };
    stepPlayer(map, m, { mx: 50, my: 0 }, SIM_DT);
    expect(m.x - 100).toBeLessThanOrEqual(PLAYER.speed * SIM_DT + 1e-6);
    for (let i = 0; i < 400; i++) stepPlayer(map, m, { mx: 1, my: 0 }, SIM_DT);
    expect(m.x).toBeLessThan((map.w - 1) * TILE - PLAYER.radius + 1);
    const slide = moveBody(map, m.x, 100, 20, 5, PLAYER.radius);
    expect(slide.y).toBeGreaterThan(100);
  });

  it('un movimiento invalido (NaN) se ignora en lugar de corromper la posicion', () => {
    const n = normalizeMove(Number.NaN, 1);
    expect(n).toEqual({ mx: 0, my: 0 });
    expect(normalizeMove(3, 4).mx).toBeCloseTo(0.6, 5);
  });

  it('el campo de flujo lleva a los drones alrededor de un muro y la linea de vista se bloquea', () => {
    const map = openMap(12, 12);
    for (let y = 1; y < 9; y++) map.tiles[y * map.w + 6] = WALL;
    const player = { x: 9.5 * TILE, y: 4.5 * TILE };
    const field = computeFlowField(map, [player]);
    const start = { x: 2.5 * TILE, y: 4.5 * TILE };
    expect(hasLineOfSight(map, start.x, start.y, player.x, player.y)).toBe(false);
    let x = start.x;
    let y = start.y;
    for (let i = 0; i < 600; i++) {
      const dir = flowDirection(map, field, x, y);
      if (!dir) break;
      const next = moveBody(map, x, y, dir.x * 4, dir.y * 4, 8);
      x = next.x;
      y = next.y;
    }
    expect(Math.hypot(x - player.x, y - player.y)).toBeLessThan(TILE * 1.5);
  });
});

describe('metricas de telemetria', () => {
  it('con la base vacia devuelve ceros y nunca NaN', () => {
    const s = computeStats(EMPTY_TOTALS);
    expect(s).toEqual({ winRate: 0, kdr: 0, survivalRate: 0, avgSurvivalSec: 0 });
  });

  it('calcula winRate, kdr y supervivencia con las definiciones documentadas', () => {
    const s = computeStats({
      matches: 10,
      wins: 6,
      kills: 90,
      deaths: 30,
      appearances: 20,
      survived: 15,
      survivalSeconds: 3000,
    });
    expect(s.winRate).toBe(0.6);
    expect(s.kdr).toBe(3);
    expect(s.survivalRate).toBe(0.75);
    expect(s.avgSurvivalSec).toBe(150);
    expect(computeStats({ ...EMPTY_TOTALS, kills: 12 }).kdr).toBe(12);
  });

  it('calcula percentiles de una lista ordenada', () => {
    const data = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(data, 0.5)).toBe(50);
    expect(percentile(data, 0.95)).toBe(95);
    expect(percentile([], 0.5)).toBe(0);
  });
});
