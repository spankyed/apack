// The protocol a live drive session speaks, against a fake page. What is checked here is that every verb
// answers rather than throws, and that the two things the real app would make expensive to discover —
// a result that cannot cross the process boundary, and two bus round-trips sharing an answer that names
// neither — are handled before anything launches Electron.
//
// The correlation is the envelope's call: an ask carries `Message.call` and its answer `Message.answering`,
// so `answer` names the call it answers and the bridge path builds the same thing with `answerTo`, which is
// what a window's delivery door puts on the event. Nothing is in the event itself, which is why these cases
// read the call off the send rather than out of a payload.
import { describe, expect, it, vi } from 'vitest';
import {
  BRIDGE_FLAG, BRIDGE_FUNCTION, createSession, DATABASE_SYSTEM, DRIVE_REF, evalSource, MAX_SEEN_EVENTS,
  REPLY_TIMEOUT_MS, type EngineResult, type SeenEvent, type SessionApi, type SessionPage,
} from '../../src/engine/session.ts';
import type { BusMessage } from '../../src/engine/api-client.ts';
import type { EngineSession, SettingsTarget } from '../../src/engine/session.ts';
import { asSessionPage } from '../../src/engine/index.ts';
import type { Page } from '@playwright/test';
import { answerTo } from '@apackdev/sdk/testing';

/** A page that records what it was asked and lets a test answer for it, plus the bridge's own callback */
function fakePage() {
  let emit: ((payload: unknown) => void) | undefined;
  let reloaded = false;
  /** What the page was asked to do, in order, so a verb's effect is what the assertions see */
  const acted: string[] = [];
  const expressions: string[] = [];
  const evaluateExpression = vi.fn(async (source: string): Promise<unknown> => {
    expressions.push(source);
    return null;
  });
  const evaluateWith = vi.fn(async (fn: (arg: never) => unknown, arg: unknown): Promise<unknown> => {
    void fn;
    void arg;
    return null;
  });
  const page: SessionPage = {
    evaluateExpression,
    evaluateWith: evaluateWith as SessionPage['evaluateWith'],
    exposeFunction: vi.fn(async (name: string, callback: (payload: unknown) => void) => {
      expect(name, 'the page is given the exported name, not a copy of it').toBe(BRIDGE_FUNCTION);
      emit = callback;
    }),
    screenshot: vi.fn(async () => Buffer.from('')),
    click: vi.fn(async (selector: string) => { acted.push(`click ${selector}`); }),
    fill: vi.fn(async (selector: string, text: string) => { acted.push(`fill ${selector}=${text}`); }),
    press: vi.fn(async (key: string, selector?: string) => { acted.push(`press ${key}${selector ? ` @${selector}` : ''}`); }),
    ariaSnapshot: vi.fn(async () => '- button "Send"'),
    // Clamps to 900x600 as the real window does, so what the session answers with is visibly not its argument
    setViewport: vi.fn(async (width: number, height: number) => {
      acted.push(`viewport ${width}x${height}`);
      return { width: Math.max(width, 900), height: Math.max(height, 600) };
    }),
    // A real reload drops the page's globals; the flag the bridge guards itself with goes with them
    reload: vi.fn(async () => { reloaded = true; return undefined; }),
    waitForState: vi.fn(async () => undefined),
    waitForSurface: vi.fn(async () => undefined),
  };
  return {
    page, expressions, evaluateExpression, evaluateWith, acted,
    reload: page.reload as ReturnType<typeof vi.fn>,
    didReload: () => reloaded,
    waitForState: page.waitForState as ReturnType<typeof vi.fn>,
    waitForSurface: page.waitForSurface as ReturnType<typeof vi.fn>,
    emit: (event: SeenEvent) => emit?.(event),
  };
}

/**
 * A connection that records what it was asked to send and lets a test answer for it.
 *
 * The bus verbs travel over this now rather than through the page, so this is where a round-trip's send is
 * asserted and where its reply comes from. `finish` sets `failure` *and* tells the listeners, as the real
 * client does — the point of `onFinished` being that the state is announced rather than only readable.
 */
function fakeApi() {
  let deliver: ((message: BusMessage) => void) | undefined;
  const finishListeners = new Set<(reason: string) => void>();
  const send = vi.fn(async (_message: { to: string; event: Record<string, unknown>; sender?: string }) => {});
  let failure: string | null = null;
  const api: SessionApi = {
    send,
    sendSettings: vi.fn(async message => send(message)),
    onMessage: (listener) => { deliver = listener; return () => { deliver = undefined; }; },
    onFinished: (listener) => { finishListeners.add(listener); return () => finishListeners.delete(listener); },
    get failure() { return failure; },
  };
  return {
    api,
    send,
    /** The channel finishing, as the client reports it: the state, then everyone who asked to be told */
    finish: (reason: string) => {
      failure = reason;
      for (const listener of finishListeners) listener(reason);
    },
    /** Only the state, for the case about a round-trip armed after the channel had already gone */
    fail: (reason: string) => { failure = reason; },
    /**
     * What the app answered on the session's own connection.
     *
     * `answering` is the call it answers, which is what `reply` stamps and what the session matches on — so a
     * case that wants its answer taken passes the call its ask was sent under, and one that wants an orphan
     * passes another or none. It is on the envelope, never in the event.
     */
    answer: (
      event: Record<string, unknown> & { type: string },
      { answering, to = DRIVE_REF }: { answering?: string; to?: string } = {},
    ) => deliver?.({ to, event, sender: DATABASE_SYSTEM, ...(answering === undefined ? {} : { answering }) }),
  };
}

