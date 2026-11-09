import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { FIXTURE_DATA, FIXTURE_ENTITY, packFixture } from '@apackdev/sdk/testing/pack-fixture';
import { REPO_ROOT } from '@apackdev/host/build/packages-built';
import { createPackBuilder, type PackBuilder } from '../../src/build/build-process.ts';
import { readPackBuild } from '@apackdev/host/packs';
import { startPackBuildWatcher } from '../../src/build/watch.ts';
import { cpuBudget } from '@apackdev/testing/vitest';
import { _settles } from '@apackdev/sdk/testing/waiting';

it('rebuilds for worker inputs and repairs missing external reads without authored edits', { meta: cpuBudget(120_000 + 2 * 60_000 + 20_000) }, async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-watch-worker-'));
  const root = path.join(temporary, 'pack');
  const value = path.join(temporary, 'value.txt');
  const selected = path.join(temporary, 'selected.txt');
  fs.writeFileSync(value, 'FIRST');
  fs.writeFileSync(selected, 'value.txt');
  let watcher: { close(): Promise<void> } | undefined;
  let publications = 0;
  let builder: PackBuilder | undefined;
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    packFixture({ at: root, nodeModules: path.join(REPO_ROOT, 'node_modules'), manifest: {
      id: 'watched-worker', name: 'Watched worker', features: {},
      data: FIXTURE_DATA, content: { formats: { rows: { compiler: 'src/compiler.cjs', entity: FIXTURE_ENTITY, identity: ['name'] } },
        sources: { rows: { path: 'src/value.txt', format: 'rows' } } },
    }, files: {
      'src/value.txt': 'rows',
      'src/compiler.cjs': `const {Worker} = require('node:worker_threads'); const {once} = require('node:events');
        module.exports = async () => {
          const worker = new Worker("const {parentPort,workerData}=require('node:worker_threads'); const fs=require('node:fs'), path=require('node:path'); const target=path.resolve(path.dirname(workerData),fs.readFileSync(workerData,'utf8')); parentPort.postMessage(fs.readFileSync(target,'utf8'));", {eval:true,workerData:${JSON.stringify(selected)}});
          try { const [name] = await once(worker,'message'); return [{entity: ${JSON.stringify(FIXTURE_ENTITY)},name}]; }
          finally { await worker.terminate(); }
        };`,
    } });
    const output = () => JSON.parse(fs.readFileSync(path.join(root, 'dist/runtime/content/rows.content.json'), 'utf8')).records[0].name;
    builder = createPackBuilder(root);
    watcher = await startPackBuildWatcher(root, {
      builder: builder!, buildArgs: ['--skip-fe'],
      place: { env: 'test', userDataDir: path.join(temporary, 'profile') },
      onBuilt: async () => { publications++; },
    });
    expect(output()).toBe('FIRST');
    const accepted = readPackBuild(path.join(root, 'dist')).revision;
    fs.writeFileSync(selected, 'future/value.txt');
    await _settles(() => expect(errors).toHaveBeenCalledWith(expect.stringContaining('Build/reload failed')));
    expect(publications).toBe(0);
    expect(readPackBuild(path.join(root, 'dist')).revision).toBe(accepted);
    expect(output()).toBe('FIRST');
    fs.mkdirSync(path.join(temporary, 'future'));
    fs.writeFileSync(path.join(temporary, 'future/value.txt'), 'SECOND');
    await _settles(() => expect(publications).toBe(1));
    expect(output()).toBe('SECOND');
  } finally {
    await Promise.all([watcher?.close(), builder?.close()]);
    errors.mockRestore();
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
