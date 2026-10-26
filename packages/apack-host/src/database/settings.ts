import fs from 'node:fs';
import { _appDataPaths } from '@apackdev/sdk/utils';
import type { Ears, EARS } from '@apackdev/ears';
import { openDatabaseStore } from './open.ts';

/** The app's stored settings overrides, which boot reads before any pack is loaded: the one host-owned row */
export function storedSettings(ears: Pick<Ears, 'getAttr'>): unknown {
  const data = ears.getAttr('Settings-app' as EARS.EntityId, 'data' as EARS.AttrKind);
  return data === undefined ? {} : data;
}

/** Offline admission reads without modifying the profile. The caller owns its storage lock. */
export function readSettingsOverrides(userDataDir: string): unknown {
  const paths = _appDataPaths(userDataDir);
  if (!fs.existsSync(paths.lmdb)) return {};
  const { database, engine } = openDatabaseStore({
    path: paths.lmdb,
    schema: { getRegisteredEntityTypes: () => new Set(['Settings']), getRegisteredRelationKinds: () => new Set(), getRegisteredRoles: () => new Set() }, readOnly: true,
  });
  try { return storedSettings(engine); }
  finally { database.close(); }
}