const sessionWith = (overrides: Partial<SessionPage> = {}) => {
  const fake = fakePage();
  const client = fakeApi();
  const errors = ['renderer blew up'];
  const log = [
    '[api] boot',
    '[brain] started a flow',
    '[api] a thing happened',
  ].join('\n');
  const session = createSession({
    page: { ...fake.page, ...overrides },
    api: client.api,
    takeErrors: () => errors.splice(0, errors.length),
    readLog: () => log,
  });
  return { ...fake, ...client, session };
};

/**
 * The envelope the connection was last asked to send, or a failure that says nothing was sent.
 *
 * Reading straight off `calls.at(-1)?.[0]` throws an opaque `TypeError` when no send happened, which is the
 * likeliest thing to go wrong in a test about sends — so it is named here instead.
 */
const lastSend = (calls: { mock: { calls: unknown[][] } }): { to: string; event: Record<string, unknown>; sender?: string; call?: string } => {
  const sent = calls.mock.calls.at(-1);
  if (sent === undefined) throw new Error('nothing was sent over the connection');
  return sent[0] as { to: string; event: Record<string, unknown>; sender?: string; call?: string };
};

/** The call the last send was made under, which an answer to it has to name */
const sentCall = (calls: { mock: { calls: unknown[][] } }): string => {
  const { call } = lastSend(calls);
  if (call === undefined) throw new Error('the last send carried no call, so nothing could answer it');
  return call;
};

/** Lets the microtasks a verb queues run, without waiting on any real timer */
const settle = () => new Promise((resolve) => setImmediate(resolve));

/** `drainEvents` answers with the batch and what it had to drop */
const drained = (result: { ok: boolean; value?: unknown }) =>
  (result as { value: { events: SeenEvent[]; dropped: number } }).value;

describe('a verb always answers', () => {
  it('reports a value as ok', async () => {
    const { session } = sessionWith({ evaluateExpression: async () => ({ cloneable: true, value: 7 }) });
    await expect(session.evaluate('return 7')).resolves.toEqual({ ok: true, value: 7 });
  });

  /**
   * A throw would be a 500 and the agent would learn only that something went wrong. The verb's name is
   * in the message because a bare `Error.message` does not say which call produced it.
   */
  it('reports a throw as ok false, naming the verb', async () => {
    const { session } = sessionWith({
      evaluateExpression: async () => { throw new Error('page is gone'); },
    });
    const result = await session.evaluate('return 1');

    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ error: 'eval: page is gone' });
  });

  it('reports a non-Error throw too, rather than losing it', async () => {
    const { session } = sessionWith({
      evaluateExpression: async () => { throw 'just a string'; },
    });
    await expect(session.evaluate('return 1')).resolves.toEqual({ ok: false, error: 'eval: just a string' });
  });
});

/**
 * The case that would otherwise cost an agent a confusing Playwright failure.
 *
 * `page.evaluate` returns only structured-cloneable values, and the first thing anyone asks for is the
 * state machine — which carries actor refs and functions. The clone is attempted in the page so the
 * answer is a description and an instruction, not a dropped request.
 */
describe('a result that cannot cross the boundary', () => {
  it('is described, with the keys and what to do instead', async () => {
    const { session } = sessionWith({
      evaluateExpression: async () => ({
        cloneable: false, described: '[object Object]', keys: ['send', 'getSnapshot'],
      }),
    });
    const result = await session.evaluate('return window.applicationState');

    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ error: expect.stringContaining('not serialisable') });
    expect(result).toMatchObject({ error: expect.stringContaining('send, getSnapshot') });
    expect(result, 'and says how to ask for it').toMatchObject({
      error: expect.stringContaining('JSON.stringify'),
    });
  });

  it('leaves out the key list when there is none', async () => {
    const { session } = sessionWith({
      evaluateExpression: async () => ({ cloneable: false, described: '[object Function]', keys: [] }),
    });
    const result = await session.evaluate('return () => 1');

    expect(result).toMatchObject({ error: expect.stringContaining('[object Function])') });
    expect(result).not.toMatchObject({ error: expect.stringContaining('keys:') });
  });

  it('wraps the body as a call rather than splicing it into an expression', () => {
    // The body is a function body — `return` has to be legal in it, which an expression wrapper breaks
    expect(evalSource('return 1')).toContain('return 1');
    expect(evalSource('return 1')).toContain('structuredClone');
  });
});

