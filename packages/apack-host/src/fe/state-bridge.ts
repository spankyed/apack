// Dual-runtime frontend bridge: owns ONE `@apackdev/state` `System` (`side: 'window'`) per app shell and wraps each
// `@apackdev/state` surface in an XState-compatible `ActorLogic` adapter so `createShellMachine`, `trail.ts`,
// `useSurface()`, `useUntypedSurfaceState()`, `fallbackPanel.isShown`, and `@apackdev/state/vue` `useState()` all
// work together seamlessly.
import {
  system,
  windowFrame,
  type AnyState,
  type Clock,
  type State,
  type System,
  type ViewHost,
} from '@apackdev/state';
import type { ActorLogic, AnyActorRef, Snapshot } from 'xstate';
import { _askOverClient, _CALL_KEY, newCall } from '@apackdev/sdk/events';
import { hostClock, type Surface, type SurfaceChrome } from '@apackdev/sdk/fe';
import { reportError } from '@apackdev/sdk/logger';
import { _isFeHostBound } from '@apackdev/sdk/runtime';
import type { ShellClient } from './client.ts';

const XSTATE_STOP = 'xstate.stop';
const STATE_SYNC_EVENT = '__apack_state_sync__';
const ROLE_PEERS = ['role:brain', 'role:code'] as const;

type StateEvent = { type: string; [key: string]: unknown };

export interface StateSurfaceMeta {
  readonly id: string;
  readonly chrome?: SurfaceChrome<any>;
}

export type StateSurfaceSnapshot = Snapshot<undefined> & {
  readonly value: string;
  readonly context: Record<string, unknown>;
  readonly _stateSurface: StateSurfaceMeta;
};

export interface WindowStateBridgeOptions {
  readonly client: Pick<ShellClient, 'send' | 'watchView'>;
  /** Resolves a role designation (`'brain'`, `'code'`) for peer tells from frontend surfaces. */
  designation?(role: string): string | undefined;
  /** Delivers peer tells addressed to `'shell'` onto the XState shell actor. */
  shell?(event: StateEvent): void;
  /** Optional clock override; defaults to `boundFeHost().clock` when bound, else wall clock. */
  clock?: Clock;
}

export interface WindowStateBridge {
  readonly system: System;
  createSurfaceActor(surface: Surface & { state: AnyState }, ownsAppLayout: boolean): ActorLogic<StateSurfaceSnapshot, StateEvent>;
  stopAll(): void;
}

const shellStateSystems = new WeakMap<object, System>();

/** @internal Associates a shell actor with its per-window `@apackdev/state` `System`. */
export function registerShellStateSystem(shell: object, sys: System): void {
  shellStateSystems.set(shell, sys);
}

/**
 * Returns the per-window `@apackdev/state` `System` owned by `shell`, for `app.provide(SYSTEM, stateSystemOf(shell))`
 * and frontend tests.
 */
export function stateSystemOf(shell: object): System {
  const sys = shellStateSystems.get(shell);
  if (!sys) throw new Error('No @apackdev/state System is registered for this shell actor');
  return sys;
}

const wallClock: Clock = {
  now: () => Date.now(),
  after: (ms, fn) => {
    const timer = setTimeout(fn, ms);
    return () => clearTimeout(timer);
  },
};

function resolveWindowClock(override?: Clock): Clock {
  if (override) return override;
  if (_isFeHostBound()) {
    const feClock = hostClock();
    if (feClock) return feClock;
  }
  return wallClock;
}

function makeSurfaceSnapshot(
  status: 'active' | 'stopped',
  value: string,
  context: Record<string, unknown>,
  meta: StateSurfaceMeta,
): StateSurfaceSnapshot {
  if (status === 'stopped') {
    return { status: 'stopped', output: undefined, error: undefined, value, context, _stateSurface: meta };
  }
  return { status: 'active', output: undefined, error: undefined, value, context, _stateSurface: meta };
}

function readSurfaceValue(sys: System, ref: string): { value: string; context: Record<string, unknown> } {
  const snap = sys.read({ ref }) as { at?: string; data?: Record<string, unknown> } | undefined;
  return {
    value: snap?.at ?? '',
    context: snap?.data ?? {},
  };
}

