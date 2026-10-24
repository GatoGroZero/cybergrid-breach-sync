import { io, type Socket } from 'socket.io-client';
import type { Ack, PongPayload } from '../shared/protocol';

/** Conexion WebSocket con el servidor y medicion continua de latencia con eventos ping y pong. */
export class Net {
  readonly socket: Socket;
  /** RTT mas reciente en ms y su mediana de las ultimas muestras. */
  rtt = 0;
  rttMedian = 0;
  private readonly samples: number[] = [];
  private pingTimer: number | null = null;

  constructor() {
    this.socket = io({
      transports: ['websocket'],
      reconnectionDelay: 500,
      reconnectionDelayMax: 4000,
    });
    this.socket.on('pong', (p: PongPayload) => {
      const rtt = performance.now() - p.t;
      if (!Number.isFinite(rtt) || rtt < 0) return;
      this.rtt = rtt;
      this.samples.push(rtt);
      if (this.samples.length > 7) this.samples.shift();
      const sorted = [...this.samples].sort((a, b) => a - b);
      this.rttMedian = sorted[Math.floor(sorted.length / 2)] ?? rtt;
    });
    this.socket.on('connect', () => this.startPing());
    this.socket.on('disconnect', () => this.stopPing());
  }

  get connected(): boolean {
    return this.socket.connected;
  }

  private startPing(): void {
    this.stopPing();
    const send = (): void => {
      if (!this.socket.connected) return;
      this.socket.emit('ping', { t: performance.now(), rtt: Math.round(this.rttMedian * 10) / 10 });
    };
    send();
    this.pingTimer = window.setInterval(send, 1000);
  }

  private stopPing(): void {
    if (this.pingTimer !== null) window.clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  /** Resuelve cuando la conexion queda abierta; rechaza si la sesion no es valida. */
  ready(): Promise<void> {
    if (this.socket.connected) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const ok = (): void => {
        this.socket.off('connect_error', bad);
        resolve();
      };
      const bad = (err: Error): void => {
        if (err.message === 'unauthorized') {
          this.socket.off('connect', ok);
          this.socket.off('connect_error', bad);
          reject(err);
        }
      };
      this.socket.once('connect', ok);
      this.socket.on('connect_error', bad);
    });
  }

  ack<T = unknown>(event: string, payload?: unknown): Promise<Ack<T>> {
    return new Promise((resolve) => {
      const timer = window.setTimeout(() => resolve({ ok: false, error: 'sin_respuesta' }), 5000);
      const done = (a: Ack<T>): void => {
        window.clearTimeout(timer);
        resolve(a);
      };
      if (payload === undefined) this.socket.emit(event, done);
      else this.socket.emit(event, payload, done);
    });
  }

  close(): void {
    this.stopPing();
    this.socket.close();
  }
}
