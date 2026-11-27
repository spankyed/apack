// What a terminal's programs say they are doing (OSC 7501), on the window: which one record its tab shows, when
// the person is told by the system, and when looking at the terminal says so to every window.
//
// The state decides when; `status.ts` says what; the badge only draws the record it is handed.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick } from 'vue';
import { state, system, type AnyEvent } from '@apackdev/state';
import { defectGuard } from '@apackdev/state/testing';
import { provide as providePackState } from '#generated/state-fe.ts';
import type { TerminalStatus } from '#features/code/be/types.ts';
import { createAskPort } from '../../_support/asks.ts';

const pool = vi.hoisted(() => ({ dispose: vi.fn(), syncProcesses: vi.fn(), noteExit: vi.fn(), describe: vi.fn() }));
vi.mock('#features/code/fe/utils/terminal-pool.ts', () => ({ terminalPool: pool }));

const { terminalState } = await import('#features/code/fe/features/terminal/state.ts');
const { statusToShow, statusSays, statusTitle, waited, statusNotification } = await import('#features/code/fe/features/terminal/status.ts');
const { default: TerminalActivityBadge } = await import('#features/code/fe/features/terminal/TerminalActivityBadge.vue');
const { useStatusSeen } = await import('#features/code/fe/features/terminal/useStatusSeen.ts');

/** A record as the backend tells one, working as `codex` and confirmed, but for what a case says of it */
const record = (over: Partial<TerminalStatus> = {}): TerminalStatus => ({
  id: '', state: 'working', kind: null, progress: null, app: 'codex', title: null, message: null,
  changed: 1, sinceMs: 0, confirmed: 'matched', seen: false, ...over,
});

const running: Array<{ stop(): void }> = [];

/** A window whose code surface has these settings, showing two terminals */
async function aWindow(settings: Record<string, unknown> = {}) {
  const guard = defectGuard();
  const sys = system({ side: 'window', onDefect: guard.onDefect });
  const askPort = createAskPort();
  sys.attach(askPort.port);

  const fakeCode = state<{ starts: { terminal: typeof terminalState } }, AnyEvent>()({
    starts: () => ({ terminal: terminalState }),
    on: {
      TERMINAL_LIST_LOADED: () => {},
      TERMINAL_CREATED_FOR_WINDOW: () => {},
      TERMINAL_CLOSED_REPORT: () => {},
      TERMINAL_TAB_INFO_CHANGED: () => {},
      TERMINAL_OPEN_TAB_REQUEST: () => {},
    },
  });
  const codeHandle = sys.start('default-setup/code', fakeCode);
  const terminalHandle = sys.child(codeHandle, 'terminal');

  sys.send(terminalHandle, { type: 'SYNC_SETTINGS', settings: settings as never });
  sys.send(terminalHandle, { type: 'terminal.REFRESH_LIST' });
  await askPort.latestAsk('terminal.REFRESH_LIST').answer([
    { id: 't-1', title: 'one', cwd: '/work/api', active: true },
    { id: 't-2', title: 'two', cwd: '/work/web', active: true },
  ]);
  askPort.reset();

  const stop = () => {
    guard.assertNone();
    sys.stop();
    guard[Symbol.dispose]();
  };
  running.push({ stop });

  return {
    sys,
    tells: askPort.tells,
    clearTells: () => { askPort.tells.length = 0; },
    told: (terminalId: string, statuses: TerminalStatus[]) =>
      sys.send(terminalHandle, { type: 'terminal.STATUS', data: { terminalId, statuses } }),
    statuses: (terminalId: string) =>
      sys.read(terminalHandle)?.data.terminals.find((terminal) => terminal.id === terminalId)?.statuses,
    looks: (terminalId: string) =>
      sys.send(terminalHandle, { type: 'terminal.SEEN', terminalId }),
  };
}

