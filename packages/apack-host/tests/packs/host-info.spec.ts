import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readHostCompatibility, recordHostCompatibility, recordShippedPackSeed } from '../../src/packs/host-info.ts';
import { _appDataPaths } from '@apackdev/sdk/utils';
import { _appDirOf, resolveAppEnvironment } from '@apackdev/sdk/env';

let dataDir: string;
beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'host-info-'));
  fs.mkdirSync(_appDirOf(dataDir), { recursive: true });
});
afterEach(() => fs.rmSync(dataDir, { recursive: true, force: true }));

describe('host info record', () => {
  it('reads back the version and pack format the app recorded', () => {
    expect(readHostCompatibility(dataDir)).toEqual({});
    recordHostCompatibility(dataDir, { version: '0.3.14', packFormat: 1 });
    expect(readHostCompatibility(dataDir)).toEqual({ version: '0.3.14', packFormat: 1 });
    recordHostCompatibility(dataDir, { version: '0.3.14', packFormat: 2 });
    expect(readHostCompatibility(dataDir)).toEqual({ version: '0.3.14', packFormat: 2 });
    recordHostCompatibility(dataDir, { version: '0.4.0-beta.1', packFormat: 2 });
    expect(readHostCompatibility(dataDir)).toEqual({ version: '0.4.0-beta.1', packFormat: 2 });
  });

  // An app that recorded only its version: its format is unknown, which the installer treats as unchecked
  it('reads a record without a pack format as the version alone', () => {
    fs.writeFileSync(path.join(_appDirOf(dataDir), 'host.json'), JSON.stringify({ version: '0.3.14' }));
    expect(readHostCompatibility(dataDir)).toEqual({ version: '0.3.14', packFormat: undefined });
  });
});

describe('profile starter selection', () => {
  const profile = () => resolveAppEnvironment({ env: 'test', userDataDir: dataDir });

  it('remembers a legacy profile that ran empty', () => {
    recordHostCompatibility(dataDir, { version: '0.3.14', packFormat: 1 });
    expect(recordShippedPackSeed(profile(), ['new-starter'])).toEqual(new Set());
  });

  it('preserves a profile with data but no host compatibility record', () => {
    fs.mkdirSync(_appDataPaths(dataDir).lmdb, { recursive: true });
    expect(recordShippedPackSeed(profile(), ['new-starter'])).toEqual(new Set());
  });

  it('refuses a corrupt selection without overwriting it', () => {
    const invalid = '["starter", "starter"]';
    const file = path.join(profile().appDir, 'shipped-pack-seed.json');
    fs.writeFileSync(file, invalid);
    expect(() => recordShippedPackSeed(profile(), ['new-starter'])).toThrow('Invalid shipped pack selection');
    expect(fs.readFileSync(file, 'utf8')).toBe(invalid);
  });
});
