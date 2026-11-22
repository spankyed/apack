import * as fs from 'node:fs';
import * as path from 'node:path';
import { _appDirOf, type AppEnvironment } from '@apackdev/sdk/env';
import { PACK_ID_PATTERN } from '@apackdev/sdk/ids';
import { _appDataPaths } from '@apackdev/sdk/utils';

const hostCompatibilityFile = (userDataDir: string) => path.join(_appDirOf(userDataDir), 'host.json');

/** What the apack that last started with a data dir can load, for tools that install packs into it without it running */
export interface HostCompatibility {
  /** Its version, which a pack's `hostVersion` range is checked against */
  version?: string;
  /**
   * The pack snapshot format it reads (`PACK_SNAPSHOT_FORMAT`), which a pack's build must be in for it to load.
   * Absent when an apack that doesn't record it last started with the data dir.
   */
  packFormat?: number;
}

/** Records what the apack starting with this data dir can load, so `apack pack install` and `apack pack dev` can check a pack against it. */
export function recordHostCompatibility(userDataDir: string, info: Required<HostCompatibility>): void {
  const current = readHostCompatibility(userDataDir);
  if (current.version === info.version && current.packFormat === info.packFormat) return;
  fs.mkdirSync(_appDirOf(userDataDir), { recursive: true });
  // Written aside and renamed, so a crash never leaves a truncated host.json
  const file = hostCompatibilityFile(userDataDir);
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify({ version: info.version, packFormat: info.packFormat }, null, 2) + '\n');
  fs.renameSync(temp, file);
}

/** What the apack that last started with this data dir recorded, each field absent when nothing says */
export function readHostCompatibility(userDataDir: string): HostCompatibility {
  let recorded: { version?: unknown; packFormat?: unknown };
  try {
    recorded = JSON.parse(fs.readFileSync(hostCompatibilityFile(userDataDir), 'utf-8')) ?? {};
  } catch {
    return {};
  }
  return {
    version: typeof recorded.version === 'string' ? recorded.version : undefined,
    packFormat: typeof recorded.packFormat === 'number' ? recorded.packFormat : undefined,
  };
}

/** The IDs this profile can install automatically. Persist the first selection before any seed install
 * so boot can retry that selection after interruption, even if the distribution changes meanwhile. */
export function recordShippedPackSeed(
  { appDir, userDataDir, installedPacksFile }: Pick<AppEnvironment, 'appDir' | 'userDataDir' | 'installedPacksFile'>,
  offeredIds: readonly string[],
): ReadonlySet<string> {
  const file = path.join(appDir, 'shipped-pack-seed.json');
  const readSeed = (): ReadonlySet<string> => {
    const ids: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string' || !PACK_ID_PATTERN.test(id)) || new Set(ids).size !== ids.length) {
      throw new Error(`Invalid shipped pack selection in ${file}`);
    }
    return new Set(ids);
  };
  if (fs.existsSync(file)) return readSeed();

  // Read before boot opens its own database or updates host.json. Legacy profiles already made their
  // choices, including a profile that happened to run with no shipped packs.
  const { lmdb } = _appDataPaths(userDataDir);
  const existing = [hostCompatibilityFile(userDataDir), lmdb, installedPacksFile].some(entry => fs.existsSync(entry));
  const initialIds = existing ? [] : offeredIds;
  fs.mkdirSync(appDir, { recursive: true });
  const scratch = fs.mkdtempSync(path.join(appDir, '.shipped-pack-seed-'));
  try {
    const pending = path.join(scratch, 'selection.json');
    fs.writeFileSync(pending, JSON.stringify(initialIds) + '\n');
    // Publish the complete record without replacing the decision if another process got there first.
    try { fs.linkSync(pending, file); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
  return readSeed();
}
