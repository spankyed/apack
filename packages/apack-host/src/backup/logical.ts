// An archive appears at its final path only after all bytes and the terminal checksum have been synchronized.
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { EarsDatabase } from '@apackdev/ears';
import { databaseStorage } from '../database/storage.ts';
import { syncRecoveryDirectory } from './recovery.ts';

/** Publish one lossless database archive exclusively. Media, packs and secrets are separately owned.
 * Publication requires hard-link support in the destination filesystem; unsupported filesystems refuse.
 * A post-publication directory-sync error is NOT_DURABLE and retains the complete artifact at publishedPath.
 */
export async function exportLogicalDatabase(database: EarsDatabase, file: string): Promise<string> {
  const storage = databaseStorage(database.format);
  if (!storage.exportLogicalSnapshot) throw new Error(`Logical export is not implemented for ${storage.format}`);
  const source = storage.exportLogicalSnapshot(database), target = path.resolve(file), parent = path.dirname(target);
  try { fs.lstatSync(target); throw Object.assign(new Error(`Logical archive target exists: ${target}`), { code: 'EEXIST' }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const temporary = fs.mkdtempSync(path.join(parent, '.apack-logical-export-'));
  let handle: fs.promises.FileHandle | undefined, failed = false, failure: unknown, published = false;
  try {
    fs.chmodSync(temporary, 0o700);
    const pending = path.join(temporary, 'snapshot');
    handle = await fs.promises.open(pending, 'wx', 0o600);
    for await (const bytes of source) {
      let offset = 0;
      while (offset < bytes.byteLength) {
        const { bytesWritten } = await handle.write(bytes, offset, Math.min(65536, bytes.byteLength - offset));
        if (bytesWritten < 1) throw Object.assign(new Error('Logical archive write made no progress'), { code: 'EIO' });
        offset += bytesWritten;
      }
    }
    await handle.sync(); await handle.close(); handle = undefined;
    // link is atomic and exclusive; unlike rename it cannot replace a target created after preflight.
    fs.linkSync(pending, target); published = true;
  } catch (error) { failed = true; failure = error; }
  const cleanup: unknown[] = [];
  try { await handle?.close(); } catch (error) { cleanup.push(error); }
  try { fs.rmSync(temporary, { recursive: true, force: true }); } catch (error) { cleanup.push(error); }
  let syncFailure: unknown, syncFailed = false;
  if (published) try { syncRecoveryDirectory(parent); } catch (error) { syncFailed = true; syncFailure = error; }
  if (syncFailed) throw Object.assign(new AggregateError([syncFailure, ...cleanup],
    `Logical archive was published but directory sync failed: ${target}`, { cause: syncFailure }), { code: 'NOT_DURABLE', publishedPath: target });
  if (cleanup.length) throw Object.assign(new AggregateError(failed ? [failure, ...cleanup] : cleanup,
    `Logical archive ${published ? 'was published but cleanup failed' : 'export cleanup failed'}: ${target}`, { cause: failed ? failure : cleanup[0] }),
    { code: ((failed ? failure : cleanup[0]) as {code?: unknown})?.code, ...(published ? { publishedPath: target } : {}) });
  if (failed) throw failure;
  return target;
}
