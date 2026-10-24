import { describe, expect, it } from 'vitest';
import { TICK_DT } from '../../src/shared/br/constants';
import { FixedStepper, FrameLimiter } from '../../src/shared/timing';
import { stepCat } from '../../src/shared/br/physics';
import { openMap } from './helpers';

/** Simula `seconds` de requestAnimationFrame a la tasa de refresco indicada, con algo de ruido. */
function simulateFrames(refreshHz: number, seconds: number): number[] {
  const period = 1000 / refreshHz;
  const times: number[] = [];
  let seed = 7;
  const jitter = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed / 2147483647 - 0.5) * 0.6;
  };
  for (let t = period; t <= seconds * 1000; t += period) times.push(t + jitter());
  return times;
}

describe('bucle de 60 FPS por delta time', () => {
  it.each([60, 75, 120, 144, 240])('el limitador sostiene ~60 FPS en un monitor de %i Hz', (hz) => {
    const limiter = new FrameLimiter(60);
    const frames = simulateFrames(hz, 10);
    let rendered = 0;
    for (const t of frames) if (limiter.shouldRender(t)) rendered++;
    const fps = rendered / 10;
    expect(fps).toBeGreaterThan(58);
    expect(fps).toBeLessThan(62);
  });

  it('la velocidad de movimiento no depende de la tasa de refresco', () => {
    const distanceAt = (hz: number): number => {
      const map = openMap(120, 20);
      const motion = { x: 64, y: 160 };
      const stepper = new FixedStepper(TICK_DT);
      let last = 0;
      for (const t of simulateFrames(hz, 3)) {
        const steps = stepper.advance((t - last) / 1000);
        last = t;
        for (let i = 0; i < steps; i++) stepCat(map, motion, { mx: 1, my: 0 }, TICK_DT);
      }
      return motion.x - 64;
    };
    const d60 = distanceAt(60);
    const d144 = distanceAt(144);
    const d240 = distanceAt(240);
    expect(Math.abs(d60 - d144)).toBeLessThan(15);
    expect(Math.abs(d60 - d240)).toBeLessThan(15);
    expect(d60).toBeGreaterThan(200);
  });

  it('un cuadro muy largo (pestana en segundo plano) no dispara una rafaga de pasos', () => {
    const stepper = new FixedStepper(TICK_DT, 5);
    expect(stepper.advance(30)).toBeLessThanOrEqual(5);
    expect(stepper.alpha).toBeLessThan(1);
  });
});
