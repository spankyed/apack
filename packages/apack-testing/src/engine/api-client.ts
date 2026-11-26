// The drive session's own connection to the running app's API, over the local tool socket's
// multiplexed Control RPC (`mux.control`) and `@apackdev/link` (`mux.link`) lanes. A broken window is
// then just a broken window: `/query` keeps working while the renderer's own connection is dead.
//
// **No reconnection, deliberately.** A drive session is one run against one app launch. The socket can
// only die because the app closed or the API restarted (which ends all claims on the old process).
// Reconnecting would silently re-fire `CLIENT_CONNECTED` into a session whose claim somebody else now
// holds. Instead the channel records why it finished and every later verb fails saying so.

import { dial, join, type Port } from '@apackdev/link';
import { HOST } from '@apackdev/host/bus';
import { SETTINGS_MUTATIONS } from '@apackdev/host/settings';
import {
  BUS_CLAIM_ASK,
  BUS_LINK_TARGET,
  BUS_SEND_ASK,
  decodeBusEnvelope,
  decodeDiagnosticCause,
  encodeBusSendPayload,
  LINK_CLAIM_CONFLICT,
} from '@apackdev/host/transport/link-protocol';
import { ControlRpcError } from '@apackdev/host/transport/mux';
import { connectToolClient, type ConnectToolClientOptions } from '@apackdev/host/transport/tool-client';

/** A message on the app's bus, as delivered over `@apackdev/link`. */
export interface BusMessage {
  readonly diagnostics?: { traceparent?: string; tracestate?: string };
  readonly to: string;
  readonly event: { type: string; [key: string]: unknown };
  readonly from?: string;
  readonly via?: string;
  readonly sender?: string;
  readonly client?: string;
  readonly call?: string;
  readonly answering?: string;
}

/**
 * A pack runtime the app has accepted, as `packs.loaded` lists it: the four fields that identify it,
 * which is what `settings.openPack` takes.
 */
export interface PackRuntime {
  readonly id: string;
  readonly registrationId: string;
  readonly declarationRevision: string;
  readonly buildRevision: string;
}

/** Where the API's local tool socket is discovered or addressed directly. */
export type ApiAddress =
  | { readonly appDir: string; readonly socket?: undefined; readonly token?: undefined }
  | { readonly socket: string; readonly token: string; readonly appDir?: undefined };

export interface ApiClient {
  /** Takes a name on this connection, so a system can be told to answer it. Rejects when another holds it. */
  claim(ref: string): Promise<void>;
  /**
   * Sends to a system. Rejects on a refusal, where the page route used to drop it silently.
   *
   * `settingsCredential` is access `openPackSettings` issued, for a send acting as that pack toward `host/settings`;
   * the API refuses a settings mutation without one, and one whose runtime has gone.
   */
  send(message: { to: string; event: Record<string, unknown>; sender?: string; call?: string; settingsCredential?: string }): Promise<void>;
  /** Explicit trusted-tool settings access; ordinary bus sends never borrow this authority. */
  sendSettings: ApiClient['send'];
  /** The pack runtimes the app has accepted (`packs.loaded`). */
  loadedPacks(): Promise<PackRuntime[]>;
  /**
   * Settings access for one pack runtime (`settings.openPack`), as that pack's frontend is issued it.
   * Refused for a runtime the app no longer runs, which is how a spec shows a disabled pack's access ending.
   */
  openPackSettings(runtime: PackRuntime): Promise<string>;
  /** Triggers a dev/test reload of `packId` over the Control RPC lane (`dev.reload`). */
  reloadPack(packId: string): Promise<void>;
  /** Every message delivered to this connection; returns the unsubscribe. */
  onMessage(listener: (message: BusMessage) => void): () => void;
  /** Told once, with why, when the channel finishes; returns the unsubscribe. */
  onFinished(listener: (reason: string) => void): () => void;
  /** Why the channel is finished, or null while it works. What a timed-out verb quotes instead of guessing. */
  readonly failure: string | null;
  close(): Promise<void>;
}

/** The code the API refuses a name another live connection holds with. */
export const CLAIM_CONFLICT = LINK_CLAIM_CONFLICT;

function refusalError(what: string, message: string, code?: string): Error {
  return Object.assign(
    new Error(`${what}: ${message}${code ? ` (${code})` : ''}`),
    code ? { code } : {},
  );
}

function wrapControlError(what: string, error: unknown): Error {
  if (error instanceof ControlRpcError) {
    return refusalError(what, error.message, error.code);
  }
  const message = error instanceof Error ? error.message : String(error);
  const code = typeof (error as { code?: unknown })?.code === 'string'
    ? (error as { code: string }).code
    : undefined;
  return refusalError(what, message, code);
}

/**
 * Connects over the app's local tool socket, dials the `@apackdev/link` lane, and returns a
 * multiplexed Control + Link `ApiClient`.
 */
