import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { REPO_ROOT } from '@apackdev/host/build/packages-built';
import { readPackBuild, PACK_LAYOUT } from '@apackdev/host/packs';
import { buildPack, callCli, preparePack, packageJson, tsconfig } from '../_support/pack-builds.ts';
import { cpuBudget } from '@apackdev/testing/vitest';

let root: string | undefined;
afterEach(() => { if (root) fs.rmSync(root, { recursive: true, force: true }); root = undefined; });

it('retains the consumer build when a content compiler changes accepted dependency bytes', { meta: cpuBudget(3 * 60_000 + 20_000) }, async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-dependency-publication-'));
  const producer = preparePack(root, 'provider', {
    'apack.json': JSON.stringify({ id: 'provider', name: 'Provider', version: '1.0.0' }),
    'package.json': packageJson('provider'), 'tsconfig.json': tsconfig,
  }, path.join(REPO_ROOT, 'node_modules'));
  await buildPack(producer);
  const consumer = preparePack(root, 'consumer', {
    'apack.json': JSON.stringify({ id: 'consumer', name: 'Consumer', version: '1.0.0',
      data: { entities: { Memo: {} } }, dependencies: { provider: `file:${producer}` },
      content: { formats: { memos: { compiler: 'src/compiler.ts', entity: 'Memo', identity: ['name'] } },
        sources: { memos: { path: 'content/data.json', format: 'memos' } } } }),
    'package.json': packageJson('consumer'), 'tsconfig.json': tsconfig, 'content/data.json': '[]',
    'src/compiler.ts': `import fs from 'node:fs'; import path from 'node:path';
export default function compile() {
  if (fs.existsSync('.apack/tamper')) {
    const resolution = JSON.parse(fs.readFileSync('.apack/deps/provider/resolution.json', 'utf8'));
    const file = path.join('.apack/deps/provider/builds', resolution.revision, 'runtime/index.cjs');
    fs.appendFileSync(file, '\\n// changed during compilation\\n');
  }
  return [];
}`,
  }, path.join(REPO_ROOT, 'node_modules'));
  await buildPack(consumer);
  const previous = readPackBuild(path.join(consumer, 'dist'));
  const generated = fs.readFileSync(path.join(consumer, '.apack/generate-entries.json'));
  fs.writeFileSync(path.join(consumer, '.apack/tamper'), '');
  const refused = await callCli(consumer, 'build', ['--skip-generate', '--skip-fe']);
  expect(refused.code, refused.output).toBe(1);
  expect(refused.output).toContain('failed verification');
  expect(readPackBuild(path.join(consumer, 'dist'))).toEqual(previous);
  expect(fs.readFileSync(path.join(consumer, '.apack/generate-entries.json'))).toEqual(generated);
  expect(fs.existsSync(path.join(consumer, '.apack/build'))).toBe(false);
  const resolution = JSON.parse(fs.readFileSync(path.join(consumer, '.apack/deps/provider/resolution.json'), 'utf8'));
  expect(fs.readFileSync(path.join(consumer, '.apack/deps/provider/builds', resolution.revision, PACK_LAYOUT.runtimeEntry), 'utf8'))
    .toContain('changed during compilation');
});
