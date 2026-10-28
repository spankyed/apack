import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

/** A periodic deadline independent of where the workload yields, including its final blocking operation. */
export function startHeartbeat(intervalMs = 8) {
  const delaysMs: number[] = [];
  let expected = performance.now() + intervalMs;
  let stopped = false;
  const sample = () => {
    const now = performance.now();
    delaysMs.push(Math.max(0, now - expected));
    expected = now + intervalMs;
  };
  const timer = setInterval(sample, intervalMs).unref();
  return {
    intervalMs,
    delaysMs,
    stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      if (performance.now() >= expected) sample();
    },
  };
}

/** Native prebuilds can have generic names; capture loaded addons plus explicitly named SQLite extensions. */
export function loadedNativeBindings(extensions: readonly string[] = []) {
  const { sharedObjects } = process.report.getReport() as { sharedObjects: string[] };
  return sharedObjects.filter(path => path.endsWith('.node') || extensions.includes(path))
    .map(path => ({ path, sha256: createHash('sha256').update(readFileSync(path)).digest('hex') }));
}
