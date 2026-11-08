// What `apack cache clean` deletes, which is the only branch of this command that removes something a
// person did not build in the directory they are standing in: downloaded apack Beta builds, a few
// hundred megabytes each, which nothing reclaimed before.
//
// It takes a `dirs` rather than reading `cliDirs()` as `cleanInstances` does, so these run against a temp
// cache. A case that exercised the real one would delete the builds on this machine.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanApps, cleanCompilers } from '../../src/commands/cache-clean';
import { betaCacheDir, packagedExecutable } from '../../src/app/beta-app';
import type { CliDirs } from '../../src/app/pack-host';
import { execFileWhileWorking } from '@apackdev/sdk/progress';

let tmp: string;
let dirs: CliDirs;

/** A downloaded build, with a file in it so it has a size to report */
const build = (tag: string): string => {
  const dir = path.join(betaCacheDir(dirs.cache), tag);
  const executable = packagedExecutable(dir);
  fs.mkdirSync(path.dirname(executable), { recursive: true });
  fs.writeFileSync(executable, 'x'.repeat(1024));
  return dir;
};

const tags = (): string[] => {
  const root = betaCacheDir(dirs.cache);
  return fs.existsSync(root) ? fs.readdirSync(root).sort() : [];
};

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-clean-'));
  dirs = { cache: path.join(tmp, 'cache'), data: path.join(tmp, 'data') };
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('apack cache clean', () => {
  /**
   * The newest survives, because resolution prefers a cached build: `cachedBetaApp` answers from the cache
   * whenever one satisfies the pack's range, so emptying it would turn every later run into a download.
   */
  it('keeps the newest build and removes the rest', () => {
    for (const tag of ['0.4.0-beta.1', '0.4.0-beta.10', '0.3.9']) build(tag);

    cleanApps(false, dirs);

    expect(tags()).toEqual(['0.4.0-beta.10']);
  });

  // Moving to a newer Beta is deleting the one you have, so there has to be a way to delete all of them
  it('removes every build with --all', () => {
    for (const tag of ['0.4.0-beta.1', '0.4.0-beta.10']) build(tag);

    cleanApps(true, dirs);

    expect(tags()).toEqual([]);
  });

  /**
   * A download killed mid-extract leaves a staging directory that nothing ever reads again —
   * `cachedBetaBuilds` filters it out by name — so it is litter whichever flag is passed, and this is the
   * only thing that removes it.
   */
  it('removes an interrupted download whatever the flag says, and keeps the build beside it', () => {
    build('0.4.0-beta.10');
    const staging = path.join(betaCacheDir(dirs.cache), '.0.5.0-beta.0.download-abc');
    fs.mkdirSync(staging, { recursive: true });

    cleanApps(false, dirs);

    expect(tags()).toEqual(['0.4.0-beta.10']);
  });

  it('says so when there is nothing downloaded, rather than failing on a missing cache', () => {
    expect(() => cleanApps(true, dirs)).not.toThrow();
    expect(vi.mocked(console.log).mock.calls.flat().join('\n')).toContain('no downloaded app builds');
  });
});

/**
 * The captured compiler installations: every entry goes, since the next build captures what it needs again, and
 * the store holds them read-only, which a plain recursive delete would refuse. One being captured — its lock held
 * by a live process — is left for its capture to finish.
 */
describe('cleanCompilers', () => {
  const entry = (store: string, name: string): string => {
    const dir = path.join(store, name);
    fs.mkdirSync(path.join(dir, 'tree'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'tree', 'node'), 'x'.repeat(1024));
    fs.chmodSync(path.join(dir, 'tree'), 0o555);
    fs.chmodSync(dir, 0o500);
    return dir;
  };

  it('removes read-only entries and keeps one whose capture is in progress', async () => {
    const store = path.join(tmp, 'compilers');
    const done = entry(store, 'aaaaaaaaaaaaaaaa');
    const capturing = entry(store, 'bbbbbbbbbbbbbbbb');
    fs.writeFileSync(`${capturing}.lock`, JSON.stringify({ pid: process.pid, machine: os.hostname(), what: 'capture', since: new Date().toISOString() }));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await cleanCompilers(store);
    expect(fs.existsSync(done)).toBe(false);
    expect(fs.existsSync(capturing)).toBe(true);
    fs.chmodSync(capturing, 0o700);
    fs.chmodSync(path.join(capturing, 'tree'), 0o700);
  });

  it('keeps an entry a live process is using and removes one whose user has exited', async () => {
    const store = path.join(tmp, 'compilers');
    const used = entry(store, 'cccccccccccccccc');
    const abandoned = entry(store, 'dddddddddddddddd');
    fs.mkdirSync(`${used}.users`);
    fs.writeFileSync(path.join(`${used}.users`, `${process.pid}-live`), '');
    const exited = await execFileWhileWorking(process.execPath, ['-e', 'process.stdout.write(String(process.pid))']);
    fs.mkdirSync(`${abandoned}.users`);
    fs.writeFileSync(path.join(`${abandoned}.users`, `${exited.stdout}-gone`), '');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await cleanCompilers(store);
    expect(fs.existsSync(used)).toBe(true);
    expect(fs.existsSync(abandoned)).toBe(false);
    fs.chmodSync(used, 0o700);
    fs.chmodSync(path.join(used, 'tree'), 0o700);
  });

  it('says so when there is nothing to remove', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await cleanCompilers(path.join(tmp, 'absent'));
    expect(log).toHaveBeenCalledWith('  no captured compiler installations');
  });
});
