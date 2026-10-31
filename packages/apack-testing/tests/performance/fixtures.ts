import type { PerformanceManifest, PerformanceTrial } from '../../src/performance/report.ts';

/** Valid role captures; admission tests remove individual guarantees from this baseline. */
export function performanceProcessReport(mode: PerformanceManifest['mode'], role: 'renderer' | 'backend' | 'driver'): PerformanceTrial['processes'][string] {
  const report: PerformanceTrial['processes'][string] = {
    processId: role === 'renderer' ? 101 : role === 'backend' ? 102 : 103,
    observations: [], bytes: 0, dropped: 0, truncated: false, rejected: 0, droppedMetadata: 0,
    mode, active: 0, unfinished: 0, droppedStarts: 0, invalidCarriers: 0, detachFailures: 0,
    droppedEvents: 0, contextFailures: 0, rejectedStarts: 0, invalidAttributes: 0, complete: true,
  };
  if (mode !== 'disabled') {
    if (role === 'renderer') {
      report.rendererStatistics = { source: 'chromium-cdp', pid: 101, metrics: [
        { name: 'TaskDuration', unit: 'seconds', before: 0, after: 1 },
        { name: 'JSHeapUsedSize', unit: 'bytes', before: 100, after: 200 },
      ], unavailable: [], failures: 0 };
      report.rendererLongTasks = { supported: true, count: 0, totalMs: 0, maxMs: 0, failures: 0 };
    } else report.processStatistics = {
      samplingFailures: 0, durationMs: 1, cpuUserMicros: 0, cpuSystemMicros: 0,
      rssStartBytes: 100, rssEndBytes: 100, rssSampledMaxBytes: 100,
      heapStartBytes: 100, heapEndBytes: 100, heapSampledMaxBytes: 100,
      gcCount: 0, gcDurationMs: 0, eventLoopUtilization: 0,
      eventLoopHistogramMaxMs: 0, eventLoopLateTickMaxMs: 0,
    };
  }
  if (mode === 'detailed') {
    const cpu = JSON.stringify({ nodes: [] }); const allocation = JSON.stringify({ head: {} });
    report.profiles = { cpu, allocation, bytes: Buffer.byteLength(cpu) + Buffer.byteLength(allocation), failures: 0, complete: true,
      sampling: { cpuIntervalMicros: 1000, allocationIntervalBytes: 512 * 1024, allocationStackDepth: 128, includeCollectedAllocations: true },
      windowLimitMs: 30_000, durationMs: 1, stoppedBy: 'owner' };
  }
  return report;
}

/** Fresh provenance per test; callers override only the condition their assertion exercises. */
export function performanceManifest(overrides: Partial<PerformanceManifest> = {}): PerformanceManifest {
  return {
    format: 1, source: { revision: 'one', dirty: false, excludedUntracked: [], diffSha256: 'clean' },
    builds: [{ path: 'app', sha256: 'one' }], fixture: { generator: 'test', seed: 0, sha256: 'fixture', distribution: {} },
    native: { pin: 'native', checkoutRevision: 'native', dirty: false, excludedUntracked: [] },
    mode: 'lightweight', cache: 'warm-process', warmups: 5, runtime: {},
    machine: { platform: 'linux', arch: 'arm64', cpus: 2, memoryBytes: 1024, identity: 'machine' },
    clock: 'Local monotonic durations; cross-process epoch alignment is approximate', ...overrides,
  };
}
