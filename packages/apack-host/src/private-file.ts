// Replace whole files atomically. Prepublication refusal preserves the incumbent; a postpublication sync
// failure retains the installed file and reports NOT_DURABLE. Windows privacy relies on the profile's ACLs.
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

const isWindows = () => process.platform === 'win32';

/** Errors Windows gives a rename while another process (an antivirus, an indexer) briefly holds the file */
const TRANSIENT_RENAME_ERRORS = new Set(['EPERM', 'EBUSY', 'EACCES']);
const RENAME_ATTEMPTS = 10;

const errorCode = (error: unknown) => (error as NodeJS.ErrnoException | undefined)?.code;

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function rename(from: string, to: string): void {
  for (let attempt = 1; ; attempt++) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (error) {
      if (!isWindows() || attempt === RENAME_ATTEMPTS || !TRANSIENT_RENAME_ERRORS.has(errorCode(error) ?? '')) throw error;
      sleepSync(attempt * 10);
    }
  }
}

/** Ask the filesystem to persist the rename; Windows directory flushes require a writable handle. */
function syncDirectory(dir: string): void {
  const fd = fs.openSync(dir, isWindows() ? 'r+' : 'r');
  try {
    fs.fsyncSync(fd);
  } catch (error) {
    // File systems that can't sync a directory
    if (isWindows() || (errorCode(error) !== 'EINVAL' && errorCode(error) !== 'ENOTSUP')) throw error;
  } finally {
    fs.closeSync(fd);
  }
}

export function writePrivateFile(filePath: string, contents: string): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  // Unique per write, so concurrent writers never share one
  const temporary = `${filePath}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try {
    const fd = fs.openSync(temporary, 'wx', 0o600);
    try {
      const bytes = Buffer.from(contents);
      let offset = 0;
      while (offset < bytes.byteLength) {
        const written = fs.writeSync(fd, bytes, offset, Math.min(65536, bytes.byteLength - offset));
        if (written < 1) throw Object.assign(new Error('Private file write made no progress'), { code: 'EIO' });
        offset += written;
      }
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    rename(temporary, filePath);
  } catch (error) {
    try { fs.rmSync(temporary, { force: true }); }
    catch (cleanup) { throw new AggregateError([error, cleanup], 'Private file installation and temporary cleanup failed', { cause: error }); }
    throw error;
  }
  try { syncDirectory(dir); }
  catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw Object.assign(new Error(`File was installed but its directory sync failed: ${message}`, { cause }),
      { code: 'NOT_DURABLE', publishedPath: filePath });
  }
}
