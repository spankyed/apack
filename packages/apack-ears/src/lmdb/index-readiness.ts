/** The native builder runs off-thread; waiting must poll status without blocking foreground JS. */
export interface NativeIndexSource {
  readonly isOpen: boolean;
  readonly readOnly: boolean;
  readonly schema: unknown;
  indexStatus(): { type: string | null; index: string; built: boolean; failure: string | null }[];
}

export function createNativeIndexReadiness(source: NativeIndexSource, hasOpenUnit: () => boolean) {
  const waiters = new Set<{ types?: Set<string>; signature?: string; resolve(): void; reject(error: unknown): void }>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const problem = (code: string, message: string) => Object.assign(new Error(message), { code });
  const signature = (types: Set<string>) => {
    const schema = source.schema as { types?: Record<string, unknown> };
    return JSON.stringify([...types].sort().map(type => [type, schema.types?.[type]]));
  };
  const checkOpen = () => {
    if (!source.isOpen) throw problem('CLOSED', 'The database is closed');
    if (hasOpenUnit()) throw problem('UNIT_OPEN', 'Commit or abort the open unit before waiting for indexes');
  };
  const poll = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    if (!waiters.size) return;
    try {
      checkOpen();
      const status = source.indexStatus();
      for (const waiter of waiters) {
        try {
          if (waiter.types && signature(waiter.types) !== waiter.signature)
            throw problem('CANCELLED', 'Index declarations changed while awaiting readiness');
          const selected = status.filter(index => !waiter.types || (index.type !== null && waiter.types.has(index.type)));
          const failed = selected.find(index => index.failure !== null);
          if (failed) throw problem('INDEX_FAILED', failed.failure!);
          if (selected.some(index => !index.built)) {
            if (source.readOnly) throw problem('INDEX_BUILDING', 'A writable owner must finish indexing');
            continue;
          }
          waiter.resolve();
        } catch (error) { waiter.reject(error); }
        waiters.delete(waiter);
      }
    } catch (error) {
      for (const waiter of waiters) waiter.reject(error);
      waiters.clear();
    }
    // An explicit waiter retains this timer; no timer or background ownership remains after settlement.
    if (waiters.size) timer = setTimeout(poll, 10);
  };
  return {
    wait(types?: readonly string[]): Promise<void> {
      try {
        checkOpen();
        const scope = types === undefined ? undefined : new Set(types);
        return new Promise<void>((resolve, reject) => {
          waiters.add({ types: scope, signature: scope && signature(scope), resolve, reject });
          poll();
        });
      } catch (error) { return Promise.reject(error); }
    },
    changed: poll,
    invalidate(code = 'CANCELLED') {
      for (const waiter of waiters) waiter.reject(problem(code, 'Database ownership changed while awaiting indexes'));
      waiters.clear();
      if (timer) clearTimeout(timer);
      timer = undefined;
    },
  };
}
