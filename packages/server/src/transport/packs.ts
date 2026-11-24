import { randomUUID } from 'node:crypto';
import { observable } from '@trpc/server/observable';
// Lets declaration emit name tRPC's router types through a public entry (TS2742 under bundler resolution)
import type {} from '@trpc/server/unstable-core-do-not-import';
// The entry type comes from the packs barrel: AppRouter's declarations then don't reference the pack runtime
import type { LoadedPackEntry, PackCatalogFrame } from '@apackdev/host/packs';
import { getLoadedPackEntries, PACK_LAYOUT } from '@apackdev/host/packs';
import { devServerUrl } from '@apackdev/host/packs/dev-server';
import { resolveAppEnvironment } from '@apackdev/sdk/env';
import { appPacks } from '../runtime/index.ts';
import { router, procedure } from './trpc';

const catalogRunId = randomUUID();

export const packsRouter = router({
  /** Data discovery includes disabled and activation-failed packs; it never loads their modules. */
  catalog: procedure.subscription(() => observable<PackCatalogFrame>(emit => {
    const publish = () => emit.next({ runId: catalogRunId, snapshot: appPacks.catalog.getSnapshot() });
    const stop = appPacks.catalog.onChanged(publish);
    publish();
    return stop;
  })),
  /** The accepted runtimes whose frontend files the renderer loads. */
  loaded: procedure.query((): LoadedPackEntry[] => {
    const environment = resolveAppEnvironment();
    return getLoadedPackEntries(appPacks).map(pack => {
      const url = environment.env === 'development' ? devServerUrl(environment.userDataDir, pack.id, '') : null;
      return url ? { ...pack, feEntry: PACK_LAYOUT.feEntry, developmentBaseUrl: url } : pack;
    });
  }),
});
