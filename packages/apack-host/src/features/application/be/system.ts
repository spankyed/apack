// The host's `application` feature on the backend: the app shell's own state, which surfaces' sidebar tabs show and
// the surface the user last had open. It lives in AppState because no pack owns the shell; the renderer's
// application actor is its surface.
import { defineHandlers } from '@apackdev/sdk/framework';
import type { MachineContext } from 'xstate';
import { fromCallback, setup } from 'xstate';
import { commandsFromDocuments } from '@apackdev/sdk/commands';
import { documentRepository } from '@apackdev/sdk/repositories';
import type { ApplicationClientEvent } from '../../event-contracts.ts';
import { broadcastToSurface } from '../../../events.ts';
import { splitRef } from '@apackdev/sdk/ids';
import { appState } from '../../../app-state/index.ts';
import type { PackRegistry } from '../../../packs/registry.ts';

/** Hands each handler the connection the message it handles arrived on — see `defineHandlers` */
// No context is declared on this machine, so XState's own open `MachineContext` is what its handlers get
const handlers = defineHandlers<MachineContext, ApplicationEvent>();

/** Which surfaces' tabs show, by ref: each feature's declared default, with the user's own choices over it */
export function surfaceVisibility(registry: Pick<PackRegistry, 'surfaceDefaults'>): Record<string, boolean> {
  return { ...registry.surfaceDefaults(), ...appState.get().surfaceVisibility };
}

type ApplicationEvent = ApplicationClientEvent | { type: 'SEND_STATE' };

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
const commandWatcher = fromCallback<{ type: string }>(({ sendBack }) => {
  let last = JSON.stringify(commandsFromDocuments());
  let comparing = false;
  /**
   * **Once per burst, not once per write.** Applying a pack's content writes every document in one
   * synchronous run, and each write announces, so comparing on each would publish the list half-built as
   * many times as there are documents. Deferring to a microtask coalesces a synchronous run into one
   * comparison, and the flag keeps a burst from queueing one per write.
   */
  const compareSoon = () => {
    if (comparing) return;
    comparing = true;
    queueMicrotask(() => {
      comparing = false;
      const now = JSON.stringify(commandsFromDocuments());
      if (now === last) return;
      last = now;
      sendBack({ type: 'COMMANDS_CHANGED' });
    });
  };
  return documentRepository.onDocumentsChanged(compareSoon);
});

/**
 * The host `application` system over the packs in `registry`. It records the user's choices, and sends the
 * application surface the visibility again when a choice or a pack's defaults change, so every window agrees.
 */
export function createApplicationSystem(registry: Pick<PackRegistry, 'surfaceDefaults' | 'loadedPacks' | 'getPackRuntime'>) {
  return setup({
    types: { events: {} as ApplicationEvent },
    actors: { commandWatcher },
    actions: handlers.actions({
      sendRuntimes: () => {
        const runtimes = Object.fromEntries(registry.loadedPacks().map(({ id }) => {
          const runtime = registry.getPackRuntime(id);
          if (!runtime) throw new Error(`Pack "${id}" has no accepted runtime identity`);
          return [id, runtime.registrationId];
        }));
        broadcastToSurface('application', { type: 'PACK_RUNTIMES_UPDATED', runtimes });
      },
      /**
       * The chat's slash commands, which the shell holds for every editor in the window. Derived from the
       * stored documents on each send rather than held here, since they are rows the user edits.
       *
       * **From `commandsFromDocuments()`, not `getCommands()`**, although they are the same list: that
       * helper prefers a bound frontend, whose answer is the shell's copy of what this send carries.
       * Reading it here would make the publisher read its own output back — in the app the two hosts are
       * different processes and it would be merely wrong, and in one process it answers empty, which is
       * what a pack's tests run in.
       */
      sendCommands: () => {
        broadcastToSurface('application', { type: 'COMMANDS_UPDATED', commands: commandsFromDocuments() });
      },
      sendVisibility: () => {
        broadcastToSurface('application', { type: 'SURFACE_VISIBILITY_UPDATED', surfaceVisibility: surfaceVisibility(registry) });
      },
    }),
  }).createMachine({
    id: 'application',
    on: {
      SET_SURFACE_VISIBILITY: {
        // A surface that isn't a ref names no surface, so nothing could ever read the choice back
        guard: ({ event }) => splitRef(event.surface) !== undefined,
        actions: [
          ({ event }) => appState.update({ surfaceVisibility: { ...appState.get().surfaceVisibility, [event.surface]: event.visible } }),
          'sendVisibility',
        ],
      },
      SET_LAST_ACTIVE_SURFACE: {
        guard: ({ event }) => splitRef(event.surface) !== undefined,
        actions: ({ event }) => appState.update({ lastActiveSurface: event.surface }),
      },
      // The watcher's own signal, not a pack's: it fires when a document write changed the derived list
      COMMANDS_CHANGED: { actions: 'sendCommands' },
      // A pack coming or going brings or takes its features' defaults, and the documents it applied with them
      SEND_STATE: { actions: ['sendVisibility', 'sendRuntimes', 'sendCommands'] },
    },
    invoke: { src: 'commandWatcher' },
  });
}
