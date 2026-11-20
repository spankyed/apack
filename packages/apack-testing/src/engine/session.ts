import type { SettingsTarget } from '@apackdev/sdk/types';
export type { SettingsTarget } from '@apackdev/sdk/types';
import { _callOf, newCall } from '@apackdev/sdk/events';
import { HOST } from '@apackdev/host/bus';
import type { BusMessage } from './api-client.ts';

/**
 * The verbs a drive session answers, over one already-open page. `packages/apack-testing/CLAUDE.md` says
 * why the engine exists at all.
 *
 * **Nothing here touches Playwright's or tRPC's types.** The page arrives as `SessionPage` and the bus as
 * `SessionApi`, so every verb is exercised in process against a fake — a session spec that had to launch
 * Electron would be an E2E test, where the subject here is the behaviour rather than the app.
 *
 * **Ending anything is not here.** `stop` drops this session's listener and nothing else: the page, the
 * connection and the app belong to whoever opened them, which is what lets a question be asked of an app
 * somebody else is holding. A session knows only how to do things to an app.
 */

/**
 * What every verb returns, and why a failure is a value rather than a throw.
 *
 * A verb is asked for an answer, so a throw tells the asker only that something went wrong and loses
 * which verb and why. `ok: false` with the message keeps the session usable: a bad query is an answer, and
 * the next verb can still be asked.
 */
export type EngineResult = { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly error: string };

/**
 * What a verb needs from a page — and the two kinds of evaluation are separate methods on purpose.
 *
 * Playwright reads a **string** as an expression and a **function** as something to serialise and call
 * with an argument; a string plus an argument silently drops the argument. One method taking either
 * would make that mistake available at every call site, so the port names which is which. The string
 * form is also what `/eval` needs: an expression goes through CDP, where a renderer CSP that forbids
 * `unsafe-eval` cannot reach it, which an in-page `new Function` would not survive.
 */
export interface SessionPage {
  /** Evaluate a source expression in the page; no argument, because a string form cannot receive one */
  evaluateExpression: (source: string) => Promise<unknown>;
  /** Evaluate a function in the page with one serialisable argument */
  evaluateWith: <A>(fn: (arg: A) => unknown, arg: A) => Promise<unknown>;
  exposeFunction: (name: string, callback: (payload: unknown) => void) => Promise<void>;
  screenshot: (name: string) => Promise<unknown>;
  /** Clicks what `selector` matches, waiting for it as Playwright's own click does */
  click: (selector: string) => Promise<unknown>;
  /** Replaces what `selector` matches with `text` */
  fill: (selector: string, text: string) => Promise<unknown>;
  /** A key, to `selector` when given and to the page otherwise */
  press: (key: string, selector?: string) => Promise<unknown>;
  /**
   * The page's accessibility tree, as text.
   *
   * What a screenshot is for a person, this is for an agent: readable, diffable, and costing no image
   * tokens. It is also the only one of the two that says what a thing *is* rather than where it is.
   */
  ariaSnapshot: () => Promise<string>;
  /**
   * Resizes what the app renders into.
   *
   * **A port method rather than `page.setViewportSize` at the call site**, because the right act depends on
   * whether anyone is looking at the window. Playwright's viewport is an emulation *inside* the real
   * window, so in a visible run it draws the app into a corner and leaves the desktop showing through the
   * rest — which is the defect `pinsViewport` (`src/launch-env.ts`) was written for, and which asking for a
   * viewport would otherwise reintroduce by hand. So a shown window is resized for real and a hidden one
   * gets the emulation, and the session says what it wants rather than how.
   *
   * Reading the size needs no method of its own: `window.innerWidth` is true whichever of the two happened.
   *
   * It answers with the size that was *taken*, which need not be the size asked for — a window has a minimum
   * and clamps to it.
   */
  setViewport: (width: number, height: number) => Promise<{ width: number; height: number }>;
  /**
   * Reloads the window and returns when it is usable again, onboarding included.
   *
   * It is the only thing that makes every surface re-read its data: a surface's state is what its system sent
   * it, so a write made outside that system — `/transact`, the database console, `apack db exec` — is invisible
   * to the view until something asks again. Navigating between surfaces does not, because the actor
   * survives; a new connection does, because the bus sends every system `CLIENT_CONNECTED` and each one
   * answers with its startup data.
   *
   * Returning *usable* rather than merely reloaded is what an implementation owes: the fixture dismisses
   * onboarding once, as the app launches, so a reloaded window comes back sitting in it.
   */
  reload: () => Promise<unknown>;
  /**
   * The fixture's own waits, which are what `/wait` is for.
   *
   * They come from the `AppDriver` rather than being rebuilt here: a `page.waitForFunction` over the
   * snapshot already exists, handles a dotted state path, and resolves on the state arriving. Without a
   * verb for them an agent has only `/state` to re-request in a loop, which is the polling this repo
   * avoids wherever something event-driven exists — and here it does.
   */
  waitForState: (check: string, timeoutMs?: number) => Promise<unknown>;
  waitForSurface: (surfaceId: string, timeoutMs?: number) => Promise<unknown>;
}

