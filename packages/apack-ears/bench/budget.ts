// The engine's budget: production-shaped data (production-shape.ts, the lead developer's data as profiled
// 2026-10-24) at its measured size and twice it, written to an LMDB store, then booted in a process of its own. Heap
// past HEAP_BUDGET_MB a scale fails the run; boot is a reading, since load inflates a duration and cannot deflate it.
// Run with `npm run bench:budget -w @apackdev/ears`, which builds the package first: it times the engine in `dist`.
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { LARGE, RELATIONS, TYPES } from './production-shape.ts';

/**
 * The heap the engine may hold per scale of the production data after boot: its structure (ids, small fields, the
 * indexes, the relations), about 50 MB measured on the production copy, and none of its 155 MB of large values. Past
 * it, an in-memory engine has stopped being the right design for this data, or a change keeps what it should not
 */
export const HEAP_BUDGET_MB = 64;

// A specifier held in a variable, so the typecheck (which runs before any build) reads the types from source
const DIST = '../dist/index.js';
const DIST_LMDB = '../dist/lmdb/index.js';
const { createEarsEngine } = await import(/* @vite-ignore */ DIST) as typeof import('../src/index.ts');
const { openLmdbStore } = await import(/* @vite-ignore */ DIST_LMDB) as typeof import('../src/lmdb/index.ts');
type Id = import('../src/index.ts').EARS.EntityId;

const isEntityType = (name: string) => name in TYPES;
/** Kinds the engine writes itself, or that would change what the data is (a role, the trash): not generated */
const ENGINE_OWNED = new Set(['role', 'createdAt', 'updatedAt', 'trashedAt', 'shortCode']);
const open = (dir: string, readOnly: boolean) => {
  let engine: ReturnType<typeof createEarsEngine>;
  const store = openLmdbStore({ path: dir, readOnly, engine: () => engine.admin, log: () => {} });
  engine = createEarsEngine({ persistence: store.sink, isEntityType, isRelationKind: () => true, isRole: () => true });
  return { engine, store };
};

/** A small value of about `bytes` serialized, of the kind such a field holds */
function small(bytes: number, n: number): unknown {
  if (bytes <= 2) return n % 10;
  if (bytes <= 5) return n % 2 === 0;
  if (bytes === 13) return 1_700_000_000_000 + n;
  return `${n}:`.padEnd(bytes - 2, 'x');
}

/** Writes the production shape `scale` times over into the store at `dir` */
function write(dir: string, scale: number): void {
  const { engine, store } = open(dir, false);
  const ids: Record<string, Id[]> = {};
  for (const [type, { entities, fields }] of Object.entries(TYPES)) {
    const count = entities * scale;
    const large = Object.entries(LARGE).filter(([key]) => key.startsWith(`${type}.`)).map(([key, [n, size]]) => [key.slice(type.length + 1), n * scale, size] as const);
    ids[type] = [];
    for (let start = 0; start < count; start += 1000) {
      engine.transact(() => {
        for (let i = start; i < Math.min(count, start + 1000); i++) {
          const row: Record<string, unknown> = {};
          for (const [kind, [n]] of Object.entries(fields)) {
            if (ENGINE_OWNED.has(kind)) continue;
            if (i < n * scale) row[kind] = small(fields[kind][1], i);
          }
          // A large value replaces the small one of its kind, for the first of its count
          for (const [kind, n, size] of large) if (i < n) row[kind] = `${i}:`.padEnd(size, 'y');
          ids[type].push(engine.create(type, row).id() as Id);
        }
      });
    }
  }
  const all = Object.values(ids).flat();
  let r = 0;
  for (const [kind, n] of Object.entries(RELATIONS)) {
    for (let start = 0; start < n * scale; start += 1000) {
      engine.transact(() => {
        for (let i = start; i < Math.min(n * scale, start + 1000); i++, r++) {
          engine.admin.addRelation(all[r % all.length], kind, all[(r * 7 + 1) % all.length]);
        }
      });
    }
  }
  store.close();
}

/** Boots the store at `dir` in this process and prints what it cost (run with --expose-gc) */
async function boot(dir: string): Promise<void> {
  const gc = (globalThis as { gc?: () => void }).gc!;
  gc();
  const before = process.memoryUsage().heapUsed;
  const started = performance.now();
  const { store } = open(dir, true);
  await store.hydrate();
  const bootMs = performance.now() - started;
  gc();
  const heapMB = (process.memoryUsage().heapUsed - before) / 2 ** 20;
  store.close();
  console.log(JSON.stringify({ bootMs: Math.round(bootMs), heapMB: +heapMB.toFixed(1) }));
}

if (process.argv[2] === '--boot') {
  await boot(process.argv[3]);
} else {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ears-budget-'));
  let over = false;
  try {
    for (const scale of [1, 2]) {
      const dir = path.join(root, `x${scale}`, 'ears-db');
      write(dir, scale);
      const runs = [0, 1, 2].map(() => JSON.parse(execFileSync(process.execPath, ['--expose-gc', import.meta.filename, '--boot', dir], { encoding: 'utf8' })) as { bootMs: number; heapMB: number });
      const heapMB = Math.max(...runs.map((run) => run.heapMB));
      const budget = HEAP_BUDGET_MB * scale;
      const fails = heapMB > budget;
      over ||= fails;
      console.log(`${scale}x the production data: boot ${runs.map((run) => run.bootMs).join(', ')} ms; heap ${heapMB} MB of ${budget}${fails ? ' — OVER BUDGET' : ''}`);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  if (over) process.exit(1);
}
