// What watches cost under a writer that commits as fast as it runs, in the built engine:
// `npm run bench:watch -w @apackdev/ears [-- <seconds> [views|none] [elmdb|sqlite] [default|durable]]`, `none` running the writer with no view open. A writer sets a field of one of the first open tasks on
// every turn of the event loop, into a hot table of 20,000 tasks, while three views are open over it: one row, the
// indexed `where` with a `limit` of 50, and every open task ordered (about 6,700 rows). It prints one JSON line:
// each view's runs a second and time a run, the share of a core the process used, the event loop's delay, and how
// late a view hears a commit — from the commit to the first delivery reflecting it — for the two views every write
// changes. Readings are recorded in elmdb's docs/evidence/next-phase-3.md (G14).
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { loadedNativeBindings, startHeartbeat } from './sqlite/load-metrics.ts';
import type { EARS as EarsTypes } from '../src/index.ts';

type Id = EarsTypes.EntityId;
// Specifiers held in variables, so the typecheck (which runs before any build) reads the types from source
const DIST = '../dist/index.js';
const BACKEND = process.argv[4] ?? 'elmdb';
const ACKNOWLEDGMENT = process.argv[5] ?? 'default';
if (!['elmdb', 'sqlite'].includes(BACKEND)) throw new Error('Expected elmdb or sqlite backend');
if (!['default', 'durable'].includes(ACKNOWLEDGMENT)) throw new Error('Expected default or durable acknowledgment');
const DIST_DATABASE = BACKEND === 'sqlite' ? '../dist/sqlite/index.js' : '../dist/lmdb/index.js';
const { createEarsEngine } = await import(DIST) as typeof import('../src/index.ts');
const { openDatabase } = await import(DIST_DATABASE) as typeof import('../src/lmdb/index.ts');

const SECONDS = Number(process.argv[2] ?? 5);
const VIEW_MODE = process.argv[3] ?? 'views';
if (!['views', 'none'].includes(VIEW_MODE)) throw new Error('Expected views or none');
const NO_VIEWS = VIEW_MODE === 'none';
const TASKS = Number(process.env.EARS_WATCH_TASKS ?? 20_000);
if (!Number.isFinite(SECONDS) || SECONDS <= 0 || !Number.isSafeInteger(TASKS) || TASKS < 120)
  throw new Error('Expected positive seconds and at least 120 tasks');
const STATUSES = ['open', 'done', 'blocked'];
/** The writer touches one of these: open tasks among the first page, so every write changes the page */
const HOT = 40;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ears-watch-stress-'));
const database = openDatabase({
  path: path.join(dir, 'ears-db'),
  schema: { types: { Task: { required: [], indexes: ['status'] } }, relations: {}, roles: [] },
});
const engine = createEarsEngine({ database });

