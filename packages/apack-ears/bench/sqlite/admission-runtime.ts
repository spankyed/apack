// Optional diagnostic instrumentation; never loaded by ordinary admission cohorts.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { Session } from 'node:inspector/promises';
import { PerformanceObserver } from 'node:perf_hooks';

export async function startAdmissionTrace(prefix: string) {
  assert(process.platform === 'linux', 'Admission runtime tracing requires the Linux cgroup interface');
  assert(!existsSync(prefix + '.json') && !existsSync(prefix + '.cpuprofile'), 'Retain prior diagnostics');
  const cpu = () => Object.fromEntries(readFileSync('/sys/fs/cgroup/cpu.stat', 'utf8').trim().split('\n').map(line => {
    const [name, value] = line.trim().split(/\s+/); return [name!, Number(value)];
  }));
  const gc: Array<{ start: number; duration: number; info: unknown }> = [];
  const counters: Array<{ at: number; cpu: Record<string, number> }> = [];
  const sample = () => { counters.push({ at: performance.now(), cpu: cpu() }); };
  const observer = new PerformanceObserver(list => {
    for (const entry of list.getEntries()) gc.push({ start: entry.startTime, duration: entry.duration, info: entry.toJSON() });
  });
  const constraints = {
    cpuMax: readFileSync('/sys/fs/cgroup/cpu.max', 'utf8').trim(),
    memoryMax: readFileSync('/sys/fs/cgroup/memory.max', 'utf8').trim(),
    allowed: readFileSync('/proc/self/status', 'utf8').split('\n').find(line => line.startsWith('Cpus_allowed_list:')),
  };
  const session = new Session(); session.connect();
  observer.observe({ entryTypes: ['gc'] });
  const profilerStartBefore = performance.now();
  try { await session.post('Profiler.enable'); await session.post('Profiler.start'); }
  catch (error) { observer.disconnect(); session.disconnect(); throw error; }
  const profilerStartAfter = performance.now(); sample();
  const timer = setInterval(sample, 64).unref();
  let stopped: Promise<void> | undefined;
  return { stop() {
    return stopped ??= (async () => {
      clearInterval(timer); sample();
      const profilerStopBefore = performance.now();
      try {
        const { profile } = await session.post('Profiler.stop');
        const profilerStopAfter = performance.now();
        await new Promise<void>(resolve => setImmediate(resolve));
        writeFileSync(prefix + '.cpuprofile', JSON.stringify(profile));
        writeFileSync(prefix + '.json', JSON.stringify({ scope: 'instrumented admission diagnostic; not workload acceptance or exclusive CPU attribution',
          constraints, profilerStartBefore, profilerStartAfter, profilerStopBefore, profilerStopAfter, sampleIntervalMs: 64, counters, gc }));
      } finally { observer.disconnect(); session.disconnect(); }
    })();
  } };
}
