#!/usr/bin/env node
import { existsSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// A global, Homebrew or app-bundled `apack` defers to the @apackdev/cli the current project
// pins, so every pack builds with the CLI version it was written against.
function projectCli() {
  try {
    const projectPkg = createRequire(path.join(process.cwd(), 'noop.js')).resolve('@apackdev/cli/package.json');
    const projectDir = realpathSync(path.dirname(projectPkg));
    const ownDir = realpathSync(path.dirname(import.meta.dirname));
    return projectDir === ownDir ? null : path.join(projectDir, 'bin', 'apack.mjs');
  } catch {
    return null;
  }
}

const frontend = process.env.APACK_FRONTEND_WORKER === '1';
const worker = process.env.APACK_BUILD_WORKER === '1' || frontend;
if (worker) globalThis[Symbol.for(frontend ? 'apack.compiler.frontend' : 'apack.compiler.startup')]?.stopReads();
if (worker && (!process.send || !process.connected)) throw new Error(`Pack ${frontend ? 'frontend' : 'build'} worker requires its parent IPC channel`);
// The supervisor already selected and captured this compiler; project hand-off would escape it.
const handoff = worker ? null : projectCli();
if (handoff) {
  await import(pathToFileURL(handoff).href);
} else {
  const entry = frontend ? 'frontend-worker' : worker ? 'build-worker' : 'cli';
  const bundle = new URL(`../dist/${entry}.js`, import.meta.url);
  const bundled = existsSync(new URL('../dist/cli.js', import.meta.url));
  // Bundled workers load pack TypeScript through their owned scopes. A second, unscoped tsx loader
  // would transform those inputs first using another configuration. Source CLI boot still needs tsx.
  if (!worker || !bundled) {
    const { register } = await import('tsx/esm/api');
    register();
  }
  if (!bundled) {
    // In a checkout, workspace @apackdev/* packages resolve to their source. Registered after tsx,
    // so it runs first and tsx resolves with the added condition. Only this process, and only the
    // CLI's own code: a pack is compiled and run against those packages' dist, so the children this
    // CLI starts for pack code (the Playwright runner, the app) have the condition stripped from
    // NODE_OPTIONS. The content-runtime check starts without compiler launch options altogether.
    const { register: registerHooks } = await import('node:module');
    registerHooks(new URL('./source-hooks.mjs', import.meta.url), {
      data: { checkout: new URL('../../../', import.meta.url).href },
    });
    const { assertSourceResolution } = await import('@apackdev/host/build/source-resolution');
    assertSourceResolution((specifier) => fileURLToPath(import.meta.resolve(specifier)), 'The apack CLI');
  }
  await import(bundled ? bundle.href : worker ? `../src/build/${entry}.ts` : '../src/index.ts');
}
