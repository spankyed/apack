// A spec's own connection to the app's API, beside the window's: the `connection` fixture.
//
// **For what a window's connection cannot show.** `app.send` and `app.ask` act as the window, which is what most
// specs mean. A spec about what the API grants a *client* — settings access issued to one pack's runtime and
// refused once it has gone, the events every client hears while a pack installs — needs a client that is not the
// window, so that what it is granted or refused is its own. Without this a spec wrote one by hand: a tRPC client,
// a subscription, a message log, a waiter list and a correlation by call, about sixty lines, every one a place to
// get the protocol wrong.
//
// It is the drive engine's client (`engine/api-client.ts`), whose frames `api-client.spec.ts` pins against a real
// tRPC server, under the verbs a spec asks in. It claims `HOST.e2eConnection`, so a system's reply to its asks is
// addressed to it alone.
//
// **A wait lasts as long as the app works**, as `app.ask`'s does: an answer on a loaded machine comes late and is
// never failed for it. A wait also ends, saying why, the moment the connection does, rather than at the test's
// timeout.
import { _appDirOf } from '@apackdev/sdk/env';
import { HOST } from '@apackdev/host/bus';
import { newCall } from '@apackdev/sdk/events';
import { answerWhileWorking, fromNow, processWork } from '@apackdev/sdk/progress';
import { connectApiClient, type ApiClient, type BusMessage, type PackRuntime } from './engine/api-client.ts';

export type { BusMessage, PackRuntime };

/** An event to or from a backend system */
type SystemEvent = BusMessage['event'];

export interface AppConnection {
  /** The name this connection claimed, which a system's reply to its asks is addressed to */
  readonly name: string;
  /**
   * Every message the bus delivered to this connection since it opened, in order: what every client hears, and
   * the answers to this connection's asks. For a spec reporting what happened around a failure; a spec waiting
   * for something uses `next` or `ask`.
   */
  readonly messages: readonly BusMessage[];
  /**
   * Sends a system an event as this connection, the system named as the pack under test's code names one.
   * Resolves once the API accepted it and rejects with its refusal. `settingsCredential` is access
   * `openPackSettings` issued, for a send acting as that pack toward `host/settings`.
   */
  send(system: string, event: SystemEvent, options?: { settingsCredential?: string }): Promise<void>;
  /**
   * Sends as `send` does and resolves with the system's answer to it — `ASK_ANSWERED` with the answer, or `ASK_FAILED`
   * with why not — matched by the call it was sent under. Rejects with the API's refusal if the send is refused, and then waits for nothing.
   */
  ask(system: string, event: SystemEvent, options?: { settingsCredential?: string }): Promise<SystemEvent>;
  /**
   * The first event delivered to this connection, after this call, that `match` accepts. Arm it before the send
   * whose outcome it waits for, so an outcome that arrives at once is not missed. `what` names it in a failure.
   */
  next(match: (event: SystemEvent) => boolean, what?: string): Promise<SystemEvent>;
  /** The pack runtimes the app has accepted (`packs.loaded`) */
  loadedPacks(): Promise<PackRuntime[]>;
  /**
   * Settings access for one pack runtime, as that pack's frontend is issued it: the `settingsCredential` its sends
   * to `host/settings` carry. Refused for a runtime the app no longer runs.
   */
  openPackSettings(runtime: PackRuntime): Promise<string>;
  /** Triggers a dev/test reload of `packId` over the local tool socket's Control RPC lane. */
  reloadPack(packId: string): Promise<void>;
}

export interface ConnectToAppOptions {
  /** A spec's system name to the ref it is, as the fixture resolves every name it is given */
  readonly resolve: (name: string) => string;
  /** The app's process, whose work bounds a wait. Without one, a wait is bounded by the test's own timeout. */
  readonly appPid?: number;
}

/** Opens a connection to the API serving `userDataDir`, and claims `HOST.e2eConnection` on it. */
export async function connectToApp(userDataDir: string, options: ConnectToAppOptions): Promise<AppConnection & { close(): Promise<void> }> {
  const api = await connectApiClient({ appDir: _appDirOf(userDataDir) });
  try {
    return await withClaim(api, options);
  } catch (error) {
    await api.close();
    throw error;
  }
}

/** The connection over a client already open, claiming its name first. Exported for its spec, which serves a fake API */
export async function withClaim(api: ApiClient, { resolve, appPid }: ConnectToAppOptions): Promise<AppConnection & { close(): Promise<void> }> {
  const messages: BusMessage[] = [];
  const listeners = new Set<(message: BusMessage) => void>();
  // Listening before claiming, so nothing addressed to the name can arrive unheard
  api.onMessage((message) => {
    messages.push(message);
    // A listener that matches removes itself, which a `Set` iterator allows for the entry at its cursor
    for (const listener of listeners) listener(message);
  });
  await api.claim(HOST.e2eConnection);

  /**
   * The first message after this call that `match` turns into a value, and a way to stop waiting for it. `cancel`
   * rejects the wait, which is what ends `answerWhileWorking`'s watch of the app rather than leaving it running.
   */
  const waitFor = <T>(what: string, match: (message: BusMessage) => T | undefined): { answer: Promise<T>; cancel(error: unknown): void } => {
    let cancel: (error: unknown) => void = () => {};
    const heard = new Promise<T>((resolveHeard, reject) => {
      if (api.failure !== null) {
        reject(new Error(`${what}: ${api.failure}`));
        return;
      }
      const stop = (): void => { listeners.delete(listener); stopFinished(); };
      const listener = (message: BusMessage): void => {
        const value = match(message);
        if (value === undefined) return;
        stop();
        resolveHeard(value);
      };
      const stopFinished = api.onFinished((reason) => { stop(); reject(new Error(`${what}: ${reason}`)); });
      cancel = (error) => { stop(); reject(error); };
      listeners.add(listener);
    });
    const answer = appPid === undefined ? heard : answerWhileWorking(heard, { work: fromNow(processWork(appPid)), what });
    return { answer, cancel: (error) => cancel(error) };
  };

  const send = (to: string, event: SystemEvent, settingsCredential: string | undefined, call?: string): Promise<void> =>
    api.send({ to, event, sender: HOST.e2eConnection, ...(call === undefined ? {} : { call }),
      ...(settingsCredential === undefined ? {} : { settingsCredential }) });

  return {
    name: HOST.e2eConnection,
    messages,
    send: (system, event, options) => send(resolve(system), event, options?.settingsCredential),
    ask: async (system, event, options) => {
      const to = resolve(system);
      const call = newCall();
      // Waiting before the send, so an answer that arrives before the send resolves is not missed
      const { answer, cancel } = waitFor(`${to}, asked ${event.type},`, (message) => (message.answering === call ? message.event : undefined));
      answer.catch(() => {});
      try {
        await send(to, event, options?.settingsCredential, call);
      } catch (error) {
        cancel(error);
        throw error;
      }
      return answer;
    },
    next: (match, what = 'the event this spec waited for') =>
      waitFor(what, (message) => (match(message.event) ? message.event : undefined)).answer,
    loadedPacks: () => api.loadedPacks(),
    openPackSettings: (runtime) => api.openPackSettings(runtime),
    reloadPack: (packId) => api.reloadPack(packId),
    close: () => api.close(),
  };
}
