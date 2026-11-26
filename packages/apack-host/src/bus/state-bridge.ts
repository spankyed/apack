// Dual-runtime backend bridge: wraps a `@apackdev/state` `State` as an XState-compatible `ActorLogic` so
// `createBusMachine` runs `@apackdev/state` systems alongside XState machines through one routing, validation,
// ask correlation, and reload/teardown lifecycle.
import { system, type AnyState, type Clock, type Handle, type PortOutcome, type State, type System } from '@apackdev/state';
import type { ActorLogic, AnyActorRef, Snapshot } from 'xstate';
import {
  _answered,
  _askEnded,
  _askSignal,
  _CALL_KEY,
  _clientOf,
  _currentDelivery,
  _failedAnswer,
  _progressed,
  _replyTo,
  newCall,
  type Message,
} from '@apackdev/sdk/events';
import { splitRef } from '@apackdev/sdk/ids';
import { reportError } from '@apackdev/sdk/logger';
import { deliverAs } from './delivery.ts';

const XSTATE_STOP = 'xstate.stop';
const STATE_SYNC_EVENT = '__apack_state_sync__';
const ROLE_PEERS = ['role:brain', 'role:code'] as const;

type StateEvent = { type: string; [key: string]: unknown };

export type StateSystemSnapshot = Snapshot<undefined> & {
  readonly value: string;
  readonly context: Record<string, unknown>;
};

export interface StateSystemBridge {
  readonly ref: string;
  readonly system: System;
  ask(
    name: string,
    args: Record<string, unknown>,
    onProgress: (update: unknown) => void,
    onDone: (outcome: PortOutcome) => void,
  ): () => void;
}

export interface StateSystemActorOptions {
  /** Delivers a `broadcast(surface, event)` onto the bus's `OUTGOING` path. */
  onBroadcast(message: Message): void;
  /** Routes a `tell({ peer: 'role:<name>' }, event)` to the designated system, if any. */
  onTellPeer?(peer: string, event: StateEvent): void;
  /** Optional clock override; defaults to standard wall time + `setTimeout`. */
  clock?: Clock;
}

const bridges = new WeakMap<AnyActorRef, StateSystemBridge>();

/** Returns the `@apackdev/state` ask bridge for `actor`, or `undefined` for an XState actor. */
export function stateSystemBridgeOf(actor: AnyActorRef): StateSystemBridge | undefined {
  return bridges.get(actor);
}

const defaultClock: Clock = {
  now: () => Date.now(),
  after: (ms, fn) => {
    const timer = setTimeout(fn, ms);
    return () => clearTimeout(timer);
  },
};

function readStateValue(sys: System, handle: Handle<unknown, any, any>): { value: string; context: Record<string, unknown> } {
  const snap = sys.read(handle) as { at?: string; data?: Record<string, unknown> } | undefined;
  return {
    value: snap?.at ?? 'active',
    context: snap?.data ?? {},
  };
}

function makeSnapshot(status: 'active' | 'stopped', value: string, context: Record<string, unknown>): StateSystemSnapshot {
  if (status === 'stopped') {
    return { status: 'stopped', output: undefined, error: undefined, value, context };
  }
  return { status: 'active', output: undefined, error: undefined, value, context };
}

/**
 * Wraps a `@apackdev/state` backend `State` in XState `ActorLogic` so `createBusMachine` can spawn, message,
 * snapshot, reload, and tear it down identically to an XState machine.
 */
