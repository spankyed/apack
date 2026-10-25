// @slow: one pack builder taken through 25 real builds: reuse, refusal and recovery
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { afterEach, expect, it, vi } from 'vitest';
import * as installation from '../../src/build/compiler-installation.ts';
import * as checkout from '../../src/build/checkout-packages.ts';
import { _declarationRevision, PACK_SNAPSHOT_FORMAT } from '@apackdev/sdk/build';
import { PACK_LAYOUT, readPackBuild, sealPackBuild } from '@apackdev/host/packs';
import { packInputsHash } from '@apackdev/host/build/pack-inputs';
import { createPackBuilder, type PackBuilder } from '../../src/build/build-process.ts';
import { readPackDevServerInputs } from '../../src/build/fe-bundler.ts';

function stopDescendant(pid: number) {
  try { process.kill(pid, 'SIGKILL'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
}

const roots: string[] = [];
const builders: PackBuilder[] = [];
afterEach(async () => {
  await Promise.all(builders.splice(0).map(builder => builder.close()));
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true }));
});

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-builder-'));
  roots.push(root);
  const compiler = path.join(root, 'compiler'), pack = path.join(root, 'pack');
  fs.mkdirSync(path.join(compiler, 'bin'), { recursive: true });
  fs.mkdirSync(path.join(compiler, 'dist'));
  fs.copyFileSync(fileURLToPath(new URL('../../bin/compiler-windows.ps1', import.meta.url)), path.join(compiler, 'bin/compiler-windows.ps1'));
  fs.copyFileSync(fileURLToPath(new URL('../../bin/compiler-helper-job.ps1', import.meta.url)), path.join(compiler, 'bin/compiler-helper-job.ps1'));
  fs.writeFileSync(path.join(compiler, 'dist/compiler-startup.cjs'), '// Fixture worker implements only candidate/process handoff.\n');
  fs.mkdirSync(path.join(pack, '.apack'), { recursive: true });
  const manifest = { id: 'builder', name: 'Builder', version: '1.0.0' };
  fs.writeFileSync(path.join(pack, 'apack.json'), JSON.stringify(manifest));
  const candidate = path.join(compiler, 'candidate');
  fs.mkdirSync(path.join(candidate, PACK_LAYOUT.runtimeDir), { recursive: true });
  fs.writeFileSync(path.join(candidate, PACK_LAYOUT.runtimeEntry), 'module.exports = {};');
  fs.mkdirSync(path.dirname(path.join(candidate, PACK_LAYOUT.snapshot)), { recursive: true });
  fs.writeFileSync(path.join(candidate, PACK_LAYOUT.snapshot), JSON.stringify({ manifest,
    format: PACK_SNAPSHOT_FORMAT, declarationRevision: _declarationRevision(manifest),
    types: { entities: {}, relKinds: {}, roles: {} }, entityDestinations: {}, facades: {} }));
  sealPackBuild(candidate, manifest);
  const handoff = { type: 'apack:build-candidate', inputHash: packInputsHash(pack), revision: readPackBuild(candidate).revision };
  fs.writeFileSync(path.join(compiler, 'package.json'), '{"name":"fixture-compiler","type":"module"}');
  fs.writeFileSync(path.join(compiler, 'label.txt'), 'first');
  fs.writeFileSync(path.join(compiler, 'bin/apack.mjs'), `
    import fs from 'node:fs';
    import {fileURLToPath} from 'node:url';
    import {spawn} from 'node:child_process';
    if (process.env.APACK_FRONTEND_WORKER === '1') {
      const hanging = fs.existsSync('.apack/frontend-hang');
      process.on('message', message => {
        if (message === 'frontend-close' && !hanging) process.exit(0);
        if (message?.type === 'frontend-inputs') {
          fs.writeFileSync('.apack/frontend-input-requested', 'requested');
          if (!fs.existsSync('.apack/frontend-input-hang')) process.send({ type: 'frontend-inputs', id: message.id, current: true });
        }
      });
      fs.writeFileSync('.apack/frontend-starting.json', JSON.stringify({pid:process.pid, directory:process.env.APACK_FRONTEND_DIRECTORY}));
      if (fs.existsSync('.apack/frontend-refuse')) process.exit(1);
      if (!hanging) process.send({type:'frontend-ready', port:12345, pid:process.pid, hash:JSON.parse(fs.readFileSync(process.env.APACK_COMPILER_INPUTS,'utf8')).hash});
      await new Promise(() => {});
    }
    if (process.argv.includes('--descendant')) {
      const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {stdio: 'ignore'});
      fs.writeFileSync('.apack/descendant.json', JSON.stringify({pid:child.pid}));
      child.unref();
    }
    if (process.argv.includes('--wait')) {
      process.on('message', () => {});
      process.on('SIGTERM', () => {
        if (process.argv.includes('--ignore-term')) return;
        fs.writeFileSync('.apack/stopped.json', JSON.stringify({compilerExists:fs.existsSync(fileURLToPath(import.meta.url))}));
        process.exit(0);
      });
    } else {
      fs.cpSync(new URL('../candidate', import.meta.url), '.apack/build', { recursive: true });
      // Compiler inputs are read-only; staged output must be removable by the parent.
      const writable = directory => {
        fs.chmodSync(directory, 0o755);
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
          if (entry.isDirectory()) writable(directory + '/' + entry.name);
        }
      };
      writable('.apack/build');
      process.send({...${JSON.stringify(handoff)}, inputHash:fs.existsSync('.apack/fixture-input-hash') ? fs.readFileSync('.apack/fixture-input-hash','utf8') : ${JSON.stringify(handoff.inputHash)}}, () => process.disconnect());
    }
    fs.writeFileSync('.apack/built.json', JSON.stringify({pid:process.pid, bin:import.meta.url, label:fs.readFileSync(new URL('../label.txt',import.meta.url),'utf8')}));
  `);
  vi.spyOn(installation, 'compilerPackageDirectory').mockReturnValue(compiler);
  vi.spyOn(checkout, 'ensureCheckoutPackages').mockImplementation(() => {});
  const builder = createPackBuilder(pack);
  builders.push(builder);
  const report = () => JSON.parse(fs.readFileSync(path.join(pack, '.apack/built.json'), 'utf8')) as { pid: number; bin: string; label: string };
  return { compiler, pack, builder, report };
}

