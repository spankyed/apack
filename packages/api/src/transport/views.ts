import { createViewSubscriptionDiagnostics, diagnosticCarrier } from './diagnostics.ts';
// Lets declaration emit name tRPC's router types through a public entry (TS2742 under bundler resolution)
import type {} from '@trpc/server/unstable-core-do-not-import';
import { observable } from '@trpc/server/observable';
import { z } from 'zod';
import type { ViewUpdate } from '@apackdev/sdk/framework';
import { appViews } from '../runtime/index.ts';
import { procedure, router } from './trpc';

export const viewsRouter = router({
  /**
   * One window's subscription to one view: its result, and each changed result after it, sent to this connection
   * alone. It lasts as long as the subscription does, and a connection closing ends every subscription on it, so
   * nothing has to notice a window going away.
   */
  watch: procedure
    .input(z.object({ ref: z.string().min(1), view: z.string().min(1), args: z.unknown().optional(), diagnostics: diagnosticCarrier }))
    .subscription(({ input }) => observable<ViewUpdate>((emit) => {
      const { diagnostics, ...request } = input;
      const observation = createViewSubscriptionDiagnostics(diagnostics);
      return observation.within(() => appViews.watch(request, update => emit.next(observation.update(update))));
    })),
});
