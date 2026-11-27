/**
 * Server-side `@apackdev/link` bus hub: connects window `MessagePortMain` channels and authenticated
 * local-tool sockets (`mux.link`) into the backend bus, EARS views, and participant claims.
 *
 * Each connection gets an isolated `Link` session owned by its `connectionId` (shared 1:1 with the
 * paired Control RPC server on `mux.control`):
 * - Outgoing bus messages (`rootEvents.onOutgoing`) stream over `remotePort.tell(...)` filtered by
 *   `message.client === undefined || message.client === connectionId`.
 * - Incoming `tell` and `ask(host/bus, SEND)` validate target/event/sender, stamp `client: connectionId`,
 *   refuse `SETTINGS_MUTATIONS` (which require the off-bus Control Lane), and dispatch into `receiveClientEvent`.
 * - `ask(host/bus, CLAIM)` manages exclusive connection-scoped participant claims (`host/drive`, `host/e2eConnection`).
 * - Native system `ask(to, name, args)` dispatches directly to `backendBus.port.ask(...)` with cancellation (`left`).
 * - `follow(feature, view, args)` binds `views.watch(...)` with diagnostic traceparent propagation via `Sending.cause`.
 */
import {
  accept,
  join,
  type Accepting,
  type Link,
  type Port,
  type Sending,
} from '@apackdev/link';
import {
  deliverAs,
  HOST,
  receiveClientEvent,
  UnknownClientEventError,
  type BackendBus,
  type ParticipantClaims,
} from '@apackdev/host/bus';
import type { PackRegistry } from '@apackdev/host/packs';
import { SETTINGS_MUTATIONS } from '@apackdev/host/settings';
import {
  BUS_CLAIM_ASK,
  BUS_LINK_TARGET,
  BUS_SEND_ASK,
  decodeBusEnvelope,
  decodeBusSendPayload,
  decodeDiagnosticCause,
  encodeBusEnvelope,
  encodeDiagnosticSending,
  LINK_CLAIM_CONFLICT,
} from '@apackdev/host/transport/link-protocol';
import type { ViewHost } from '@apackdev/host/views';
import {
  _askEnded,
  _askSignal,
  _clientOf,
  _currentDelivery,
  newCall,
  type Message,
} from '@apackdev/sdk/events';
import { splitRef } from '@apackdev/sdk/ids';
import { createLogger } from '@apackdev/sdk/logger';
import { _withPerformanceCarrier } from '@apackdev/sdk/runtime';
import { errorMessage, isPlainObject } from '@apackdev/sdk/utils/pure';
import { createViewSubscriptionDiagnostics } from './diagnostics.ts';
import type { RootEventEmitter } from './emitter.ts';
import { safeJsonCodec } from './encoder.ts';

const logger = createLogger('app-events');

export type LinkBusPacks = Pick<
  PackRegistry,
  'getEventValidationMap' | 'getSurfaceEventValidationMap' | 'askKinds'
>;

export interface LinkBusDeps {
  readonly packs: () => LinkBusPacks;
  readonly bus: () => BackendBus | undefined;
  readonly views: () => ViewHost;
  readonly claims: ParticipantClaims;
  readonly rootEvents: Pick<RootEventEmitter, 'onOutgoing' | 'emitConnected' | 'emitConnectionEnded'>;
}

/**
 * Whether `ref` names something a reply could reach: a registered system, a registered surface,
 * or a name a live connection claimed.
 */
export function isAddressableRef(packs: LinkBusPacks, claims: ParticipantClaims, ref: string): boolean {
  return packs.getEventValidationMap().has(ref)
    || packs.getSurfaceEventValidationMap().has(ref)
    || claims.clientFor(ref) !== undefined;
}

/**
 * Creates the server's `@apackdev/link` acceptor wired to the backend bus, views, and participant claims.
 */
