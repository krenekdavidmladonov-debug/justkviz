interface QueuedMutation {
  execute: () => Promise<void>;
  supersede?: () => void;
}

/** Serializes revisioned writes while letting operator commands pass queued telemetry. */
export class LiveMutationQueue {
  private readonly commands: QueuedMutation[] = [];
  private readonly reports = new Map<string, QueuedMutation>();
  private running = false;

  enqueueCommand<T>(action: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.commands.push({
        execute: async () => {
          try { resolve(await action()); }
          catch (error) { reject(error instanceof Error ? error : new Error('Live mutation failed.', { cause: error })); }
        },
      });
      this.start();
    });
  }

  /** Only the latest waiting state for a playback generation needs publication. */
  enqueueReport<T>(reportKey: string, action: () => Promise<T>): Promise<T | undefined> {
    return new Promise<T | undefined>((resolve, reject) => {
      this.reports.get(reportKey)?.supersede?.();
      this.reports.set(reportKey, {
        execute: async () => {
          try { resolve(await action()); }
          catch (error) { reject(error instanceof Error ? error : new Error('Live mutation failed.', { cause: error })); }
        },
        supersede: () => resolve(undefined),
      });
      this.start();
    });
  }

  private start(): void {
    if (this.running) return;
    this.running = true;
    void this.drain();
  }

  private async drain(): Promise<void> {
    while (this.commands.length > 0 || this.reports.size > 0) {
      let mutation = this.commands.shift();
      if (!mutation) {
        const firstReport = this.reports.entries().next().value;
        if (!firstReport) break;
        const [key, report] = firstReport;
        this.reports.delete(key);
        mutation = report;
      }
      // An in-flight report must settle before a command reads its expected revision.
      await mutation.execute();
    }
    this.running = false;
  }
}
