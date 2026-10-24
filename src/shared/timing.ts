/**
 * Limitador de cuadros. Decide en cada requestAnimationFrame si toca dibujar para sostener un
 * objetivo fijo (60 FPS) sin importar si el monitor refresca a 60, 120, 144 o 240 Hz.
 */
export class FrameLimiter {
  private readonly interval: number;
  private next = 0;
  private last = 0;
  private avgFrame = 1000 / 60;

  constructor(targetFps = 60) {
    this.interval = 1000 / targetFps;
  }

  shouldRender(now: number): boolean {
    if (this.last > 0) {
      const frame = Math.min(100, Math.max(1, now - this.last));
      this.avgFrame += (frame - this.avgFrame) * 0.1;
    }
    this.last = now;

    if (this.next === 0) {
      this.next = now + this.interval;
      return true;
    }
    // Media vsync de tolerancia: sin ella un monitor de 144 Hz quedaria por debajo de 60 FPS.
    const tolerance = Math.min(this.avgFrame * 0.5, 4);
    if (now + tolerance < this.next) return false;

    this.next += this.interval;
    if (this.next < now - this.interval) this.next = now + this.interval;
    return true;
  }
}

/**
 * Acumulador de paso fijo. Convierte el tiempo real (delta time) en un numero entero de pasos de
 * simulacion, de modo que la velocidad del juego no dependa de la tasa de refresco.
 */
export class FixedStepper {
  private acc = 0;

  constructor(
    readonly step: number,
    private readonly maxSteps = 5,
  ) {}

  advance(dt: number): number {
    this.acc += Math.min(Math.max(dt, 0), 0.25);
    let steps = 0;
    while (this.acc >= this.step && steps < this.maxSteps) {
      this.acc -= this.step;
      steps++;
    }
    if (this.acc >= this.step) this.acc %= this.step;
    return steps;
  }

  /** Fraccion del paso en curso, para interpolar el dibujo entre dos estados. */
  get alpha(): number {
    return this.acc / this.step;
  }

  reset(): void {
    this.acc = 0;
  }
}
