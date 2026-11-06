// The invariant projections exist for: whoever writes what a projection derives from, in any order, killed part way,
// in bursts larger than a chunk, or replacing every row, what it derives ends up what deriving it afresh gives, once
// the app has caught up. Generated histories of real commits from a real second process, each from a seed a failure
// prints.
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { createEarsEngine, type EARS, type EarsEngine } from '@apackdev/ears';
import { openDatabase } from '@apackdev/ears/lmdb';
import { _installProjections } from '../../src/runtime/projections.ts';
import { startTestRuntime, testPacks } from '../../src/testing/index.ts';

startTestRuntime();
afterEach(() => { testPacks.projections.length = 0; });

const TASKS = Array.from({ length: 6 }, (_, i) => `Task-${i}`);

/** A small seeded generator, so a failing history can be run again from its seed */
function random(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { below: (n: number) => Math.floor(next() * n), pick: <T>(xs: readonly T[]) => xs[Math.floor(next() * xs.length)]! };
}

/** How the other process may end after a step: killed after its commit, killed inside an open unit, or not at all */
const DEATHS = ['after', 'inside', false, false, false] as const;

type Op = Record<string, unknown>;
type Step =
  | { step: 'here'; op: Op }
  | { step: 'there'; op: Op; die: 'after' | 'inside' | false }
  | { step: 'burst'; count: number }
  | { step: 'reset' }
  | { step: 'catchUp' }
  | { step: 'version' };

function anOp(r: ReturnType<typeof random>): Op {
  const id = r.pick(TASKS);
  switch (r.below(5)) {
    case 0: return { op: 'create', type: 'Task', id, fields: { value: r.below(10) } };
    case 1: return { op: 'set', id, fields: { value: r.below(10) } };
    case 2: return { op: 'trash', id };
    case 3: return { op: 'restore', id };
    default: return { op: 'destroy', id };
  }
}

function history(seed: number): Step[] {
  const r = random(seed);
  return Array.from({ length: 10 + r.below(20) }, (): Step => {
    // A reset or a new version derives everything again, which would hide what a catch-up got wrong: both are rare
    const roll = r.below(40);
    if (roll < 12) return { step: 'here', op: anOp(r) };
    if (roll < 27) return { step: 'there', op: anOp(r), die: r.pick(DEATHS) };
    if (roll < 30) return { step: 'burst', count: 501 + r.below(600) };
    if (roll < 31) return { step: 'reset' };
    if (roll < 39) return { step: 'catchUp' };
    return { step: 'version' };
  });
}

const requireFromEars = createRequire(createRequire(import.meta.url).resolve('@apackdev/ears/package.json'));

/** Another process holding the database open: it does what it's sent, each its own commit, and answers */
function anotherProcess(path: string) {
  const child: ChildProcess = spawn(process.execPath, ['-e', `
    const { Database } = require(${JSON.stringify(requireFromEars.resolve('elmdb'))});
    const { Packr } = require(${JSON.stringify(requireFromEars.resolve('msgpackr'))});
    const packr = new Packr({ useRecords: false, moreTypes: true, mapsAsObjects: true });
    const database = Database.open(process.argv[1]);
    let held = '';
    process.stdin.setEncoding('utf8').on('data', (chunk) => {
      held += chunk;
      for (let at; (at = held.indexOf('\\n')) >= 0; held = held.slice(at + 1)) {
        const { op, die, burst, reset } = JSON.parse(held.slice(0, at));
        try {
          if (reset) database.reset();
          else if (burst) database.write(packr.pack({ ops: Array.from({ length: burst }, (_, i) => ({ op: 'create', type: 'Task', id: 'Task-burst-' + Date.now() + '-' + i, fields: { value: i % 10 } })), now: 1 }));
          else if (die === 'inside') { const unit = database.begin(); unit.write(packr.pack({ ops: [op], now: 1 })); process.kill(process.pid, 'SIGKILL'); }
          else database.write(packr.pack({ ops: [op], now: 1 }));
        } catch {}
        if (die) process.kill(process.pid, 'SIGKILL');
        process.stdout.write('done\\n');
      }
    });
    process.stdout.write('ready\\n');
  `, path], { stdio: ['pipe', 'pipe', 'inherit'] });
  const heard: Array<() => void> = [];
  let partial = '';
  child.stdout!.setEncoding('utf8').on('data', (chunk: string) => {
    const lines = (partial + chunk).split('\n');
    partial = lines.pop()!;
    for (const _ of lines) heard.shift()?.();
  });
  const answered = () => new Promise<void>((resolve) => { heard.push(resolve); });
  const gone = new Promise<void>((resolve) => { child.once('close', () => resolve()); });
  return {
    ready: answered(),
    async send(message: Record<string, unknown>) {
      const reply = message.die ? gone : answered();
      child.stdin!.write(`${JSON.stringify(message)}\n`);
      await reply;
    },
    async stop() { child.kill('SIGKILL'); await gone; },
    gone: () => child.exitCode !== null || child.signalCode !== null,
  };
}

