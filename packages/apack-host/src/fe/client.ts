import type { EARS } from '@elmdb/ears';
// The window's client to the API as the app shell uses it: the SDK's part (sending to backend systems) and what only
// the shell reads. The renderer implements it over its API client; tests pass a fake.
import type { Message } from '@apackdev/sdk/events';
import type { FeClient } from '@apackdev/sdk/runtime';
import type { LoadedPackEntry } from '../packs/layout-types.ts';

/**
 * Why the backend failed: a message, or an error with its stack, which the error page shows as a message over the
 * stack it can expand
 */
export type ShellFailure = string | { message: string; stack?: string };

/** A failure as one text, its stack under its message: for a log or a test, where the error page's layout isn't */
export function describeFailure(failure: ShellFailure): string {
  if (typeof failure === 'string') return failure;
  return failure.stack ? `${failure.message}\n\n${failure.stack}` : failure.message;
}

/** What the shell hears from its subscription to the bus */
export interface ShellConnection {
  /**
   * The subscription is established: the server has sent this connection's CLIENT_CONNECTED. Each reconnection
   * establishes it again.
   */
  onConnected(): void;
  /** The connection dropped; `onConnected` follows when it's back */
  onDisconnected(): void;
  /** A message a backend system sent a surface, exactly as sent */
  onMessage(message: Message): void;
  /** The backend failed and won't recover by itself: why, for the error page */
  onFailed(error: ShellFailure): void;
}

export interface ShellClient extends FeClient {
  /** Whether the current database contains a non-deleted entity; abort when its navigation ends. */
  entityExists(id: EARS.EntityId, signal: AbortSignal): Promise<boolean>;
  /** Subscribes to what the backend sends this window; returns the unsubscribe */
  subscribe(connection: ShellConnection): () => void;
  /** Acknowledges this window's accepted frontend lifetime before requesting startup data. */
  packClientReady(packId: string, registrationId: string): Promise<void>;
  /** The packs the backend loaded, the built-in ones first */
  loadedPacks(): Promise<LoadedPackEntry[]>;
  /** What the platform knows about the backend, for the error page when it doesn't answer */
  describeConnection(): Promise<string>;
}
