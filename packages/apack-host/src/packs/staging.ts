import * as fs from 'node:fs';
import * as path from 'node:path';
import { _appDirOf } from '@apackdev/sdk/env';
import { PACK_ID_PATTERN } from '@apackdev/sdk/ids';
import { PACK_SNAPSHOT_FORMAT } from '@apackdev/pack-format';
import { readInstalledPacks, writeInstalledPacks } from './installed.ts';
import { recordHostCompatibility } from './host-info.ts';
import { recordIsStale } from '../process-liveness.ts';
// The naming convention lives with the module that makes one of these directories; this is its reader
import { OWNED_STAGING_DIR, stagingDirName, type StagingKind } from '../replace-dir.ts';

export const INSTALL_RECORD_RECOVERY = '.apack-install-record.json';

interface StagingEntry { name: string; id: string; kind: StagingKind; stale: boolean }

/**
 * A staging dir and whether the process that made it is gone: its PID isn't running, or the dir predates
 * this boot, which a later process reusing that PID would otherwise hide.
 */
function parseStagingDir(dir: string, name: string): StagingEntry | null {
  const owned = OWNED_STAGING_DIR.exec(name);
  if (!owned || !PACK_ID_PATTERN.test(owned[1])) return null;
  const pid = Number(owned[3]);
  const stale = pid !== process.pid && recordIsStale(path.join(dir, name), pid);
  return { name, id: owned[1], kind: owned[2] as StagingKind, stale };
}

export interface StagingRecovery {
  /** Packs whose install crashed between moving the old copy aside and placing the new one */
  restored: string[];
  /** Staging dirs removed */
  removed: string[];
  /** Entries that couldn't be handled; they're left in place */
  failed: { name: string; error: string }[];
}

/**
 * Recover interrupted acceptance before discovery. Uncommitted previous builds are restored even when
 * a candidate reached its final path. Retired builds have committed and only need cleanup. A failed
 * recovery retains its previous build and is reported; it is never swept as staging litter.
 */
export function recoverStagingDirs(dir: string, installedPacksFile?: string): StagingRecovery {
  const result: StagingRecovery = { restored: [], removed: [], failed: [] };
  let names: string[];
  try {
    names = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') result.failed.push({ name: dir, error: String(err) });
    return result;
  }

  const entries: StagingEntry[] = [];
  for (const name of names) {
    try {
      const entry = parseStagingDir(dir, name);
      if (entry?.stale) entries.push(entry);
    } catch (err) {
      result.failed.push({ name, error: String(err) });
    }
  }

  const previous = entries.filter(entry => entry.kind === 'previous');
  for (const entry of previous) {
    try {
      if (previous.filter(other => other.id === entry.id).length !== 1) {
        throw new Error(`Multiple interrupted replacements for "${entry.id}"; previous builds retained for explicit recovery`);
      }
      const backup = path.join(dir, entry.name);
      const dest = path.join(dir, entry.id);
      const record = path.join(backup, INSTALL_RECORD_RECOVERY);
      if (fs.existsSync(record)) {
        if (!installedPacksFile) throw new Error('Restoring installation decisions requires the target profile record path');
        const saved = readInstalledPacks(record, { strict: true });
        if (saved.length > 1 || saved.some(record => record.id !== entry.id)) throw new Error(`Invalid recovery record for "${entry.id}"`);
        const current = readInstalledPacks(installedPacksFile, { strict: true }).filter(record => record.id !== entry.id);
        if (!writeInstalledPacks([...current, ...saved], installedPacksFile)) throw new Error(`Cannot restore installation decisions: ${installedPacksFile}`);
        fs.rmSync(record);
      }
      // Keep the unaccepted candidate hidden until the incumbent is back in place.
      const candidate = fs.existsSync(dest) ? path.join(dir, stagingDirName(entry.id, 'installing')) : undefined;
      if (candidate) fs.renameSync(dest, candidate);
      fs.renameSync(backup, dest);
      result.restored.push(entry.id);
      if (candidate) {
        try { fs.rmSync(candidate, { recursive: true }); }
        catch (error) { result.failed.push({ name: path.basename(candidate), error: String(error) }); }
      }
    } catch (err) {
      result.failed.push({ name: entry.name, error: String(err) });
    }
  }

  for (const entry of entries.filter(entry => entry.kind !== 'previous')) {
    try {
      fs.rmSync(path.join(dir, entry.name), { recursive: true });
      result.removed.push(entry.name);
    } catch (err) {
      result.failed.push({ name: entry.name, error: String(err) });
    }
  }
  return result;
}

/** Never load a candidate whose interrupted replacement could not be recovered. */
export function interruptedReplacementProblem(packDir: string): string | undefined {
  const dir = path.dirname(packDir), id = path.basename(packDir);
  for (const name of fs.readdirSync(dir)) {
    const owned = OWNED_STAGING_DIR.exec(name);
    if (owned?.[1] !== id || owned[2] !== 'previous') continue;
    if (parseStagingDir(dir, name)?.stale) {
      return `Interrupted replacement for "${id}" has not been recovered; previous build retained at ${path.join(dir, name)}`;
    }
  }
}

/**
 * Boot-time data dir upkeep, before packs are discovered: records the apack version and the pack format it
 * reads for `apack pack install` and `apack pack dev`, and recovers staging in each packs dir. Failures are logged; boot continues.
 */
export function prepareHostDataDirs(
  options: { userDataDir: string; packsDir: string; version: string },
  log: Pick<Console, 'info' | 'warn'> = console,
): void {
  try {
    recordHostCompatibility(options.userDataDir, { version: options.version, packFormat: PACK_SNAPSHOT_FORMAT });
  } catch (err) {
    log.warn(`[packs] Could not record the host version in ${options.userDataDir}: ${err}`);
  }
  for (const dir of [options.packsDir]) {
    const { restored, removed, failed } = recoverStagingDirs(dir, path.join(_appDirOf(options.userDataDir), 'installed-packs.json'));
    for (const id of restored) log.info(`[packs] Restored "${id}", whose install was interrupted`);
    for (const name of removed) log.info(`[packs] Removed stale staging dir ${name}`);
    for (const { name, error } of failed) log.warn(`[packs] Could not clean up ${name}: ${error}`);
  }
}