async function prepareCompiler(compiler: string) {
  const captured = await installation.captureCompilerInstallation(compiler);
  try {
    // First launch of a copied native executable can exceed the shutdown tests' readiness budget.
    execFileSync(captured.executable, ['-e', ''], { timeout: 5_000 });
  } catch (error) {
    await captured.dispose();
    throw error;
  }
  vi.spyOn(installation, 'captureCompilerInstallation').mockResolvedValueOnce(captured);
  return captured;
}

it('reuses a verified compiler, refreshes changed or damaged copies, and releases its scope', async () => {
  const { compiler, builder, report } = fixture();
  await builder.build();
  const first = report();
  await builder.build();
  expect(report().bin).toBe(first.bin);
  expect(report().pid).not.toBe(first.pid);
  fs.writeFileSync(path.join(compiler, 'label.txt'), 'updated compiler');
  await builder.build();
  const updated = report();
  expect(updated.label).toBe('updated compiler');
  expect(updated.bin).not.toBe(first.bin);
  // Installations are the store's shared copies: a released one stays for whoever captures those inputs next
  expect(fs.existsSync(fileURLToPath(first.bin))).toBe(true);
  const label = fileURLToPath(new URL('../label.txt', updated.bin));
  fs.chmodSync(label, 0o644);
  fs.writeFileSync(label, 'damaged copy');
  await builder.build();
  const repaired = report();
  expect(repaired.label).toBe('updated compiler');
  // A damaged entry is captured again in place, so the same inputs keep the same path
  expect(repaired.bin).toBe(updated.bin);
  await builder.close();
  expect(fs.existsSync(fileURLToPath(repaired.bin))).toBe(true);
  await expect(builder.build()).rejects.toThrow('Pack builder is closed');
});