/**
 * What a verb needs from the app's API, kept as narrow as `SessionPage` so every verb stays testable in process
 * against a fake. `api-client.ts` is the real one.
 */
export interface SessionApi {
  send: (message: { to: string; event: Record<string, unknown>; sender?: string; call?: string }) => Promise<void>;
  /** Explicit trusted-tool settings transport. */
  sendSettings: SessionApi['send'];
  onMessage: (listener: (message: BusMessage) => void) => () => void;
  /** Told once, with why, when the channel finishes — which is what ends a round-trip at once rather than at its timeout */
  onFinished: (listener: (reason: string) => void) => () => void;
  /** Why the channel is finished, or null while it works */
  readonly failure: string | null;
}

/** What the session needs besides the page: its own connection, the fixture's diagnostics, and how to end */
export interface SessionDeps {
  readonly page: SessionPage;
  /** The drive session's own connection to the app's API, which is how the bus verbs travel */
  readonly api: SessionApi;
  /** Renderer errors the fixture collected, read and cleared — see `drainErrors` */
  readonly takeErrors: () => readonly string[];
  /**
   * The app's own log, as text.
   *
   * A function rather than the text, because a session outlives any one reading of it. Reading the file
   * is the caller's: the session takes ports, and `node:fs` in here would be the first of them to need a
   * real filesystem to test against.
   */
  readonly readLog: () => string;
}

/** A message the app emitted, as the in-page bridge or the session's own connection reports it */
export interface SeenEvent {
  readonly to?: string;
  readonly type: string;
  readonly event: Record<string, unknown>;
  /**
   * Who sent it, where the sender said — a feature's ref, or a participant's claimed name.
   *
   * Only the connection supplies this: the in-page bridge reads the renderer's xstate inspector, which sees an
   * event rather than an envelope, so a bridged event has none. It matters for the one case the bridge cannot
   * see at all — a message addressed to `host/drive`, which never reaches the renderer. Without it `/events`
   * tells an agent that something arrived for it and not who asked, which is enough to notice a question and
   * not enough to answer one.
   */
  readonly sender?: string;
  /**
   * The call this message answers, for an answer; absent for everything else.
   *
   * **Both channels supply it, from different places, which is why it is a field here rather than read at
   * the match.** The connection carries the envelope, so it is `Message.answering`; the in-page bridge sees
   * the *delivered event*, where a door has put the same value under the reserved key `_callOf` reads. One
   * field, so `nextReply` matches the same way whichever channel woke it.
   *
   * A broadcast answers nothing and so has none — which is what makes a broadcast uncorrelatable now, and
   * is said in the timeout message rather than left to be discovered.
   */
  readonly answering?: string;
}

/**
 * The name the in-page bridge calls, and the flag that stops it being installed twice.
 *
 * Exported so a spec asserts against the same string the page is given rather than a copy of it.
 */
