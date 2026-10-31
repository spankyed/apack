// A persistent inode owns the service claim. Never unlink it: another opener must lock the same inode.
// No signal handler releases ownership; the descriptor outlives stopping workers, or the OS closes it at exit.
import { openSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

export function claimNativeVectorOwner(directory: string): () => void {
  // The pinned CommonJS addon has no declarations. Own the single consumed signature here;
  // lazy loading keeps ordinary readers and module imports free of an unused native addon.
  const { tryLock } = createRequire(import.meta.url)('fs-native-extensions') as { tryLock(fd: number): boolean };
  const fd = openSync(join(directory, '.native-model-owner.lock'), 'a+', 0o600);
  try {
    if (!tryLock(fd)) throw Object.assign(new Error('Another native vector model owner holds this database'), { code: 'BACKGROUND_OWNER_EXISTS' });
  } catch (error) {
    try { closeSync(fd); }
    catch (cleanup) { throw new AggregateError([error, cleanup], 'Native owner claim and cleanup failed', { cause: error }); }
    throw error;
  }
  let released = false;
  return () => { if (!released) { released = true; closeSync(fd); } };
}
