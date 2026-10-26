// `apack pack facade-report` over a real pack: what its subject is.
//
// The command re-takes the facade — codegen, then the same `bundlePackTypes` the build runs — rather than
// reading `dist/types/pack-types.d.ts`, so the report is held against what the pack's sources describe now.
// Two cases here are what that is worth and would fail against a command that read the built file: junk
// written over the bundle does not move the verdict, and the check runs with no `dist` at all.
//
// The normalisation those reports go through is `tests/build/facade-report.spec.ts`, over text, because a pack
// cannot be asked to emit its declarations in the wrong order on purpose.
//
// The shared pack evolves in declaration order; each case establishes the state the next consumes.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { packagesBuiltOrRefuse, REPO_ROOT } from '@apackdev/host/build/packages-built';
import { PACK_LAYOUT } from '@apackdev/host/packs';
import { buildPack, callCli, packageJson, preparePack, tsconfig } from '../_support/pack-builds';

/** Skips without built packages, and refuses rather than reading a stale `dist` */
const PACKAGES_BUILT = packagesBuiltOrRefuse('npm run packages:build (or npm test -w @apackdev/cli, which builds them)');

const ID = 'report-pack';
const CONTRACT = (extra = '') => [
  `export type OutgoingNotifierEvents = { type: 'NOTIFIED'; text: string }${extra};`,
  "export type Contract = { incoming: { type: 'NOTIFY' }; outgoing: OutgoingNotifierEvents };",
].join('\n') + '\n';

/**
 * The pack's manifest, declaring `entities` with their shapes. Both shape types are in `src/types.ts` from the
 * start, so the one case that edits this file changes the manifest and nothing else — which is what makes it a
 * case about the manifest reaching the facade rather than about a source edit.
 */
const manifest = (...entities: string[]) => JSON.stringify({
  id: ID, name: ID, version: '1.0.0',
  data: { entities: Object.fromEntries(entities.map(name => [name, { shape: `src/types.ts#${name}Entity` }])) },

  features: { notifier: { description: 'Feature declaration fixture.', system: { entry: 'src/system.ts', contract: 'src/system.contract.ts#Contract' } } },
});

let parent: string;
let pack: string;
let initialBuildOutput: string;

beforeAll(async () => {
  if (!PACKAGES_BUILT) return;
  parent = fs.mkdtempSync(path.join(os.tmpdir(), 'facade-report-cmd-'));
  pack = preparePack(parent, ID, {
    'package.json': packageJson(ID),
    'tsconfig.json': tsconfig,
    'apack.json': manifest('Memo'),
    'src/types.ts': 'export interface MemoEntity { title: string; copyState?: "saved" | "pending" | "idle" | "error" | undefined }\nexport interface ReminderEntity { at: string }\n',
    'src/system.contract.ts': CONTRACT(),
    'src/system.ts': [
      "import { setup } from 'xstate';",
      "import { defineSystem } from '@apackdev/sdk/framework';",
      "import type { Contract } from './system.contract.ts';",
      'export const notifierSpec = defineSystem<Contract>();',
      'const entry = { spec: notifierSpec, machine: setup({ types: notifierSpec.types }).createMachine({ id: "notifier" }) };',
      'export default entry;',
    ].join('\n'),
  }, path.join(REPO_ROOT, 'node_modules'));
  // produces: dist/, which three cases below go on to corrupt, remove and have rebuilt
  initialBuildOutput = await buildPack(pack, ID);
});

afterAll(() => {
  if (parent) fs.rmSync(parent, { recursive: true, force: true });
});

const reportFile = () => path.join(pack, 'etc', 'pack-types.api.md');
const bundleFile = () => path.join(pack, 'dist', PACK_LAYOUT.typesDir, 'pack-types.d.ts');
const readReport = () => fs.readFileSync(reportFile(), 'utf-8');

// The setup build already exercises an absent report; do not compile the same pack again for it.
describe.skipIf(!PACKAGES_BUILT)('apack pack build without a report', () => {
  it('says nothing about a pack that has no report to be stale against', () => {
    expect(fs.existsSync(reportFile())).toBe(false);
    expect(initialBuildOutput).not.toContain('facade:update');
  });
});

