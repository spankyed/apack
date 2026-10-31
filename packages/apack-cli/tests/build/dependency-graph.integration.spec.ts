// A dependent of two packs that share an ancestor: the diamond.
//
// A snapshot carries what its whole tree declares, because a dependent sees only its direct
// dependencies' snapshots. Attributing an inherited name to the dependency it *arrived through* rather
// than the pack that *declares* it made every diamond read as a collision — and since every pack
// depends on the base pack, that was every pack with two dependencies.
//
// The unit tests over hand-written snapshots pin the algorithm. These build four real packs with the
// real CLI, so they pin that a build writes the attribution a dependent reads.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { packagesBuiltOrRefuse, REPO_ROOT } from '@apackdev/host/build/packages-built';
import { CLI, buildPack, callCli, packageJson, preparePack, tsconfig } from '../_support/pack-builds';
import { runCommand } from '../_support/run-command.ts';
import { PACK_LAYOUT } from '@apackdev/host/packs';

/** Skips without built packages, and refuses rather than reading a stale `dist` */
const PACKAGES_BUILT = packagesBuiltOrRefuse('npm run packages:build (or npm test -w @apackdev/cli, which builds them)');

/** A pack declaring `entities`, depending on `dependencies`. Nothing else: the graph is the subject. */
function pack(id: string, entities: Record<string, string>, dependencies: Record<string, string> = {}, extra: Record<string, unknown> = {}) {
  return {
    'package.json': packageJson(id),
    'tsconfig.json': tsconfig,
    'apack.json': JSON.stringify({
      id, name: id, version: '1.0.0', data: { entities: Object.fromEntries(Object.keys(entities).map(name => [name, {}])) },
      ...(Object.keys(dependencies).length > 0 && { dependencies }),
      ...extra,
    }),
  };
}

/** A feature with a system and a surface, so dependents have something to send to */
const NOTIFIER = {
  features: { notifier: { description: 'Notify subscribing features.', system: { entry: 'src/system.ts', contract: 'src/system.contract.ts#Contract' }, surface: { label: 'Fixture', state: 'src/surface.ts' } } },
};
const NOTIFIER_SOURCES = {
  'src/system.contract.ts': [
    "export type OutgoingNotifierEvents = { type: 'NOTIFIED'; text: string };",
    "export type Contract = { incoming: { type: 'NOTIFY' }; outgoing: OutgoingNotifierEvents };",
  ].join('\n') + '\n',
  'src/system.ts': [
    "import { setup } from 'xstate';",
    "import { defineSystem } from '@apackdev/sdk/framework';",
    "import type { Contract } from './system.contract.ts';",
    'export const notifierSpec = defineSystem<Contract>();',
    'const entry = { spec: notifierSpec, machine: setup({ types: notifierSpec.types }).createMachine({ id: "notifier" }) };',
    'export default entry;',
  ].join('\n'),
  'src/surface.ts': "import type { AnyStateMachine } from 'xstate';\nexport default { id: 'notifier' } as unknown as AnyStateMachine;\n",
};

const DEEP = 'deep-pack';
const on = (...ids: string[]) => Object.fromEntries(ids.map((id) => [id, '*']));

let parent: string;
let built: { code: number; output: string } | undefined;

// callCli captures console output while a build runs. Keep phase boundaries visible even if the
// shared hook deadline fires before it returns, without changing that deadline or skipping a build.
async function buildPhase<T>(name: string, run: () => Promise<T>): Promise<T> {
  const started = performance.now();
  process.stdout.write(`[dependency-graph] ${name}: start\n`);
  try { return await run(); }
  finally { process.stdout.write(`[dependency-graph] ${name}: ${Math.round(performance.now() - started)}ms\n`); }
}