describe('the in-page bridge', () => {
  it('installs the collector behind a flag, so a reconnect does not double it', async () => {
    const { session, expressions } = sessionWith();
    await session.ready();

    const installed = expressions.find((source) => source.includes(BRIDGE_FLAG));
    expect(installed, 'the flag guards the install').toContain(`if (win.${BRIDGE_FLAG}) return null;`);
    expect(installed).toContain(BRIDGE_FUNCTION);
  });

  it('collects what the page emits, and a drain empties it', async () => {
    const { session, emit } = sessionWith();
    await session.ready();

    emit({ type: 'QUERY_RESULT', event: { result: 1 } });
    emit({ type: 'SOMETHING_ELSE', event: {} });

    expect(drained(session.drainEvents()).events.map((e) => e.type))
      .toEqual(['QUERY_RESULT', 'SOMETHING_ELSE']);
    expect(drained(session.drainEvents()).events, 'read and cleared').toEqual([]);
  });

  /**
   * The inspector sees all of the app's traffic, not only replies, so a session nobody drains would
   * grow for as long as it is open. The oldest go, and the count of them is reported.
   */
  it('caps the buffer, keeps the newest and says how many it dropped', async () => {
    const { session, emit } = sessionWith();
    await session.ready();

    for (let n = 0; n < MAX_SEEN_EVENTS + 5; n += 1) emit({ type: `E${n}`, event: {} });
    const first = drained(session.drainEvents());

    expect(first.events).toHaveLength(MAX_SEEN_EVENTS);
    expect(first.events[0]?.type, 'the oldest five went').toBe('E5');
    expect(first.events.at(-1)?.type, 'the newest stayed').toBe(`E${MAX_SEEN_EVENTS + 4}`);
    expect(first.dropped).toBe(5);
    expect(drained(session.drainEvents()).dropped, 'the count resets with the read').toBe(0);
  });

  /**
   * The hook stays in the page after its session exits, and the next session to attach is handed its calls
   * before its own function is exposed: Playwright refuses each with a rejected promise, which in the app's
   * window is fatal. The installed source runs here over a window of its own, whose function refuses, throws
   * or is not there, and whatever the page's runtime would see as unhandled is caught.
   */
  it('settles every call the page makes, so one no session serves is not an unhandled rejection', async () => {
    const { session, expressions } = sessionWith();
    await session.ready();
    const installed = expressions.find((source) => source.includes(BRIDGE_FLAG))!;
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
    process.on('unhandledRejection', onUnhandled);
    try {
      for (const bridge of [
        () => Promise.reject(new Error(`Function "${BRIDGE_FUNCTION}" is not exposed`)),
        () => { throw new Error('threw before answering'); },
        undefined,
      ]) {
        let inspect: ((inspection: unknown) => void) | undefined;
        const win: Record<string, unknown> = {
          [BRIDGE_FUNCTION]: bridge,
          applicationState: { system: { inspect: (observer: typeof inspect) => { inspect = observer; } } },
        };
        new Function('window', `return ${installed}`)(win);
        const circular: Record<string, unknown> = { type: 'CIRCULAR' };
        circular.self = circular;
        expect(() => {
          inspect!({ type: '@xstate.event', event: { type: 'PING' }, actorRef: { id: 'x' } });
          inspect!({ type: '@xstate.event', event: circular, actorRef: { id: 'x' } });
        }).not.toThrow();
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('hands the page every event, one that will not serialise as an empty one', async () => {
    const { session, expressions } = sessionWith();
    await session.ready();
    const installed = expressions.find((source) => source.includes(BRIDGE_FLAG))!;
    const delivered: unknown[] = [];
    let inspect: ((inspection: unknown) => void) | undefined;
    const win = {
      [BRIDGE_FUNCTION]: async (payload: unknown) => { delivered.push(payload); },
      applicationState: { system: { inspect: (observer: typeof inspect) => { inspect = observer; } } },
    };
    new Function('window', `return ${installed}`)(win);
    const circular: Record<string, unknown> = { type: 'CIRCULAR' };
    circular.self = circular;
    inspect!({ type: '@xstate.event', event: { type: 'PING', n: 1 }, actorRef: { id: 'a' } });
    inspect!({ type: '@xstate.event', event: circular, actorRef: { id: 'b' } });
    inspect!({ type: '@xstate.snapshot', event: { type: 'IGNORED' } });

    expect(delivered).toEqual([
      { to: 'a', type: 'PING', event: { type: 'PING', n: 1 } },
      { to: 'b', type: 'CIRCULAR', event: {} },
    ]);
  });

  it('still wakes a waiter when the buffer is full', async () => {
    const { session, emit, send } = sessionWith();
    await session.ready();

    for (let n = 0; n < MAX_SEEN_EVENTS; n += 1) emit({ type: `E${n}`, event: {} });
    const pending = session.query('return 1');
    await settle();
    // Through the bridge, so the call is on the delivered event where a window's door put it — `answerTo`
    // builds exactly that, which is why the session reads both places into one field
    emit({ type: 'QUERY_RESULT', event: answerTo(sentCall(send), { type: 'QUERY_RESULT', result: 'through a full buffer' }) });

    await expect(pending).resolves.toEqual({ ok: true, value: 'through a full buffer' });
  });
});

/**
 * `/query` and `/transact` go to the system that already runs code against the live engine, and each reply names
 * the request it answers — so the engine takes its own and leaves everything else alone.
 *
 * It used to run one round-trip at a time instead, because the reply named nothing and the next one of
 * the right type therefore had to be this request's. That held only while nothing was abandoned, which
 * is the case the last two tests here are about.
 */
/**
 * Reloading is the one thing that makes a surface re-read its data, so the verb has to leave the session
 * usable. The port returns when the window is usable again — waiting, and dismissing the onboarding a
 * reload brings back, belong to the implementation that knows Playwright. What is left here is the half
 * the session owns: a reload that forgot the bridge would leave `/events` and every round-trip deaf for
 * the rest of the session, over a document that no longer carries the hook.
 */
describe('reload', () => {
  it('reloads and puts the bridge back over the fresh document', async () => {
    const { session, didReload, expressions } = sessionWith();
    await session.ready();
    const before = expressions.filter((source) => source.includes(BRIDGE_FLAG)).length;

    const result = await session.reload();

    expect(result.ok).toBe(true);
    expect(didReload(), 'the page was reloaded').toBe(true);
    expect(
      expressions.filter((source) => source.includes(BRIDGE_FLAG)).length,
      'the bridge is installed again over the fresh document',
    ).toBe(before + 1);
  });

  it('answers rather than throwing when the page will not come back', async () => {
    const { session } = sessionWith({ reload: async () => { throw new Error('window is gone'); } });
    await session.ready();

    expect(await session.reload()).toEqual({ ok: false, error: 'reload: window is gone' });
  });
});

/**
 * The verbs that were missing, and why each one is a verb rather than something to spell out with `/eval`.
 *
 * Driving used to mean sending bus events and evaluating expressions — there was no way to press a button
 * a user presses, and reading what a view held took a hand-written expression that the session adding
 * these wrote out four times for one question.
 */
describe('reading and using the page', () => {
  it("answers with a surface's published state, and says when it is not running", async () => {
    const { session } = sessionWith({
      evaluateExpression: async () => ({ running: true, state: { notes: ['welcome'] } }),
    });

    expect(await session.surface('default-setup/notes')).toEqual({ ok: true, value: { running: true, state: { notes: ['welcome'] } } });
  });

  it('reads one path into that state when asked for one', async () => {
    const { session, expressions } = sessionWith();
    await session.surface('default-setup/notes', 'notes.length');

    const read = expressions.at(-1)!;
    expect(read, 'the ref is quoted into the expression rather than interpolated raw').toContain('"default-setup/notes"');
    expect(read).toContain('"notes.length"');
  });

  it('clicks, fills and presses', async () => {
    const { session, acted } = sessionWith();

    await session.click('button.send');
    await session.fill('input.title', 'a note');
    await session.press('Enter');
    await session.press('Escape', 'input.title');

    expect(acted).toEqual(['click button.send', 'fill input.title=a note', 'press Enter', 'press Escape @input.title']);
  });

  it('answers with the page as a tree rather than a picture', async () => {
    const { session } = sessionWith();

    expect(await session.snapshot()).toEqual({ ok: true, value: '- button "Send"' });
  });

  it('answers a verb that throws with the failure, rather than throwing', async () => {
    const { session } = sessionWith({ click: async () => { throw new Error('no such element'); } });

    expect(await session.click('button.missing')).toEqual({ ok: false, error: 'click: no such element' });
  });
});

describe('settings', () => {
  it('reads effective values and catalog metadata from the host settings snapshot', async () => {
    const { session, send, answer } = sessionWith();
    await session.ready();

    const reading = session.settings();
    await settle();
    expect(lastSend(send)).toMatchObject({ to: 'host/settings', event: { type: 'GET_SETTINGS' } });
    const snapshot = { runId: 'run', revision: 1, values: { app: { personal: { name: 'Ada' } } }, catalog: { revision: 2 } };
    answer({ type: 'SETTINGS_LOADED', snapshot }, { answering: sentCall(send) });

    await expect(reading).resolves.toEqual({ ok: true, value: snapshot });
  });

  /** Writes the setting, then answers it, which is the round trip a caller is told the outcome of */
  const write = async (
    session: EngineSession,
    send: { mock: { calls: unknown[][] } },
    answer: (event: Record<string, unknown> & { type: string }, options?: { answering?: string }) => void,
    target: SettingsTarget,
    reply: Record<string, unknown> & { type: string },
  ) => {
    const writing = session.setSetting(target, 'personal.name', 'Ada');
    await settle();
    const sent = lastSend(send);
    answer(reply, { answering: sentCall(send) });
    return { sent, result: await writing };
  };

  it("writes one of a feature's settings, by the ref they are keyed under", async () => {
    const { session, send, answer, api } = sessionWith();
    await session.ready();

    const { sent, result } = await write(session, send, answer, { kind: 'feature', featureRef: 'default-setup/code' }, { type: 'SETTINGS_SAVED' });

    expect(sent).toMatchObject({
      to: 'host/settings',
      event: { type: 'UPDATE_SETTINGS', target: { kind: 'feature', featureRef: 'default-setup/code' }, path: ['personal', 'name'], value: 'Ada' },
    });
    expect(api.sendSettings).toHaveBeenCalledOnce();
    expect(result).toEqual({ ok: true, value: undefined });
  });

  it.each([
    { kind: 'app' },
    { kind: 'pack', packId: 'default-setup', groupId: 'assistant' },
  ] as const)('writes settings relative to $kind ownership', async (target) => {
    const { session, send, answer } = sessionWith();
    await session.ready();
    const { sent } = await write(session, send, answer, target, { type: 'SETTINGS_SAVED' });
    expect(sent).toMatchObject({
      to: 'host/settings',
      event: { type: 'UPDATE_SETTINGS', target, path: ['personal', 'name'], value: 'Ada' },
    });
  });

  /**
   * The defect this round trip exists for. It resolved on the send being accepted, so a write the store
   * refused answered `ok: true` and wrote nothing — and the refusal went to the Settings surface, where the
   * session could not see it. A refusal carries `problems` rather than one `error`, because a document can
   * be wrong in more than one place.
   */
  it('answers with the refusal when the store would not take the write', async () => {
    const { session, send, answer } = sessionWith();
    await session.ready();

    const { result } = await write(session, send, answer, { kind: 'pack', packId: 'default-setup', groupId: 'missing' }, {
      type: 'SETTINGS_REFUSED',
      problems: ['This settings definition is unavailable'],
    });

    expect(result).toEqual({
      ok: false,
      error: 'setSetting: This settings definition is unavailable',
    });
  });

  it('joins several reasons, since a document can be wrong in more than one place', async () => {
    const { session, send, answer } = sessionWith();
    await session.ready();

    const { result } = await write(session, send, answer, { kind: 'app' }, {
      type: 'SETTINGS_REFUSED',
      problems: ['first reason', 'second reason'],
    });

    expect(result).toEqual({ ok: false, error: 'setSetting: first reason; second reason' });
  });
});

describe('the viewport', () => {
  it('answers with what the app is rendering into, read from the window', async () => {
    const { session, evaluateExpression } = sessionWith();
    evaluateExpression.mockResolvedValueOnce({ width: 1400, height: 900 });

    expect(await session.viewport()).toEqual({ ok: true, value: { width: 1400, height: 900 } });
    // `innerWidth` rather than Playwright's `viewportSize()`, which answers null until something sets one
    // and never moves when the window itself is resized
    expect(String(evaluateExpression.mock.calls.at(-1)?.[0])).toContain('window.innerWidth');
  });

  it('resizes through the port, so a shown window is moved rather than drawn into', async () => {
    const { session, acted } = sessionWith();

    expect(await session.setViewport(1200, 800)).toEqual({ ok: true, value: { width: 1200, height: 800 } });
    expect(acted).toEqual(['viewport 1200x800']);
  });

  /**
   * The answer is the size that was *taken*. A window has a minimum and clamps to it — the main window's is
   * 900x600 — so echoing the request reported a resize that had not happened, and `/viewport` immediately
   * afterwards disagreed with it.
   */
  it('answers with the size the window took, not the size it was asked for', async () => {
    const { session, acted } = sessionWith();

    expect(await session.setViewport(400, 300)).toEqual({ ok: true, value: { width: 900, height: 600 } });
    expect(acted, 'it still asked for what it was told to ask for').toEqual(['viewport 400x300']);
  });

  /**
   * The decision the port exists for, asserted at the adapter: a run whose window someone can see resizes
   * the window, and a run nobody is watching sets the emulated viewport.
   *
   * Both directions, because each is wrong in the other's run. Emulating inside a shown window draws the
   * app into its top-left corner and leaves the desktop showing through the rest — what `npm run dev:drive`
   * looked like before `pinsViewport` — and moving a hidden window buys nothing while making a suite's
   * layout depend on whatever size the window happened to open at.
   */
  it('sets the emulated viewport for a window nobody is watching, and moves one someone is', async () => {
    const acted: string[] = [];
    const page = {
      setViewportSize: async ({ width, height }: { width: number; height: number }) => {
        acted.push(`emulated ${width}x${height}`);
      },
      locator: () => ({ ariaSnapshot: async () => '' }),
    } as unknown as Page;
    const app = { screenshot: async () => null, waitForState: async () => null, waitForSurface: async () => null };

    // An emulated viewport is applied exactly, so the adapter answers with what it asked for
    expect(await asSessionPage(page, app).setViewport(1000, 700)).toEqual({ width: 1000, height: 700 });
    // A real window clamps, and only it can say what it took
    expect(await asSessionPage(page, app, {
      setContentSize: async (width, height) => {
        acted.push(`window ${width}x${height}`);
        return { width: Math.max(width, 900), height: Math.max(height, 600) };
      },
    }).setViewport(400, 300)).toEqual({ width: 900, height: 600 });

    expect(acted).toEqual(['emulated 1000x700', 'window 400x300']);
  });

});

describe('the app log', () => {
  const lines = async (result: Promise<EngineResult>) => ((await result) as { value: string[] }).value;

  it('answers with every line', async () => {
    const { session } = sessionWith();

    expect((await lines(session.logs({}))).length).toBe(3);
  });

  it('answers with what followed a line the caller already saw', async () => {
    const { session } = sessionWith();

    // `since` names a line rather than a time: what a reader wants is "after the thing I just did"
    expect(await lines(session.logs({ since: 'boot' }))).toEqual(['[brain] started a flow', '[api] a thing happened']);
  });

  it('narrows to one source', async () => {
    const { session } = sessionWith();

    expect(await lines(session.logs({ source: '[brain]' }))).toEqual(['[brain] started a flow']);
  });

  /**
   * Answering with the whole log would be the same bytes as a right answer and a different meaning: a
   * reader asking "what happened since X" would take every line before X as new.
   */
  it('fails when `since` names a line the log does not hold, rather than answering with all of it', async () => {
    const { session } = sessionWith();

    expect(await session.logs({ since: 'a line nobody wrote' })).toEqual({
      ok: false,
      error: 'logs: no line contains "a line nobody wrote", so there is nothing to answer "since"',
    });
  });
});

describe('a bus round-trip', () => {
  /** The id the engine minted, read back off the send so a test can answer as the app would */
  it('sends to the database system with an id, and resolves on the reply that carries it', async () => {
    const { session, send, answer } = sessionWith();
    await session.ready();

    const pending = session.query('return 42');
    await settle();
    const sent = lastSend(send);
    expect(sent.to).toBe(DATABASE_SYSTEM);
    expect(sent.event).toMatchObject({ type: 'EXECUTE_QUERY', code: 'return 42' });
    expect(sent.call, 'minted by the asker, not the answerer, and on the envelope rather than in the event')
      .toEqual(expect.any(String));
    expect(sent.event, 'nothing correlating in the event the system receives')
      .toEqual({ type: 'EXECUTE_QUERY', code: 'return 42' });
    // The field the system turns into a reply address: without it `reply` has nobody to answer
    expect(sent.sender, 'so the system can answer this session').toBe(DRIVE_REF);

    answer({ type: 'QUERY_RESULT', result: 42 }, { answering: sentCall(send) });
    await expect(pending).resolves.toEqual({ ok: true, value: 42 });
  });

  it('turns the error reply into ok false, carrying the system message', async () => {
    const { session, send, answer } = sessionWith();
    await session.ready();

    const pending = session.query('return boom');
    await settle();
    answer({ type: 'QUERY_ERROR', error: 'boom is not defined' }, { answering: sentCall(send) });

    await expect(pending).resolves.toEqual({ ok: false, error: 'query: boom is not defined' });
  });

  it('uses the transaction events for transact, not the query ones', async () => {
    const { session, send, answer } = sessionWith();
    await session.ready();

    const pending = session.transact('return write(...)');
    await settle();
    expect(lastSend(send).event).toMatchObject({ type: 'EXECUTE_TRANSACTION', code: 'return write(...)' });

    const call = sentCall(send);
    // A QUERY_RESULT carrying the same id must not satisfy a transaction either: the type and the id
    // are both part of the answer, and only one of them is enough to be wrong
    answer({ type: 'QUERY_RESULT', result: 'wrong' }, { answering: call });
    answer({ type: 'TRANSACTION_RESULT', result: 'right' }, { answering: call });
    await expect(pending).resolves.toEqual({ ok: true, value: 'right' });
  });

  /**
   * The bridge is still a reply path, and this is the only case that says so.
   *
   * An app built before `host/drive` existed answers with a broadcast, which never reaches this session's
   * connection — the in-page inspector is the only way to see it. `apack pack drive --channel beta` can be exactly that
   * app, so waiters hear both channels and this case is what stops the page path being deleted as redundant.
   */
  it('still resolves a round-trip from a reply seen only in the page', async () => {
    const { session, emit, send } = sessionWith();
    await session.ready();

    const pending = session.query('return 1');
    await settle();
    emit({ type: 'QUERY_RESULT', event: answerTo(sentCall(send), { type: 'QUERY_RESULT', result: 'through the bridge' }) });

    await expect(pending).resolves.toEqual({ ok: true, value: 'through the bridge' });
  });

  /**
   * The channel dying ends what is waiting on it, at once.
   *
   * It used to end at `REPLY_TIMEOUT_MS` instead: `failure` was a state nothing announced, so a round-trip
   * could only discover it by being asked, and an agent sat fifteen seconds for a sentence that was true
   * immediately. The real client tells its listeners from the same place it records the state
   * (`ApiClient.onFinished`).
   */
  it('ends a round-trip in flight as soon as the channel finishes', async () => {
    const { session, finish } = sessionWith();
    await session.ready();

    const pending = session.query('return 1');
    await settle();
    finish('the app closed the connection');

    await expect(pending).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining('the app closed the connection'),
    });
  });

  // And one armed after it has gone needs no wait at all: there is nothing to wait for
  it('refuses a round-trip started once the channel has finished', async () => {
    const { session, fail } = sessionWith();
    await session.ready();
    fail('the app closed the connection');

    await expect(session.query('return 1')).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining('restart the session'),
    });
  });

  /** Someone else's query — a person in the Database surface while a session drives */
  it('ignores a reply for a request it did not make', async () => {
    const { session, send, answer } = sessionWith();
    await session.ready();

    const pending = session.query('return mine');
    await settle();
    answer({ type: 'QUERY_RESULT', result: 'someone else' }, { answering: 'c-elsewhere' });
    await settle();

    answer({ type: 'QUERY_RESULT', result: 'mine' }, { answering: sentCall(send) });
    await expect(pending).resolves.toEqual({ ok: true, value: 'mine' });
  });

  /**
   * The defect this whole change exists for, and it could not be written before.
   *
   * A request is abandoned at the timeout; its answer arrives afterwards, when the next request is the
   * one waiting. With no id in the reply the next request took it and reported it as its own. Now the
   * orphan matches nobody.
   */
  it('does not give an abandoned request\'s late reply to the next one', async () => {
    vi.useFakeTimers();
    try {
      const { session, send, answer } = sessionWith();
      await session.ready();

      const abandoned = session.query('return slow');
      await vi.advanceTimersByTimeAsync(0);
      const orphan = sentCall(send);
      await vi.advanceTimersByTimeAsync(REPLY_TIMEOUT_MS + 10);
      await expect(abandoned).resolves.toMatchObject({ ok: false });

      const next = session.query('return quick');
      await vi.advanceTimersByTimeAsync(0);
      // The slow query finishes at last, with nobody waiting for it
      answer({ type: 'QUERY_RESULT', result: 'the abandoned one' }, { answering: orphan });
      await vi.advanceTimersByTimeAsync(0);

      answer({ type: 'QUERY_RESULT', result: 'its own' }, { answering: sentCall(send) });
      await expect(next).resolves.toEqual({ ok: true, value: 'its own' });
    } finally {
      vi.useRealTimers();
    }
  });

  /**
   * The causes changed when the send stopped going through the page, and the message had to change with them.
   *
   * It used to lead with a serialisation failure in the *renderer's* subscription, because that killed every
   * later round-trip. It cannot any more — this session has its own connection — so that cause is gone from here
   * entirely rather than demoted.
   */
  it('names what is left to go wrong when no reply comes', async () => {
    vi.useFakeTimers();
    try {
      const { session, send } = sessionWith();
      await session.ready();
      const pending = session.query('return 1');
      // Advanced rather than `settle()`, which is `setImmediate` and so is itself faked here
      await vi.advanceTimersByTimeAsync(1);
      // The ask's own call, so the message is held to naming *that* one rather than to looking like an id
      const call = sentCall(send);
      await vi.advanceTimersByTimeAsync(REPLY_TIMEOUT_MS + 10);
      const result = await pending;

      expect(result.ok).toBe(false);
      expect(result, 'which ask went unanswered').toMatchObject({ error: expect.stringContaining(call) });
      expect(result, 'and that a broadcast cannot be matched at all, whichever channel brings it')
        .toMatchObject({ error: expect.stringContaining('answers no call at all') });
      expect(result, 'no pack providing it is still a cause').toMatchObject({
        error: expect.stringContaining(DATABASE_SYSTEM),
      });
      expect(result, 'and an app too old to answer a participant').toMatchObject({
        error: expect.stringContaining(DRIVE_REF),
      });
    } finally {
      vi.useRealTimers();
    }
  });

  /**
   * When the channel itself is the reason, the message says so instead of listing possibilities.
   *
   * This is what `api.failure` is for: a dead connection is not a slow query, and an agent reading "restart the
   * session" acts on it, where a list of three maybes sends it to `/state` for nothing.
   */
  it('quotes the channel when the connection is what failed', async () => {
    vi.useFakeTimers();
    try {
      const { session, fail } = sessionWith();
      await session.ready();
      const pending = session.query('return 1');
      fail('the app ended the event subscription');
      await vi.advanceTimersByTimeAsync(REPLY_TIMEOUT_MS + 10);

      await expect(pending).resolves.toMatchObject({
        ok: false,
        error: expect.stringContaining('the app ended the event subscription'),
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps serving after a request fails', async () => {
    const { session, send, answer } = sessionWith();
    await session.ready();

    const bad = session.query('return boom');
    await settle();
    answer({ type: 'QUERY_ERROR', error: 'nope' }, { answering: sentCall(send) });
    await expect(bad).resolves.toMatchObject({ ok: false });

    const good = session.query('return 1');
    await settle();
    answer({ type: 'QUERY_RESULT', result: 'still here' }, { answering: sentCall(send) });
    await expect(good).resolves.toEqual({ ok: true, value: 'still here' });
  });
});

describe('what /events says about an inbound message', () => {
  /**
   * The one case the page bridge cannot see at all.
   *
   * A message addressed to `host/drive` carries a `client`, so the subscription delivers it to this connection
   * and nowhere else — the renderer never sees it, so the in-page inspector cannot report it. `/events` is
   * therefore the only way an agent notices one, and without the sender it learns that something arrived for it
   * but not who asked: enough to notice a question, not enough to answer it.
   */
  it('keeps the sender of a message addressed to the session', async () => {
    const { session, answer } = sessionWith();
    await session.ready();

    answer({ type: 'DRIVER_QUESTION', question: 'which file?' });
    await settle();

    const [seen] = drained(session.drainEvents()).events;
    expect(seen.to).toBe(DRIVE_REF);
    expect(seen.sender, 'so an agent can answer whoever asked').toBe(DATABASE_SYSTEM);
  });

  // A bridged event is an event rather than an envelope, so it has no sender to keep and must not invent one
  it('leaves it absent for an event seen only in the page', async () => {
    const { session, emit } = sessionWith();
    await session.ready();

    emit({ type: 'TRAIL_UPDATE', event: {} });
    await settle();

    expect(drained(session.drainEvents()).events[0].sender).toBeUndefined();
  });
});

describe('the drains', () => {
  it('hands over the renderer errors and clears them', () => {
    const { session } = sessionWith();

    expect(session.drainErrors()).toEqual({ ok: true, value: ['renderer blew up'] });
    expect(session.drainErrors(), 'cleared, so a long session does not re-report them').toEqual({
      ok: true, value: [],
    });
  });

  /**
   * The fixture throws on any dropped send left after the drive body. A session that ran for an hour
   * would fail at the end over drops the agent had already been told about, so the read clears — and it
   * has to clear in the *page*, where the fixture will look, not in a copy here.
   */
  it('hands over the dropped sends and empties them in the page', async () => {
    const asked: string[] = [];
    const { session } = sessionWith({
      evaluateExpression: async (source: string) => { asked.push(source); return ['one drop']; },
    });

    await expect(session.drainDrops()).resolves.toEqual({ ok: true, value: ['one drop'] });
    expect(asked[0], 'cleared where the fixture reads it').toContain('win.__droppedSends = []');
  });
});

/**
 * `/wait` exists so an agent does not have to re-request `/state` in a loop.
 *
 * The fixture already has the event-driven wait; the verb hands it over. Which of the two it reaches is
 * the whole decision, since they wait on different things.
 */
describe('wait', () => {
  it('waits on a state path, passing the timeout through', async () => {
    const { session, waitForState, waitForSurface } = sessionWith();
    const result = await session.wait({ state: 'running.connected' }, 2_000);

    expect(result).toEqual({ ok: true, value: { state: 'running.connected' } });
    expect(waitForState).toHaveBeenCalledWith('running.connected', 2_000);
    expect(waitForSurface, 'the other wait is not the one for a state').not.toHaveBeenCalled();
  });

  it('waits on a surface arriving instead, when that is what was asked', async () => {
    const { session, waitForState, waitForSurface } = sessionWith();
    await session.wait({ surface: 'default-setup/notes' });

    expect(waitForSurface).toHaveBeenCalledWith('default-setup/notes', undefined);
    expect(waitForState).not.toHaveBeenCalled();
  });

  it('reports a wait that timed out rather than throwing', async () => {
    const { session } = sessionWith({
      waitForState: async () => { throw new Error('Timeout 10000ms exceeded.'); },
    });

    await expect(session.wait({ state: 'never.happens' })).resolves.toEqual({
      ok: false, error: 'wait: Timeout 10000ms exceeded.',
    });
  });
});
