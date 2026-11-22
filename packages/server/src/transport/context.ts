// The context every tRPC call gets: which connection it came in on, and nothing else — what a procedure
// needs besides that, it takes from the bound app.
//
// `client` is what makes a reply addressable to one window instead of all of them. The WebSocket adapter
// calls this once per connection and every operation on that socket awaits the same result
// (`getWSConnectionHandler`, @trpc/server), so an id minted here is per-connection by construction; it is
// not derived from the socket, only from when this runs. Two properties follow, and both are load-bearing:
// it is never read from the wire, so a return address cannot be forged, and it dies with the socket, so
// nothing has to observe a disconnect to retire it.
import { randomId } from '@apackdev/sdk/utils/pure';

/**
 * What the WebSocket adapter hands this, narrowed to the one member used.
 *
 * **Both members are required, and that is a fact about the adapter rather than a wish.** Read out of
 * `@trpc/server@11.16.0`'s installed adapter (`dist/ws-*.mjs`) rather than from memory: it builds `info` as
 * an object literal at its only call site with `signal: abortController.signal` always set, and its own
 * types declare `info` and `info.signal` non-optional. The controller is per connection, created once in the
 * handler and aborted from `client.once('close')` — a cancelled *operation* uses a different, inner one.
 *
 * They were optional until the type was checked against that, and the optionality was load-bearing in the
 * wrong direction: `bus.ts` had to write `ctx.closed?.addEventListener`, so a signal that never arrived would
 * have leaked every participant claim for the life of the process without a word. `context.spec.ts` runs a
 * real adapter so that a tRPC bump which stops supplying it fails there rather than restoring that silence.
 */
type ConnectionArgs = { info: { signal: AbortSignal } };

export const createRpcContext = ({ info }: ConnectionArgs) => ({
  client: randomId({ prefix: 'c-' }),
  /**
   * Fires when this connection ends, whatever ended it. Anything holding per-connection state releases it here.
   *
   * It matters that this is the *connection* and not a subscription. Releasing from a subscription's teardown is
   * both too eager — a client that stops subscribing while keeping its socket would lose its name — and too
   * narrow, since one that claims without ever subscribing would hold the name until the process exited.
   */
  closed: info.signal,
});

export type RpcContext = ReturnType<typeof createRpcContext>;
