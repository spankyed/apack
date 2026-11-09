// A pack's `build.workers` entries: each bundled whole beside the runtime, found by `workerPath`, and refused when
// it imports what only the host's module bridge resolves — which a worker thread or child process doesn't have.
import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import { Worker } from 'node:worker_threads';
import { afterEach, describe, expect, it } from 'vitest';
import { packFixture } from '@apackdev/sdk/testing/pack-fixture';
import { generatePackFiles, type PackManifest } from '@apackdev/sdk/build';
import { REPO_ROOT } from '@apackdev/host/build/packages-built';
import { bundlePackWorkers } from '../../src/build/be-bundler';

const tmpDirs: string[] = [];
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function pack(files: Record<string, string>): string {
  const dir = packFixture({ manifest: { id: 'worker-pack', name: 'Workers' }, files, nodeModules: path.join(REPO_ROOT, 'node_modules') });
  tmpDirs.push(dir);
  return dir;
}

/** The worker's one answer to `input` */
function ask(file: string, input: unknown): Promise<unknown> {
  const worker = new Worker(file);
  return new Promise((resolve, reject) => {
    worker.once('message', (answer) => { void worker.terminate(); resolve(answer); });
    worker.once('error', reject);
    worker.postMessage(input);
  });
}

const WORKER = `import { parentPort } from 'node:worker_threads';
import picomatch from 'picomatch';
import { twice } from './twice.ts';
parentPort!.on('message', (glob: string) => parentPort!.postMessage({ matches: picomatch(glob)('a/b.ts'), twice: twice(21) }));
`;

describe('build.workers', () => {
  it('bundles a worker with what it imports, so it runs with no node_modules beside it', async () => {
    const dir = pack({ 'src/worker.ts': WORKER, 'src/twice.ts': 'export const twice = (n: number) => n * 2;\n' });
    const dist = path.join(dir, 'dist');

    expect(await bundlePackWorkers(dir, dist, { indexer: 'src/worker.ts' })).toEqual({ success: true });

    const built = path.join(dist, 'runtime', 'workers', 'indexer.cjs');
    const moved = path.join(dir, 'installed', 'indexer.cjs');
    fs.mkdirSync(path.dirname(moved), { recursive: true });
    fs.copyFileSync(built, moved);
    expect(await ask(moved, 'a/*.ts')).toEqual({ matches: true, twice: 42 });
  });

  it.each([
    ['@apackdev/sdk/ears', "import { untypedQuery } from '@apackdev/sdk/ears';\nconsole.log(untypedQuery);\n"],
    ['zod', "import { z } from 'zod';\nconsole.log(z);\n"],
    ['@vscode/ripgrep', "import { rgPath } from '@vscode/ripgrep';\nconsole.log(rgPath);\n"],
  ])('refuses a worker importing %s, which only the module bridge resolves', async (specifier, source) => {
    const dir = pack({ 'src/worker.ts': source });
    const result = await bundlePackWorkers(dir, path.join(dir, 'dist'), { indexer: 'src/worker.ts' });
    expect(result.success).toBe(false);
    expect(result.error).toContain(`${specifier} reaches a pack only through the host's module bridge`);
  });

  it('names a worker whose entry is missing', async () => {
    const dir = pack({});
    const result = await bundlePackWorkers(dir, path.join(dir, 'dist'), { indexer: 'src/nowhere.ts' });
    expect(result).toEqual({ success: false, error: "Worker \"indexer\" names src/nowhere.ts, which doesn't exist" });
  });

  it("finds each worker beside the runtime the loader hands the pack", async () => {
    const dir = pack({ 'src/worker.ts': WORKER, 'src/twice.ts': 'export const twice = (n: number) => n * 2;\n' });
    const manifest = { id: 'worker-pack', name: 'Workers', version: '0.1.0', build: { workers: { indexer: 'src/worker.ts' } } } as PackManifest;
    const generated = await generatePackFiles(manifest, { packRoot: dir });
    for (const file of ['src/__generated__/appliers.ts', 'src/__generated__/workers.ts']) {
      fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
      fs.writeFileSync(path.join(dir, file), generated[file]!);
    }
    const dist = path.join(dir, 'dist');
    await bundlePackWorkers(dir, dist, { indexer: 'src/worker.ts' });
    const esbuild = await import('esbuild');
    const runtime = path.join(dist, 'runtime', 'probe.cjs');
    await esbuild.build({
      stdin: { contents: "export { setCompiledDir } from './src/__generated__/appliers.ts';\nexport { workerPath } from './src/__generated__/workers.ts';\n", resolveDir: dir, loader: 'ts' },
      bundle: true, format: 'cjs', platform: 'node', outfile: runtime, logLevel: 'silent', external: ['@apackdev/*'],
    });
    const loaded = createRequire(import.meta.url)(runtime) as { setCompiledDir(dir: string): void; workerPath(name: string): string };
    loaded.setCompiledDir(path.join(dist, 'runtime', 'content'));

    expect(loaded.workerPath('indexer')).toBe(path.join(dist, 'runtime', 'workers', 'indexer.cjs'));
    expect(await ask(loaded.workerPath('indexer'), '*.md')).toEqual({ matches: false, twice: 42 });
  });
});
