// A tool's write to the settings row, checked in its unit, so an invalid row never commits and the tool hears why. The app's
// own writes go through its settings store, which validates against the same rules. This runs the validator the store
// does rather than a second one in the database: the rules are JSON schemas in pack manifests, and two validators would
// have to agree on every one of them.
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { EarsEngine, BeforeCommit } from '@apackdev/ears';
import { readInstalledContributionCatalog } from '../packs/catalog.ts';
import { discoverPackDirectories } from '../packs/discovery.ts';
import { PACK_LAYOUT } from '../packs/layout-paths.ts';
import { disabledPackIds } from '../packs/installed.ts';
import { compileSettingsCatalog } from '../features/settings/validation.ts';
import { SettingsRefusedError } from '../features/settings/document.ts';
import { storedSettings } from './settings.ts';

const SETTINGS_ENTITY = 'Settings';
const SETTINGS_ROW = `${SETTINGS_ENTITY}-app`;

interface Environment { packsDir: string; installedPacksFile: string }

/**
 * What the installed catalog is read from, as a key that changes when any of it does: the packs directory's entries, each
 * pack's directory, receipt and snapshot (an install replaces the directory, a rebuild the receipt), and the record of
 * which are disabled. A few stats, where reading and verifying the builds took about 60 ms
 */
function catalogKey({ packsDir, installedPacksFile }: Environment): string {
  const stat = (file: string) => {
    const found = fs.statSync(file, { throwIfNoEntry: false });
    return found ? `${found.ino}:${found.mtimeMs}:${found.size}` : '-';
  };
  return JSON.stringify([stat(installedPacksFile), ...discoverPackDirectories(packsDir)
    .map((dir) => [dir, stat(dir), stat(path.join(dir, PACK_LAYOUT.integrity)), stat(path.join(dir, PACK_LAYOUT.snapshot))])]);
}

export function refuseInvalidSettings(engine: EarsEngine, environment: Environment): BeforeCommit {
  let compiled: { key: string; validation: ReturnType<typeof compileSettingsCatalog> } | undefined;
  /** The installed catalog, compiled, read again only when what it is read from has changed */
  const validation = () => {
    const key = catalogKey(environment);
    if (compiled?.key !== key) {
      const catalog = readInstalledContributionCatalog(environment.packsDir, disabledPackIds(environment.installedPacksFile));
      compiled = { key, validation: compileSettingsCatalog(catalog.settings()) };
    }
    return compiled.validation;
  };
  return {
    wants: (type) => type === SETTINGS_ENTITY,
    run() {
      const { pending } = engine.admin.changesSince(engine.lastCommit(), 1);
      if (!pending?.entities[SETTINGS_ROW]) return;
      // Read only now, since most tool runs never write this row and a pack whose build can't be read need not stop them
      const problems = validation().inspect(storedSettings(engine as Pick<EarsEngine, 'getAttr'>));
      if (problems.length > 0) throw new SettingsRefusedError(problems.map(problem => problem.message));
    },
  };
}
