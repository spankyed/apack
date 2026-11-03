import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, vi } from 'vitest';
import { vueRuntimePack } from './frontend-pack.ts';
import { filesUnder } from '../../src/build/phase-cache.ts';
import type { WatchOptions } from '../../src/build/watch.ts';
import type { PackBuilderOptions } from '../../src/build/build-process.ts';
import { startTestPackBuildWatcher } from './watch-builds.ts';

export function createFrontendResourceFixture({ captureCompiler }: PackBuilderOptions = {}) {
  let root: string | undefined;
  let signal: AbortSignal | undefined;
  const watchers: ReturnType<typeof startTestPackBuildWatcher>[] = [];
  beforeEach(context => { signal = context.signal; });
  afterEach(async () => {
    try {
      const results = await Promise.allSettled(watchers.splice(0)
        .map(starting => starting.then(watcher => watcher.close(), () => {})));
      const failures = results.flatMap(result => result.status === 'rejected' ? [result.reason] : []);
      if (failures.length) throw new AggregateError(failures, 'Could not close frontend fixture watchers');
    } finally {
      vi.unstubAllEnvs(); vi.restoreAllMocks();
    }
    if (root) fs.rmSync(root, { recursive: true, force: true });
    root = undefined;
  });
  return {
    startWatcher(pack: string, options: Omit<WatchOptions, 'signal' | 'builder'> = {}) {
      const starting = startTestPackBuildWatcher(pack, { ...options, signal, captureCompiler });
      watchers.push(starting);
      return starting;
    },
    consumer() {
      root = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-frontend-resources-'));
      return vueRuntimePack(root);
    },
    get root() {
      if (!root) throw new Error('Create the frontend consumer before reading its directory');
      return root;
    },
  };
}

/** A pack whose `canvas.vue` imports through `expression`, from a `pages` directory outside it that is empty and linked into it */
export function externalGlobConsumer(fixture: ReturnType<typeof createFrontendResourceFixture>, expression: string) {
  const { pack } = fixture.consumer();
  const packageFile = path.join(pack, 'package.json');
  const manifest = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
  manifest.imports = { ...manifest.imports, '#pages/*': './pages/*' };
  fs.writeFileSync(packageFile, JSON.stringify(manifest));
  const directory = path.join(fixture.root, 'pages');
  fs.mkdirSync(directory);
  fs.symlinkSync(directory, path.join(pack, 'pages'), 'dir');
  const entryPoint = path.join(pack, expression.includes('#pages') ? 'canvas.vue' : 'src/canvas.vue');
  fs.writeFileSync(entryPoint, `<script setup>const pages = ${expression};</script><template><div>{{ pages }}</div></template>`);
  return { pack, directory, entryPoint, page: path.join(directory, 'nested', 'new.js') };
}

export function readFrontendOutput(pack: string, extension: string): string {
  const directory = path.join(pack, 'dist/runtime');
  return filesUnder(directory).filter(file => file.endsWith(extension))
    .map(file => fs.readFileSync(path.join(directory, file), 'utf8')).join('\n');
}
