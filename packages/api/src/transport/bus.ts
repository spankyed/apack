import { _withPerformanceCarrier } from '@apackdev/sdk/runtime';
import { diagnosticCarrier } from './diagnostics.ts';
// Lets declaration emit name tRPC's router types through a public entry (TS2742 under bundler resolution)
import type {} from '@trpc/server/unstable-core-do-not-import';
import { observable } from '@trpc/server/observable';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import type { Message } from '@apackdev/sdk/events';
import { HOST, receiveClientEvent, UnknownClientEventError } from '@apackdev/host/bus';
import { splitRef } from '@apackdev/sdk/ids';
import { procedure, router } from './trpc';
import { createLogger } from '@apackdev/sdk/logger';
import { rootEvents } from './emitter.ts';
import { appClaims, appPacks, appSettingsAccess } from '../runtime/index.ts';
import { bindSettingsRequest, SETTINGS_MUTATIONS, SettingsRefusedError } from '@apackdev/host/settings';

const logger = createLogger('app-events');

/**
 * Whether `ref` names something a reply could reach: a registered system, a registered surface, or a name a
 * connection claimed. The symmetric check to the one `receiveClientEvent` makes on `to` — without it a stale or
 * misspelled `sender` becomes an answer the bus drops into a diagnostic, one step removed from the send that
 * caused it.
 *
 * The two maps rather than `systemIds()`/`surfaceIds()`, which spread a cached map's keys into a new array on
 * every call: most of a window's sends carry a `sender`, so this runs on the common path and a lookup there
 * should cost nothing. The third clause is the one the drive engine lives on — `host/drive` is claimed, never
 * registered, so it appears in neither map.
 */
const addressable = (ref: string): boolean =>
  appPacks.getEventValidationMap().has(ref)
  || appPacks.getSurfaceEventValidationMap().has(ref)
  || appClaims.clientFor(ref) !== undefined;

