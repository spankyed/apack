import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
import { packFixture } from '@apackdev/sdk/testing/pack-fixture';
import { REPO_ROOT } from '@apackdev/host/build/packages-built';
import { readPackBuild } from '@apackdev/host/packs';
import { readPackBuildInputs, assertPackBuildInputsCurrent } from '@apackdev/host/build/pack-build-inputs';
import { createPackBuilder } from '../../src/build/build-process.ts';
import { formatNodeOptions, parseNodeOptions } from '@apackdev/host/build/source-resolution';
import type { CompilerInstallation } from '../../src/build/compiler-installation.ts';
import { startPackFrontend, type PackFrontend } from '../../src/build/frontend-process.ts';
import { nativeFixture, nativeLoad } from '../_support/native-libraries.ts';
import { shareCompilerInstallation } from '../_support/shared-compiler.ts';
import { cpuBudget } from '@apackdev/testing/vitest';

// The native-library proofs are split by subject so the native half's shards can spread them; this one is
// outside launch overrides: OS libraries, the DYLD_* variables and the selected image suffix.

const sharedCompiler = shareCompilerInstallation();
const execFileAsync = promisify(execFile);
const PROBE_MS = 60_000;

it.runIf(process.platform === 'darwin')('admits OS libraries and refuses outside launch overrides before build or frontend launch', { meta: cpuBudget(120_000 + 60_000 + 20_000) }, async () => {
  const fixture = await nativeFixture('relative');
  const builder = createPackBuilder(fixture.pack, { captureCompiler: sharedCompiler.capture });
  const previous = process.env.DYLD_INSERT_LIBRARIES;
  const previousCache = process.env.DYLD_SHARED_CACHE_DIR;
  const marker = path.join(fixture.root, 'inserted');
  const outside = path.join(fixture.root, 'insert/libinit.dylib');
  const started = performance.now();
  const checkpoint = (phase: string) => console.info(`Native launch admission: ${phase} (${Math.round(performance.now() - started)}ms)`);
  try {
    await fixture.buildLibrary(outside, `#include <stdio.h>
__attribute__((constructor)) static void initialize(void) {
  FILE *marker = fopen(${JSON.stringify(marker)}, "w"); if (marker) fclose(marker);
}`, outside);
    packFixture({ at: fixture.pack, nodeModules: path.join(REPO_ROOT, 'node_modules'), manifest: { features: {} },
      files: { 'src/pack-entry-fe.ts': 'export const surfaces = [];',
        'tsconfig.json': JSON.stringify({ compilerOptions: { module: 'esnext', moduleResolution: 'bundler', skipLibCheck: true } }) } });
    process.env.DYLD_INSERT_LIBRARIES = '/usr/lib/libSystem.B.dylib';
    await builder.build({ args: ['--skip-fe'], signal: AbortSignal.timeout(120_000) });
    checkpoint('OS baseline built');
    const output = path.join(fixture.pack, 'dist');
    const revision = readPackBuild(output).revision;
    for (const library of [outside, fixture.library]) {
      process.env.DYLD_INSERT_LIBRARIES = library;
      await expect(builder.build({ args: ['--skip-fe'] })).rejects.toThrow('DYLD_INSERT_LIBRARIES');
      await expect(builder.serveFrontend(() => {})).rejects.toThrow('DYLD_INSERT_LIBRARIES');
      expect(fs.existsSync(marker)).toBe(false);
      expect(readPackBuild(output).revision).toBe(revision);
    }
    checkpoint('outside insertion refused');
    process.env.DYLD_INSERT_LIBRARIES = '/usr/lib/libSystem.B.dylib';
    process.env.DYLD_SHARED_CACHE_DIR = fixture.root;
    await expect(builder.build({ args: ['--skip-fe'] })).rejects.toThrow('DYLD_SHARED_CACHE_DIR');
    await expect(builder.serveFrontend(() => {})).rejects.toThrow('DYLD_SHARED_CACHE_DIR');
    expect(fs.existsSync(marker)).toBe(false);
    expect(readPackBuild(output).revision).toBe(revision);
    checkpoint('outside cache refused');
  } finally {
    if (previous === undefined) delete process.env.DYLD_INSERT_LIBRARIES;
    else process.env.DYLD_INSERT_LIBRARIES = previous;
    if (previousCache === undefined) delete process.env.DYLD_SHARED_CACHE_DIR;
    else process.env.DYLD_SHARED_CACHE_DIR = previousCache;
    await builder.close();
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

it.runIf(process.platform === 'darwin').each(['DYLD_FALLBACK_LIBRARY_PATH', 'DYLD_FRAMEWORK_PATH', 'DYLD_FALLBACK_FRAMEWORK_PATH'] as const)(
  'refuses external %s before native initialization after preload mutation', { meta: cpuBudget(2 * 60_000 + 60_000 + 20_000) }, async variable => {
    const framework = variable !== 'DYLD_FALLBACK_LIBRARY_PATH';
    const fixture = await nativeFixture(framework ? 'framework' : 'fallback');
    const builder = createPackBuilder(fixture.pack, { captureCompiler: sharedCompiler.capture });
    const previousOptions = process.env.NODE_OPTIONS;
    const previousSearch = process.env[variable];
    const preload = path.join(fixture.pack, 'clear-fallback.cjs');
    const attempted = path.join(fixture.root, 'owned-attempt');
    const search = framework ? path.join(fixture.root, 'outside') : path.dirname(fixture.library);
    const selected = framework ? path.join(search, path.relative(fixture.native, fixture.library)) : fixture.library;
    try {
      if (framework) {
        fs.mkdirSync(path.dirname(selected), { recursive: true });
        fs.copyFileSync(fixture.library, selected);
        if (variable === 'DYLD_FALLBACK_FRAMEWORK_PATH') fs.rmSync(fixture.library);
      }
      // First prove dyld really selects the external bytes in a fresh process.
      const loaded = JSON.parse((await execFileAsync(process.execPath, ['-e', `const value = require(${JSON.stringify(path.join(fixture.native, 'binding/addon.node'))}).read(); console.log(JSON.stringify({ value, libraries: process.report.getReport().sharedObjects }));`], {
        encoding: 'utf8', env: { ...process.env, [variable]: search }, timeout: PROBE_MS,
      })).stdout) as { value: number; libraries: string[] };
      expect(loaded.value).toBe(11);
      expect(loaded.libraries).toContain(fs.realpathSync.native(selected));
      expect(fs.existsSync(fixture.marker)).toBe(true);
      fs.rmSync(fixture.marker);
      packFixture({ at: fixture.pack, nodeModules: path.join(REPO_ROOT, 'node_modules'), manifest: { features: {} },
        files: { 'tsconfig.json': JSON.stringify({ compilerOptions: { module: 'esnext', moduleResolution: 'bundler', skipLibCheck: true } }) } });
      await builder.build({ args: ['--skip-fe'] });
      const output = path.join(fixture.pack, 'dist');
      const revision = readPackBuild(output).revision;
      fs.writeFileSync(preload, `if (globalThis[Symbol.for('apack.compiler.startup')]) {
        delete process.env[${JSON.stringify(variable)}];
        require('node:fs').writeFileSync(${JSON.stringify(attempted)}, 'owned');
        require(${JSON.stringify(path.join(fixture.native, 'binding/addon.node'))});
      }`);
      process.env[variable] = search;
      process.env.NODE_OPTIONS = formatNodeOptions([...parseNodeOptions(previousOptions), '--require', preload]);
      await expect(builder.build({ args: ['--skip-fe'] })).rejects.toThrow();
      expect(fs.readFileSync(attempted, 'utf8')).toBe('owned');
      expect(fs.existsSync(fixture.marker)).toBe(false);
      expect(readPackBuild(output).revision).toBe(revision);
    } finally {
      if (previousOptions === undefined) delete process.env.NODE_OPTIONS;
      else process.env.NODE_OPTIONS = previousOptions;
      if (previousSearch === undefined) delete process.env[variable];
      else process.env[variable] = previousSearch;
      await builder.close();
      fs.rmSync(fixture.root, { recursive: true, force: true });
    }
  },
);

it.runIf(process.platform === 'darwin').each(['DYLD_VERSIONED_LIBRARY_PATH', 'DYLD_VERSIONED_FRAMEWORK_PATH'] as const)(
  'refuses selected external %s libraries before retained frontend initialization', async variable => {
    const fixture = await nativeFixture('relative');
    const previousOptions = process.env.NODE_OPTIONS;
    const previousSearch = process.env[variable];
    let compiler: CompilerInstallation | undefined;
    let frontend: PackFrontend | undefined;
    try {
      const directory = path.join(fixture.root, 'overrides');
      const selected = path.join(directory, variable === 'DYLD_VERSIONED_FRAMEWORK_PATH' ? 'Value.framework/Value' : 'liboverride.dylib');
      await fixture.buildLibrary(selected, 'int native_value(void) { return 22; }', '@loader_path/../lib/libvalue.dylib');
      const addon = path.join(fixture.native, 'binding/addon.node');
      const loaded = JSON.parse((await execFileAsync(process.execPath, ['-e', `const addon = require(${JSON.stringify(addon)}); console.log(JSON.stringify({ value: addon.read(), libraries: process.report.getReport().sharedObjects }));`], {
        encoding: 'utf8', env: { ...process.env, [variable]: directory }, timeout: PROBE_MS,
      })).stdout) as { value: number; libraries: string[] };
      expect(loaded.value).toBe(22);
      expect(loaded.libraries).toContain(selected);
      fs.rmSync(fixture.marker);
      packFixture({ at: fixture.pack, nodeModules: path.join(REPO_ROOT, 'node_modules'), manifest: { features: {} },
        files: { 'src/pack-entry-fe.ts': "export { default } from './View.vue';", 'src/View.vue': '<template>VERSIONED</template>' } });
      const preload = path.join(fixture.root, 'versioned-preload.cjs');
      fs.writeFileSync(preload, `if (globalThis[Symbol.for('apack.compiler.frontend')]) {
        delete process.env[${JSON.stringify(variable)}]; require(${JSON.stringify(addon)});
      }`);
      compiler = await sharedCompiler.installation({ cwd: fixture.pack });
      process.env[variable] = directory;
      process.env.NODE_OPTIONS = formatNodeOptions([...parseNodeOptions(previousOptions), '--require', preload]);
      await expect(startPackFrontend(fixture.pack, compiler, new AbortController().signal)
        .then(value => { frontend = value; })).rejects.toThrow(`${variable} references directory "${directory}"`);
      expect(fs.existsSync(fixture.marker)).toBe(false);
    } finally {
      if (previousOptions === undefined) delete process.env.NODE_OPTIONS;
      else process.env.NODE_OPTIONS = previousOptions;
      if (previousSearch === undefined) delete process.env[variable];
      else process.env[variable] = previousSearch;
      try { await frontend?.close(); }
      finally { await compiler?.dispose(); fs.rmSync(fixture.root, { recursive: true, force: true }); }
    }
  },
);

it.runIf(process.platform === 'darwin')('captures the selected native image suffix and refuses its later transitive escape', { meta: cpuBudget(2 * 60_000 + 90_000 + 30_000) }, async () => {
  const fixture = await nativeFixture('relative');
  const builder = createPackBuilder(fixture.pack, { captureCompiler: sharedCompiler.capture });
  const previousOptions = process.env.NODE_OPTIONS;
  const previousSuffix = process.env.DYLD_IMAGE_SUFFIX;
  const selected = fixture.library.replace(/\.dylib$/, '_apack.dylib');
  const reference = '@loader_path/../lib/libvalue.dylib';
  const preload = path.join(fixture.pack, 'suffix-preload.cjs');
  const proof = path.join(fixture.root, 'selected.json');
  const attempted = path.join(fixture.root, 'owned-attempt');
  try {
    await fixture.buildLibrary(selected, 'int native_value(void) { return 37; }', reference);
    const loaded = JSON.parse((await execFileAsync(process.execPath, ['-e', `const addon = require(${JSON.stringify(path.join(fixture.native, 'binding/addon.node'))}); console.log(JSON.stringify({ value: addon.read(), libraries: process.report.getReport().sharedObjects }));`], {
      encoding: 'utf8', env: { ...process.env, DYLD_IMAGE_SUFFIX: '_apack' }, timeout: PROBE_MS,
    })).stdout) as { value: number; libraries: string[] };
    expect(loaded.value).toBe(37);
    expect(loaded.libraries).toContain(selected);
    fs.rmSync(fixture.marker);
    packFixture({ at: fixture.pack, nodeModules: path.join(REPO_ROOT, 'node_modules'), manifest: { features: {} },
      files: { 'tsconfig.json': JSON.stringify({ compilerOptions: { module: 'esnext', moduleResolution: 'bundler', skipLibCheck: true } }) } });
    fs.writeFileSync(preload, `if (globalThis[Symbol.for('apack.compiler.startup')]) {
      delete process.env.DYLD_IMAGE_SUFFIX;
      require('node:fs').writeFileSync(${JSON.stringify(attempted)}, 'owned');
      ${nativeLoad(fixture, proof)}
    }`);
    process.env.DYLD_IMAGE_SUFFIX = '_apack';
    process.env.NODE_OPTIONS = formatNodeOptions([...parseNodeOptions(previousOptions), '--require', preload]);
    await builder.build({ args: ['--skip-fe'] });
    const accepted = JSON.parse(fs.readFileSync(proof, 'utf8')) as { value: number; libraries: string[] };
    expect(accepted.value).toBe(37);
    expect(accepted.libraries).not.toContain(selected);
    expect(accepted.libraries.some(file => file.includes('apack-inputs-') && file.endsWith('/lib/libvalue_apack.dylib'))).toBe(true);
    const output = path.join(fixture.pack, 'dist');
    const revision = readPackBuild(output).revision;
    const inputs = readPackBuildInputs(output);
    assertPackBuildInputsCurrent(fixture.pack, inputs);
    fs.rmSync(fixture.marker);
    fs.rmSync(proof);
    fs.rmSync(attempted);
    await fixture.buildLibrary(fixture.outside, 'int outside_value(void) { return 37; }', fixture.outside);
    await fixture.buildLibrary(selected, 'extern int outside_value(void); int native_value(void) { return outside_value(); }', reference, [fixture.outside]);
    expect(() => assertPackBuildInputsCurrent(fixture.pack, inputs)).toThrow();
    await expect(builder.build({ args: ['--skip-fe'] })).rejects.toThrow();
    expect(fs.readFileSync(attempted, 'utf8')).toBe('owned');
    expect(fs.existsSync(fixture.marker)).toBe(false);
    expect(fs.existsSync(proof)).toBe(false);
    expect(readPackBuild(output).revision).toBe(revision);
  } finally {
    if (previousOptions === undefined) delete process.env.NODE_OPTIONS;
    else process.env.NODE_OPTIONS = previousOptions;
    if (previousSuffix === undefined) delete process.env.DYLD_IMAGE_SUFFIX;
    else process.env.DYLD_IMAGE_SUFFIX = previousSuffix;
    await builder.close();
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});
