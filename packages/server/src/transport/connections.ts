// Publishing the end of a connection, once, from the one place every call goes through.
//
// **The signal was always here and each holder armed its own listener.** `createRpcContext` carries
// `closed`, an `AbortSignal` the adapter aborts from `client.once('close')`, and its comment says anything
// holding per-connection state releases there. Four things hold such state — the participant claims, the
// settings leases, the performance recording owner, and a terminal's grid — and each arranged the release
// itself: one per claim in `bus.ts`, one behind a `WeakSet<AbortSignal>` dedupe in `settings.ts`, one with
// a hand-rolled `unlisten` in `performance.ts`. Three were right. The fourth is a pack, which could not
// reach the signal at all, so a terminal's size stayed owned by a window that had gone.
//
// So the arming happens once, here, and the end goes out on the bus as `connection-ended`. A holder
// subscribes; nothing has to remember to listen to a socket.
//
// **A middleware rather than the context factory**, because `createRpcContext` has one job — mint an id,
// carry the signal — and because `createCaller` runs the middleware chain while bypassing the factory, so
// every router spec that builds `{ client, closed }` by hand feeds this the way production does instead of
// needing to be taught. Registration is therefore on a connection's first call: a socket that opens and
// calls nothing holds no state to release.
import type { RootEvents } from '@apackdev/sdk/runtime';

/** Arms a connection's end exactly once, however many calls arrive on it */
export function createConnectionWatch(rootEvents: Pick<RootEvents, 'emitConnectionEnded'>) {
  // Keyed by the signal, not the client: the signal *is* the connection, and a WeakMap lets a finished
  // connection's entry go without this having to be told twice
  const watched = new WeakSet<AbortSignal>();

  return {
    /** Call on every request. The second and later calls on a connection do nothing */
    watch({ client, closed }: { client: string; closed: AbortSignal }): void {
      if (watched.has(closed)) return;
      watched.add(closed);
      // Over before its first call finished. Published now, so a holder that recorded something during that
      // call still hears about it rather than keeping it for the life of the process
      if (closed.aborted) {
        rootEvents.emitConnectionEnded(client);
        return;
      }
      closed.addEventListener('abort', () => { rootEvents.emitConnectionEnded(client); }, { once: true });
    },
  };
}
