// Where the harness finds the pack, and which tests it runs: a pack's unit tests run from anywhere with --root,
// tests that run concurrently, or test files sharing the harness, fail naming why, and a pack scaffolded before the harness gets its setup from `apack pack add feature`.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { _declarationRevision } from '@apackdev/sdk/build';
import { callCli } from '../_support/pack-builds';
import { runCommand } from '../_support/run-command.ts';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const CLI = path.join(REPO_ROOT, 'packages', 'apack-cli', 'bin', 'apack.mjs');
const VITEST = path.join(REPO_ROOT, 'node_modules', 'vitest', 'vitest.mjs');

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
});


function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

function write(root: string, file: string, content: string): void {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), content);
}

/** A nested vitest or CLI run, off this worker's event loop */
const run = (command: string, args: string[], cwd: string) =>
  runCommand(command, args, cwd, { env: { CI: '', NO_COLOR: '1' }, timeout: 180_000 });

/** A pack with no dependencies whose unit tests run its data code on the harness */
function dataPack(spec: string, manifest: Record<string, unknown> = {}): string {
  const root = tempDir('apack-harness-setup-');
  fs.symlinkSync(path.join(REPO_ROOT, 'node_modules'), path.join(root, 'node_modules'), 'dir');
  write(root, 'package.json', JSON.stringify({ name: 'data-pack', type: 'module' }));
  write(root, 'apack.json', JSON.stringify({ id: 'data-pack', name: 'Data', version: '1.0.0', ...manifest }));
  // As `apack pack init` scaffolds it: one call, so this fixture stays what a real pack has
  write(root, 'vitest.config.ts', `
import { definePackTestConfig } from '@apackdev/testing/vitest';
export default definePackTestConfig({ dataDirPrefix: 'harness-setup-' });`);
  write(root, 'tests/setup.ts', `
import { setupPackTests } from '@apackdev/testing/harness';
await setupPackTests({ contentRuntime: { id: 'data-pack', declarationRevision: ${JSON.stringify(_declarationRevision(JSON.parse(fs.readFileSync(path.join(root, 'apack.json'), 'utf-8'))))}, entities: {}, relKinds: {}, roles: {}, repositories: {}, contentWriters: {} } });`);
  write(root, 'tests/pack.spec.ts', spec);
  return root;
}

