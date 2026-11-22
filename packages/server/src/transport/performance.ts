import { _recordingModeSchema } from '@apackdev/sdk/runtime';
import type { PerformanceRecordingReport } from '@apackdev/host/diagnostics';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { appPerformance, appStartupPerformance } from '../runtime/index.ts';
import { procedure, router } from './trpc.ts';
import { rootEvents } from './emitter.ts';

/** The socket is authenticated before tRPC; a recording additionally belongs to the connection that started it. */
interface RecordingOwner { client: string }
let owner: RecordingOwner | undefined;
/**
 * Clears ownership, if this claim is still the one holding it.
 *
 * The identity check is what keeps a finishing recording from releasing the next one: ownership is held
 * until a stop completes, so a recording started in between belongs to its own claim by then.
 */
function release(claim: RecordingOwner) {
  if (owner === claim) owner = undefined;
}

/**
 * A recording belongs to one connection, so it stops when that connection ends.
 *
 * One subscription for the process, rather than a listener armed per recording and removed again when one
 * finished. Nothing is per-connection here: the owner is a single slot, and an end that names a client
 * holding nothing is a no-op — which is also what makes the removal this replaces unnecessary.
 */
rootEvents.onConnectionEnded((client) => {
  const claim = owner;
  if (claim?.client !== client) return;
  // Ownership is kept until the stop settles, so a recording started while this one winds down is its own
  try { void performanceOf()?.stop().finally(() => release(claim)).catch(() => {}); }
  catch { release(claim); }
});

/** The recording controller, or absence: this fires for every connection, including when none is available */
const performanceOf = () => appPerformance;
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
  start: procedure.input(z.object({ mode: _recordingModeSchema, startup: z.boolean().optional() })).mutation(async ({ input, ctx }) => {
    const performance = controller();
    if (owner) throw new TRPCError({ code: 'CONFLICT', message: 'A performance recording is already active' });
    if (ctx.closed.aborted) throw new TRPCError({ code: 'BAD_REQUEST', message: 'The connection is closed' });
    if (input.startup) {
      if (!appStartupPerformance || appStartupPerformance.controller !== performance) throw new TRPCError({ code: 'CONFLICT', message: 'No startup recording is available' });
      try { appStartupPerformance.adopt(input.mode); }
      catch { throw new TRPCError({ code: 'CONFLICT', message: 'No matching startup recording is available' }); }
    } else performance.start(input.mode);
    owner = { client: ctx.client };
    await performance.ready();
    if (ctx.closed.aborted) throw new TRPCError({ code: 'BAD_REQUEST', message: 'The connection is closed' });
  }),
  snapshot: procedure.query(({ ctx }): PerformanceRecordingReport | undefined => owned(ctx.client).snapshot()),
  stop: procedure.mutation(async ({ ctx }): Promise<PerformanceRecordingReport> => {
    const performance = owned(ctx.client);
    const claim = owner!;
    try { return await performance.stop(); }
    finally { release(claim); }
  }),
});