it('drains an interrupted frontend startup before removing its compiler and writable workspace', async () => {
  const { pack, builder, report } = fixture();
  await builder.build();
  const accepted = report();
  fs.mkdirSync(path.join(pack, 'src'));
  fs.writeFileSync(path.join(pack, 'src/pack-entry-fe.ts'), 'export {};');
  fs.writeFileSync(path.join(pack, '.apack/frontend-hang'), '');
  const refused = expect(builder.serveFrontend(() => {})).rejects.toMatchObject({ name: 'AbortError' });
  const record = path.join(pack, '.apack/frontend-starting.json');
  await vi.waitFor(() => expect(fs.existsSync(record)).toBe(true), { timeout: 5_000 });
  const { pid, directory } = JSON.parse(fs.readFileSync(record, 'utf8'));
  expect(fs.existsSync(directory)).toBe(true);
  expect(fs.existsSync(fileURLToPath(accepted.bin))).toBe(true);
  await builder.close();
  await refused;
  expect(() => process.kill(pid, 0)).toThrow();
  expect(fs.existsSync(directory)).toBe(false);
  expect(fs.existsSync(fileURLToPath(accepted.bin))).toBe(true);
});

it('cancels a frontend input check before retiring its compiler and workspace', async () => {
  const { pack, builder, report } = fixture();
  await builder.build();
  const accepted = report();
  fs.mkdirSync(path.join(pack, 'src'));
  fs.writeFileSync(path.join(pack, 'src/pack-entry-fe.ts'), 'export {};');
  await builder.serveFrontend(() => {});
  fs.writeFileSync(path.join(pack, '.apack/frontend-input-hang'), '');
  const refused = expect(builder.build()).rejects.toMatchObject({ name: 'AbortError' });
  // A bound on a hang: the build reaches its frontend input check after starting a worker, seconds on a two-core runner
  await vi.waitFor(() => expect(fs.existsSync(path.join(pack, '.apack/frontend-input-requested'))).toBe(true), { timeout: 15_000 });
  const { pid, directory } = JSON.parse(fs.readFileSync(path.join(pack, '.apack/frontend-starting.json'), 'utf8'));
  await builder.close();
  await refused;
  expect(() => process.kill(pid, 0)).toThrow();
  expect(fs.existsSync(directory)).toBe(false);
  expect(fs.existsSync(fileURLToPath(accepted.bin))).toBe(true);
}, 15_000 + 15_000);

it('refuses an unresponsive frontend freshness check and allows its later recovery', async () => {
  const { pack, builder } = fixture();
  await builder.build();
  fs.mkdirSync(path.join(pack, 'src'));
  fs.writeFileSync(path.join(pack, 'src/pack-entry-fe.ts'), 'export {};');
  await builder.serveFrontend(() => {});
  const hang = path.join(pack, '.apack/frontend-input-hang');
  fs.writeFileSync(hang, '');
  expect(await builder.isFrontendCurrent()).toBe(false);
  fs.rmSync(hang);
  expect(await builder.isFrontendCurrent()).toBe(true);
});