export function createLinkBus(deps: LinkBusDeps): Accepting<string> {
  const validateAndDispatch = (
    connectionId: string,
    message: Message,
  ): { ok: true } | { ok: false; code: 'BAD_REQUEST' | 'FORBIDDEN' | 'INTERNAL'; message: string } => {
    const packs = deps.packs();
    if (message.sender !== undefined && !isAddressableRef(packs, deps.claims, message.sender)) {
      return {
        ok: false,
        code: 'BAD_REQUEST',
        message: `"${message.sender}" can't be a sender: it names no registered system, no registered surface and no claimed participant. An answer to it would be sent nowhere and dropped.`,
      };
    }
    if (message.to === HOST.settings && SETTINGS_MUTATIONS.has(message.event.type)) {
      return {
        ok: false,
        code: 'FORBIDDEN',
        message: 'Settings requests require host-issued access.',
      };
    }
    try {
      const deliver = () => receiveClientEvent(packs, { ...message, client: connectionId });
      _withPerformanceCarrier(message.diagnostics, deliver);
      return { ok: true };
    } catch (error) {
      if (error instanceof UnknownClientEventError) {
        return { ok: false, code: 'BAD_REQUEST', message: error.message };
      }
      return { ok: false, code: 'INTERNAL', message: errorMessage(error) };
    }
  };

  const attachLink = (link: Link, connectionId: string): void => {
    let ended = false;

    const serverPort: Port = {
      tell: (to, payload, how) => {
        const diagnostics = decodeDiagnosticCause(how?.cause);
        const message = decodeBusEnvelope(to, payload, diagnostics);
        if (!message) {
          logger.warn('Dropped malformed link tell frame', { to, connectionId });
          return;
        }
        const outcome = validateAndDispatch(connectionId, message);
        if (!outcome.ok) {
          logger.warn(`Refused link tell "${message.event.type}" to "${message.to}": ${outcome.message}`, {
            to: message.to,
            type: message.event.type,
            code: outcome.code,
            connectionId,
          });
        }
      },

      ask: (to, name, args, heard, endedCb, how) => {
        const diagnostics = decodeDiagnosticCause(how?.cause);

        if (to === BUS_LINK_TARGET && name === BUS_SEND_ASK) {
          const message = decodeBusSendPayload(args, diagnostics);
          if (!message) {
            endedCb({ ok: false, failure: { kind: 'BAD_REQUEST', message: 'Invalid bus send payload' } });
            return () => {};
          }
          const outcome = validateAndDispatch(connectionId, message);
          if (outcome.ok) {
            endedCb({ ok: true, value: undefined });
          } else {
            endedCb({ ok: false, failure: { kind: outcome.code, message: outcome.message } });
          }
          return () => {};
        }

        if (to === BUS_LINK_TARGET && name === BUS_CLAIM_ASK) {
          const as = isPlainObject(args) && typeof args.as === 'string' ? args.as : '';
          if (!as || !splitRef(as)) {
            endedCb({
              ok: false,
              failure: {
                kind: 'BAD_REQUEST',
                message: `"${as}" doesn't name a participant: a name is "<packId>/<featureId>", as "${HOST.drive}" is`,
              },
            });
            return () => {};
          }
          const outcome = deps.claims.claim(as, connectionId);
          if (!outcome.ok) {
            endedCb({
              ok: false,
              failure: {
                kind: LINK_CLAIM_CONFLICT,
                message: `"${as}" is already claimed by another connection. Close the other drive session, or claim a different name.`,
              },
            });
            return () => {};
          }
          logger.info(`→ Claimed "${as}"`, { as, connectionId });
          endedCb({ ok: true, value: undefined });
          return () => {};
        }

        if (to === HOST.settings && SETTINGS_MUTATIONS.has(name)) {
          endedCb({ ok: false, failure: { kind: 'FORBIDDEN', message: 'Settings requests require host-issued access.' } });
          return () => {};
        }

        const packs = deps.packs();
        const backendBus = deps.bus();
        if (!backendBus || !backendBus.getSystem(to)) {
          endedCb({
            ok: false,
            failure: { kind: 'unavailable', message: `No "${to}" system is running to answer "${name}"` },
          });
          return () => {};
        }

        const kinds = packs.askKinds(to, name);
        if (kinds === undefined) {
          endedCb({
            ok: false,
            failure: { kind: 'unavailable', message: `System "${to}" does not declare ask "${name}"` },
          });
          return () => {};
        }

        const payload = isPlainObject(args) ? args : {};
        const incomingEvent = { ...payload, type: name };
        const call = newCall();
        return _withPerformanceCarrier(diagnostics, () =>
          deliverAs(
            { to, client: connectionId, call, ...(diagnostics ? { diagnostics } : {}) },
            incomingEvent,
            () => {
              const signal = _askSignal(call, _clientOf(_currentDelivery()));
              if (signal.aborted) {
                _askEnded(call);
                endedCb({ ok: false, failure: { kind: 'unavailable', message: 'Connection ended' } });
                return () => {};
              }
              let settled = false;
              let cancel: (() => void) | undefined;
              const onAbort = () => {
                cancel?.();
              };
              const finish = (outcome: Parameters<typeof endedCb>[0]) => {
                if (settled) return;
                settled = true;
                signal.removeEventListener('abort', onAbort);
                _askEnded(call);
                endedCb(outcome);
              };
              cancel = backendBus.port.ask(
                to,
                name,
                args,
                (update) => { if (!settled && !signal.aborted) heard(update); },
                finish,
              );
              if (!settled) {
                if (signal.aborted) cancel();
                else signal.addEventListener('abort', onAbort, { once: true });
              }
              return () => {
                if (settled) return;
                settled = true;
                signal.removeEventListener('abort', onAbort);
                _askEnded(call);
                cancel?.();
              };
            },
            { kinds, taken: true },
          ),
        );
      },

      follow: (feature, view, args, shown, _over, how) => {
        const diagnostics = decodeDiagnosticCause(how?.cause);
        const observation = createViewSubscriptionDiagnostics(diagnostics);
        const stop = observation.within(() =>
          deps.views().watch({ ref: feature, view, ...(args !== undefined ? { args } : {}) }, (update) => {
            const observed = observation.update(update);
            const sending: Sending | undefined = encodeDiagnosticSending(observed.diagnostics?.carrier);
            shown(observed, sending);
          }),
        );
        return { stop };
      },
    };

    const remotePort = join(link, serverPort, {
      thrown: (error) => {
        logger.error('Link peer callback failed', { error, connectionId });
      },
    });

    const unsubOutgoing = deps.rootEvents.onOutgoing((message) => {
      if (ended) return;
      if (message.client !== undefined && message.client !== connectionId) return;
      try {
        remotePort.tell(
          message.to,
          encodeBusEnvelope(message),
          encodeDiagnosticSending(message.diagnostics),
        );
      } catch (error) {
        logger.error('Failed to send outgoing bus message over link', {
          to: message.to,
          type: message.event.type,
          connectionId,
          error,
        });
      }
    });

    link.onEnd(() => {
      if (ended) return;
      ended = true;
      unsubOutgoing();
      deps.claims.release(connectionId);
      deps.rootEvents.emitConnectionEnded(connectionId);
    });

    queueMicrotask(() => {
      if (!ended) deps.rootEvents.emitConnected();
    });
  };

  return accept<string>(attachLink, {
    codec: safeJsonCodec,
    thrown: (error) => {
      logger.error('Link transport error', { error });
    },
  });
}