interface ActiveSurface {
  readonly ref: string;
  readonly state: AnyState;
  readonly ownsAppLayout: boolean;
  readonly meta: StateSurfaceMeta;
  readonly actor: AnyActorRef;
  inTransition: boolean;
  stopped: boolean;
}

/**
 * Creates a per-window bridge owning one `@apackdev/state` `System` (`side: 'window'`) wired to `client` for
 * `tell`, `ask` (via `_askOverClient`), `follow` (`watchView`), and role peers.
 */
export function createWindowStateBridge(options: WindowStateBridgeOptions): WindowStateBridge {
  const cleanups: Array<() => void> = [];
  const hasBrowserWindow = typeof globalThis.requestAnimationFrame === 'function'
    && typeof globalThis.document !== 'undefined';

  const frame = hasBrowserWindow
    ? windowFrame({
        hidden: () => globalThis.document.hidden,
        frame: (run) => { globalThis.requestAnimationFrame(run); },
        later: (run) => { setTimeout(run, 0); },
        onHidden: (listener) => {
          const onVisibilityChange = () => { if (globalThis.document.hidden) listener(); };
          globalThis.document.addEventListener('visibilitychange', onVisibilityChange);
          cleanups.push(() => globalThis.document.removeEventListener('visibilitychange', onVisibilityChange));
        },
      })
    : undefined;

  const views: ViewHost = (feature, view, args, updated) =>
    options.client.watchView({ ref: feature, view, args }, (update) => {
      if (update.ok) updated({ ok: true, value: update.value });
      else updated({ ok: false, failure: { kind: 'failed', message: update.error } });
    });

  const sys = system({
    side: 'window',
    name: 'window',
    views,
    clock: resolveWindowClock(options.clock),
    ...(frame ? { frame } : {}),
    onDefect: (defect) => {
      reportError({
        source: defect.ref ?? 'window',
        operation: 'state',
        severity: 'diagnostic',
        error: defect.error ?? new Error(defect.message),
      });
    },
  });

  const detachUp = sys.attach({
    tell: (to, event) => {
      options.client.send({
        to,
        event: event as StateEvent,
        call: newCall(),
      });
    },
    ask: (to, name, args, progress, done) => {
      const controller = new AbortController();
      let active = true;
      const payload = typeof args === 'object' && args !== null ? (args as Record<string, unknown>) : {};
      void _askOverClient(
        options.client,
        to,
        { ...payload, type: name },
        {
          signal: controller.signal,
          heard: (update) => { if (active) progress(update); },
        },
      ).then(
        (outcome) => {
          if (!active) return;
          active = false;
          if (outcome.ok) done({ ok: true, value: outcome.value });
          else done({ ok: false, failure: outcome.failure });
        },
        () => {
          // Cancelled by caller leaving; `@apackdev/state` expects done() not to be called after cancel.
          active = false;
        },
      );
      return () => {
        if (!active) return;
        active = false;
        controller.abort();
      };
    },
    follow: (feature, view, args, updated, failed) => {
      const stop = options.client.watchView({ ref: feature, view, args }, (update) => {
        if (update.ok) updated(update.value);
        else failed({ kind: 'failed', message: update.error });
      });
      return { stop };
    },
  });
  cleanups.push(detachUp);

  if (options.designation) {
    for (const peer of ROLE_PEERS) {
      const role = peer.slice('role:'.length);
      cleanups.push(sys.attach(peer, {
        tell: (_name, event) => {
          const target = options.designation?.(role);
          if (!target) return;
          options.client.send({ to: target, event: event as StateEvent, call: newCall() });
        },
      }));
    }
  }

  if (options.shell) {
    cleanups.push(sys.attach('shell', {
      tell: (_name, event) => {
        options.shell?.(event as StateEvent);
      },
    }));
  }

  const activeSurfaces = new Map<string, ActiveSurface>();
  let restarting = false;
  let bridgeStopped = false;

  const unsubscribeSys = sys.subscribe((changed) => {
    if (restarting || bridgeStopped) return;
    for (const ref of changed) {
      const entry = activeSurfaces.get(ref);
      if (!entry || entry.stopped || entry.inTransition) continue;
      if (entry.actor.getSnapshot().status === 'active') {
        entry.actor.send({ type: STATE_SYNC_EVENT });
      }
    }
  });
  cleanups.push(unsubscribeSys);

  /**
   * Stops one running surface in `sys`. `@apackdev/state` stops a system wholesale rather than per-ref, so when other
   * surfaces remain active we stop `sys` and cleanly restart only the remaining ones so `sys.start` never collides on
   * a reloaded pack ref.
   */
  const stopSurface = (ref: string) => {
    const removed = activeSurfaces.get(ref);
    if (!removed) return;
    removed.stopped = true;
    activeSurfaces.delete(ref);
    if (bridgeStopped) return;

    restarting = true;
    try {
      sys.stop();
      for (const remaining of activeSurfaces.values()) {
        sys.start(remaining.ref, remaining.state as State<any, any, any, never>);
        sys.port.tell(remaining.ref, { type: 'SURFACE_STARTED', ownsAppLayout: remaining.ownsAppLayout });
      }
    } finally {
      restarting = false;
    }

    for (const remaining of activeSurfaces.values()) {
      if (!remaining.stopped && remaining.actor.getSnapshot().status === 'active') {
        remaining.actor.send({ type: STATE_SYNC_EVENT });
      }
    }
  };

  const stopAll = () => {
    if (bridgeStopped) return;
    bridgeStopped = true;
    for (const entry of activeSurfaces.values()) entry.stopped = true;
    activeSurfaces.clear();
    for (const cleanup of cleanups.splice(0).reverse()) cleanup();
    sys.stop();
  };

  const createSurfaceActor = (
    surface: Surface & { state: AnyState },
    ownsAppLayout: boolean,
  ): ActorLogic<StateSurfaceSnapshot, StateEvent> => {
    const ref = surface.id;
    const meta: StateSurfaceMeta = { id: ref, ...(surface.chrome ? { chrome: surface.chrome } : {}) };
    const instances = new WeakMap<AnyActorRef, ActiveSurface>();

    return {
      config: { id: ref, state: surface.state },
      getInitialSnapshot: () => makeSurfaceSnapshot('active', '', {}, meta),
      getPersistedSnapshot: (snapshot) => snapshot,
      restoreSnapshot: (snapshot) => snapshot as StateSurfaceSnapshot,
      start: (_snapshot, actorScope) => {
        if (bridgeStopped) return;
        const { self } = actorScope;
        if (activeSurfaces.has(ref)) stopSurface(ref);

        const entry: ActiveSurface = {
          ref,
          state: surface.state,
          ownsAppLayout,
          meta,
          actor: self,
          inTransition: true,
          stopped: false,
        };
        activeSurfaces.set(ref, entry);
        instances.set(self, entry);
        try {
          sys.start(ref, surface.state as State<any, any, any, never>);
        } catch (error) {
          entry.stopped = true;
          activeSurfaces.delete(ref);
          instances.delete(self);
          throw error;
        } finally {
          entry.inTransition = false;
        }

        // Push initial committed state into XState's snapshot so getSnapshot() reflects initial `at` and `data`.
        self.send({ type: STATE_SYNC_EVENT });
      },
      transition: (snapshot, event, actorScope) => {
        const entry = instances.get(actorScope.self);
        if (!entry || entry.stopped) return snapshot;

        if (event.type === XSTATE_STOP) {
          instances.delete(actorScope.self);
          const latest = readSurfaceValue(sys, ref);
          stopSurface(ref);
          return makeSurfaceSnapshot('stopped', latest.value, latest.context, meta);
        }

        if (event.type === STATE_SYNC_EVENT) {
          const latest = readSurfaceValue(sys, ref);
          return makeSurfaceSnapshot('active', latest.value, latest.context, meta);
        }

        if (bridgeStopped) return snapshot;

        const delivered = _CALL_KEY in event
          ? Object.fromEntries(Object.entries(event).filter(([key]) => key !== _CALL_KEY)) as StateEvent
          : event;

        entry.inTransition = true;
        try {
          sys.port.tell(ref, delivered);
        } finally {
          entry.inTransition = false;
        }

        const latest = readSurfaceValue(sys, ref);
        return makeSurfaceSnapshot('active', latest.value, latest.context, meta);
      },
    };
  };

  return {
    system: sys,
    createSurfaceActor,
    stopAll,
  };
}