it('replaces a server for pack configuration changes while reusing unchanged source/configuration', async () => {
  const capture = vi.spyOn(installation, 'captureCompilerInstallation');
  const { pack, builder, report } = fixture();
  await builder.build();
  fs.mkdirSync(path.join(pack, 'src'));
  fs.writeFileSync(path.join(pack, 'src/pack-entry-fe.ts'), 'export {};');
  const addresses: { pid: number }[] = [];
  await builder.serveFrontend(address => {
    if (!address) return;
    if (addresses.length) expect(() => process.kill(addresses.at(-1)!.pid, 0)).not.toThrow();
    addresses.push(address);
  });
  const first = report();
  fs.writeFileSync(path.join(pack, '.apack/fixture-input-hash'), packInputsHash(pack));
  await builder.build();
  expect(report().bin).toBe(first.bin);
  expect(addresses).toHaveLength(1);
  fs.writeFileSync(path.join(pack, 'package.json'), '{"type":"module"}');
  await expect(builder.serveFrontend(() => {})).rejects.toThrow('configuration changed');
  fs.writeFileSync(path.join(pack, '.apack/fixture-input-hash'), packInputsHash(pack));
  fs.writeFileSync(path.join(pack, '.apack/frontend-refuse'), '');
  await expect(builder.build()).rejects.toThrow('Pack frontend exited before readiness');
  expect(addresses).toHaveLength(1);
  expect(() => process.kill(addresses[0]!.pid, 0)).not.toThrow();
  expect(fs.existsSync(fileURLToPath(first.bin))).toBe(true);
  const refused = JSON.parse(fs.readFileSync(path.join(pack, '.apack/frontend-starting.json'), 'utf8'));
  expect(fs.existsSync(refused.directory)).toBe(false);
  fs.rmSync(path.join(pack, '.apack/frontend-refuse'));
  await builder.build();
  expect(addresses).toHaveLength(2);
  expect(report().bin).toBe(first.bin);
  expect(() => process.kill(addresses[0]!.pid, 0)).toThrow();
  expect(capture).toHaveBeenCalledTimes(1);
  expect(fs.existsSync(fileURLToPath(first.bin))).toBe(true);
  await builder.close();
  expect(fs.existsSync(fileURLToPath(first.bin))).toBe(true);
});

it('replaces frontend metadata generations while retaining their verified compiler', async () => {
  const capture = vi.spyOn(installation, 'captureCompilerInstallation');
  const { pack, builder, report } = fixture();
  await builder.build();
  fs.mkdirSync(path.join(pack, 'src'));
  fs.writeFileSync(path.join(pack, 'src/pack-entry-fe.ts'), 'export {};');
  const addresses: { pid: number }[] = [];
  await builder.serveFrontend(address => { if (address) addresses.push(address); });
  const first = report();
  fs.writeFileSync(path.join(pack, '.apack/fixture-input-hash'), packInputsHash(pack));
  const ui = path.join(pack, '.apack/ui-one');
  fs.mkdirSync(ui, { recursive: true });
  const lookup = path.join(pack, 'node_modules/@apackdev/ui');
  fs.mkdirSync(path.dirname(lookup), { recursive: true });
  fs.symlinkSync(ui, lookup, 'dir');
  const metadata = { name: '@apackdev/ui', exports: { './package.json': './package.json', './one': './one.js' } };
  fs.writeFileSync(path.join(ui, 'package.json'), JSON.stringify(metadata));
  fs.writeFileSync(path.join(ui, 'one.js'), 'throw new Error("Metadata must not activate this module");');
  await builder.build();
  expect(addresses).toHaveLength(2);
  metadata.exports['./one'] = './two.js';
  fs.writeFileSync(path.join(ui, 'package.json'), JSON.stringify(metadata));
  await builder.build();
  expect(addresses).toHaveLength(3);
  const other = path.join(pack, '.apack/ui-two');
  fs.mkdirSync(other);
  fs.writeFileSync(path.join(other, 'package.json'), JSON.stringify({ name: '@apackdev/ui', exports: {
    './package.json': './package.json', './two': './two.js',
  } }));
  fs.unlinkSync(lookup);
  fs.symlinkSync(other, lookup, 'dir');
  await builder.build();
  expect(addresses).toHaveLength(4);
  expect(readPackDevServerInputs(pack)).toContain('@apackdev/ui/two');
  expect(capture).toHaveBeenCalledTimes(1);
  await builder.close();
  expect(fs.existsSync(fileURLToPath(first.bin))).toBe(true);
});