export async function connectApiClient(address: ApiAddress): Promise<ApiClient> {
  const options: ConnectToolClientOptions = address.appDir !== undefined
    ? { appDir: address.appDir }
    : { socket: address.socket, token: address.token };

  let tool: Awaited<ReturnType<typeof connectToolClient>>;
  try {
    tool = await connectToolClient(options);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Couldn't reach the app's API: ${detail}`);
  }

  const listeners = new Set<(message: BusMessage) => void>();
  const finishListeners = new Set<(reason: string) => void>();
  const pendingAsks = new Set<(reason: string) => void>();
  let failure: string | null = null;

  const finish = (reason: string): void => {
    if (failure !== null) return;
    failure = reason;
    for (const rejectPending of pendingAsks) rejectPending(reason);
    pendingAsks.clear();
    for (const listener of finishListeners) listener(reason);
    finishListeners.clear();
  };

  const clientPort: Port = {
    tell: (to, payload, how) => {
      const diagnostics = decodeDiagnosticCause(how?.cause);
      const decoded = decodeBusEnvelope(to, payload, diagnostics);
      if (!decoded) return;
      for (const listener of listeners) listener(decoded);
    },
    ask: (_to, _name, _args, _heard, ended) => {
      ended({ ok: false, failure: { kind: 'UNSUPPORTED', message: 'API tool client does not serve asks' } });
      return () => {};
    },
    follow: (_to, _view, _args, _shown, over) => {
      over({ kind: 'UNSUPPORTED', message: 'API tool client does not serve views' });
      return { stop: () => {}, change: () => {} };
    },
  };

  const link = dial(tool.link);
  const remotePort = join(link, clientPort);

  link.onEnd((reason) => {
    finish(reason ? `the connection to the app closed (${reason})` : 'the connection to the app closed');
  });
  tool.mux.control.onClose(() => {
    finish('the connection to the app closed');
  });

  const askLink = (to: string, name: string, args: unknown, what: string): Promise<unknown> => {
    if (failure !== null) return Promise.reject(new Error(`${what}: ${failure}`));
    return new Promise((resolve, reject) => {
      let settled = false;
      const onFinish = (reason: string): void => {
        if (settled) return;
        settled = true;
        pendingAsks.delete(onFinish);
        reject(new Error(`${what}: ${reason}`));
      };
      pendingAsks.add(onFinish);
      remotePort.ask(
        to,
        name,
        args,
        () => {},
        (outcome) => {
          if (settled) return;
          settled = true;
          pendingAsks.delete(onFinish);
          if (outcome.ok) {
            resolve(outcome.value);
          } else {
            reject(refusalError(what, outcome.failure.message || 'the API refused it', outcome.failure.kind));
          }
        },
      );
    });
  };

  const callControl = async <T>(what: string, run: () => Promise<T>): Promise<T> => {
    if (failure !== null) throw new Error(`${what}: ${failure}`);
    try {
      return await run();
    } catch (error) {
      if (failure !== null) throw new Error(`${what}: ${failure}`);
      throw wrapControlError(what, error);
    }
  };

  let settingsCredential: Promise<string> | undefined;
  const openSettings = (): Promise<string> => (
    settingsCredential ??= callControl('opening tool settings access', () => tool.control.call('settings.openHost', undefined))
      .then(({ credential }) => {
        if (typeof credential !== 'string' || !credential) {
          throw new Error('The app returned no settings credential');
        }
        return credential;
      })
  );

  const sendSettingsMutation = async (
    credential: string,
    message: { to: string; event: Record<string, unknown>; sender?: string; call?: string },
  ): Promise<void> => {
    const eventType = typeof message.event.type === 'string' ? message.event.type : '';
    const what = `sending ${eventType} to ${message.to}`;
    await callControl(what, () =>
      tool.control.call('settings.mutate', {
        credential,
        event: message.event as { type: string; [key: string]: unknown },
        ...(message.sender !== undefined ? { sender: message.sender } : {}),
        ...(message.call !== undefined ? { call: message.call } : {}),
      }),
    );
  };

  return {
    claim: (ref) => askLink(BUS_LINK_TARGET, BUS_CLAIM_ASK, { as: ref }, `claiming ${ref}`).then(() => undefined),

    send: async (message) => {
      const eventType = typeof message.event.type === 'string' ? message.event.type : '';
      if (
        message.settingsCredential !== undefined
        && message.to === HOST.settings
        && SETTINGS_MUTATIONS.has(eventType)
      ) {
        await sendSettingsMutation(message.settingsCredential, message);
        return;
      }
      const payload = encodeBusSendPayload({
        to: message.to,
        event: message.event as { type: string; [key: string]: unknown },
        ...(message.sender !== undefined ? { sender: message.sender } : {}),
        ...(message.call !== undefined ? { call: message.call } : {}),
      });
      await askLink(BUS_LINK_TARGET, BUS_SEND_ASK, payload, `sending ${eventType} to ${message.to}`);
    },

    sendSettings: async (message) => {
      if (message.to !== HOST.settings) {
        throw new Error('Settings access only sends to host/settings');
      }
      const credential = await openSettings();
      await sendSettingsMutation(credential, message);
    },

    loadedPacks: () =>
      callControl('listing the loaded packs', () => tool.control.call('packs.loaded', undefined)) as Promise<PackRuntime[]>,

    openPackSettings: ({ id, registrationId, declarationRevision, buildRevision }) =>
      callControl(`opening settings access for ${id}`, () =>
        tool.control.call('settings.openPack', { id, registrationId, declarationRevision, buildRevision }),
      ).then(({ credential }) => {
        if (typeof credential !== 'string' || !credential) {
          throw new Error(`The app returned no settings credential for ${id}`);
        }
        return credential;
      }),

    reloadPack: (packId) =>
      callControl(`reloading pack ${packId}`, () => tool.control.call('dev.reload', { packId })).then(() => undefined),

    onMessage: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    onFinished: (listener) => {
      finishListeners.add(listener);
      return () => finishListeners.delete(listener);
    },

    get failure() {
      return failure;
    },

    close: async () => {
      finish('the drive session closed the connection');
      link.close();
      await tool.close();
    },
  };
}
