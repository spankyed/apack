// One cancellable read/load cycle: reconcile absent owners, accept new frontends, and refresh existing
// resources on reconnect. Refused candidates leave accepted resources to their owner.
import { state } from '@apackdev/state';
import type { Surface } from '@apackdev/sdk/fe';
import { errorMessage } from '@apackdev/sdk/utils/pure';
import type { ShellClient } from '../../../fe/client.ts';
import type { ShellPackFrontends } from '../../../fe/pack-frontends.ts';

export type PackFrontendLoaderEvent =
  | { type: 'START'; acceptedPackRuntimes: Record<string, string>; refresh: boolean }
  | { type: 'STOP' };

export type PackFrontendLoaderReport =
  | { type: 'PACK_SURFACES_UNLOADED'; packId: string }
  | { type: 'PACK_FRONTEND_LOADED'; packId: string; registrationId: string; surfaces: Surface[] | null }
  | { type: 'PACK_FRONTENDS_SETTLED'; loadedPacksError?: string; failedPacks?: { packId: string; error: string }[] };

export type PackFrontendLoaderShape = {
  data: {
    acceptedPackRuntimes: Record<string, string>;
    refresh: boolean;
  };
  reports: PackFrontendLoaderReport;
  states: {
    idle: {};
    loading: {};
  };
};

/**
 * Ordinary reads skip matching accepted lifetimes; changed revisions and reconnect refresh their resources.
 * Only a successful authoritative list can remove an owner; failed reads and candidates preserve incumbents.
 */
export function createPackFrontendLoaderState(client: ShellClient, packFrontends: ShellPackFrontends) {
  return state<PackFrontendLoaderShape, PackFrontendLoaderEvent>()({
    initial: 'idle',
    data: {
      acceptedPackRuntimes: {},
      refresh: false,
    },
    on: {
      START: (event) => ({
        at: 'loading',
        data: {
          acceptedPackRuntimes: event.acceptedPackRuntimes,
          refresh: event.refresh,
        },
      }),
      STOP: () => ({ at: 'idle' }),
    },
    states: {
      idle: {},
      loading: {
        run: async ({ data, signal, report }) => {
          const failedPacks: { packId: string; error: string }[] = [];
          let loadedPacks;
          try {
            loadedPacks = await client.loadedPacks();
          } catch (err: unknown) {
            if (signal.aborted) return;
            report({ type: 'PACK_FRONTENDS_SETTLED', loadedPacksError: errorMessage(err), failedPacks });
            return { at: 'idle' };
          }
          if (signal.aborted) return;

          const present = new Set(loadedPacks.map((pack) => pack.id));
          for (const packId of Object.keys(data.acceptedPackRuntimes)) {
            if (signal.aborted) return;
            if (!present.has(packId)) report({ type: 'PACK_SURFACES_UNLOADED', packId });
          }

          for (const pack of loadedPacks) {
            if (signal.aborted) return;
            if (!data.refresh && data.acceptedPackRuntimes[pack.id] === pack.registrationId) continue;
            try {
              // null: the pack has no frontend code, so there's nothing to merge or ask startup data for
              const surfaces = await packFrontends.load(pack, signal);
              if (signal.aborted) return;
              report({ type: 'PACK_FRONTEND_LOADED', packId: pack.id, registrationId: pack.registrationId, surfaces });
            } catch (err: unknown) {
              if (signal.aborted) return;
              failedPacks.push({ packId: pack.id, error: errorMessage(err) });
            }
          }

          if (signal.aborted) return;
          report({ type: 'PACK_FRONTENDS_SETTLED', failedPacks });
          return { at: 'idle' };
        },
        failed: () => ({ at: 'idle' }),
      },
    },
  });
}

export type PackFrontendLoaderState = ReturnType<typeof createPackFrontendLoaderState>;

/**
 * Asks a pack's systems for their startup data. A connection's CLIENT_CONNECTED skips the systems of every pack
 * with frontend code, the ones the app ships included, since that frontend loads after it; each is asked for once
 * its load finished, whether it added surfaces or not, so its systems without surfaces get it too.
 */
export function announcePackClientReady(client: ShellClient, packId: string, registrationId: string): void {
  client.packClientReady(packId, registrationId).catch((err: unknown) => {
    console.warn(`[shell] Couldn't request startup data for pack ${packId}:`, err);
  });
}