export const BRIDGE_FUNCTION = '__driveEngineEmit';
export const BRIDGE_FLAG = '__driveEngineBridge';

/**
 * How many captured events the session holds before it starts dropping the oldest.
 *
 * The inspector sees every event in the app, not only replies, and an idle session still emits a steady
 * stream — so a buffer nobody drains grows for as long as the session is open. Dropping the oldest keeps the
 * ones an agent asking "what just happened" wants, and `dropped` says how many it missed.
 */
export const MAX_SEEN_EVENTS = 1_000;

/** How long a bus round-trip waits for its reply before answering that none came */
export const REPLY_TIMEOUT_MS = 15_000;

/** The system that runs query and transaction code against the live engine, and the events it answers with */
export const DATABASE_SYSTEM = 'default-setup/database';

/** The name the session claims, so a system can answer *it* rather than broadcasting to every window */
export const DRIVE_REF = HOST.drive;

/**
 * What a round-trip says when the channel is gone: the one cause a session can be certain of, so it is reported
 * as a fact rather than as one of the three guesses a plain timeout has to offer.
 */
const channelGone = (requestId: string, reason: string): Error =>
  new Error(`no answer for ${requestId}: ${reason}. The drive session's connection to the app is finished, so restart the session.`);

/**
 * What a refusal says, whichever shape the answering system uses.
 *
 * The database answers with one `error`; the settings store answers with `problems`, a list, because a
 * document can be wrong in several places at once. Both are the same thing to a caller — why it was refused —
 * so they are read here rather than at each call site.
 */
const refusalText = (event: Record<string, unknown>): string => {
  if (Array.isArray(event.problems)) return event.problems.join('; ');
  return String(event.error ?? 'the system reported an error');
};

/** The system that runs query and transaction code, and the one that owns the settings document */
const SETTINGS_SYSTEM = 'host/settings';

/**
 * Runs a verb and turns any throw into the failure half of `EngineResult`.
 *
 * The message is kept whole and prefixed with the verb: `Error.message` alone loses which verb failed
 * and, for a page evaluation, the in-page detail that says where.
 */
const attempt = async (what: string, run: () => Promise<unknown>): Promise<EngineResult> => {
  try {
    return { ok: true, value: await run() };
  } catch (error) {
    return { ok: false, error: `${what}: ${error instanceof Error ? error.message : String(error)}` };
  }
};

/**
 * Wraps an agent's expression so a result that cannot cross the process boundary is described instead.
 *
 * `page.evaluate` can only return a structured-cloneable value, which is why the fixture's `getState`
 * returns `snapshot.value` and never the snapshot: an XState snapshot carries actor references and
 * functions. Without this, asking for one gets an opaque Playwright failure. Attempting the clone in the
 * page keeps `/eval` total — every expression gets an answer — and leaves `JSON.stringify` in the body
 * as the way to ask for more.
 */
export const evalSource = (body: string): string => `(async () => {
  const value = await (async function () { ${body} }).call(window);
  try {
    structuredClone(value);
    return { cloneable: true, value };
  } catch {
    return {
      cloneable: false,
      described: Object.prototype.toString.call(value),
      keys: value && typeof value === 'object' ? Object.keys(value).slice(0, 40) : [],
    };
  }
})()`;

type Evaluated = { cloneable: true; value: unknown }
  | { cloneable: false; described: string; keys: readonly string[] };

/** What `wait` waits for: a dotted state path, or a surface arriving. Exactly one, never both */
export type WaitTarget = { readonly state: string } | { readonly surface: string };

