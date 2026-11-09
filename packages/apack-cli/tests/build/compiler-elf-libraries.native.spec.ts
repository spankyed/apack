import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { packFixture } from '@apackdev/sdk/testing/pack-fixture';
import { REPO_ROOT } from '@apackdev/host/build/packages-built';
import { formatNodeOptions, parseNodeOptions } from '@apackdev/host/build/source-resolution';
import type { CompilerInstallation } from '../../src/build/compiler-installation.ts';
import { startPackFrontend, type PackFrontend } from '../../src/build/frontend-process.ts';
import { parseElfLibraryCommands } from '../../src/build/compiler-elf-libraries.ts';
import { isElfSystemLibrary } from '../../src/build/compiler-elf-environment.ts';
import { nativeAddonSource } from '../_support/native-addon.ts';
import { shareCompilerInstallation } from '../_support/shared-compiler.ts';
import { execFileWhileWorking } from '@apackdev/sdk/progress';
import { settles } from '@apackdev/sdk/testing/waiting';
import { DEV_SERVER_HOST } from '@apackdev/host/packs/dev-server';

const sharedCompiler = shareCompilerInstallation();

const execFileAsync = execFileWhileWorking;
const compile = (args: string[]) => execFileAsync('cc', args, { timeout: 15_000 });

it.runIf(process.platform === 'linux')('owns retained ELF libraries, preserves Vue updates and refuses absolute outside dependencies', async () => {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'apack-elf-libraries-')));
  const pack = path.join(root, 'pack');
  const previous = process.env.NODE_OPTIONS;
  let compiler: CompilerInstallation | undefined;
  let frontend: PackFrontend | undefined;
  let refused: PackFrontend | undefined;
  const signal = new AbortController().signal;
  try {
    packFixture({ at: pack, nodeModules: path.join(REPO_ROOT, 'node_modules'), manifest: { features: {} },
      files: { 'src/pack-entry-fe.ts': "export { default } from './View.vue';", 'src/View.vue': '<template>ELF_BEFORE</template>' } });
    const library = path.join(pack, 'lib/libvalue.so');
    const addon = path.join(pack, 'binding/addon.node');
    const marker = path.join(root, 'initialized');
    const reference = '$ORIGIN/../lib/libvalue.so';
    const buildLibrary = async (file: string, value: number, name: string) => {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file + '.c', `int native_value(void) { return ${value}; }`);
      await compile(['-fPIC', '-shared', file + '.c', '-Wl,-soname,' + name, '-o', file]);
    };
    const source = path.join(root, 'addon.c');
    fs.writeFileSync(source, nativeAddonSource(marker));
    const buildAddon = async (file: string, dependency: string) => {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      await compile(['-fPIC', '-shared', '-I', path.resolve(path.dirname(process.execPath), '../include/node'), source, dependency, '-o', file]);
    };
    const observe = async () => JSON.parse((await execFileAsync(process.execPath, ['-e',
      `const addon = require(${JSON.stringify(addon)}); console.log(JSON.stringify({ value: addon.read(), libraries: process.report.getReport().sharedObjects.map(file => require('node:path').normalize(file)) }));`],
    { encoding: 'utf8', timeout: 10_000 })).stdout) as { value: number; libraries: string[] };
    await buildLibrary(library, 11, reference);
    await buildAddon(addon, library);
    const ordinary = await observe();
    expect(ordinary.value).toBe(11);
    expect(ordinary.libraries).toContain(library);
    fs.rmSync(marker);
    const proof = path.join(root, 'loaded.json');
    const preload = path.join(root, 'preload.cjs');
    fs.writeFileSync(preload, `if (globalThis[Symbol.for('apack.compiler.frontend')] && require('node:worker_threads').isMainThread) {
      const addon = require(${JSON.stringify(addon)});
      require('node:fs').writeFileSync(${JSON.stringify(proof)}, JSON.stringify({ value: addon.read(), libraries: process.report.getReport().sharedObjects.map(file => require('node:path').normalize(file)) }));
    }`);
    compiler = await sharedCompiler.installation({ cwd: pack });
    process.env.NODE_OPTIONS = formatNodeOptions([...parseNodeOptions(previous), '--require', preload]);
    frontend = await startPackFrontend(pack, compiler, signal);
    const loaded = JSON.parse(fs.readFileSync(proof, 'utf8')) as { value: number; libraries: string[] };
    expect(loaded.value).toBe(11);
    expect(loaded.libraries).not.toContain(library);
    expect(loaded.libraries.some(file => file.includes('apack-vite-') && file.endsWith('/lib/libvalue.so'))).toBe(true);
    expect(await frontend.isCurrent(signal)).toBe(true);
    const original = fs.readFileSync(library);
    const originalMode = fs.statSync(library).mode & 0o777;
    const replacement = path.join(root, 'replacement.so');
    await buildLibrary(replacement, 22, reference);
    fs.renameSync(replacement, library);
    expect(await frontend.isCurrent(signal)).toBe(false);
    fs.writeFileSync(replacement, original, { mode: originalMode });
    fs.renameSync(replacement, library);
    expect(await frontend.isCurrent(signal)).toBe(true);
    const view = `http://${DEV_SERVER_HOST}:${frontend.address.port}/src/View.vue`;
    expect(await (await fetch(view)).text()).toContain('ELF_BEFORE');
    fs.writeFileSync(path.join(pack, 'src/View.vue'), '<template>ELF_AFTER</template>');
    await settles(async () => expect(await (await fetch(view)).text()).toContain('ELF_AFTER'));
    expect(await frontend.isCurrent(signal)).toBe(true);
    const outside = path.join(root, 'outside/liboutside.so');
    await buildLibrary(outside, 22, outside);
    const candidate = path.join(root, 'candidate.node');
    await buildAddon(candidate, outside);
    fs.renameSync(candidate, addon);
    const escaped = await observe();
    expect(escaped.value).toBe(22);
    expect(escaped.libraries).toContain(outside);
    fs.rmSync(marker);
    await expect(startPackFrontend(pack, compiler, signal).then(value => { refused = value; })).rejects.toThrow();
    expect(fs.existsSync(marker)).toBe(false);
    expect(frontend.alive()).toBe(true);
    expect(await (await fetch(view)).text()).toContain('ELF_AFTER');
  } finally {
    if (previous === undefined) delete process.env.NODE_OPTIONS;
    else process.env.NODE_OPTIONS = previous;
    try { await refused?.close(); await frontend?.close(); }
    finally { await compiler?.dispose(); fs.rmSync(root, { recursive: true, force: true }); }
  }
});

