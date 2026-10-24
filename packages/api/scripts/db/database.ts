// Opens this data dir's database for a one-off script, the way the API boots it: built-in packs
// registered (from their dev entries: the script runs unbundled) and LMDB hydrated, so it can run
// their content code. Needs APACK_ENV and APACK_USER_DATA_DIR, like any process that touches app data.
// Database work that runs no pack code goes through `apack db` instead.
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openAppStore } from '../../src/runtime/index.ts';
import { loadAppPacks } from '@apackdev/host/packs/runtime';

export const packagesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** The data dir's LMDB store, the engine persisting to it and the registered packs, opened as the API opens them (the engine is installed) */
export const { store, engine, packs } = openAppStore();

/**
 * Registers the installed packs and hydrates the store, as the app's boot does. It does not *install* the
 * packs the app ships: a tool reads a data dir as it found it, and writing packs into one is the app's job.
 */
export async function openDatabase(): Promise<void> {
  loadAppPacks(packs);
  await store.hydrate();
}

export function closeDatabase(): void {
  store.close();
}
