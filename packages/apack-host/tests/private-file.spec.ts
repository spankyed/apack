// Distinguish prepublication refusal from an installed file whose durability could not be confirmed.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Renames fail with `renameFailures.code` for `renameFailures.count` more calls
const renameFailures = vi.hoisted(() => ({ code: '', count: 0 }));
const platform = vi.hoisted(() => process.platform);
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    openSync: (file: fs.PathLike, flags: fs.OpenMode, mode?: fs.Mode) => {
      // The retry test selects Windows behavior on POSIX. Keep the real host's directory-open mode
      // while still performing an actual directory fsync; hosted Windows exercises r+ directly.
      const simulatedDirectory = platform !== 'win32' && process.platform === 'win32' && flags === 'r+' && actual.statSync(file).isDirectory();
      return actual.openSync(file, simulatedDirectory ? 'r' : flags, mode);
    },
    renameSync: (from: fs.PathLike, to: fs.PathLike) => {
      if (renameFailures.count > 0) {
        renameFailures.count -= 1;
        throw Object.assign(new Error(`${renameFailures.code}: rename failed`), { code: renameFailures.code });
      }
      actual.renameSync(from, to);
    },
  };
});

const { writePrivateFile } = await import('../src/private-file.ts');
const { syncRecoveryDirectory } = await import('../src/backup/recovery.ts');

const dirs: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  renameFailures.count = 0;
  Object.defineProperty(process, 'platform', { value: platform });
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'private-file-'));
  dirs.push(dir);
  return dir;
}

describe('writePrivateFile', () => {
  it('replaces the file atomically and leaves no temporary file', () => {
    const file = path.join(tempDir(), 'secrets.json');
    writePrivateFile(file, 'one');
    writePrivateFile(file, 'two');
    expect(fs.readFileSync(file, 'utf-8')).toBe('two');
    // Windows modes do not express privacy; the file inherits the enclosing profile's ACL.
    if (platform !== 'win32') expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(fs.readdirSync(path.dirname(file))).toEqual(['secrets.json']);
  });

  it('keeps the previous file and removes its temporary one when the rename fails', () => {
    const file = path.join(tempDir(), 'secrets.json');
    writePrivateFile(file, 'one');
    renameFailures.code = 'EXDEV';
    renameFailures.count = 1;
    expect(() => writePrivateFile(file, 'two')).toThrow('EXDEV');
    expect(fs.readFileSync(file, 'utf-8')).toBe('one');
    expect(fs.readdirSync(path.dirname(file))).toEqual(['secrets.json']);
  });

  it('retries a rename another process briefly blocks, on Windows only', () => {
    const file = path.join(tempDir(), 'secrets.json');
    renameFailures.code = 'EPERM';
    renameFailures.count = 2;
    if (platform !== 'win32') {
      expect(() => writePrivateFile(file, 'one')).toThrow('EPERM');
      expect(fs.readdirSync(path.dirname(file))).toEqual([]);
    }

    Object.defineProperty(process, 'platform', { value: 'win32' });
    renameFailures.count = 2;
    writePrivateFile(file, 'one');
    expect(fs.readFileSync(file, 'utf-8')).toBe('one');
    expect(fs.readdirSync(path.dirname(file))).toEqual(['secrets.json']);

    renameFailures.count = 100;
    expect(() => writePrivateFile(file, 'two')).toThrow('EPERM');
    expect(fs.readFileSync(file, 'utf-8')).toBe('one');
    expect(fs.readdirSync(path.dirname(file))).toEqual(['secrets.json']);
  });

  it('requests a real directory flush and propagates a refused recovery barrier', () => {
    const dir = tempDir(), failure = Object.assign(new Error('directory flush refused'), { code: 'EIO' });
    const sync = fs.fsyncSync;
    vi.spyOn(fs, 'fsyncSync').mockImplementation(fd => {
      if (fs.fstatSync(fd).isDirectory()) throw failure;
      sync(fd);
    });
    expect(() => syncRecoveryDirectory(dir)).toThrow(failure);
  });

  it('retains a published file and reports its committed outcome when the directory flush fails', () => {
    const file = path.join(tempDir(), 'secrets.json');
    writePrivateFile(file, 'incumbent');
    const failure = Object.assign(new Error('directory flush refused'), { code: 'EIO' }), sync = fs.fsyncSync;
    vi.spyOn(fs, 'fsyncSync').mockImplementation(fd => {
      if (fs.fstatSync(fd).isDirectory()) throw failure;
      sync(fd);
    });
    let caught: unknown;
    try { writePrivateFile(file, 'installed'); } catch (error) { caught = error; }
    expect(caught).toMatchObject({ code: 'NOT_DURABLE', publishedPath: file, cause: failure });
    expect(fs.readFileSync(file, 'utf8')).toBe('installed');
    expect(fs.readdirSync(path.dirname(file))).toEqual(['secrets.json']);
  });

  it('retains the original refusal when temporary cleanup also fails', () => {
    const file = path.join(tempDir(), 'secrets.json');
    writePrivateFile(file, 'incumbent');
    const cleanup = Object.assign(new Error('cleanup refused'), { code: 'EACCES' });
    renameFailures.code = 'EXDEV'; renameFailures.count = 1;
    vi.spyOn(fs, 'rmSync').mockImplementationOnce(() => { throw cleanup; });
    let caught: unknown;
    try { writePrivateFile(file, 'refused'); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(AggregateError);
    const error = caught as AggregateError;
    expect(error.cause).toMatchObject({ code: 'EXDEV' });
    expect(error.errors).toEqual([error.cause, cleanup]);
    expect(fs.readFileSync(file, 'utf8')).toBe('incumbent');
  });
});
