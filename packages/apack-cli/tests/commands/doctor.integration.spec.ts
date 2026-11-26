import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { resolveAppEnvironment } from '@apackdev/sdk/env';
import { runtimeFilePath, writeApiRuntimeFile } from '@apackdev/host/transport/tool-socket';
import { doctorChannel, inspectApp } from '../../src/commands/doctor';
import { doctor as packDoctor } from '../../src/commands/pack-doctor';
import { dev, holdSession } from '../../src/commands/dev';
import { driveTarget } from '../../src/commands/drive';

let root: string;
let applications: string;
let dataDir: string;
const cwd = process.cwd();
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-doctor-'));
  applications = path.join(root, 'Applications');
  dataDir = path.join(root, 'data');
  const contents = path.join(applications, 'apack.app', 'Contents');
  fs.mkdirSync(path.join(contents, 'MacOS'), { recursive: true });
  fs.writeFileSync(path.join(contents, 'MacOS', 'apack'), '#!/bin/sh\n', { mode: 0o755 });
  fs.writeFileSync(path.join(contents, 'Info.plist'), '<plist version="1.0"><dict><key>CFBundleIdentifier</key><string>dev.apack.app</string><key>CFBundleShortVersionString</key><string>0.4.0</string></dict></plist>');
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => { process.chdir(cwd); vi.restoreAllMocks(); vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true }); });

// Installed-app diagnostics support macOS only (`doctor.ts` refuses elsewhere), so these run where that app exists
const macOnly = it.skipIf(process.platform !== 'darwin');

it('defaults to production and rejects pack or development arguments', () => {
  vi.stubEnv('APACK_CLI_CHANNEL', 'beta');
  expect(doctorChannel([])).toBe('production');
  expect(doctorChannel(['--channel', 'beta'])).toBe('beta');
  expect(() => doctorChannel(['-d'])).toThrow('Usage');
  expect(() => doctorChannel(['--fix'])).toThrow('Usage');
});

macOnly('checks a closed installed app without creating data or probing an API', async () => {
  const probeSocket = vi.fn(async () => true);
  await inspectApp('production', { applications, dataDir, probeSocket });
  expect(probeSocket).not.toHaveBeenCalled();
  expect(fs.existsSync(dataDir)).toBe(false);
});

macOnly('accepts a live production api-runtime.json with { pid } only without probing any socket', async () => {
  const context = resolveAppEnvironment({ env: 'production', userDataDir: dataDir });
  fs.mkdirSync(context.appDir, { recursive: true });
  writeApiRuntimeFile(context.appDir, { pid: process.pid });
  const probeSocket = vi.fn(async () => false);
  await inspectApp('production', { applications, dataDir, probeSocket });
  expect(probeSocket).not.toHaveBeenCalled();
});

macOnly('fails for an invalid installation and leaves the bundle intact', async () => {
  const executable = path.join(applications, 'apack.app', 'Contents', 'MacOS', 'apack');
  fs.chmodSync(executable, 0o644);
  await expect(inspectApp('production', { applications, dataDir })).rejects.toThrow('health check failed');
  expect(fs.readFileSync(executable, 'utf8')).toBe('#!/bin/sh\n');
});

macOnly('probes the local tool socket when present and fails if unreachable while leaving api-runtime.json intact', async () => {
  const context = resolveAppEnvironment({ env: 'production', userDataDir: dataDir });
  fs.mkdirSync(context.appDir, { recursive: true });
  const socket = '/tmp/apack-501/api-0123456789abcdef.sock';
  writeApiRuntimeFile(context.appDir, { pid: process.pid, socket, token: 'tok' });

  const probed: string[] = [];
  await inspectApp('production', {
    applications,
    dataDir,
    probeSocket: async (addr) => { probed.push(addr); return true; },
  });
  expect(probed).toEqual([socket]);

  await expect(inspectApp('production', {
    applications,
    dataDir,
    probeSocket: async () => false,
  })).rejects.toThrow('health check failed');
  expect(fs.existsSync(runtimeFilePath(context.appDir))).toBe(true);
});

it('pack doctor fails for missing source files and accepts warnings alone', async () => {
  const manifest = { id: 'demo', name: 'Demo', version: '0.4.0', features: {} };
  fs.writeFileSync(path.join(root, 'apack.json'), JSON.stringify(manifest));
  process.chdir(root);
  await packDoctor([]);
  fs.writeFileSync(path.join(root, 'apack.json'), JSON.stringify({ ...manifest, name: undefined }));
  await expect(packDoctor([])).rejects.toThrow('health check failed');
  fs.writeFileSync(path.join(root, 'apack.json'), JSON.stringify({ ...manifest, migrations: { pack: { '0.4.0': { description: 'Missing', up: 'src/missing.ts#up' } } } }));
  await expect(packDoctor([])).rejects.toThrow('health check failed');
});

it('checks step function paths independently of migration declarations', async () => {
  fs.writeFileSync(path.join(root, 'apack.json'), JSON.stringify({ id: 'steps', name: 'Steps', version: '1.0.0',
    extensions: { steps: { example: { node: { label: 'Example' }, build: { compile: 'src/step.ts#compile', validate: 'src/step.ts#validate', getLabel: 'src/step.ts#getLabel' } } } },
  }));
  process.chdir(root);
  await expect(packDoctor([])).rejects.toThrow('health check failed');
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src/step.ts'), "export const compile = () => ({ entity: {}, relations: [] });\nexport const validate = () => [];\nexport const getLabel = () => '';\n");
  await packDoctor([]);
});

it('pack drive requires a pack while app driving never selects one from cwd', () => {
  expect(() => driveTarget(root, 'pack')).toThrow('No apack.json');
  fs.writeFileSync(path.join(root, 'apack.json'), JSON.stringify({ id: 'demo' }));
  expect(driveTarget(root, 'pack').packDir).toBe(root);
  expect(() => driveTarget(root, 'app')).toThrow('checkout');
});

it('app sessions never require a pack; pack sessions do', async () => {
  process.chdir(root);
  await expect(holdSession(['--typo'], 'app')).rejects.toThrow('Unknown option');
  await expect(dev(['--typo'])).rejects.toThrow('No apack.json');
});

it('app drive ignores the shipped pack manifest in its current directory', () => {
  const pack = path.resolve(import.meta.dirname, '../../../default-setup');
  const checkout = path.resolve(import.meta.dirname, '../../../..');
  expect(driveTarget(checkout, 'app').packDir).toBeUndefined();
  expect(() => driveTarget(pack, 'app')).toThrow('checkout root');
  expect(driveTarget(pack, 'pack').packDir).toBe(pack);
});