let notify: ReturnType<typeof vi.fn>;
let hasFocus: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  notify = vi.fn().mockResolvedValue(true);
  vi.stubGlobal('electronAPI', { notify: { show: notify } });
  hasFocus = vi.spyOn(document, 'hasFocus').mockReturnValue(false);
});
afterEach(() => {
  for (const r of running.splice(0)) r.stop();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the one record a tab shows', () => {
  it('is what waits on the person, then what failed, what finished, what is working, what is idle', async () => {
    const idle = record({ id: 'i', state: 'idle' });
    const working = record({ id: 'w' });
    const done = record({ id: 'd', state: 'done' });
    const failed = record({ id: 'e', state: 'error' });
    const blocked = record({ id: 'b', state: 'blocked', kind: 'question' });
    expect(statusToShow([idle, working, done, failed, blocked])?.id).toBe('b');
    expect(statusToShow([idle, working, done, failed])?.id).toBe('e');
    expect(statusToShow([idle, working, done])?.id).toBe('d');
    expect(statusToShow([idle, working])?.id).toBe('w');
    expect(statusToShow([idle])?.id).toBe('i');
    expect(statusToShow([])).toBeUndefined();
    expect(statusToShow(undefined)).toBeUndefined();
  });

  it('is not something the person has already looked at', async () => {
    const seen = record({ id: 'd', state: 'done', seen: true });
    expect(statusToShow([seen])).toBeUndefined();
    expect(statusToShow([seen, record({ id: 'w' })])?.id).toBe('w');
    expect(statusToShow([record({ id: 'b', state: 'blocked', seen: true }), record({ id: 'w' })])?.id).toBe('b');
  });

  it('says what it is in a few words, and for how long', async () => {
    expect(statusSays(record({ state: 'blocked', kind: 'permission' }))).toBe('Needs permission');
    expect(statusSays(record({ state: 'blocked', kind: 'question' }))).toBe('Has a question');
    expect(statusSays(record({ state: 'blocked', kind: 'auth' }))).toBe('Needs you to sign in');
    expect(statusSays(record({ state: 'blocked' }))).toBe('Waiting on you');
    expect(['idle', 'working', 'done', 'error'].map((s) => statusSays(record({ state: s as TerminalStatus['state'] }))))
      .toEqual(['Idle', 'Working', 'Finished', 'Failed']);
    expect([0, 4_999, 5_000, 59_999, 60_000, 3_599_999, 3_600_000, 86_400_000].map((ms) => waited(0, ms)))
      .toEqual(['now', 'now', '5s', '59s', '1m', '59m', '1h', '1d']);
    expect(statusTitle(record({ state: 'blocked', kind: 'permission', message: 'Apply?', progress: 40, sinceMs: 0 }), 240_000))
      .toBe('codex · Needs permission · Apply?, 40%, for 4m');
    expect(statusTitle(record({ confirmed: 'mismatched', sinceMs: 0 }), 0))
      .toBe('codex · Working — reported by a program other than the one in front');
  });
});

