import type {} from '@trpc/server/unstable-core-do-not-import';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { SettingsRefusedError } from '@apackdev/host/settings';
import { appSettingsAccess } from '../runtime/index.ts';
import { procedure, router } from './trpc';
import { rootEvents } from './emitter.ts';
import type { RpcContext } from './context';

// Every lease this connection holds goes when it ends. One subscription, rather than a listener armed on
// first use behind a `WeakSet<AbortSignal>` to keep from arming it twice: the dedupe was only ever there
// because the arming was per-call.
rootEvents.onConnectionEnded((client) => { appSettingsAccess.releaseClient(client); });

function withAccess<T>(context: RpcContext, issue: () => T): T {
  try {
    if (context.closed.aborted) throw new SettingsRefusedError(['The settings connection is closed.']);
    return issue();
  } catch (error) {
    if (error instanceof SettingsRefusedError) throw new TRPCError({ code: 'FORBIDDEN', message: error.message });
    throw error;
  }
}

/** API-token holders are trusted window/tool bootstrap; pack SDKs receive only their scoped port. */
export const settingsRouter = router({
  openHost: procedure.mutation(({ ctx }) => withAccess(ctx, () => appSettingsAccess.issueHost(ctx.client))),
  openPack: procedure.input(z.object({
    id: z.string().min(1), registrationId: z.string().min(1), declarationRevision: z.string().min(1), buildRevision: z.string().min(1),
  }).strict()).mutation(({ input, ctx }) => withAccess(ctx, () => appSettingsAccess.issuePack(ctx.client, input))),
  close: procedure.input(z.object({ credential: z.string().min(1) }).strict())
    .mutation(({ input, ctx }) => appSettingsAccess.revoke(ctx.client, input.credential)),
});
