// The views windows are subscribed to: each request resolved to the feature's view in the registered pack and run
// on the engine as a watch (`Ears.watch`), so it runs again after every commit that could change its result.
//
// **One engine watch per distinct request, however many subscribe to it.** Requests share a watch when they name the
// same feature, view and arguments (`viewKey`), and the watch stops when the last of them unsubscribes, so ten
// windows on one page cost one read per commit. A subscriber that joins a running watch is handed its last result.
//
// **The registry is what a view's code is.** A pack registering, being replaced or unregistering restarts that pack's
// watches on whatever `getPackRegistration` answers now: a reload re-runs them on the new code, and a pack that's
// gone, or a view it no longer declares, is delivered as an error and comes back when the pack does.
//
// Who subscribes is the caller's: the API holds one subscription per tRPC subscription, so a window closing its
// socket ends its own, and the test harness one per watch a spec opens.
import type { Ears, WatchReadContext } from '@apackdev/ears';
import { viewKey, type PackRegistration, type ViewRead, type ViewRequest, type ViewUpdate } from '@apackdev/sdk/framework';
import { splitRef } from '@apackdev/sdk/ids';
import { errorMessage } from '@apackdev/sdk/utils/pure';

type ViewObserver = (update: ViewUpdate) => void;

/** Optional observation of one watch; view execution and delivery remain owned by the view host. */
export interface ViewObservation {
  read<T>(read: () => T, causes?: WatchReadContext): T;
  deliver<T>(commit: number, deliver: () => T): T;
  recordCauses(): boolean;
}

/** What the views read: the engine, and the packs that declare them */
export interface ViewHostOptions {
  observe?: () => ViewObservation;
  /** The engine views run on, asked for at each start, so a test's replaced engine is the one a new watch reads */
  ears: () => Ears;
  packs: {
    getPackRegistration(packId: string): PackRegistration | null;
    onRegistrationChanged(listener: (packId: string) => void): () => void;
  };
}

export interface ViewHost {
  /**
   * Subscribes `observer` to the view `request` names: it hears the view's result, and each changed result after
   * it, until the returned function is called. Always asynchronously, never inside the call or a write.
   */
  watch(request: ViewRequest, observer: ViewObserver): () => void;
  /** How many distinct views are running, and how many subscriptions share them */
  stats(): { views: number; subscriptions: number };
  /** Ends every subscription and stops listening to the registry */
  close(): void;
}

/** A request's running watch and everyone subscribed to it */
interface SharedView {
  request: ViewRequest;
  packId: string;
  featureId: string;
  observers: Set<ViewObserver>;
  /** What was last delivered, which a subscriber joining later is handed */
  last: ViewUpdate | undefined;
  /** Ends what `start` began */
  stop: () => void;
}

export function createViewHost({ ears, packs, observe }: ViewHostOptions): ViewHost {
  const views = new Map<string, SharedView>();

  const deliver = (shared: SharedView, update: ViewUpdate) => {
    // A restart's first result, when the new code reads the same as the old did, isn't news
    if (shared.last && sameOutcome(shared.last, update)) return;
    shared.last = update;
    for (const observer of shared.observers) observer(update);
  };

  /** The view's code as the registry holds it now, or why there is none */
  const resolve = (shared: SharedView): ViewRead | string => {
    const { ref, view } = shared.request;
    const registration = packs.getPackRegistration(shared.packId);
    if (!registration) return `No view "${view}" at "${ref}": pack "${shared.packId}" isn't running`;
    const declared = registration.features?.[shared.featureId]?.views;
    if (!declared) return `No view "${view}" at "${ref}": the feature declares no views (apack.json features.${shared.featureId}.views)`;
    const read = Object.prototype.hasOwnProperty.call(declared, view) ? declared[view] : undefined;
    if (typeof read !== 'function') return `No view "${view}" at "${ref}": its views are ${Object.keys(declared).map(name => `"${name}"`).join(', ')}`;
    return read;
  };

  const start = (shared: SharedView) => {
    const read = resolve(shared);
    if (typeof read === 'string') {
      // Delivered as a watch would deliver it, after the caller has returned
      let stopped = false;
      queueMicrotask(() => { if (!stopped) deliver(shared, { ok: false, error: read, commit: ears().lastCommit() }); });
      shared.stop = () => { stopped = true; };
      return;
    }
    const args = shared.request.args;
    const observation = observe?.();
    const runRead = observation
      ? (causes?: WatchReadContext) => observation.read(() => (read as (args: unknown) => unknown)(args), causes)
      : () => (read as (args: unknown) => unknown)(args);
    const deliverRead = observation
      ? (update: ViewUpdate) => observation.deliver(update.commit, () => deliver(shared, update))
      : (update: ViewUpdate) => deliver(shared, update);
    const watching = ears().watch(runRead, {
      next: (value, commit) => deliverRead({ ok: true, value, commit }),
      error: (error, commit) => deliverRead({ ok: false, error: errorMessage(error), commit }),
    }, { label: `${shared.request.ref} · ${shared.request.view}`, recordCauses: observation?.recordCauses });
    shared.stop = () => watching.stop();
  };

  const unlisten = packs.onRegistrationChanged((packId) => {
    for (const shared of views.values()) {
      if (shared.packId !== packId) continue;
      shared.stop();
      start(shared);
    }
  });

  return {
    watch(request, observer) {
      const key = viewKey(request);
      let shared = views.get(key);
      if (!shared) {
        const parts = splitRef(request.ref);
        shared = { request, packId: parts?.packId ?? '', featureId: parts?.featureId ?? '', observers: new Set(), last: undefined, stop: () => {} };
        views.set(key, shared);
        if (parts) start(shared);
        else {
          const unaddressable = shared;
          queueMicrotask(() => deliver(unaddressable, { ok: false, error: `"${request.ref}" doesn't name a feature: a view is asked for at "<packId>/<featureId>"`, commit: ears().lastCommit() }));
        }
      }
      const joined = shared;
      // Its own function, so one observer subscribed twice is two subscriptions and each unsubscribe ends one
      const subscription: ViewObserver = (update) => observer(update);
      joined.observers.add(subscription);
      const last = joined.last;
      if (last) queueMicrotask(() => { if (joined.observers.has(subscription) && joined.last === last) subscription(last); });
      return () => {
        if (!joined.observers.delete(subscription) || joined.observers.size > 0) return;
        joined.stop();
        views.delete(key);
      };
    },
    stats: () => ({ views: views.size, subscriptions: [...views.values()].reduce((sum, shared) => sum + shared.observers.size, 0) }),
    close() {
      unlisten();
      for (const shared of views.values()) {
        shared.observers.clear();
        shared.stop();
      }
      views.clear();
    },
  };
}

/**
 * Whether two updates say the same thing, whatever commit each reflects: as JSON, which is how a result crosses the
 * wire. A value JSON can't hold (a BigInt) compares as different, so it is delivered rather than lost.
 */
function sameOutcome(a: ViewUpdate, b: ViewUpdate): boolean {
  if (!a.ok || !b.ok) return !a.ok && !b.ok && a.error === b.error;
  try {
    return JSON.stringify(a.value) === JSON.stringify(b.value);
  } catch {
    return false;
  }
}