describe("a pack's unit tests on the harness", () => {
  it('runs without a bundled build and refuses stale source declarations before starting the harness', async () => {
    const root = dataPack(`import { expect, it } from 'vitest'; it('source works', () => expect(true).toBe(true));`);
    expect(fs.existsSync(path.join(root, 'dist'))).toBe(false);
    expect((await run(process.execPath, [VITEST, 'run'], root)).output).toMatch(/Tests\s+1 passed/);
    const manifestFile = path.join(root, 'apack.json');
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf-8'));
    fs.writeFileSync(manifestFile, JSON.stringify({ ...manifest, name: 'Edited source' }));
    const refused = await run(process.execPath, [VITEST, 'run'], root);
    expect(refused.code).toBe(1);
    expect(refused.output).toContain('generated declarations are stale');
    expect(fs.existsSync(path.join(root, 'dist'))).toBe(false);
  });

  it('find the pack from the vitest project root when run from another directory (--root)', async () => {
    const root = dataPack(`
import { expect, it } from 'vitest';
import { importContent } from '@apackdev/testing/harness';
it('writes nothing', async () => {
  expect(await importContent()).toEqual({});
});`);
    // inherent: runs a pack's own vitest suite from another cwd — the nested runner is the thing under test
    const result = await run(process.execPath, [VITEST, 'run', '--root', root], tempDir('apack-elsewhere-'));
    expect(result.output).toMatch(/Tests\s+1 passed/);
  });

  // A content runtime registers no features, yet an action the test runs sends to the pack's own through services.emitter
  it("let services.emitter send to the features the pack's manifest declares", async () => {
    const root = dataPack(`
import { expect, it } from 'vitest';
import { createActionEmitter } from '@apackdev/sdk/services';
it('sends to its own system and surface', () => {
  expect(() => createActionEmitter().sendToSystem('data-pack/memos', { type: 'GET_MEMOS' })).not.toThrow();
  expect(() => createActionEmitter().broadcastToSurface('data-pack/memos', { type: 'MEMOS_UPDATED' })).not.toThrow();
  expect(() => createActionEmitter().broadcastToSurface('data-pack/ghost', { type: 'MEMOS_UPDATED' })).toThrow('No registered surface is named "data-pack/ghost"');
});`, { features: { memos: { description: 'Exercise the harness system.', system: { entry: 'src/features/memos/be/system.ts' }, surface: { label: 'Fixture', state: 'src/features/memos/fe/index.ts' } } } });
    // inherent: runs a pack's own vitest suite — the nested runner is the thing under test
    const result = await run(process.execPath, [VITEST, 'run'], root);
    expect(result.output).toMatch(/Tests\s+1 passed/);
  });

  it('fail naming why when test files share the harness (vitest isolate off)', async () => {
    const spec = `
import { expect, it } from 'vitest';
import { importContent } from '@apackdev/testing/harness';
it('writes nothing', async () => {
  expect(await importContent()).toEqual({});
});`;
    const root = dataPack(spec);
    write(root, 'tests/other.spec.ts', spec);
    // `isolate: false` is the thing under test, and a pack sets what the helper does not by spreading it —
    // which is also the only way to override anything `definePackTestConfig` decides
    write(root, 'vitest.config.ts', `
import { definePackTestConfig } from '@apackdev/testing/vitest';
const base = await definePackTestConfig({ dataDirPrefix: 'harness-setup-' });
export default { ...base, test: { ...base.test, isolate: false, fileParallelism: false } };`);
    // inherent: runs a pack's own vitest suite — the nested runner is the thing under test
    const result = await run(process.execPath, [VITEST, 'run'], root);
    expect(result.output).toContain('setupPackTests() already ran in this process');
    expect(result.output).toContain('`isolate` on (the default)');
  });

  it('fail concurrent tests, naming why', async () => {
    const root = dataPack(`
import { it } from 'vitest';
it.concurrent('one', async () => {});
it.concurrent('two', async () => {});`);
    // inherent: runs a pack's own vitest suite — the nested runner is the thing under test
    const result = await run(process.execPath, [VITEST, 'run'], root);
    expect(result.output).toMatch(/Tests\s+2 failed/);
    expect(result.output).toContain('"one" runs concurrently: harness tests share one database, service mocks and apps per file');
  });

  it("run a concurrent test nothing runs alongside: alone in its group, or next to skipped ones", async () => {
    const root = dataPack(`
import { describe, it } from 'vitest';
it.concurrent('alone', async () => {});
it('after it', async () => {});
describe.concurrent('a concurrent suite', () => {
  it('runs', async () => {});
  it.skip('skipped', async () => {});
});`);
    // inherent: runs a pack's own vitest suite — the nested runner is the thing under test
    const result = await run(process.execPath, [VITEST, 'run'], root);
    expect(result.output).toMatch(/Tests\s+3 passed \| 1 skipped/);
  });
});

describe('apack pack add feature in a pack without the unit test setup', () => {
  it('adds the harness setup its system test runs on, and the test passes', async () => {
    const tmp = tempDir('apack-pre-harness-');
    // produces: the pre-harness pack the test then strips and re-adds a feature to
    expect((await callCli(tmp, 'init', ['old-pack'])).code).toBe(0);
    const pack = path.join(tmp, 'old-pack');
    fs.symlinkSync(path.join(REPO_ROOT, 'node_modules'), path.join(pack, 'node_modules'), 'dir');
    // As a pack scaffolded before the harness: no tests/setup.ts, a vitest config of its own, no harness dependency
    fs.rmSync(path.join(pack, 'tests'), { recursive: true });
    const pkgPath = path.join(pack, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    delete pkg.devDependencies['@apackdev/testing'];
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));

    // process: the report the command prints, line by line, is the assertion
    const added = await run(process.execPath, [CLI, 'pack', 'add', 'feature', 'memos', '--description', 'Manage memos.'], pack);

    expect(added.code, added.output).toBe(0);
    expect(added.output).toContain('+ tests/setup.ts');
    expect(added.output).toContain('+ tests/features/memos/be/system.spec.ts');
    expect(added.output).toContain('vitest.config.ts already exists');
    expect(added.output).toContain('Added @apackdev/testing to devDependencies. Run: npm install');
    expect(JSON.parse(fs.readFileSync(pkgPath, 'utf-8')).devDependencies['@apackdev/testing']).toMatch(/^\^/);
    // The kept config is the scaffold's, which loads tests/setup.ts
    // inherent: runs a pack's own vitest suite — the nested runner is the thing under test
    // Verbose, because which file ran is the question and the default reporter names none of them off a terminal
    const unit = await run(process.execPath, [VITEST, 'run', '--reporter=verbose'], pack);
    expect(unit.output).toMatch(/tests\/features\/memos\/be\/system\.spec\.ts/);
    expect(unit.output).toMatch(/Tests\s+1 passed/);
  });
});