export interface EngineSession {
  evaluate: (body: string) => Promise<EngineResult>;
  send: (event: Record<string, unknown>) => Promise<EngineResult>;
  system: (to: string, event: Record<string, unknown>) => Promise<EngineResult>;
  query: (code: string) => Promise<EngineResult>;
  transact: (code: string) => Promise<EngineResult>;
  state: () => Promise<EngineResult>;
  wait: (target: WaitTarget, timeoutMs?: number) => Promise<EngineResult>;
  navigate: (surfaceId: string) => Promise<EngineResult>;
  screenshot: (name: string) => Promise<EngineResult>;
  /** A surface's published state, or one dotted path into it */
  surface: (ref: string, path?: string) => Promise<EngineResult>;
  click: (selector: string) => Promise<EngineResult>;
  fill: (selector: string, text: string) => Promise<EngineResult>;
  press: (key: string, selector?: string) => Promise<EngineResult>;
  snapshot: () => Promise<EngineResult>;
  /** What the app is rendering into, in CSS pixels */
  viewport: () => Promise<EngineResult>;
  /** Resizes it — the real window where one is shown, the emulated viewport where none is */
  setViewport: (width: number, height: number) => Promise<EngineResult>;
  /** The settings as stored */
  settings: () => Promise<EngineResult>;
  /** Writes one setting relative to an explicit app, pack/group or feature owner. */
  setSetting: (target: SettingsTarget, path: string, value: unknown) => Promise<EngineResult>;
  /** The app's own log lines, newest last; fails when `since` names a line the log does not hold */
  logs: (options: { since?: string; source?: string }) => Promise<EngineResult>;
  /** Reloads the window and returns once it is connected again, with the in-page bridge back */
  reload: () => Promise<EngineResult>;
  drainEvents: () => EngineResult;
  drainDrops: () => Promise<EngineResult>;
  drainErrors: () => EngineResult;
  /** Installs the in-page bridge and listens on the connection; a caller awaits it before asking anything */
  ready: () => Promise<void>;
  /**
   * Drops the connection listener `ready` added. The page's exposed function and its flag survive, nothing
   * undoing an `exposeFunction` — the flag is what stops a second install. The client belongs to whoever
   * opened it.
   */
  stop: () => void;
}

