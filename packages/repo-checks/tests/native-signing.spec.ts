import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ sign: vi.fn(), exec: vi.fn(), delay: vi.fn() }));
vi.mock('@electron/osx-sign', () => ({ signAsync: mocks.sign }));
vi.mock('node:child_process', () => ({ execFileSync: mocks.exec }));
vi.mock('node:timers/promises', () => ({ setTimeout: mocks.delay }));
import { signMacApplication } from '../../../scripts/lib/native-signing.mjs';

let root: string, app: string, library: string, manifestFile: string;
const hash = (file: string) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const manifest = () => JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
beforeEach(() => {
  vi.resetAllMocks();
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'native-signing-'));
  app = path.join(root, 'Preview.app');
  const resources = path.join(app, 'Contents/Resources/app');
  fs.mkdirSync(path.join(app, 'Contents/MacOS'), { recursive: true });
  fs.writeFileSync(path.join(app, 'Contents/MacOS/Preview'), 'executable');
  fs.mkdirSync(path.join(resources, 'packages/api'), { recursive: true });
  fs.writeFileSync(path.join(resources, 'packages/api/package.json'), '{}');
  const ears = path.join(resources, 'node_modules/@apackdev/ears');
  fs.mkdirSync(path.join(ears, 'dist/sqlite/native/darwin-arm64'), { recursive: true });
  fs.writeFileSync(path.join(ears, 'package.json'), JSON.stringify({ exports: { './sqlite': './dist/sqlite/index.js' } }));
  fs.writeFileSync(path.join(ears, 'dist/sqlite/index.js'), '');
  library = path.join(ears, 'dist/sqlite/native/darwin-arm64/vec1.dylib');
  manifestFile = path.join(path.dirname(library), 'manifest.json');
  fs.writeFileSync(library, 'unsigned native bytes');
  fs.writeFileSync(manifestFile, JSON.stringify({ format: 1, platform: 'darwin', arch: 'arm64',
    upstream: 'retained upstream', extensionSha256: hash(library) }));
  mocks.exec.mockImplementation((command: string) => command.endsWith('/lipo') ? 'arm64\n' : Buffer.alloc(0));
  mocks.delay.mockResolvedValue(undefined);
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('native manifest signing before outer app sealing', () => {
  it('preserves signing options and finalizes signed library bytes before the outer seal', async () => {
    const original = manifest(), perFile = vi.fn((_file: string) => ({ entitlements: '/entitlements', hardenedRuntime: true }));
    const ignore = () => false;
    mocks.sign.mockImplementation(async options => {
      expect(options).toMatchObject({ identity: 'identity hash', keychain: '/keychain', ignore });
      options.optionsForFile(library);
      expect(manifest()).toEqual(original);
      fs.appendFileSync(library, ' signed');
      expect(options.optionsForFile(app)).toEqual({ entitlements: '/entitlements', hardenedRuntime: true });
      expect(manifest()).toEqual({ ...original, extensionSha256: hash(library) });
      expect(mocks.exec).toHaveBeenCalledWith('/usr/bin/codesign', ['--verify', '--strict', library], { stdio: 'pipe' });
      const sealed = fs.readFileSync(manifestFile, 'utf8');
      await Promise.resolve();
      expect(fs.readFileSync(manifestFile, 'utf8')).toBe(sealed);
    });
    await signMacApplication({ app, identity: 'identity hash', keychain: '/keychain', ignore, optionsForFile: perFile });
    expect(perFile.mock.calls.map(call => call[0])).toEqual([library, app]);
    expect(mocks.sign).toHaveBeenCalledTimes(1);
  });

  it('refuses mismatched unsigned input before invoking the signer', async () => {
    fs.appendFileSync(library, ' changed');
    await expect(signMacApplication({ app })).rejects.toThrow(/mismatched build provenance/);
    expect(mocks.sign).not.toHaveBeenCalled();
  });

  it('does not bless a failed inner signature or a concurrently changed manifest', async () => {
    const original = fs.readFileSync(manifestFile, 'utf8');
    mocks.exec.mockImplementation((command: string) => {
      if (command.endsWith('/lipo')) return 'arm64';
      throw new Error('Inner signature invalid');
    });
    mocks.sign.mockImplementation(async options => { options.optionsForFile(library); options.optionsForFile(app); });
    await expect(signMacApplication({ app })).rejects.toThrow(/Inner signature invalid/);
    expect(fs.readFileSync(manifestFile, 'utf8')).toBe(original);
    mocks.exec.mockReturnValue('arm64');
    mocks.sign.mockImplementation(async options => {
      options.optionsForFile(library);
      fs.writeFileSync(manifestFile, original + ' ');
      options.optionsForFile(app);
    });
    await expect(signMacApplication({ app })).rejects.toThrow(/provenance changed/);
  });

  it('retries signing after an outer-seal failure and hashes the newly signed bytes each time', async () => {
    let calls = 0;
    mocks.sign.mockImplementation(async options => {
      options.optionsForFile(library);
      fs.appendFileSync(library, ` signature ${++calls}`);
      options.optionsForFile(app);
      expect(manifest().extensionSha256).toBe(hash(library));
      if (calls < 4) throw new Error('Transient signing failure');
    });
    await signMacApplication({ app });
    expect(calls).toBe(4);
    expect(mocks.delay.mock.calls.map(call => call[0])).toEqual([5000, 10000, 15000]);
  });

  it('refuses a preexisting valid signature when the library was skipped in this signing pass', async () => {
    const original = fs.readFileSync(manifestFile, 'utf8');
    mocks.sign.mockImplementation(async options => { options.optionsForFile(app); });
    await expect(signMacApplication({ app })).rejects.toThrow(/skipped the native vector library/);
    expect(fs.readFileSync(manifestFile, 'utf8')).toBe(original);
  });

  it('fails if the signer skips the outer-app callback', async () => {
    mocks.sign.mockResolvedValue(undefined);
    await expect(signMacApplication({ app })).rejects.toThrow(/before sealing/);
    expect(mocks.sign).toHaveBeenCalledTimes(4);
  });

  it('derives architecture from the app executable and refuses unsupported universal builds', async () => {
    mocks.exec.mockReturnValue('arm64 x86_64');
    await expect(signMacApplication({ app })).rejects.toThrow(/Unsupported packaged app architecture/);
    expect(mocks.sign).not.toHaveBeenCalled();
  });

  it('refuses native-library symlinks that escape the packaged app', async () => {
    const outside = path.join(root, 'outside.dylib');
    fs.copyFileSync(library, outside); fs.rmSync(library); fs.symlinkSync(outside, library);
    await expect(signMacApplication({ app })).rejects.toThrow(/escapes the app/);
    expect(mocks.sign).not.toHaveBeenCalled();
  });
});