/** A Mirror per live Task, holding its value: what the projection derives, and what deriving it afresh gives */
function mirrors(engine: EarsEngine): Record<string, unknown> {
  const rows = engine.query('Mirror').pick(['of', 'value']) as unknown as Array<{ of: string; value: unknown }>;
  return Object.fromEntries(rows.map((row) => [row.of, row.value]).sort());
}
function expected(engine: EarsEngine): Record<string, unknown> {
  const rows = engine.query('Task').pick(['value']) as unknown as Array<{ id: string; value: unknown }>;
  return Object.fromEntries(rows.map((row) => [row.id, row.value]).sort());
}

function mirroring(engine: EarsEngine) {
  const mirrorOf = (id: string) => `Mirror-${id.slice('Task-'.length)}` as EARS.EntityId;
  const sync = (id: string) => {
    const task = engine.query.ids(id as EARS.EntityId).pickOne(['value']) as { value?: unknown } | undefined;
    const mirror = mirrorOf(id);
    if (task) engine.upsert('Mirror', { id: mirror, of: id, value: task.value ?? null } as never);
    else if (engine.query.withTrashed.ids(mirror).exists()) engine.write(mirror).destroy();
  };
  return {
    from: ['Task'],
    version: 1,
    apply(ids: readonly string[]) { for (const id of ids) sync(id); },
    rebuild() {
      for (const id of engine.query.withTrashed('Mirror').ids()) engine.write(id).destroy();
      for (const id of engine.query('Task').ids()) sync(id);
    },
  };
}

async function run(seed: number): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'projections-converge-'));
  const database = openDatabase({ path: directory, syncs: false, schema: {
    types: { Task: { required: [], indexes: [], changeOrder: true }, Mirror: { required: [], indexes: [] } },
    relations: {}, roles: [],
  } });
  const engine = createEarsEngine({ database });
  const projection = mirroring(engine);
  testPacks.projections.length = 0;
  testPacks.projections.push({ name: 'test/converge/mirrors', projection });
  const runner = _installProjections(engine);
  let there = anotherProcess(directory);
  const startOver = async () => {
    const epoch = engine.admin.replacedElsewhere();
    if (epoch !== undefined) engine.admin.adoptReplacement(epoch);
    await runner.catchUp();
  };
  try {
    await there.ready;
    for (const step of history(seed)) {
      if (step.step === 'here') {
        // Through the engine, as the app writes: a refused op is no commit, and after a reset elsewhere every one is
        try {
          const id = step.op.id as EARS.EntityId;
          if (step.op.op === 'create') engine.create('Task', { id, value: (step.op.fields as { value: number }).value } as never);
          else if (step.op.op === 'set') engine.write(id).set('value' as EARS.AttrKind, (step.op.fields as { value: number }).value);
          else if (step.op.op === 'trash') engine.write(id).trash();
          else if (step.op.op === 'restore') engine.write(id).restore();
          else engine.write(id).destroy();
        } catch { /* refused, as the same op there would be */ }
      } else if (step.step === 'catchUp') {
        // The invariant holds whenever the app has caught up, not only at the end
        await startOver();
        expect(mirrors(engine), `seed ${seed}`).toEqual(expected(engine));
      } else if (step.step === 'version') {
        projection.version += 1;
      } else {
        await there.send(step.step === 'there' ? { op: step.op, die: step.die } : step.step === 'burst' ? { burst: step.count } : { reset: true });
        if (there.gone()) {
          there = anotherProcess(directory);
          await there.ready;
        }
      }
    }
    await startOver();
    expect(mirrors(engine), `seed ${seed}`).toEqual(expected(engine));
  } finally {
    await there.stop();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

it('derives what deriving afresh gives, whatever another process did and however it ended', async () => {
  const first = Number(process.env.PROJECTIONS_SEED ?? 1);
  for (let seed = first; seed < first + 16; seed++) await run(seed);
});