it('replaces the frontend for environment changes without recopying the compiler', async () => {
  const capture = vi.spyOn(installation, 'captureCompilerInstallation');
  const { pack, builder } = fixture();
  await builder.build();
  fs.mkdirSync(path.join(pack, 'src'));
  fs.writeFileSync(path.join(pack, 'src/pack-entry-fe.ts'), 'export {};');
  fs.writeFileSync(path.join(pack, '.apack/fixture-input-hash'), packInputsHash(pack));
  const addresses: { pid: number }[] = [];
  await builder.serveFrontend(address => { if (address) addresses.push(address); });
  vi.stubEnv('VITE_APACK_BUILDER_TEST', 'changed');
  await builder.build();
  expect(addresses).toHaveLength(2);
  expect(() => process.kill(addresses[0]!.pid, 0)).toThrow();
  expect(capture).toHaveBeenCalledTimes(1);
});

it('tracks frontend SDK and UI metadata while leaving bundled EARS outside the shared frontend inputs', () => {
  const { pack } = fixture();
  const metadata = (name: string, description: string) => {
    const directory = path.join(pack, 'node_modules', name);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name, description, exports: {} }));
  };
  for (const name of ['@apackdev/sdk', '@apackdev/ui', '@apackdev/ears']) metadata(name, 'original');
  const before = readPackDevServerInputs(pack);
  metadata('@apackdev/ears', 'changed');
  expect(readPackDevServerInputs(pack)).toBe(before);
  metadata('@apackdev/sdk', 'changed');
  const sdkChanged = readPackDevServerInputs(pack);
  expect(sdkChanged).not.toBe(before);
  metadata('@apackdev/ui', 'changed');
  expect(readPackDevServerInputs(pack)).not.toBe(sdkChanged);
});

it('tracks effective ordered frontend Node options without treating source-mode flags as runtime changes', () => {
  const { pack } = fixture();
  vi.stubEnv('NODE_OPTIONS', '--require one.cjs --import two.mjs');
  const first = readPackDevServerInputs(pack);
  vi.stubEnv('NODE_OPTIONS', '--require "one.cjs"   --import two.mjs --conditions=@apackdev/source');
  expect(readPackDevServerInputs(pack)).toBe(first);
  vi.stubEnv('NODE_OPTIONS', '--import two.mjs --require one.cjs');
  expect(readPackDevServerInputs(pack)).not.toBe(first);
  vi.stubEnv('NODE_OPTIONS', '--require other.cjs --import two.mjs');
  expect(readPackDevServerInputs(pack)).not.toBe(first);
});

it('stops its worker before removing the compiler on close', async () => {
  const { compiler, pack, builder, report } = fixture();
  const captured = await prepareCompiler(compiler);
  const running = builder.build({ args: ['--wait'] });
  await vi.waitFor(() => expect(fs.existsSync(path.join(pack, '.apack/built.json'))).toBe(true), { timeout: 5_000 });
  const active = report();
  const dispose = captured.dispose;
  const disposal = vi.spyOn(captured, 'dispose').mockImplementation(async () => {
    try {
      expect(() => process.kill(active.pid, 0)).toThrow();
      expect(fs.existsSync(fileURLToPath(active.bin))).toBe(true);
    } finally { await dispose(); }
  });
  const stopped = expect(running).rejects.toMatchObject({ name: 'AbortError' });
  await builder.close();
  await stopped;
  // Windows terminates the owned job; only POSIX delivers the fixture's SIGTERM handler.
  if (process.platform !== 'win32') {
    expect(JSON.parse(fs.readFileSync(path.join(pack, '.apack/stopped.json'), 'utf8')).compilerExists).toBe(true);
  }
  expect(disposal).toHaveBeenCalledTimes(1);
  expect(() => process.kill(active.pid, 0)).toThrow();
  expect(fs.existsSync(fileURLToPath(active.bin))).toBe(true);
});