export function createStateSystemActor(
  ref: string,
  state: AnyState,
  options: StateSystemActorOptions,
): ActorLogic<StateSystemSnapshot, StateEvent> {
  interface Instance {
    readonly sys: System;
    readonly handle: Handle<unknown, any, any>;
    readonly cleanup: () => void;
    inTransition: boolean;
    stopped: boolean;
  }

  const instances = new WeakMap<AnyActorRef, Instance>();
  const packId = splitRef(ref)?.packId;

  return {
    config: { id: ref, state },
    getInitialSnapshot: () => makeSnapshot('active', 'active', {}),
    getPersistedSnapshot: (snapshot) => snapshot,
    restoreSnapshot: (snapshot) => snapshot as StateSystemSnapshot,
    start: (_snapshot, actorScope) => {
      const { self } = actorScope;
      const sys = system({
        side: 'backend',
        name: ref,
        clock: options.clock ?? defaultClock,
        onDefect: (defect) => {
          reportError({
            source: ref,
            operation: 'state',
            severity: 'diagnostic',
            error: defect.error ?? new Error(defect.message),
          });
        },
      });

      const detachDown = sys.attach({
        tell: (to, event) => {
          options.onBroadcast({
            to,
            event: event as StateEvent,
            ...(packId !== undefined ? { from: packId } : {}),
            sender: ref,
            call: newCall(),
          });
        },
        ask: (_to, _name, _args, _progress, done) => {
          done({ ok: false, failure: { kind: 'unavailable', message: `Backend system "${ref}" cannot ask a window` } });
          return () => {};
        },
        follow: (_feature, _view, _args, _updated, failed) => {
          failed({ kind: 'unavailable', message: `Backend system "${ref}" cannot follow a window view` });
          return { stop: () => {} };
        },
      });

      const peerDetaches = options.onTellPeer
        ? ROLE_PEERS.map((peer) => sys.attach(peer, {
            tell: (name, event) => options.onTellPeer!(name, event as StateEvent),
          }))
        : [];

      const instance: Instance = {
        sys,
        handle: undefined as unknown as Handle<unknown, any, any>,
        cleanup: () => {
          unsubscribe();
          detachDown();
          for (const detachPeer of peerDetaches) detachPeer();
          sys.stop();
        },
        inTransition: true,
        stopped: false,
      };

      const unsubscribe = sys.subscribe(() => {
        if (instance.stopped || instance.inTransition) return;
        if (self.getSnapshot().status === 'active') {
          self.send({ type: STATE_SYNC_EVENT });
        }
      });

      let handle: Handle<unknown, any, any>;
      try {
        handle = sys.start(ref, state as State<any, any, any, never>);
      } catch (error) {
        instance.stopped = true;
        unsubscribe();
        detachDown();
        for (const detachPeer of peerDetaches) detachPeer();
        sys.stop();
        throw error;
      } finally {
        instance.inTransition = false;
      }

      (instance as { handle: Handle<unknown, any, any> }).handle = handle;
      instances.set(self, instance);
      bridges.set(self, {
        ref,
        system: sys,
        ask: (name, args, onProgress, onDone) => sys.port.ask(ref, name, args, onProgress, onDone),
      });

      // Push initial committed state into XState's snapshot so getSnapshot() reflects initial `at` and `data`.
      self.send({ type: STATE_SYNC_EVENT });
    },
    transition: (snapshot, event, actorScope) => {
      const instance = instances.get(actorScope.self);
      if (!instance || instance.stopped) return snapshot;

      if (event.type === XSTATE_STOP) {
        instance.stopped = true;
        bridges.delete(actorScope.self);
        instances.delete(actorScope.self);
        const latest = readStateValue(instance.sys, instance.handle);
        instance.cleanup();
        return makeSnapshot('stopped', latest.value, latest.context);
      }

      if (event.type === STATE_SYNC_EVENT) {
        const latest = readStateValue(instance.sys, instance.handle);
        return makeSnapshot('active', latest.value, latest.context);
      }

      const delivered = _CALL_KEY in event
        ? Object.fromEntries(Object.entries(event).filter(([key]) => key !== _CALL_KEY)) as StateEvent
        : event;

      instance.inTransition = true;
      try {
        instance.sys.port.tell(ref, delivered);
      } finally {
        instance.inTransition = false;
      }

      const latest = readStateValue(instance.sys, instance.handle);
      return makeSnapshot('active', latest.value, latest.context);
    },
  };
}

/**
 * Dispatches a declared ask arriving on the bus to a `@apackdev/state` backend system, wiring progress,
 * cancellation (`_askSignal` / `_askEnded`), answer/failure replies, and orphan-failure reporting.
 */
export function dispatchStateAsk(
  bridge: StateSystemBridge,
  message: Message,
  kinds: readonly string[],
): void {
  const { to, event: incoming, sender, client, call, diagnostics } = message;
  const { type: asked, [_CALL_KEY]: _ignoredCall, ...args } = incoming;
  const ask = { kinds, taken: false };

  deliverAs({ to, sender, client, call, diagnostics }, incoming, () => {
    const delivery = _currentDelivery();
    if (delivery?.ask) delivery.ask.taken = true;
    const reply = _replyTo(delivery);
    const signal = _askSignal(call, _clientOf(delivery));
    if (signal.aborted) {
      _askEnded(call);
      return;
    }

    let settled = false;
    let cancel: (() => void) | undefined;
    const onAbort = () => {
      cancel?.();
    };
    const onProgress = (update: unknown) => {
      if (!signal.aborted) reply?.(_progressed(asked, update));
    };
    const onDone = (outcome: PortOutcome) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      _askEnded(call);
      if (signal.aborted) return;
      if (outcome.ok) {
        reply?.(_answered(asked, outcome.value));
        return;
      }
      if (reply) {
        reply(_failedAnswer(asked, outcome.failure));
      } else if (outcome.failure.kind !== 'unavailable') {
        reportError({
          error: new Error(outcome.failure.message),
          title: `${asked} failed`,
          source: bridge.ref,
        });
      }
    };

    cancel = bridge.ask(asked, args, onProgress, onDone);
    if (!settled) {
      if (signal.aborted) cancel();
      else signal.addEventListener('abort', onAbort, { once: true });
    }
  }, ask);
}
