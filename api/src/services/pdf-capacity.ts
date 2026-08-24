export class PdfCapacityError extends Error {
  readonly retryAfterSeconds = 5;
  constructor(message = "El generador de informes estÃ¡ ocupado. Intente nuevamente.") {
    super(message);
    this.name = "PdfCapacityError";
  }
}

interface Waiter {
  resolve: (release: () => void) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export class PdfCapacityGate {
  private active = 0;
  private readonly queue: Waiter[] = [];
  readonly maxConcurrent: number;
  readonly maxQueue: number;
  readonly queueTimeoutMs: number;

  constructor(
    maxConcurrent: number,
    maxQueue: number,
    queueTimeoutMs: number,
  ) {
    this.maxConcurrent = maxConcurrent;
    this.maxQueue = maxQueue;
    this.queueTimeoutMs = queueTimeoutMs;
  }

  acquire(): Promise<() => void> {
    if (this.active < this.maxConcurrent) {
      this.active += 1;
      return Promise.resolve(this.releaseFactory());
    }
    if (this.queue.length >= this.maxQueue) return Promise.reject(new PdfCapacityError());

    return new Promise((resolve, reject) => {
      const waiter: Waiter = {
        resolve,
        reject,
        timer: setTimeout(() => {
          const index = this.queue.indexOf(waiter);
          if (index >= 0) this.queue.splice(index, 1);
          reject(new PdfCapacityError("Se agotÃ³ el tiempo de espera para generar el informe."));
        }, this.queueTimeoutMs),
      };
      waiter.timer.unref();
      this.queue.push(waiter);
    });
  }

  snapshot(): { active: number; queued: number } {
    return { active: this.active, queued: this.queue.length };
  }

  private releaseFactory(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.queue.shift();
      if (next) {
        clearTimeout(next.timer);
        next.resolve(this.releaseFactory());
      } else {
        this.active -= 1;
      }
    };
  }
}
