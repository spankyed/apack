import { writeInstalledPackFixture } from './runtime/build-fixture.ts';
import type { PackManifest } from '@apackdev/sdk/build';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readInstalledPackBuilds, discoverPacks, installedPacks } from '../../src/packs/discovery.ts';
import { writeInstalledPacks } from '../../src/packs/installed.ts';
import { _appDirOf } from '@apackdev/sdk/env';

let packagesDir: string;

beforeEach(() => {
  packagesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'builtin-discovery-'));
});

afterEach(() => {
  fs.rmSync(packagesDir, { recursive: true, force: true });
});

function writeManifest(name: string, manifest: Record<string, unknown>): string {
  const dir = path.join(packagesDir, name);
  writeInstalledPackFixture(dir, manifest as unknown as PackManifest);
  return dir;
}

describe('installed build admission', () => {
  it('keeps unreadable directories in the inventory and excludes hidden publication candidates', () => {
    fs.mkdirSync(path.join(packagesDir, 'broken'));
    fs.mkdirSync(path.join(packagesDir, '.candidate'));
    const entries = readInstalledPackBuilds(packagesDir);
    expect(entries).toEqual([{ id: 'broken', dir: path.join(packagesDir, 'broken'), problem: expect.any(String) }]);
  });

  it('refuses a complete build installed under another owner and never runs its modules', () => {
    writeManifest('local-pack', { id: 'other-pack', name: 'Other', version: '1.0.0' });
    const entries = readInstalledPackBuilds(packagesDir);
    expect(entries).toEqual([{ id: 'local-pack', dir: path.join(packagesDir, 'local-pack'),
      problem: 'Installed directory "local-pack" contains pack "other-pack"' }]);
    expect(discoverPacks(packagesDir)).toEqual([]);
  });

  it('isolates an installed pack with invalid settings defaults as a per-pack problem while admitting healthy packs', () => {
    writeManifest('healthy-pack', { id: 'healthy-pack', name: 'Healthy', version: '1.0.0' });
    writeManifest('broken-settings', {
      id: 'broken-settings',
      name: 'Broken Settings',
      version: '1.0.0',
      extensions: {
        settings: {
          prefs: {
            schema: { type: 'object', properties: { limit: { type: 'integer' } }, required: ['limit'] },
            defaults: { limit: 'not-an-integer' },
          },
        },
      },
    });
    const entries = readInstalledPackBuilds(packagesDir);
    expect(entries.find(e => e.id === 'healthy-pack')?.build).toBeDefined();
    const broken = entries.find(e => e.id === 'broken-settings');
    expect(broken?.build).toBeUndefined();
    expect(broken?.problem).toContain('manifest.extensions.settings.prefs.defaults.limit');
  });
});

describe('installedPacks', () => {
  let userDataDir: string;
  const env = { APACK_ENV: process.env.APACK_ENV, APACK_USER_DATA_DIR: process.env.APACK_USER_DATA_DIR };

  beforeEach(() => {
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'installed-packs-'));
    process.env.APACK_ENV = 'test';
    process.env.APACK_USER_DATA_DIR = userDataDir;
  });
  afterEach(() => {
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(userDataDir, { recursive: true, force: true });
  });

  function onDisk(id: string, version: string) {
    const dir = path.join(_appDirOf(userDataDir), 'packs', id);
    writeInstalledPackFixture(dir, { id, name: id, version });
  }

  it('reports a pack nothing has recorded anything about, enabled', () => {
    onDisk('memo-pack', '1.0.0');

    expect(installedPacks()).toMatchObject([
      { manifest: { id: 'memo-pack', version: '1.0.0' }, record: { id: 'memo-pack', enabled: true } },
    ]);
  });

  it('reports the recorded disabled choice alongside unrecorded enabled installations', () => {
    onDisk('memo-pack', '1.0.0');
    onDisk('scribble-pack', '1.0.0');
    writeInstalledPacks([{ id: 'memo-pack', enabled: false }]);
    expect(installedPacks().map(pack => [pack.record.id, pack.record.enabled])).toEqual([
      ['memo-pack', false], ['scribble-pack', true],
    ]);
  });

  // The version lives in the pack's manifest and nowhere else, so an `apack pack install` outside the app —
  // which writes the directory and never the record — cannot cost the pack the slug its updates come
  // from. A record that copied the version had to be rewritten when it changed, and that rewrite is what
  // used to take `installedFrom` with it.
  it('keeps what only the record can say when the pack on disk changes version', () => {
    onDisk('memo-pack', '1.0.0');
    writeInstalledPacks([{ id: 'memo-pack', enabled: true, installedFrom: 'acme/memo-pack', installedAt: '2020-01-01T00:00:00.000Z' }]);

    onDisk('memo-pack', '2.0.0');

    expect(installedPacks()).toMatchObject([{
      manifest: { version: '2.0.0' },
      record: { installedFrom: 'acme/memo-pack', installedAt: '2020-01-01T00:00:00.000Z' },
    }]);
  });
});
