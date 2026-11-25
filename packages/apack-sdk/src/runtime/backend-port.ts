import type { RootEvents } from './root-events.ts';
import type { PackRegistryView } from './packs-view.ts';
import type { PerformanceExecution } from './performance.ts';
import type { RunHistory } from '../services/run-history.ts';

/**
 * Service-free backend host port shared by frontend-safe SDK modules (packs-view, performance,
 * root-events, events, logger, commands, steps, framework) so frontend and preload typechecks
 * never pull backend `HostRuntimeServices`, `InferenceService`, or `ai`.
 */
export interface BackendHostPort {
  readonly transport: { readonly rootEvents: RootEvents };
  readonly packs: PackRegistryView;
  readonly diagnostics?: { readonly performance?: PerformanceExecution };
  readonly runHistory?: Pick<RunHistory, 'update'>;
}

let bound: BackendHostPort | undefined;

/** @internal Installed by `bindHost` and cleared by `unbindHost`. */
export function _setBackendHostPort(port: BackendHostPort | undefined): void {
  bound = port;
}

/** @internal Whether a backend host is bound. */
export function _isBackendHostBound(): boolean {
  return bound !== undefined;
}

/** @internal The bound backend host's service-free port; throws, naming bindHost, when none is bound. */
export function _boundBackendHost(): BackendHostPort {
  if (!bound) {
    throw new Error('No host is bound: the app binds one at boot with bindHost(runtime) from @apackdev/sdk/runtime, and unit tests with startTestRuntime() from @apackdev/sdk/testing');
  }
  return bound;
}