it.runIf(process.platform === 'linux')('refuses outside runtime-linked libraries before captured executable initialization', async () => {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'apack-elf-runtime-')));
  const pack = path.join(root, 'pack');
  const previous = process.env.LD_LIBRARY_PATH;
  let compiler: CompilerInstallation | undefined;
  let frontend: PackFrontend | undefined;
  try {
    packFixture({ at: pack, nodeModules: path.join(REPO_ROOT, 'node_modules'), manifest: { features: {} },
      files: { 'src/pack-entry-fe.ts': 'export const surfaces = [];' } });
    const libraries = (process.report.getReport() as { sharedObjects: string[] }).sharedObjects;
    const original = libraries.find(file => isElfSystemLibrary(file)
      && parseElfLibraryCommands(fs.readFileSync(file)).soname === 'libstdc++.so.6');
    expect(original, 'the Node control must expose its real C++ runtime library').toBeDefined();
    const outside = path.join(root, 'outside');
    fs.mkdirSync(outside);
    // A shim retains Node's complete ABI through a renamed private copy of its real provider.
    // Only the private copy changes; no OS file or already mapped image is modified.
    const bytes = fs.readFileSync(original!);
    const name = Buffer.from('libstdc++.so.6\0');
    const at = bytes.indexOf(name);
    expect(at).toBeGreaterThanOrEqual(0);
    bytes.fill(0, at, at + name.length);
    bytes.write('$ORIGIN/r.so', at);
    expect(parseElfLibraryCommands(bytes).soname).toBe('$ORIGIN/r.so');
    const provider = path.join(outside, 'r.so');
    fs.writeFileSync(provider, bytes, { mode: 0o555 });
    const marker = path.join(root, 'runtime-initialized');
    const source = path.join(outside, 'shim.c');
    const shim = path.join(outside, 'libstdc++.so.6');
    fs.writeFileSync(source, `#include <stdio.h>
__attribute__((constructor)) static void initialize(void) {
  FILE *marker = fopen(${JSON.stringify(marker)}, "w"); if (marker) fclose(marker);
}`);
    await compile(['-fPIC', '-shared', '-Wl,-soname,libstdc++.so.6', '-Wl,--no-as-needed', source, provider, '-o', shim]);
    expect(parseElfLibraryCommands(fs.readFileSync(shim)).dependencies).toContain('$ORIGIN/r.so');
    const search = [outside, previous].filter(Boolean).join(':');
    const control = JSON.parse((await execFileAsync(process.execPath, ['-e',
      'console.log(JSON.stringify({version:process.version,libraries:process.report.getReport().sharedObjects}))'], {
      encoding: 'utf8', env: { ...process.env, LD_LIBRARY_PATH: search }, timeout: 10_000,
    })).stdout) as { version: string; libraries: string[] };
    expect(control.version).toBe(process.version);
    expect(control.libraries).toContain(shim);
    expect(fs.existsSync(marker)).toBe(true);
    fs.rmSync(marker);
    compiler = await sharedCompiler.installation({ cwd: pack });
    process.env.LD_LIBRARY_PATH = search;
    let refusal: unknown;
    try { frontend = await startPackFrontend(pack, compiler, new AbortController().signal); }
    catch (error) { refusal = error; }
    expect(fs.existsSync(marker), 'outside runtime constructor executed before JavaScript admission').toBe(false);
    expect(refusal).toBeInstanceOf(Error);
    expect((refusal as Error).message).toContain(shim);
    expect(frontend).toBeUndefined();
  } finally {
    if (previous === undefined) delete process.env.LD_LIBRARY_PATH;
    else process.env.LD_LIBRARY_PATH = previous;
    try { await frontend?.close(); }
    finally { await compiler?.dispose(); fs.rmSync(root, { recursive: true, force: true }); }
  }
});
