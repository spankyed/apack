// The host's `application` feature on the backend: the app shell's own state, which surfaces' sidebar tabs show and
// the surface the user last had open. It lives in AppState because no pack owns the shell; the renderer's
// application actor is its surface.
import type { EARS } from '@elmdb/ears';
import { boundEars } from '@apackdev/sdk/ears';
import type { ContractAsks, IncomingOnlyEventsOf, NormalizeAsks } from '@apackdev/sdk/events';
import type { HostLifecycleEvents, StateMatchesContract } from '@apackdev/sdk/framework';
import { commandsFromDocuments } from '@apackdev/sdk/commands';
import { documentRepository } from '@apackdev/sdk/repositories';
import { splitRef } from '@apackdev/sdk/ids';
import { appState } from '../../../app-state/index.ts';
import type { PackRegistry } from '../../../packs/registry.ts';
import { hostState } from '../../../state.ts';
import type { Contract } from './contract.ts';

/** Which surfaces' tabs show, by ref: each feature's declared default, with the user's own choices over it */
export function surfaceVisibility(registry: Pick<PackRegistry, 'surfaceDefaults'>): Record<string, boolean> {
  return { ...registry.surfaceDefaults(), ...appState.get().surfaceVisibility };
}

type ApplicationEvent =
  | IncomingOnlyEventsOf<Contract>
  | Extract<HostLifecycleEvents, { type: 'SEND_STATE' }>;

/**
 * The host `application` system over the packs in `registry`. It records the user's choices, sends the
 * application surface the visibility again when a choice or a pack's defaults change, watches stored command
 * documents for changes, and answers entity existence queries.
 */
export function createApplicationSystem(registry: Pick<PackRegistry, 'surfaceDefaults' | 'loadedPacks' | 'getPackRuntime'>) {
  return hostState<
    {},
    ApplicationEvent,
    NormalizeAsks<ContractAsks<Contract>>
  >()({
    /**
     * Follows the stored commands, and sends them on when they actually differ.
     *
     * The repository announces every document write without saying what changed, because what changed is the
     * subscriber's to work out — and most document writes touch no command. So this compares the derived list,
     * which is the one place that comparison is made: the serialized form is what "the same commands" means.
     *
     * This is why no pack has to announce anything. An editor writes a document through the repository and the
     * app notices; a second editor would need no wiring at all.
     */
    listen: ({ send }) => {
      let last = JSON.stringify(commandsFromDocuments());
      let comparing = false;
      let disposed = false;
      /**
       * **Once per burst, not once per write.** Applying a pack's content writes every document in one
       * synchronous run, and each write announces, so comparing on each would publish the list half-built as
       * many times as there are documents. Deferring to a microtask coalesces a synchronous run into one
       * comparison, and the flag keeps a burst from queueing one per write.
       */
      const compareSoon = () => {
        if (comparing || disposed) return;
        comparing = true;
        queueMicrotask(() => {
          comparing = false;
          if (disposed) return;
          const now = JSON.stringify(commandsFromDocuments());
          if (now === last) return;
          last = now;
          send({ type: 'COMMANDS_CHANGED' });
        });
      };
      const unsubscribe = documentRepository.onDocumentsChanged(compareSoon);
      return () => {
        disposed = true;
        unsubscribe();
      };
    },
    on: {
      SET_SURFACE_VISIBILITY: (event, { broadcast }) => {
        // A surface that isn't a ref names no surface, so nothing could ever read the choice back
        if (splitRef(event.surface) === undefined) return;
        appState.update({ surfaceVisibility: { ...appState.get().surfaceVisibility, [event.surface]: event.visible } });
        broadcast('application', { type: 'SURFACE_VISIBILITY_UPDATED', surfaceVisibility: surfaceVisibility(registry) });
      },
      SET_LAST_ACTIVE_SURFACE: (event) => {
        if (splitRef(event.surface) === undefined) return;
        appState.update({ lastActiveSurface: event.surface });
      },
      // The watcher's own signal, or a pack's: reads the derived list from stored documents and publishes it.
      // **From `commandsFromDocuments()`, not `getCommands()`**, although they are the same list: that helper
      // prefers a bound frontend, whose answer is the shell's copy of what this send carries. Reading it here
      // would make the publisher read its own output back — in the app the two hosts are different processes and
      // it would be merely wrong, and in one process it answers empty, which is what a pack's tests run in.
      COMMANDS_CHANGED: (_event, { broadcast }) => {
        broadcast('application', { type: 'COMMANDS_UPDATED', commands: commandsFromDocuments() });
      },
      // A pack coming or going brings or takes its features' defaults, and the documents it applied with them
      SEND_STATE: (_event, { broadcast }) => {
        broadcast('application', { type: 'SURFACE_VISIBILITY_UPDATED', surfaceVisibility: surfaceVisibility(registry) });
        const runtimes = Object.fromEntries(registry.loadedPacks().map(({ id }) => {
          const runtime = registry.getPackRuntime(id);
          if (!runtime) throw new Error(`Pack "${id}" has no accepted runtime identity`);
          return [id, runtime.registrationId];
        }));
        broadcast('application', { type: 'PACK_RUNTIMES_UPDATED', runtimes });
        broadcast('application', { type: 'COMMANDS_UPDATED', commands: commandsFromDocuments() });
      },
    },
    answers: {
      ENTITY_EXISTS: ({ id }) => ({
        exists: typeof id === 'string' && id.includes('-') && boundEars().query.ids(id as EARS.EntityId).exists(),
      }),
    },
  });
}

const _contractMatches: StateMatchesContract<ReturnType<typeof createApplicationSystem>, Contract> = true;
void _contractMatches;
