// A tool's write to the settings row, checked in its unit, so an invalid row never commits and the tool hears why. The app's
// own writes go through its settings store, which validates against the same rules. This runs the validator the store
// does rather than a second one in the database: the rules are JSON schemas in pack manifests, and two validators would
// have to agree on every one of them.
import type { EarsEngine, BeforeCommit } from '@apackdev/ears';
import { readInstalledContributionCatalog } from '../packs/catalog.ts';
import { disabledPackIds } from '../packs/installed.ts';
import { compileSettingsCatalog } from '../features/settings/validation.ts';
import { SettingsRefusedError } from '../features/settings/document.ts';
import { storedSettings } from './settings.ts';

const SETTINGS_ENTITY = 'Settings';
const SETTINGS_ROW = `${SETTINGS_ENTITY}-app`;

export function refuseInvalidSettings(engine: EarsEngine, environment: { packsDir: string; installedPacksFile: string }): BeforeCommit {
  return {
    wants: (type) => type === SETTINGS_ENTITY,
    run() {
      const { pending } = engine.admin.changesSince(engine.lastCommit(), 1);
      if (!pending?.entities[SETTINGS_ROW]) return;
      // Read only now, since most tool runs never write this row and a pack whose build can't be read need not stop them
      const catalog = readInstalledContributionCatalog(environment.packsDir, disabledPackIds(environment.installedPacksFile));
      const problems = compileSettingsCatalog(catalog.settings()).inspect(storedSettings(engine as Pick<EarsEngine, 'getAttr'>));
      if (problems.length > 0) throw new SettingsRefusedError(problems.map(problem => problem.message));
    },
  };
}