describe("a terminal's status on the window", () => {
  it('replaces what the window held, whole', async () => {
    const w = await aWindow();
    w.told('t-1', [record(), record({ id: 'build', state: 'done' })]);
    expect(w.statuses('t-1')?.map((status) => status.id)).toEqual(['', 'build']);
    expect(w.statuses('t-2'), 'another terminal is untouched').toBeUndefined();
    w.told('t-1', [record({ state: 'idle' })]);
    expect(w.statuses('t-1')).toEqual([record({ state: 'idle' })]);
    w.told('t-1', []);
    expect(w.statuses('t-1')).toBeUndefined();
  });

  it('tells the person by the system when a program comes to want them, naming the terminal first', async () => {
    const w = await aWindow();
    w.told('t-1', [record()]);
    expect(notify, 'working wants nobody').not.toHaveBeenCalled();
    w.told('t-1', [record({ state: 'blocked', kind: 'permission', message: 'Apply?', changed: 7 })]);
    expect(notify).toHaveBeenCalledExactlyOnceWith('api — codex', 'Needs permission · Apply?', 'terminal-status:t-1::7');
  });

  it('tells them once for a terminal until they look at it, however often its program changes its mind', async () => {
    const w = await aWindow();
    w.told('t-1', [record({ state: 'blocked', changed: 1 })]);
    w.told('t-1', [record({ state: 'working', changed: 2 })]);
    w.told('t-1', [record({ state: 'blocked', changed: 3 })]);
    w.told('t-1', [record({ state: 'done', changed: 4 })]);
    expect(notify).toHaveBeenCalledTimes(1);
    w.told('t-2', [record({ state: 'error' })]);
    expect(notify).toHaveBeenCalledTimes(2);

    w.looks('t-1');
    w.told('t-1', [record({ state: 'done', changed: 4, seen: true })]);
    w.told('t-1', [record({ state: 'blocked', changed: 5 })]);
    expect(notify, 'they looked, so the next thing is told').toHaveBeenCalledTimes(3);
  });

  it('tells them again once another window was where they looked', async () => {
    const w = await aWindow();
    w.told('t-1', [record({ state: 'done' })]);
    w.told('t-1', [record({ state: 'done', seen: true })]);
    w.told('t-1', [record({ state: 'error', changed: 2 })]);
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it('does not tell them while the window has the focus, or of a record naming another program, or with the setting off', async () => {
    hasFocus.mockReturnValue(true);
    const focused = await aWindow();
    focused.told('t-1', [record({ state: 'blocked' })]);
    expect(notify, 'they can see the tab').not.toHaveBeenCalled();

    hasFocus.mockReturnValue(false);
    const forged = await aWindow();
    forged.told('t-1', [record({ state: 'blocked', kind: 'permission', confirmed: 'mismatched' })]);
    expect(notify, 'anything in a terminal can write one').not.toHaveBeenCalled();
    forged.told('t-1', [
      record({ state: 'blocked', kind: 'permission', confirmed: 'mismatched' }),
      record({ id: 'real', state: 'error', confirmed: 'unknown' }),
    ]);
    expect(notify, 'where nothing could be compared, they are told').toHaveBeenCalledTimes(1);

    notify.mockClear();
    const off = await aWindow({ terminalStatusNotification: false });
    off.told('t-1', [record({ state: 'blocked' })]);
    expect(notify).not.toHaveBeenCalled();
  });

  it('says so to every window when the person looks at what wanted them, and only then', async () => {
    const w = await aWindow();
    w.told('t-1', [record(), record({ id: 'i', state: 'idle' })]);
    w.looks('t-1');
    expect(w.tells, 'nothing was waiting to be looked at').toEqual([]);
    w.told('t-1', [record({ state: 'done', seen: true }), record({ id: 'b', state: 'blocked', seen: true })]);
    w.looks('t-1');
    expect(w.tells, 'they have already looked at these').toEqual([]);

    w.told('t-1', [record({ state: 'done', changed: 2 })]);
    w.looks('t-2');
    expect(w.tells, 'they looked at another terminal').toEqual([]);
    w.looks('t-1');
    expect(w.tells).toEqual([{ to: 'default-setup/code', event: { type: 'terminal.STATUS_SEEN', terminalId: 't-1' } }]);

    w.clearTells();
    w.told('t-2', [record({ state: 'blocked' })]);
    w.looks('t-2');
    expect(w.tells).toEqual([{ to: 'default-setup/code', event: { type: 'terminal.STATUS_SEEN', terminalId: 't-2' } }]);
  });
});

describe('a terminal on screen', () => {
  const apps: Array<ReturnType<typeof createApp>> = [];
  afterEach(() => { for (const app of apps.splice(0)) app.unmount(); });
  /** A window with a component mounted that shows `terminalId`, as a tab or the panel does */
  const showing = async (terminalId: string) => {
    const w = await aWindow();
    const app = createApp({ setup() { useStatusSeen(() => terminalId); return () => null; } });
    providePackState(app, w.sys);
    apps.push(app);
    app.mount(document.createElement('div'));
    return { ...w, app };
  };
  const seen = (terminalId: string) => ({ to: 'default-setup/code', event: { type: 'terminal.STATUS_SEEN', terminalId } });

  it('is looked at when what wants the person arrives while the window has the focus', async () => {
    hasFocus.mockReturnValue(true);
    const w = await showing('t-1');
    w.told('t-1', [record()]);
    await nextTick();
    expect(w.tells, 'working wants nobody').toEqual([]);
    w.told('t-1', [record({ state: 'done', changed: 2 })]);
    await nextTick();
    expect(w.tells).toEqual([seen('t-1')]);
  });

  it('is not looked at behind another window, until this one comes to the front', async () => {
    const w = await showing('t-1');
    w.told('t-1', [record({ state: 'error' })]);
    await nextTick();
    expect(w.tells, 'on screen is not looked at').toEqual([]);
    hasFocus.mockReturnValue(true);
    window.dispatchEvent(new Event('focus'));
    expect(w.tells).toEqual([seen('t-1')]);
  });

  it('says nothing of a terminal it is not showing, or once it is gone from the screen', async () => {
    hasFocus.mockReturnValue(true);
    const w = await showing('t-1');
    w.told('t-2', [record({ state: 'done' })]);
    await nextTick();
    window.dispatchEvent(new Event('focus'));
    expect(w.tells).toEqual([]);

    w.app.unmount();
    w.told('t-1', [record({ state: 'done' })]);
    await nextTick();
    window.dispatchEvent(new Event('focus'));
    expect(w.tells).toEqual([]);
  });
});

describe('the notification', () => {
  it('leads with the terminal, so a program cannot pass itself off as one running elsewhere', async () => {
    expect(statusNotification('api', record({ state: 'error', title: 'deploy', message: 'exit 2' })))
      .toEqual({ title: 'api — codex', body: 'Failed · deploy · exit 2' });
    expect(statusNotification('api', record({ state: 'done', app: null }))).toEqual({ title: 'api', body: 'Finished' });
  });
});

describe('the mark on a tab', () => {
  const apps: Array<ReturnType<typeof createApp>> = [];
  afterEach(() => { for (const app of apps.splice(0)) app.unmount(); });
  const marked = (status: TerminalStatus | undefined): HTMLElement | null => {
    const host = document.createElement('div');
    const app = createApp({ render: () => h(TerminalActivityBadge, { activity: undefined, kept: false, status }) });
    apps.push(app);
    app.mount(host);
    return host.querySelector<HTMLElement>('[data-terminal-status]');
  };

  it('is not drawn where there is nothing to show', async () => {
    expect(marked(undefined)).toBeNull();
  });

  it('says the state and what a blocked program needs', async () => {
    const blocked = marked(record({ state: 'blocked', kind: 'permission' }))!;
    expect({ ...blocked.dataset }).toMatchObject({
      terminalStatusState: 'blocked', terminalStatusKind: 'permission', terminalStatusConfirmed: 'matched',
    });
    for (const s of ['idle', 'working', 'done', 'error'] as const) {
      const mark = marked(record({ state: s }))!;
      expect(mark.dataset.terminalStatusState).toBe(s);
      expect(mark.dataset.terminalStatusKind).toBeUndefined();
    }
  });

  it('is drawn faint for a record naming a program other than the one in front, and says why', async () => {
    const forged = marked(record({ state: 'blocked', confirmed: 'mismatched' }))!;
    expect(forged.classList.contains('opacity-40')).toBe(true);
    expect(forged.title).toContain('reported by a program other than the one in front');
    expect(marked(record({ state: 'blocked' }))!.classList.contains('opacity-40')).toBe(false);
  });
});