export function createSession({ page, api, takeErrors, readLog }: SessionDeps): EngineSession {
  const seen: SeenEvent[] = [];
  let dropped = 0;
  /** A round-trip in flight: how it hears an answer, and how it is told none is coming */
  const waiting = new Set<{ receive: (event: SeenEvent) => void; fail: (reason: string) => void }>();
  /** Set by `ready`; dropped by `stop`, so a session leaves no listener on a client it does not own */
  let stopApi: (() => void) | undefined;
  let stopFinished: (() => void) | undefined;

  /**
   * Answers a waiting round-trip, from either channel.
   *
   * Iterated directly: a receiver that matches removes *itself*, and a `Set` iterator handles an entry
   * deleted at or before the cursor. Nothing adds a waiter here — a resolved round-trip arms its next one in a
   * later microtask — so there is no entry this loop could visit too early.
   */
  const wake = (event: SeenEvent): void => {
    for (const waiter of waiting) waiter.receive(event);
  };

  /** Puts an event in the buffer `/events` drains, oldest dropped past the cap */
  const record = (event: SeenEvent): void => {
    seen.push(event);
    if (seen.length > MAX_SEEN_EVENTS) {
      seen.shift();
      dropped += 1;
    }
  };

  /**
   * Sends to the window's root actor, which is all `/send` and `/navigate` each do.
   *
   * `/navigate` does not then wait for the surface to arrive, unlike `AppDriver.navigate`: a session has `/wait`
   * for that, and pairing them here would make the cheap verb pay for the slow one.
   */
  const sendToApp = (message: Record<string, unknown>): Promise<unknown> =>
    page.evaluateWith((event: Record<string, unknown>) => {
      (window as unknown as { applicationState: { send: (event: unknown) => void } })
        .applicationState.send(event);
      return null;
    }, message);

  /**
   * Waits for the answer to *this* ask, matched by the call the ask was sent under.
   *
   * Addressing says which connection an answer came to; only the call says which ask it answers, so three
   * concurrent `/query` calls can be told apart. An orphan matches nobody — an ask that timed out and then
   * finished, or an answer to someone querying in the Database surface while a session drives.
   *
   * The call is the envelope's, so this session asks and matches the way the app's own features do: nothing
   * in the app declares a correlation field, because every send mints a call and `reply` names the one it
   * answers.
   */
  const nextReply = (to: string, call: string, ok: string, bad: string, resultField = 'result'): Promise<unknown> =>
    new Promise((resolve, reject) => {
      // Already gone, so there is nothing to wait for and no reason to make the caller wait for the timeout
      if (api.failure !== null) {
        reject(channelGone(call, api.failure));
        return;
      }
      const waiter = {
        receive: (event: SeenEvent): void => {
          if (event.type !== ok && event.type !== bad) return;
          if (event.answering !== call) return;
          clearTimeout(timer);
          waiting.delete(waiter);
          if (event.type === bad) reject(new Error(refusalText(event.event)));
          else resolve(event.event[resultField]);
        },
        /** The channel finished while this was in flight: say so now rather than in fifteen seconds */
        fail: (reason: string): void => {
          clearTimeout(timer);
          waiting.delete(waiter);
          reject(channelGone(call, reason));
        },
      };
      const timer = setTimeout(() => {
        waiting.delete(waiter);
        // The fallback for a session whose `ready` never ran, so nothing is listening for the finish. The
        // server awaits `ready` before it serves a verb, so this is reachable only from a test driving the
        // session directly — remove `ready`'s `onFinished` subscription and every dead-channel case comes here
        if (api.failure !== null) {
          reject(channelGone(call, api.failure));
          return;
        }
        reject(new Error(`no ${ok} or ${bad} answering ${call} within ${REPLY_TIMEOUT_MS}ms. `
          + `Either it is still running, or nothing provides ${to}, or that system answered with a `
          + `broadcast rather than a reply — which an app built before ${DRIVE_REF} existed does. A broadcast `
          + 'answers no call at all, so it cannot be matched here however it is delivered, and GET /events '
          + 'would show the answer arriving unaddressed.'));
      }, REPLY_TIMEOUT_MS);
      waiting.add(waiter);
    });

  /**
   * A send to a system, over the session's own connection rather than through the page.
   *
   * `sender` is the load-bearing field: the bus turns it into the delivery's `replyTo`, which is the only thing
   * that lets the system's `reply` come back here instead of to every window. Going direct is also why a send
   * to an unknown system comes back as a refusal rather than being dropped silently in the renderer, and why
   * `/query` works while the window's own subscription is broken.
   */
  const sendToSystem = (to: string, event: Record<string, unknown>, call?: string): Promise<unknown> =>
    api.send({ to, event, sender: DRIVE_REF, ...(call === undefined ? {} : { call }) }).then(() => null);

  /**
   * Asks a system something and waits for the answer it addresses back, matched by the call it asked under.
   *
   * Taking the system and the event rather than a kind, because the database is no longer the only thing that
   * answers: the settings system replies to whoever asked for a write, and `/set-setting` reporting success for
   * a refused write was the whole reason it had to.
   *
   * **The call goes on the envelope, not into the event**, which is what lets this ask *any* system rather
   * than only one that declares a correlation field: the envelope's call needs nothing of the receiver,
   * because `reply` echoes whatever it was entered under.
   */
  const roundTrip = async (
    to: string,
    event: Record<string, unknown>,
    ok: string,
    bad: string,
    resultField = 'result',
    send: SessionApi['send'] = api.send,
  ): Promise<unknown> => {
    // Minted here, by the asker: an answer can only name an ask if the ask named itself first
    const call = newCall();
    // Armed before the send, so an answer that arrives immediately is not missed
    const answer = nextReply(to, call, ok, bad, resultField);
    // A send that never left means no answer is coming, and the armed waiter is abandoned — handled here so
    // its rejection is not an unhandled one when the timer finally fires
    answer.catch(() => {});
    await send({ to, event, sender: DRIVE_REF, call });
    return answer;
  };

  /** What the database answers with, which is the one round-trip shape used twice */
  const runCode = (kind: 'query' | 'transact', type: string, code: string): Promise<unknown> =>
    roundTrip(DATABASE_SYSTEM, { type, code },
      kind === 'query' ? 'QUERY_RESULT' : 'TRANSACTION_RESULT',
      kind === 'query' ? 'QUERY_ERROR' : 'TRANSACTION_ERROR');

  /**
   * Hooks the app's actor inspection up to `BRIDGE_FUNCTION`, which is a callback into this process rather
   * than a buffer the engine reads back: a reply has to wake the request waiting for it.
   *
   * Idempotent through a flag on `window`, and called again after a reload, where a fresh document has
   * dropped both the hook and the flag.
   *
   * **The hook outlives the session that installed it**: nothing in the page can be told a session ended, so
   * after one exits the hook keeps calling a function no process serves, and the next session to attach is
   * handed those calls before its own `exposeFunction` lands — Playwright refuses each, as a rejected promise.
   * In the app's window an unhandled rejection is fatal (its error page), so every call is settled here: an
   * event no session is listening for is one nobody asked about.
   */
  const installBridge = () => page.evaluateExpression(`(() => {
    const win = window;
    if (win.${BRIDGE_FLAG}) return null;
    win.${BRIDGE_FLAG} = true;
    const emit = (payload) => {
      try {
        win.${BRIDGE_FUNCTION}?.(payload)?.catch?.(() => {});
      } catch {
        // The function is absent, or threw before answering: the same event nobody is listening for
      }
    };
    win.applicationState?.system?.inspect?.((inspection) => {
      if (inspection?.type !== '@xstate.event') return;
      const event = inspection.event;
      if (!event || typeof event.type !== 'string') return;
      const to = inspection.actorRef?.id;
      let copy;
      try {
        copy = JSON.parse(JSON.stringify(event));
      } catch {
        // An event that will not serialise still happened, and that it did is worth reporting
        copy = {};
      }
      emit({ to, type: event.type, event: copy });
    });
    return null;
  })()`);

  return {
    ready: async () => {
      /**
       * The session's own connection, where an addressed answer arrives.
       *
       * **Waiters hear both channels on purpose.** An answer reaches `DRIVE_REF` from an app whose system
       * answers with `reply`; the page bridge is the only path to one delivered to a surface in the window.
       * The call check makes the double delivery harmless: the first match removes the receiver and the
       * second matches nobody.
       *
       * Only what the inspector cannot see is recorded, so `/events` keeps its meaning — a message addressed to
       * `DRIVE_REF` never reaches the renderer, while a broadcast reaches both and would be counted twice.
       */
      /**
       * A finished channel ends every round-trip waiting on it, at once.
       *
       * Without this each one sat until `REPLY_TIMEOUT_MS` and then reported the same sentence fifteen seconds
       * late — the state was observable only by asking, so the session discovered it on the next verb rather
       * than being told. Iterated directly, for `wake`'s reason: a waiter removes *itself*, and a `Set`
       * iterator handles an entry deleted at or before the cursor.
       */
      stopFinished = api.onFinished((reason) => {
        for (const waiter of waiting) waiter.fail(reason);
      });

      stopApi = api.onMessage((message) => {
        const event: SeenEvent = {
          to: message.to,
          type: message.event.type,
          event: message.event,
          ...(message.sender === undefined ? {} : { sender: message.sender }),
          // Off the envelope: this channel has it, where the bridge has to read the delivered event
          ...(message.answering === undefined ? {} : { answering: message.answering }),
        };
        wake(event);
        if (message.to === DRIVE_REF) record(event);
      });

      await page.exposeFunction(BRIDGE_FUNCTION, (payload) => {
        const seen = payload as SeenEvent;
        // The bridge reads the renderer's xstate inspector, which sees an event and not an envelope — so the
        // call comes off the delivered event, where the window's delivery door put it. Read here rather than
        // at the match, so `nextReply` has one field to compare whichever channel woke it
        const answering = seen.answering ?? _callOf(seen.event);
        const event: SeenEvent = { ...seen, ...(answering === undefined ? {} : { answering }) };
        record(event);
        // A waiter is woken either way: an answer must not be lost because the buffer was full
        wake(event);
      });
      /**
       * The bridge is a callback into this process, not a buffer the engine reads back.
       *
       * The fixture's dropped-send collector pushes to `window.__droppedSends` and is read once at the
       * end, which suits a check and not a session: a reply has to wake the request waiting for it.
       * `exposeFunction` gives the page a direct line here, so a round-trip resolves on the event rather
       * than on anything asking repeatedly whether it has arrived.
       */
      await installBridge();
    },

    reload: () => attempt('reload', async () => {
      // The port returns when the window is usable again, so there is nothing to wait for here
      await page.reload();
      // A fresh document dropped the inspector and the flag that guards it; `exposeFunction` survives
      await installBridge();
      return null;
    }),

    evaluate: (body) => attempt('eval', async () => {
      const result = await page.evaluateExpression(evalSource(body)) as Evaluated;
      if (result.cloneable) return result.value;
      throw new Error(`the result is not serialisable (${result.described}`
        + `${result.keys.length > 0 ? `, keys: ${result.keys.join(', ')}` : ''})`
        + ' — return JSON.stringify(...) or a projection of it instead');
    }),

    send: (event) => attempt('send', () => sendToApp(event)),

    // No call: this is the fire-and-forget verb, so nothing here waits for an answer and there is nothing to
    // match one against. A system that replies to it answers a call nobody is holding, which the bus drops
    system: (to, event) => attempt('system', () => sendToSystem(to, event)),

    query: (code) => attempt('query', () => runCode('query', 'EXECUTE_QUERY', code)),
    transact: (code) => attempt('transact', () => runCode('transact', 'EXECUTE_TRANSACTION', code)),

    state: () => attempt('state', () => page.evaluateExpression(`(() => {
      const snap = window.applicationState?.getSnapshot();
      return {
        value: snap?.value,
        surface: snap?.context?.activeSurface?.id ?? '',
        surfaces: (snap?.context?.surfaces ?? []).map((p) => p.id),
      };
    })()`)),

    /** The fixture's wait, so a reply arrives when the state does rather than when something asks again */
    wait: (target, timeoutMs) => attempt('wait', async () => {
      if ('state' in target) await page.waitForState(target.state, timeoutMs);
      else await page.waitForSurface(target.surface, timeoutMs);
      return target;
    }),

    navigate: (surfaceId) => attempt('navigate', () => sendToApp({ type: 'SELECT_SURFACE', surface: surfaceId })),

    /**
     * A surface's published state, which is what a view is actually showing.
     *
     * Over `evaluateExpression` rather than a port method of its own: the shell already holds every
     * running surface's actor, so this is a read of the page and not a new capability. Before it existed
     * the same expression was written out by hand at every call site, which is four chances to get the
     * ref or the optional chain wrong.
     */
    surface: (ref, at) => attempt('surface', () => page.evaluateExpression(`(() => {
      const surface = window.applicationState?.getSnapshot().children?.[${JSON.stringify(ref)}];
      if (!surface) return { running: false };
      const context = surface.getSnapshot().context ?? {};
      const at = ${JSON.stringify(at ?? '')};
      // No path asked for: the whole context, which is what a surface publishes
      if (!at) return { running: true, state: context };
      const value = at.split('.').reduce((held, key) => (held == null ? held : held[key]), context);
      return { running: true, state: value ?? null };
    })()`)),

    click: (selector) => attempt('click', async () => { await page.click(selector); return selector; }),
    fill: (selector, text) => attempt('fill', async () => { await page.fill(selector, text); return selector; }),
    press: (key, selector) => attempt('press', async () => { await page.press(key, selector); return key; }),
    snapshot: () => attempt('snapshot', () => page.ariaSnapshot()),

    /**
     * What the app is rendering into, asked of the window rather than of Playwright.
     *
     * `page.viewportSize()` answers `null` until something has set one, and a resized *window* never moves
     * it at all — so it reports the emulation and not the app. `window.innerWidth` is the size the layout
     * actually has, which is the question.
     */
    viewport: () => attempt('viewport', () => page.evaluateExpression(
      '({ width: window.innerWidth, height: window.innerHeight })',
    )),

    /**
     * Answers with the size that was taken, not the size that was asked for.
     *
     * It echoed its argument at first, on the reasoning that measuring after a real window moved would
     * sometimes read the size before it. That race could not be reproduced — 12 set-then-read cycles, none
     * stale — and the echo is wrong in a case that does occur: the main window has a 900x600 minimum, so
     * `/set-viewport {400,300}` answered `{400,300}` while the window sat at `{900,600}`. The port asks
     * whoever applied the size what it became, which costs no extra round trip either way.
     */
    setViewport: (width, height) => attempt('setViewport', () => page.setViewport(width, height)),

    /** The host snapshot includes effective values, lifecycle status and declaration metadata. */
    settings: () => attempt('settings', () => roundTrip(SETTINGS_SYSTEM, { type: 'GET_SETTINGS' },
      'SETTINGS_LOADED', 'SETTINGS_REFUSED', 'snapshot')),

    /** Waits for the host writer's saved/refused answer, rather than merely accepting the send. */
    setSetting: (target, at, value) => attempt('setSetting', () => roundTrip(
      SETTINGS_SYSTEM,
      {
        type: 'UPDATE_SETTINGS',
        target,
        path: at.split('.'),
        value,
      },
      'SETTINGS_SAVED',
      'SETTINGS_REFUSED',
      'result',
      api.sendSettings,
    )),

    logs: ({ since, source }) => attempt('logs', async () => {
      const lines = readLog().split('\n').filter(Boolean);
      const at = since === undefined ? -1 : lines.findIndex((line) => line.includes(since));
      // A marker nobody can find is a failure, not an empty filter: answering with the whole log would be
      // read as "everything here is new", which is the same bytes as a right answer and a wrong meaning
      if (since !== undefined && at === -1) {
        throw new Error(`no line contains ${JSON.stringify(since)}, so there is nothing to answer "since"`);
      }
      const after = lines.slice(at + 1);
      return source === undefined ? after : after.filter((line) => line.includes(source));
    }),

    screenshot: (name) => attempt('screenshot', async () => {
      await page.screenshot(name);
      return name;
    }),

    /**
     * Read and cleared, so each call answers "since you last asked" rather than "since the session began".
     *
     * `dropped` rather than a bare array: a session the agent has not asked in a while has lost its
     * oldest events, and a reader comparing counts needs to know that happened.
     */
    drainEvents: () => {
      const value = { events: seen.splice(0, seen.length), dropped };
      dropped = 0;
      return { ok: true, value };
    },

    /**
     * The dropped sends, read **and cleared**, which is what lets a long session end cleanly.
     *
     * The fixture reads `window.__droppedSends` after the drive body and throws if it is not empty — a
     * check written for a test, where a drop should fail the thing that caused it. A session running for
     * an hour would collect every drop and fail at the very end, naming them all and blaming the
     * session. Clearing here hands them to whoever asked instead.
     */
    drainDrops: () => attempt('drops', () => page.evaluateExpression(`(() => {
      const win = window;
      const dropped = win.__droppedSends ?? [];
      win.__droppedSends = [];
      return dropped;
    })()`)),

    /** The same bargain as `drainDrops`, for the renderer errors the fixture accumulates without bound */
    drainErrors: () => ({ ok: true, value: takeErrors() }),

    stop: () => {
      stopApi?.();
      stopFinished?.();
      stopApi = undefined;
      stopFinished = undefined;
    },
  };
}
