export interface ComponentHealth {
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastError: string | null;
  consecutiveFailures: number;
}

export class HealthTracker {
  readonly components = new Map<string, ComponentHealth>();

  private get(name: string): ComponentHealth {
    let entry = this.components.get(name);
    if (!entry) {
      entry = { lastSuccessAt: null, lastFailureAt: null, lastError: null, consecutiveFailures: 0 };
      this.components.set(name, entry);
    }
    return entry;
  }

  ok(name: string): void {
    const entry = this.get(name);
    entry.lastSuccessAt = new Date().toISOString();
    entry.consecutiveFailures = 0;
  }

  fail(name: string, error: unknown): void {
    const entry = this.get(name);
    entry.lastFailureAt = new Date().toISOString();
    entry.lastError = error instanceof Error ? error.message : String(error);
    entry.consecutiveFailures += 1;
  }

  snapshot(): Record<string, ComponentHealth> {
    return Object.fromEntries(this.components);
  }
}