export const systemBusRouter = router({
  send: procedure
    // Every field of `Message` beside `event` is named here rather than the object being made passthrough: zod
    // strips what it isn't told about, so a field this line omits arrives as `undefined`, while everything a
    // client invents still goes no further than here.
    //
    // `client` is omitted on purpose, and is the one field that must stay omitted: it is stamped from the
    // connection below rather than accepted, so a sender cannot claim another connection's address. The server
    // knows it for free, so taking it from the wire would be strictly worse for no gain.
    //
    // `sender` is named, and that is not the same decision. It is where an answer goes, and a client has to be
    // able to say — a window knows which of its surfaces asked, and a participant which name it claimed.
    //
    // `call` and `answering` are named for the same reason, in both directions: a window's ask crosses inbound
    // and must be answerable, and a *system* asking a window is answered inbound — so a round trip correlates
    // only if both survive the boundary. Neither routes, so a forged one buys a confused asker and nothing
    // more. Omitting `answering` on the reasoning that every reader is local is the trap: a window's reader is
    // not local to the backend that answered it.
    //
    // **It is checked for existence and not for identity, and the difference is worth knowing.** A `sender` must
    // name something addressable, the way `to` must; what it cannot do is prove the caller *is* that thing. One
    // window could name another's surface, and the bound on that is `client`: a reply goes to the connection the
    // ask arrived on, so the worst a forged `sender` buys is making a system answer *you* while believing it
    // answered somebody else. That is a bug rather than an escalation only while every caller is trusted, which
    // today means every caller holds the API token and no pack exists outside this repo — a premise the root
    // CLAUDE.md gives an expiry for. Closing it properly needs per-connection knowledge of which surfaces a
    // window actually loaded, which `packClientReady` does not keep.
    .input(z.object({ to: z.string().min(1), from: z.string().min(1).optional(), via: z.string().min(1).optional(), sender: z.string().min(1).optional(), call: z.string().min(1).optional(), answering: z.string().min(1).optional(), settingsCredential: z.string().min(1).optional(), diagnostics: diagnosticCarrier, event: z.object({ type: z.string().min(1) }).passthrough() }))
    .mutation(({ input, ctx }) => {
      if (input.sender !== undefined && !addressable(input.sender)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `"${input.sender}" can't be a sender: it names no registered system, no registered surface and no claimed participant. An answer to it would be sent nowhere and dropped.`,
        });
      }
      try {
        const { settingsCredential, ...message } = input;
        if (message.to === HOST.settings && SETTINGS_MUTATIONS.has(message.event.type)) {
          if (ctx.closed.aborted || !settingsCredential) throw new SettingsRefusedError(['Settings requests require host-issued access.']);
          const access = appSettingsAccess;
          access.resolve(ctx.client, settingsCredential);
          bindSettingsRequest(message.event, () => access.resolve(ctx.client, settingsCredential));
        }
        const deliver = () => receiveClientEvent(appPacks, { ...message, client: ctx.client });
        _withPerformanceCarrier(message.diagnostics, deliver);
      } catch (error) {
        if (error instanceof SettingsRefusedError) throw new TRPCError({ code: 'FORBIDDEN', message: error.message });
        if (error instanceof UnknownClientEventError) throw new TRPCError({ code: 'BAD_REQUEST', message: error.message });
        throw error;
      }
    }),
  /**
   * The client finished loading a pack's frontend (at boot, on activation), whatever it added, or its
   * subscription reconnected: the pack's systems get CLIENT_CONNECTED, which the connection's broadcast and
   * the activation skip for external packs with frontend code. Their replies still reach every client rather
   * than this one — not because an outgoing message cannot name a connection, which it can, but because a
   * system answering CLIENT_CONNECTED sends its startup data with `broadcastToSurface`, which names none. That
   * is the right reach for it: the data is for every window showing the surface, not for whoever connected.
   */
  packClientReady: procedure
    .input(z.object({ packId: z.string().min(1), registrationId: z.string().min(1) }).strict())
    .mutation(({ input }) => {
      if (appPacks.getPackRuntime(input.packId)?.registrationId !== input.registrationId) {
        throw new TRPCError({ code: 'CONFLICT', message: 'The frontend belongs to an unavailable pack runtime.' });
      }
      logger.info(`→ Pack client ready: "${input.packId}"`, { packId: input.packId });
      rootEvents.emitPackClientConnected(input.packId);
    }),
  /**
   * Takes a name on this connection, so something that is not a pack's feature can be sent to: an agent driving
   * the app claims `host/drive`, and from then on `sendToSystem('host/drive', …)` and a system's `reply` reach
   * it. The claim dies with the connection, so nothing has to give it back.
   *
   * A name another live connection holds is refused rather than taken over. Since a claim cannot outlive its
   * socket, a reconnect always finds the name free — so a collision means two drivers really are running, and
   * letting the newest win would send one of them the other's answers and look like it worked.
   */
  claim: procedure
    .input(z.object({ as: z.string().min(1) }))
    .mutation(({ input, ctx }) => {
      if (!splitRef(input.as)) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `"${input.as}" doesn't name a participant: a name is "<packId>/<featureId>", as "${HOST.drive}" is` });
      }
      const outcome = appClaims.claim(input.as, ctx.client);
      if (!outcome.ok) {
        throw new TRPCError({ code: 'CONFLICT', message: `"${input.as}" is already claimed by another connection. Close the other drive session, or claim a different name.` });
      }
      // Released when the connection ends, which is the only event that means the claimer is gone. A claim is
      // keyed by an id minted per socket, so there is nothing to reconcile: the name is free for the next one.
      ctx.closed.addEventListener('abort', () => appClaims.release(ctx.client), { once: true });
      logger.info(`→ Claimed "${input.as}"`, { as: input.as });
    }),
  sub: procedure
    .subscription(({ ctx }) =>
      observable<Message>((emit) => {
        const unsubscribe = rootEvents.onOutgoing((message) => {
          // Absent `client` means every connection, which is what a notification is: a mutation broadcast is
          // aimed at every view, and a surface runs once per window. A message that names a connection is an
          // answer to something that connection asked, and goes only there.
          if (message.client !== undefined && message.client !== ctx.client) return;
          emit.next(message);
        });

        rootEvents.emitConnected();

        return () => {
          logger.debug('Cleaning up subscription');
          unsubscribe();
        };
      }),
    ),
});