it('captures both checkouts after refresh and refuses reuse if refresh fails', async () => {
  const { compiler, pack, builder, report } = fixture();
  vi.spyOn(checkout, 'checkoutFor').mockImplementation(directory => directory === pack ? 'pack-checkout' : 'compiler-checkout');
  vi.mocked(checkout.ensureCheckoutPackages).mockImplementation(directory => {
    const label = path.join(compiler, 'label.txt');
    if (directory === pack) fs.writeFileSync(label, 'pack refreshed');
    else fs.appendFileSync(label, ' and compiler refreshed');
  });
  await builder.build();
  const refreshed = report();
  expect(refreshed.label).toBe('pack refreshed and compiler refreshed');
  vi.mocked(checkout.ensureCheckoutPackages).mockImplementation(() => { throw new Error('Checkout refresh failed'); });
  await expect(builder.build()).rejects.toThrow('Checkout refresh failed');
  expect(report()).toEqual(refreshed);
});


it('stops remaining compiler descendants before accepting output', async () => {
  const { pack, builder } = fixture();
  let pid: number | undefined;
  try {
    await builder.build({ args: ['--descendant'] });
    pid = JSON.parse(fs.readFileSync(path.join(pack, '.apack/descendant.json'), 'utf8')).pid;
    if (process.platform === 'win32') {
      expect(() => process.kill(pid!, 0)).toThrow();
    } else {
      let state = '';
      try { state = execFileSync('ps', ['-p', String(pid), '-o', 'stat='], { encoding: 'utf8' }).trim(); }
      catch (error) { if ((error as { status?: number }).status !== 1) throw error; }
      expect(state === '' || state.startsWith('Z'), `Compiler descendant ${pid} is still ${state}`).toBe(true);
    }
    expect(readPackBuild(path.join(pack, 'dist')).snapshot.manifest.id).toBe('builder');
  } finally {
    // Read the owned PID even if a refusal happened before build returned.
    const record = path.join(pack, '.apack/descendant.json');
    if (!pid && fs.existsSync(record)) pid = JSON.parse(fs.readFileSync(record, 'utf8')).pid;
    if (pid) stopDescendant(pid);
  }
});


it('force-stops a compiler that ignores cancellation before releasing its inputs', async () => {
  const { compiler, pack, builder, report } = fixture();
  await prepareCompiler(compiler);
  const running = builder.build({ args: ['--wait', '--ignore-term'] });
  await vi.waitFor(() => expect(fs.existsSync(path.join(pack, '.apack/built.json'))).toBe(true), { timeout: 5_000 });
  const active = report();
  const stopped = expect(running).rejects.toMatchObject({ name: 'AbortError' });
  await builder.close();
  await stopped;
  expect(() => process.kill(active.pid, 0)).toThrow();
  expect(fs.existsSync(fileURLToPath(active.bin))).toBe(true);
  expect(fs.existsSync(path.join(pack, 'dist'))).toBe(false);
});

it('processes pending cancellation before starting queued compiler preflight', async () => {
  const { builder } = fixture();
  const controller = new AbortController();
  const reason = new Error('The development session is closing');
  const capture = vi.spyOn(installation, 'captureCompilerInstallation');
  vi.mocked(checkout.ensureCheckoutPackages).mockImplementation(() => { throw new Error('Preflight ran before pending shutdown'); });
  const cancellation = setImmediate(() => controller.abort(reason));
  try {
    await expect(builder.build({ signal: controller.signal })).rejects.toBe(reason);
    expect(checkout.ensureCheckoutPackages).not.toHaveBeenCalled();
    expect(capture).not.toHaveBeenCalled();
  } finally { clearImmediate(cancellation); }
});