beforeAll(async () => {
  if (!PACKAGES_BUILT) return;
  parent = fs.mkdtempSync(path.join(os.tmpdir(), 'dependency-graph-'));
  const modules = path.join(REPO_ROOT, 'node_modules');
  // D, then B and C on D, then A on B and C: four builds, the budget for this spec
  await buildPhase(DEEP, () => buildPack(preparePack(parent, DEEP, { ...pack(DEEP, { Memo: 'Memo' }, {}, NOTIFIER), ...NOTIFIER_SOURCES }, modules), DEEP));
  for (const side of ['left-pack', 'right-pack']) {
    await buildPhase(side, () => buildPack(preparePack(parent, side, pack(side, { [`${side === 'left-pack' ? 'Left' : 'Right'}Note`]: side === 'left-pack' ? 'LeftNote' : 'RightNote' }, on(DEEP)), modules), side));
  }
  const appDir = preparePack(parent, 'app-pack', pack('app-pack', { App: 'App' }, on('left-pack', 'right-pack')), modules);
  // produces: the app-pack build whose snapshot the tests read (its output is also checked for conflicts)
  built = await buildPhase('app-pack', () => callCli(appDir, 'build'));
}, 4 * 60_000);

afterAll(() => {
  if (parent) fs.rmSync(parent, { recursive: true, force: true });
});

const snapshotOf = (id: string) => {
  const file = path.join(parent, id, 'dist', PACK_LAYOUT.snapshot);
  if (!fs.existsSync(file)) throw new Error(`no snapshot written for ${id}`);
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
};

describe.skipIf(!PACKAGES_BUILT)('a pack depending on two packs that share an ancestor', () => {
  it('builds, rather than reporting the ancestor as a collision', async () => {
    expect(built!.output).not.toContain('Type conflicts');
    expect(built!.code, built!.output).toBe(0);
  });

  // The generated union is what a pack author sees: the ancestor's entity once, not twice and not missing
  it("names the ancestor's entity exactly once in the dependent's EntityName", async () => {
    const ears = fs.readFileSync(path.join(parent, 'app-pack', 'src', '__generated__', 'ears.ts'), 'utf-8');
    const entityName = ears.slice(ears.indexOf('export type EntityName'));
    const line = entityName.slice(0, entityName.indexOf(';'));
    expect(line).toContain("'Memo'");
    expect(line.match(/'Memo'/g), line).toHaveLength(1);
    // And both sides' own entities come through alongside it
    for (const name of ['LeftNote', 'RightNote', 'App']) expect(line).toContain(`'${name}'`);
  });

  // What the dependent read to get that right, written by the middle packs' own builds
  it("attributes the ancestor's entity to the ancestor in each side's snapshot", async () => {
    for (const side of ['left-pack', 'right-pack']) {
      expect(snapshotOf(side).provenance.entities, side).toMatchObject({ Memo: DEEP });
    }
  });

  it("attributes each pack's own entity to itself", async () => {
    expect(snapshotOf('left-pack').provenance.entities).toMatchObject({ LeftNote: 'left-pack' });
    expect(snapshotOf(DEEP).provenance.entities).toEqual({ Memo: DEEP });
  });
});

describe.skipIf(!PACKAGES_BUILT)('a collision that is real', () => {
  // The diamond fix must not swallow this: two packs each declaring `Memo` themselves is not a diamond,
  // and a dependent of both cannot tell which one it means.
  it('still fails when two independent packs declare the same entity', async () => {
    const modules = path.join(REPO_ROOT, 'node_modules');
    const rival = 'rival-pack';
    await buildPack(preparePack(parent, rival, pack(rival, { Memo: 'Memo' }), modules), rival);

    const clashDir = preparePack(parent, 'clash-pack', pack('clash-pack', {}, on(DEEP, rival)), modules);
    // process: the exit code and the colliding-entity message are the assertion
    const clash = await runCommand(process.execPath, [CLI, 'pack', 'build'], clashDir);

    expect(clash.code, clash.output).not.toBe(0);
    expect(clash.output).toMatch(/entity "Memo" declared by both/);
  }, 2 * 60_000 + 20_000);
});