describe.skipIf(!PACKAGES_BUILT)('apack pack facade-report', () => {
  /** Nothing is recorded before the first update: there is no report to be stale against */
  it('reports a missing report as missing rather than as a difference', async () => {
    const { code, output } = await callCli(pack, 'facade-report');
    expect(code, output).toBe(1);
    expect(output).toContain("doesn't exist");
  });

  it('records the facade dependents compile against, and then reports it up to date', async () => {
    expect((await callCli(pack, 'facade-report', ['--update'])).code).toBe(0);
    expect(readReport()).toContain(`Facade types report for the "${ID}" pack`);
    expect(readReport()).toContain('NOTIFIED');
    expect(readReport()).toContain('copyState?: "error" | "idle" | "pending" | "saved" | undefined;');

    const { code, output } = await callCli(pack, 'facade-report');
    expect(code, output).toBe(0);
    expect(output).toContain('is up to date');
  });

  it('checks the verified current build without changing generated files', async () => {
    // Recording the report adds an authored input; publish that state before inspecting it passively.
    await buildPack(pack, ID);
    const directory = path.join(pack, 'src/__generated__');
    const before = fs.readdirSync(directory);
    const stamp = fs.readFileSync(path.join(pack, '.apack/generate-entries.json'), 'utf8');
    const { code, output } = await callCli(pack, 'facade-report', ['--from-build']);
    expect(code, output).toBe(0);
    expect(output).toContain('is up to date');
    expect(fs.readdirSync(directory)).toEqual(before);
    expect(fs.readFileSync(path.join(pack, '.apack/generate-entries.json'), 'utf8')).toBe(stamp);
  }, 60_000 + 20_000);

  it('refuses edited generated files on the skip path without updating the report', async () => {
    const entry = path.join(pack, 'src/__generated__/pack-types.ts');
    const original = fs.readFileSync(entry, 'utf8');
    const report = readReport();
    fs.appendFileSync(entry, '\n// edited facade\n');
    try {
      const { code, output } = await callCli(pack, 'facade-report', ['--skip-generate', '--update']);
      expect(code).toBe(1);
      expect(output).toContain('modified src/__generated__/pack-types.ts');
      expect(readReport()).toBe(report);
    } finally { fs.writeFileSync(entry, original); }
    expect((await callCli(pack, 'facade-report', ['--skip-generate'])).code).toBe(0);
  });

  /** Up to date writes nothing, asserted on the bytes: the message would say so either way */
  it('leaves the report alone when it is current, --update included', async () => {
    const recorded = readReport();
    const before = fs.statSync(reportFile()).mtimeMs;

    expect((await callCli(pack, 'facade-report', ['--update'])).code).toBe(0);
    expect(readReport()).toBe(recorded);
    expect(fs.statSync(reportFile()).mtimeMs).toBe(before);
  });

  /**
   * The point of the command deriving its subject. Against a command that read the built bundle this says the
   * report is stale and prints a diff of nonsense — a check passing over the wrong thing, in the direction
   * that is silent when the bundle is merely old rather than absurd.
   */
  it('is not told anything by the built bundle: junk in dist does not move the verdict', async () => {
    fs.writeFileSync(bundleFile(), 'declare const nonsense: 1;\nexport { nonsense };\n');

    expect((await callCli(pack, 'facade-report', ['--from-build'])).code).toBe(1);
    const { code, output } = await callCli(pack, 'facade-report');
    expect(code, output).toBe(0);
    expect(output).toContain('is up to date');
  });

  it('needs no build at all: the check runs with no dist', async () => {
    fs.rmSync(path.join(pack, 'dist'), { recursive: true, force: true });

    const { code, output } = await callCli(pack, 'facade-report');
    expect(code, output).toBe(0);
    expect(output).toContain('is up to date');
  });

  it("follows an edit to the pack's own sources, with nothing rebuilt", async () => {
    fs.writeFileSync(path.join(pack, 'src', 'system.contract.ts'), CONTRACT(" | { type: 'ALSO_NOTIFIED' }"));

    const stale = await callCli(pack, 'facade-report');
    expect(stale.code, stale.output).toBe(1);
    expect(stale.output).toContain('differs');
    expect(stale.output).toContain('facade:update');

    expect((await callCli(pack, 'facade-report', ['--update'])).code).toBe(0);
    expect(readReport()).toContain('ALSO_NOTIFIED');
  });

  /**
   * The manifest is one step further back — it reaches the facade through `src/__generated__/`, which is why
   * the command regenerates before it bundles. Drop that call and this case is the one that fails.
   */
  it('follows the manifest, regenerating the barrel the facade is bundled from', async () => {
    fs.writeFileSync(path.join(pack, 'apack.json'), manifest('Memo', 'Reminder'));

    expect((await callCli(pack, 'facade-report')).code).toBe(1);
    expect((await callCli(pack, 'facade-report', ['--update'])).code).toBe(0);
    expect(readReport()).toContain('ReminderEntity');
  });
});

/**
 * The build holds the report to the bundle it has just produced — the one moment nothing can be stale about
 * it — and **warns**. It does not fail, because a report that has not caught up is not output a dependent
 * cannot use, and because failing would mean no pack author could start their app until they had rewritten a
 * reviewed report mid-change. `facade:check` is the gate that says so once: its own chain step, and CI.
 */
describe.skipIf(!PACKAGES_BUILT)('apack pack build', () => {
  it('warns about a report that has gone stale, and still succeeds', async () => {
    fs.writeFileSync(path.join(pack, 'src', 'system.contract.ts'), CONTRACT(" | { type: 'NOTIFIED_AGAIN' }"));

    const { code, output } = await callCli(pack, 'build');
    expect(code, output).toBe(0);
    expect(output).toContain('facade:update');
  });
});
