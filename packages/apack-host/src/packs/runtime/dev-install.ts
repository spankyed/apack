import { createLogger } from '@apackdev/sdk/logger';
import { resolveAppEnvironment, getAppVersion } from '@apackdev/sdk/env';
import { PACK_SNAPSHOT_FORMAT } from '@apackdev/sdk/build';
import { HOST_PACK_ID } from '@apackdev/sdk/ids';
import type { PackRegistry } from '../registry.ts';
import { installPackFromLocal } from '../installer.ts';
import { recordUserInstall } from '../installed.ts';
import { acceptInstalledPack } from './lifecycle.ts';

const logger = createLogger('pack-dev-install');

/**
 * Installs a development build from a pack's source directory and starts it, for `apack pack dev`
 * (`POST /dev/install`). The app copies the files and loads the runtime itself, under its claim on the
 * pack id, so no install, toggle or reload in the Packs view can load a half-copied build.
 *
 * The install is the user's own copy, as a CLI install is: an app default installed this way becomes a
 * user-managed fork. A disabled pack's files and declarations are replaced without starting it.
 */
export async function installDevPack(
  registry: PackRegistry,
  packRoot: string,
  backendActor: import('xstate').AnyActorRef,
): Promise<{ id: string; dir: string }> {
  const { packsDir, installedPacksFile } = resolveAppEnvironment();
  let claimedId: string | undefined;
  let start: (() => Promise<boolean>) | undefined;
  try {
    const result = await installPackFromLocal(packRoot, packsDir, {
      installedPacksFile,
      hostVersion: getAppVersion(),
      packFormat: PACK_SNAPSHOT_FORMAT,
      beforePlace: manifest => {
        if (manifest.id === HOST_PACK_ID) throw new Error('The host is not an installable pack');
        registry.catalog.assertPackSettings(manifest);
        if (!registry.claimPackOperation(manifest.id)) throw new Error(`Operation already in progress for ${manifest.id}`);
        claimedId = manifest.id;
      },
      accept: candidate => {
        if (recordUserInstall(installedPacksFile, candidate.id)) start = acceptInstalledPack(registry, candidate.id, backendActor);
      },
    });
    if (start) {
      if (!await start()) throw new Error(`Installed ${result.id}, but ${registry.loadProblem(result.id) ?? 'it failed to start'}`);
    } else {
      registry.refreshCatalog(packsDir);
      backendActor.send({ type: 'PACK_CHANGED', packId: result.id });
      logger.info(`Installed ${result.id}, which is disabled, so it was not started`);
    }
    return { id: result.id, dir: result.dir };
  } finally {
    if (claimedId) registry.releasePackOperation(claimedId);
  }
}
