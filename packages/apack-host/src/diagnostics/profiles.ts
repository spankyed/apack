/** Standard V8 profiles; values/heap snapshots are never requested. */
import type { _PerformanceProfiles } from '@apackdev/sdk/runtime';

/** Node Inspector and Electron renderer debug sessions implement the same protocol. */
export interface PerformanceProfileTransport {
  post(method: string, parameters?: object): Promise<unknown>;
  close(): void | Promise<void>;
}

export const PROFILE_BYTES = 4 * 1024 * 1024;
export const PROFILE_WINDOW_MS = 30_000;

class ProfileProtocolTimeout extends Error {}

/** A finite diagnostic window, owned transport and capped serialized output, separate from span retention. */
export function createPerformanceProfiles(transport: PerformanceProfileTransport) {
  const sampling = { cpuIntervalMicros: 1000, allocationIntervalBytes: 512 * 1024, allocationStackDepth: 32, includeCollectedAllocations: true };
  function bounded<T>(operation: () => T | Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new ProfileProtocolTimeout()), 5000);
      timeout.unref?.();
      Promise.resolve().then(operation).then(
        value => { clearTimeout(timeout); resolve(value); },
        error => { clearTimeout(timeout); reject(error); },
      );
    });
  }
  const post = (method: string, parameters?: object) => bounded(() => transport.post(method, parameters));
  const started = performance.now();
  let cpuStarted = false;
  let heapStarted = false;
  let failures = 0;
  const failureStages: string[] = [];
  function failed(stage: string) { failures++; if (failureStages.length < 8) failureStages.push(stage); }
  let stoppedBy: _PerformanceProfiles['stoppedBy'] = 'owner';
  let stopping: Promise<_PerformanceProfiles> | undefined;
  const ready = (async () => {
    try {
      await post('Profiler.enable');
      await post('Profiler.setSamplingInterval', { interval: sampling.cpuIntervalMicros });
      await post('Profiler.start');
      cpuStarted = true;
      await post('HeapProfiler.enable');
      await post('HeapProfiler.startSampling', {
        samplingInterval: sampling.allocationIntervalBytes, stackDepth: sampling.allocationStackDepth,
        includeObjectsCollectedByMajorGC: sampling.includeCollectedAllocations, includeObjectsCollectedByMinorGC: sampling.includeCollectedAllocations,
      });
      heapStarted = true;
    } catch { failed('admission'); }
  })();
  const timer = setTimeout(() => { stoppedBy = 'limit'; void stop(); }, PROFILE_WINDOW_MS);
  timer.unref?.();
  function stop(): Promise<_PerformanceProfiles> {
    if (stopping) return stopping;
    clearTimeout(timer);
    stopping = (async () => {
      await ready;
      const output: Pick<_PerformanceProfiles, 'cpu' | 'allocation'> = {};
      let bytes = 0;
      const encodedBytes: { cpu?: number; allocation?: number } = {};
      const raw: Partial<Record<keyof typeof output, unknown>> = {};
      async function end(method: string, kind: keyof typeof output, enabled: boolean) {
        if (!enabled) { failed(`${kind}-unavailable`); return; }
        try {
          const response = await post(method) as { profile?: unknown };
          if (!response.profile || typeof response.profile !== 'object') throw Error('Missing profile');
          const shape = response.profile as { nodes?: unknown; head?: unknown };
          if (kind === 'cpu' ? !Array.isArray(shape.nodes) : !shape.head || typeof shape.head !== 'object') throw Error('Invalid profile');
          raw[kind] = response.profile;
        } catch (error) { failed(`${kind}-${error instanceof ProfileProtocolTimeout ? 'timeout' : 'protocol'}`); }
      }
      try {
        // Stop allocation sampling before creating/encoding the CPU export, then stop CPU sampling.
        // Neither profiler should mistake our JSON/export allocations for application work.
        await end('HeapProfiler.stopSampling', 'allocation', heapStarted);
        await end('Profiler.stop', 'cpu', cpuStarted);
      } finally {
        try { await bounded(() => transport.close()); } catch { failed('close'); }
      }
      for (const kind of ['cpu', 'allocation'] as const) {
        if (raw[kind] === undefined) continue;
        try {
          const encoded = JSON.stringify(raw[kind]);
          if (typeof encoded !== 'string') throw Error('Invalid profile encoding');
          const size = new TextEncoder().encode(encoded).byteLength;
          encodedBytes[kind] = size;
          if (size > PROFILE_BYTES / 2) { failed(`${kind}-size`); continue; }
          output[kind] = encoded;
          bytes += size;
        } catch { failed(`${kind}-encoding`); }
      }
      return { ...output, sampling: { ...sampling }, bytes, failures, failureStages, encodedBytes, complete: failures === 0,
        windowLimitMs: PROFILE_WINDOW_MS, durationMs: performance.now() - started, stoppedBy };
    })();
    return stopping;
  }
  return { ready, stop };
}
