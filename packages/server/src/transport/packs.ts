import { randomUUID } from 'node:crypto';
import type { LoadedPackEntry, PackCatalogFrame } from '@apackdev/host/packs';
import { getLoadedPackEntries, PACK_LAYOUT } from '@apackdev/host/packs';
import { devServerUrl } from '@apackdev/host/packs/dev-server';
import { resolveAppEnvironment } from '@apackdev/sdk/env';
import { appPacks } from '../runtime/index.ts';

const catalogRunId = randomUUID();

export function getPackCatalogFrame(): PackCatalogFrame {
  return { runId: catalogRunId, snapshot: appPacks.catalog.getSnapshot() };
}

export function getLoadedPacks(): LoadedPackEntry[] {
  const environment = resolveAppEnvironment();
  return getLoadedPackEntries(appPacks).map(pack => {
    const url = environment.env === 'development' ? devServerUrl(environment.userDataDir, pack.id, '') : null;
    return url ? { ...pack, feEntry: PACK_LAYOUT.feEntry, developmentBaseUrl: url } : pack;
  });
}
