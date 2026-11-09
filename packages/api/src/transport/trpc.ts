import { initTRPC } from '@trpc/server';
import type { RpcContext } from './context';
import { rootEvents } from './emitter.ts';
import { createConnectionWatch } from './connections.ts';

const t = initTRPC.context<RpcContext>().create();

const connections = createConnectionWatch(rootEvents);

/**
 * Arms the end of the connection this call arrived on, once.
 *
 * **Every procedure in every router is built from the `procedure` below**, so this is the one place a
 * connection becomes known and the one place its end is published. Putting it here rather than in
 * `createRpcContext` keeps that factory to minting an id, and means `createCaller` — which runs this chain
 * and skips the factory — feeds it the way a real socket does.
 */
const watchesTheConnection = t.middleware(({ ctx, next }) => {
  connections.watch(ctx);
  return next();
});

export const router    = t.router;
export const procedure = t.procedure.use(watchesTheConnection);
