import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { appPerformance } from '../runtime/index.ts';
import { procedure, router } from './trpc.ts';

/** The socket is authenticated before tRPC; a recording additionally belongs to the connection that started it. */
interface RecordingOwner { client: string; unlisten(): void }
let owner: RecordingOwner | undefined;
function release(claim: RecordingOwner) {
  claim.unlisten();
  if (owner === claim) owner = undefined;
}
function controller() {
  if (!appPerformance) throw new TRPCError({ code: 'FORBIDDEN', message: 'Performance recording is available only in development and test' });
  return appPerformance;
}
function owned(client: string) {
  const performance = controller();
  if (owner?.client !== client) throw new TRPCError({ code: 'FORBIDDEN', message: 'This connection does not own the performance recording' });
  return performance;
}

export const performanceRouter = router({
  start: procedure.input(z.object({ mode: z.enum(['disabled', 'lightweight', 'detailed']) })).mutation(({ input, ctx }) => {
    const performance = controller();
    if (owner) throw new TRPCError({ code: 'CONFLICT', message: 'A performance recording is already active' });
    if (ctx.closed.aborted) throw new TRPCError({ code: 'BAD_REQUEST', message: 'The connection is closed' });
    performance.start(input.mode);
    const claim: RecordingOwner = { client: ctx.client, unlisten: () => ctx.closed.removeEventListener('abort', closed) };
    const closed = () => {
      claim.unlisten();
      // Keep ownership until cleanup finishes. A prior lifetime cannot release a subsequent recording.
      try { void performance.stop().finally(() => release(claim)).catch(() => {}); }
      catch { release(claim); }
    };
    owner = claim;
    ctx.closed.addEventListener('abort', closed, { once: true });
  }),
  snapshot: procedure.query(({ ctx }) => owned(ctx.client).snapshot()),
  stop: procedure.mutation(async ({ ctx }) => {
    const performance = owned(ctx.client);
    const claim = owner!;
    try { return await performance.stop(); }
    finally { release(claim); }
  }),
});
