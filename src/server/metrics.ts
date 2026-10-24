import { monitorEventLoopDelay } from 'node:perf_hooks';
import { percentile } from '../shared/stats';

const LOOP_RESOLUTION_MS = 10;

/** Metricas de proceso que alimentan la telemetria: latencia reportada por clientes y event loop. */
export class Metrics {
  private readonly rtt: number[] = [];
  private readonly histogram: ReturnType<typeof monitorEventLoopDelay>;
  private readonly timer: NodeJS.Timeout;
  readonly startedAt = Date.now();

  constructor(private readonly rttCapacity = 500) {
    this.histogram = monitorEventLoopDelay({ resolution: LOOP_RESOLUTION_MS });
    this.histogram.enable();
    this.timer = setInterval(() => this.histogram.reset(), 60_000);
    this.timer.unref();
  }

  stop(): void {
    this.histogram.disable();
    clearInterval(this.timer);
  }

  addRtt(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) return;
    this.rtt.push(ms);
    if (this.rtt.length > this.rttCapacity) this.rtt.shift();
  }

  rttStats(): { samples: number; p50Ms: number; p95Ms: number; maxMs: number } {
    const sorted = [...this.rtt].sort((a, b) => a - b);
    return {
      samples: sorted.length,
      p50Ms: round1(percentile(sorted, 0.5)),
      p95Ms: round1(percentile(sorted, 0.95)),
      maxMs: round1(sorted[sorted.length - 1] ?? 0),
    };
  }

  eventLoop(): { p50Ms: number; p99Ms: number; maxMs: number } {
    const h = this.histogram;
    // El histograma mide el intervalo completo del temporizador; el retraso real es lo que sobra.
    const ms = (ns: number): number =>
      Number.isFinite(ns) ? round1(Math.max(0, ns / 1e6 - LOOP_RESOLUTION_MS)) : 0;
    return { p50Ms: ms(h.percentile(50)), p99Ms: ms(h.percentile(99)), maxMs: ms(h.max) };
  }

  uptimeS(): number {
    return Math.round((Date.now() - this.startedAt) / 1000);
  }
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}
