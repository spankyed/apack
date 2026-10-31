// The packs' start over hydrated data, as a boot and an app reset (services.appData.reset()) run it
import { runAppMigrations, runPackMigrations } from '../../migrations/index.ts';
import type { PackRegistry } from '../registry.ts';
import { applyPacks } from './apply.ts';

/** Each registered pack's onInit, then the app's and each pack's migrations, then every pack's content, unless the app's migrations failed */
export async function startPacks(registry: PackRegistry): Promise<void> {
  await registry.indexesReady();
  for (const hooks of registry.getLifecycleHooks()) hooks.onInit?.();

  // The versions and content revisions the packs' migrations and content read may only be in place once the app's migrations
  // ran: when one failed, nothing else runs, and the next boot retries
  if (!runAppMigrations(registry)) return;
  // `runAppMigrations` has run every pack's `app`-line migrations against the app version; this is the other
  // line, so a migration reaches one runner or the other by where its pack declared it
  runPackMigrations(registry.packMigrationTargets('pack'));

  // One call for every pack, in dependency order, so every pack gets the same treatment: a failed apply is
  // retried on the next boot, and a pack sees what the packs it depends on applied in this same run
  applyPacks(registry.packContentTargets());
}
