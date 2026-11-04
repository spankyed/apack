import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fork } from 'node:child_process';
import threads, { SHARE_ENV } from 'node:worker_threads';
import { syncBuiltinESMExports } from 'node:module';
import { ownCompilerThreads } from '../../src/build/compiler-threads.ts';
import { afterEach, expect, it, vi } from 'vitest';
import { cliBin } from '../../src/utils.ts';
import { COMPILER_INPUTS_ENV, readCompilerInstallationInputs } from '../../src/build/compiler-installation-inputs.ts';
import { withCompilerFileReads } from '@apackdev/host/build/compiler-inputs';
import { _byDeadline } from '@apackdev/sdk/testing/waiting';
import { compilerStartupOptions, compilerStartupLoader } from '../../src/build/compiler-startup-options.ts';
import { parseNodeOptions } from '@apackdev/host/build/source-resolution';

const roots: string[] = [];
afterEach(() => { vi.unstubAllEnvs(); roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true })); });

it('reads owned compiler metadata without capturing it as authored input', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-owned-metadata-'));
  roots.push(root);
  const file = path.join(root, 'compiler-inputs.json');
  fs.writeFileSync(file, JSON.stringify({ hash: '0'.repeat(64), packages: [root], paths: [] }));
  vi.stubEnv(COMPILER_INPUTS_ENV, file);
  const scope = { compilation: {
    isInput: () => true,
    readDataPath: () => { throw new Error('Authored input captured'); },
    readDirectory: () => [],
    openDirectory: () => { throw new Error('Unexpected directory read'); },
    readMetadata: () => undefined,
    sourcePath: (file: string) => file,
    diagnostic: (message: string) => message,
    requireParent: (file: string) => file,
  } };
  expect(withCompilerFileReads(scope, () => readCompilerInstallationInputs())).toMatchObject({ directory: fs.realpathSync.native(root), packages: [root] });
  expect(() => withCompilerFileReads(scope, () => fs.readFileSync(file))).toThrow('Authored input captured');
});

it('keeps private startup options separate from child options and preserves user loader flags', () => {
  const bin = path.resolve('compiler/bin/apack.mjs');
  const normal = compilerStartupOptions(bin, '--import="/pre load.mjs"');
  expect(parseNodeOptions(normal.worker)).toEqual(['--require', path.resolve('compiler/dist/compiler-startup.cjs'), '--import=/pre load.mjs']);
  expect(parseNodeOptions(normal.user)).toEqual(['--import=/pre load.mjs']);
  for (const flag of ['--loader', '--experimental-loader']) {
    const options = compilerStartupOptions(bin, `${flag}="/custom loader.mjs" --conditions=@apackdev/source`);
    expect(parseNodeOptions(options.worker)).toEqual(['--require', path.resolve('compiler/dist/compiler-startup.cjs'),
      '--experimental-loader', compilerStartupLoader(path.resolve('compiler/dist/compiler-startup.cjs')),
      `${flag}=/custom loader.mjs`]);
    expect(parseNodeOptions(options.user)).toEqual([`${flag}=/custom loader.mjs`]);
  }
});

it('refuses shared worker environments that would run preloads before capture ownership', async () => {
  vi.stubEnv('NODE_OPTIONS', '--require=/must-not-run.cjs');
  const NativeWorker = threads.Worker;
  const collect = ownCompilerThreads(path.resolve('compiler-startup.cjs'), os.tmpdir(), {});
  try {
    expect(() => new threads.Worker('', { eval: true, execArgv: [], env: SHARE_ENV }))
      .toThrow('inherit execArgv or use a private environment');
    expect(process.env.NODE_OPTIONS).toBe('--require=/must-not-run.cjs');
  } finally {
    threads.Worker = NativeWorker;
    syncBuiltinESMExports();
    await collect(true);
  }
});

it('refuses a startup loader without its active input owner', async () => {
  await expect(import(new URL('../../bin/compiler-startup-loader.mjs', import.meta.url).href))
    .rejects.toThrow('Compiler loader requires its active startup input owner');
});

it.each([false, true])('refuses an uncaptured worker with parent IPC (unrelated metadata: %s)', async unrelated => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-worker-inputs-'));
  roots.push(root);
  const inputsFile = path.join(root, 'compiler-inputs.json');
  if (unrelated) fs.writeFileSync(inputsFile, JSON.stringify({ hash: '0'.repeat(64), packages: [root], paths: [] }));
  const child = fork(cliBin(), ['pack', 'build'], {
    cwd: root, execArgv: [], stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    env: { ...process.env, APACK_BUILD_WORKER: '1', [COMPILER_INPUTS_ENV]: unrelated ? inputsFile : undefined },
  });
  let errors = '';
  child.stderr!.on('data', chunk => { errors += chunk; });
  const closed = new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
  try {
    // A bound on a hang, not a speed check: the refusal is the first thing the worker does, but reaching it
    // is a cold CLI start from source, which a loaded small runner can take seconds over
    expect(await _byDeadline(closed, 'uncaptured worker refusal', 10_000)).toBe(1);
    expect(errors).toContain('Pack build worker requires captured compiler inputs');
    expect(fs.existsSync(path.join(root, 'dist'))).toBe(false);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await _byDeadline(closed, 'uncaptured worker cleanup', 2_000);
  }
});