try {
  const ids: Id[] = Array.from({ length: TASKS }, (_, i) => `Task-${String(i).padStart(5, '0')}` as Id);
  engine.admin.bulkLoad(() => {
    ids.forEach((id, i) => {
      engine.admin.bulkLoadAttr(id, 'title', `Task ${i}`);
      engine.admin.bulkLoadAttr(id, 'status', STATUSES[i % 3]);
      engine.admin.bulkLoadAttr(id, 'rank', i);
    });
  });
  await database.indexesReady();
  const hot = ids.filter((_, i) => i % 3 === 0).slice(0, HOT);

  /** Commit sequence → when it committed; a view's latency is from there to the first delivery at or past it */
  const committedAt = new Map<number, number>();
  const views = {
    row: () => engine.getRow(hot[0]!),
    page: () => engine.query('Task').where('status', 'open').limit(50).pick(['rank']),
    ordered: () => engine.query('Task').where('status', 'open').orderBy('rank').pick(['rank']),
  };
  type Name = keyof typeof views;
  const stats = Object.fromEntries(Object.keys(views).map((name) => [name, {
    runs: 0, runMs: 0, deliveries: 0, latencies: [] as number[], heardUpTo: 0, last: undefined as unknown,
  }])) as Record<Name, { runs: number; runMs: number; deliveries: number; latencies: number[]; heardUpTo: number; last: unknown }>;
  let measuring = false;
  const watching = (NO_VIEWS ? [] : Object.keys(views) as Name[]).map((name) => engine.watch(() => {
    const start = performance.now();
    try {
      return views[name]();
    } finally {
      if (measuring) {
        stats[name].runs++;
        stats[name].runMs += performance.now() - start;
      }
    }
  }, (value, commit) => {
    const view = stats[name];
    view.last = value;
    if (!measuring) {
      view.heardUpTo = commit;
      return;
    }
    view.deliveries++;
    const now = performance.now();
    for (let sequence = view.heardUpTo + 1; sequence <= commit; sequence++) {
      const at = committedAt.get(sequence);
      if (at !== undefined) view.latencies.push(now - at);
    }
    view.heardUpTo = Math.max(view.heardUpTo, commit);
  }));
  await engine.admin.watchesSettled();

  const delay = monitorEventLoopDelay({ resolution: 1 });
  const heartbeat = startHeartbeat(1);
  measuring = true;
  delay.enable();
  const cpu = process.cpuUsage();
  const started = performance.now();
  let commits = 0;
  const acknowledgmentMs: number[] = [];
  await new Promise<void>((resolve) => {
    const step = () => {
      if (performance.now() - started >= SECONDS * 1000) {
        resolve();
        return;
      }
      const before = engine.lastCommit(), at = performance.now();
      const write = () => engine.write(hot[commits % HOT]!).set('rank', -commits - 1);
      if (ACKNOWLEDGMENT === 'durable') engine.transact(write, { durable: true });
      else write();
      if (engine.lastCommit() <= before) throw new Error('Benchmark iteration did not commit a mutation');
      acknowledgmentMs.push(performance.now() - at);
      committedAt.set(engine.lastCommit(), performance.now());
      commits++;
      setImmediate(step);
    };
    setImmediate(step);
  });
  const writing = performance.now() - started;
  await engine.admin.watchesSettled();
  const settledMs = performance.now() - started - writing;
  delay.disable();
  heartbeat.stop();
  const used = process.cpuUsage(cpu);
  measuring = false;

  // Every view's last delivery is what its read answers now: a view converges
  const converged = NO_VIEWS || (Object.keys(views) as Name[]).every((name) => JSON.stringify(stats[name].last) === JSON.stringify(views[name]()));
  const percentile = (values: number[], p: number) => {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    return Number(sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!.toFixed(2));
  };
  const seconds = writing / 1000;
  console.log(JSON.stringify({
    date: new Date().toISOString(),
    backend: BACKEND,
    execution: 'built-package',
    taskCount: TASKS,
    requestedSeconds: SECONDS,
    viewMode: VIEW_MODE,
    nativeBindings: loadedNativeBindings(),
    heartbeatDelaysMs: heartbeat.delaysMs,
    acknowledgment: ACKNOWLEDGMENT,
    durabilityComparison: ACKNOWLEDGMENT === 'durable' ? 'Each mutation uses a durable unit on both backends'
      : 'Backend defaults differ: elmdb group sync versus SQLite FULL per commit; not matched durable acknowledgments',
    acknowledgmentMs: { p50: percentile(acknowledgmentMs, 50), p95: percentile(acknowledgmentMs, 95), p99: percentile(acknowledgmentMs, 99) },
    processMemory: { end: process.memoryUsage(), wholeProcessMaxRssKiB: process.resourceUsage().maxRSS },
    conditions: `${os.cpus()[0]?.model ?? os.arch()}, ${os.cpus().length} cores, load ${os.loadavg().map((l) => l.toFixed(1)).join('/')}, node ${process.version}, ${TASKS} tasks, ${SECONDS}s writer, syncs enabled, acknowledgment ${ACKNOWLEDGMENT}`,
    commitsPerSecond: Math.round(commits / seconds),
    coreShare: Number(((used.user + used.system) / 1000 / (writing + settledMs)).toFixed(2)),
    eventLoopDelayMs: { p50: Number((delay.percentile(50) / 1e6).toFixed(2)), p99: Number((delay.percentile(99) / 1e6).toFixed(2)), max: Number((delay.max / 1e6).toFixed(2)) },
    settledMs: Number(settledMs.toFixed(1)),
    converged,
    views: Object.fromEntries((NO_VIEWS ? [] : Object.keys(views) as Name[]).map((name) => {
      const view = stats[name];
      return [name, {
        runsPerSecond: Math.round(view.runs / seconds),
        msPerRun: view.runs ? Number((view.runMs / view.runs).toFixed(3)) : null,
        shareOfWall: Number((view.runMs / writing).toFixed(3)),
        heardMs: name === 'row' ? undefined : { p50: percentile(view.latencies, 50), p99: percentile(view.latencies, 99), max: percentile(view.latencies, 100) },
      }];
    })),
  }));
  for (const watch of watching) watch.stop();
} finally {
  database.close();
  fs.rmSync(dir, { recursive: true, force: true });
}
