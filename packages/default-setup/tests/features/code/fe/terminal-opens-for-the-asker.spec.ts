// A terminal opens in the window that asked for it, and appears in every window's list.
//
// Those are two jobs and they used to be one event. `terminal.CREATED` is a broadcast — `broadcastToSurface`
// reaches every window — and its handler both grew the list *and* routed the terminal into this window's
// panel and ran the pending command. So opening a terminal in one window opened it in all of them, and ran
// there a command nobody had typed there.
//
// The id is minted when the terminal is created, so nothing *about the terminal* could identify the ask — a
// slot keyed by what was asked for cannot settle this one. Two things settle it instead, and they answer
// different questions. **Addressing** says which window: the news stays a broadcast and the answer is replied
// to the asker (`code/be/features/terminal.ts`), the same split the database system makes between
// `IMPORT_DATABASE_SUCCESS` and `DATABASE_REPLACED`. **The call** says which of that window's asks, which addressing
// cannot — a window can have two creates in flight, and the intent held for each (a tab or the panel, a
// command to run) is not interchangeable, so one slot could not hold both.
//
// `answerTo` is how a spec with no delivery door in front of it builds an answer that names a call.
import { beforeEach, expect, it, vi } from 'vitest';
import { createActor } from 'xstate';
import { answerTo } from '@apackdev/sdk/testing';
import { sentCall } from '../../../_support/calls.ts';

const sendToSystem = vi.hoisted(() => vi.fn());
vi.mock('#generated/events.ts', () => ({ sendToSystem }));

const parent = vi.hoisted(() => ({ updateParentState: vi.fn(), addTabToParent: vi.fn(), getParentContext: vi.fn(() => null), sendEventToParent: vi.fn() }));
vi.mock('#features/code/fe/utils/parent-communication.ts', () => parent);

// The pool renders a terminal with xterm, which reaches `self` as it loads; nothing here draws anything
vi.mock('#features/code/fe/utils/terminal-pool.ts', () => ({ terminalPool: { dispose: vi.fn(), syncProcesses: vi.fn() } }));
vi.mock('#features/code/fe/utils/terminal-events.ts', () => ({
  terminalEventBus: { emit: vi.fn(), clearOutput: vi.fn(), prunePersistedOutputs: vi.fn() },
}));

const { terminalState } = await import('#features/code/fe/features/terminal/state.ts');

const aTerminal = (id: string) => ({ id, title: id, cwd: '/tmp' }) as never;

const terminals = (actor: ReturnType<typeof createActor>) =>
  (actor.getSnapshot().context as { terminals: Array<{ id: string }> }).terminals.map((t) => t.id);

const pendingOpens = (actor: ReturnType<typeof createActor>) =>
  Object.keys((actor.getSnapshot().context as { pendingOpens: Record<string, unknown> }).pendingOpens);

/** The call the nth `terminal.CREATE_TERMINAL` was asked under */
const createCall = (nth: number) => sentCall(sendToSystem, 'terminal.CREATE_TERMINAL', nth);

beforeEach(() => {
  sendToSystem.mockReset();
  parent.updateParentState.mockReset();
  parent.addTabToParent.mockReset();
});

/** A window that has asked for a terminal, so its intent is recorded under that ask's call */
function asked() {
  const actor = createActor(terminalState).start();
  actor.send({ type: 'terminal.CREATE', command: 'echo hi' });
  return actor;
}

it('grows every window\'s list on the news, and opens nothing', () => {
  // This window never asked — it is any other window, which the broadcast also reaches
  const other = createActor(terminalState).start();

  other.send({ type: 'terminal.CREATED', data: aTerminal('t-1') });

  expect(terminals(other), 'the list is what every window takes from it').toEqual(['t-1']);
  expect(parent.updateParentState, 'and nothing is routed into a panel nobody asked about').not.toHaveBeenCalled();
  expect(parent.addTabToParent).not.toHaveBeenCalled();
});

it('opens the terminal for the window that asked', () => {
  const actor = asked();

  actor.send(answerTo(createCall(0), { type: 'terminal.OPENED', data: aTerminal('t-1') }));

  expect(parent.updateParentState).toHaveBeenCalledWith(expect.anything(), { panelTerminalId: 't-1' });
  // The command this window typed is run in the terminal this window asked for, and nowhere else
  expect(sendToSystem).toHaveBeenCalledWith('code', expect.objectContaining({ type: 'terminal.TERMINAL_INPUT', terminalId: 't-1', data: 'echo hi\n' }));
});

it('opens it as a tab when that is what was asked for', () => {
  const actor = createActor(terminalState).start();
  actor.send({ type: 'terminal.CREATE', target: 'tab' });

  actor.send(answerTo(createCall(0), { type: 'terminal.OPENED', data: aTerminal('t-2') }));

  expect(parent.addTabToParent).toHaveBeenCalled();
  expect(parent.updateParentState, 'a tab, so not also the panel').not.toHaveBeenCalled();
});

/**
 * The pair, stated as one case: the window that asked does both jobs, and it does the opening *once*.
 *
 * Both events reach the asker — it is a window like any other, so the broadcast lands there too — and the
 * danger of splitting one handler in two is that the asker now adds the terminal twice or opens it twice.
 */
it('leaves the asker with one entry and one open', () => {
  const actor = asked();

  actor.send({ type: 'terminal.CREATED', data: aTerminal('t-3') });
  actor.send(answerTo(createCall(0), { type: 'terminal.OPENED', data: aTerminal('t-3') }));

  expect(terminals(actor)).toEqual(['t-3']);
  expect(parent.updateParentState).toHaveBeenCalledTimes(1);
});

/**
 * **Two creates in flight, each opened the way it asked — the issue doc's repro.**
 *
 * `docs/issues/ISSUE-terminal-integration-review.md` (T4) is the repro: run "build" then "test" before the
 * first answer. A single slot holds the second create's intent, so the *first* answer reads the second's
 * command and the second answer finds nothing. Keyed by call, each answer finds its own intent whatever
 * order the two arrive in — asserted here in the awkward order, the first ask answered second, since that
 * is the order one slot gets wrong in both directions at once.
 */
it('opens two terminals asked for together the way each was asked for', () => {
  const actor = createActor(terminalState).start();

  actor.send({ type: 'terminal.CREATE', command: 'build' });
  actor.send({ type: 'terminal.CREATE', command: 'test', target: 'tab' });
  const [build, test] = [createCall(0), createCall(1)];
  expect(build, 'two asks, two calls').not.toEqual(test);

  actor.send(answerTo(test, { type: 'terminal.OPENED', data: aTerminal('t-test') }));
  actor.send(answerTo(build, { type: 'terminal.OPENED', data: aTerminal('t-build') }));

  // Each command in the terminal its own ask created, which is the whole of T4
  expect(sendToSystem).toHaveBeenCalledWith('code', expect.objectContaining({ terminalId: 't-build', data: 'build\n' }));
  expect(sendToSystem).toHaveBeenCalledWith('code', expect.objectContaining({ terminalId: 't-test', data: 'test\n' }));
  // And the targets likewise: the tab was the second ask's, the panel the first's
  expect(parent.addTabToParent).toHaveBeenCalledTimes(1);
  expect(parent.updateParentState).toHaveBeenCalledWith(expect.anything(), { panelTerminalId: 't-build' });
});

/**
 * An answer settles its ask, whether it opened a terminal or failed to.
 *
 * Both are replied, so both name the call. Without the removal on the error path a create that failed would
 * leave its target and command in the map for the life of the surface — and the map is the one piece of state
 * here that grows per ask.
 */
it('holds an intent only while its ask is outstanding', () => {
  const actor = createActor(terminalState).start();

  actor.send({ type: 'terminal.CREATE', command: 'echo hi' });
  expect(pendingOpens(actor), 'one ask outstanding').toEqual([createCall(0)]);

  actor.send(answerTo(createCall(0), { type: 'terminal.OPENED', data: aTerminal('t-1') }));
  expect(pendingOpens(actor), 'settled by the answer').toEqual([]);

  actor.send({ type: 'terminal.CREATE', command: 'fails' });
  actor.send(answerTo(createCall(1), { type: 'terminal.ERROR', data: { message: 'no shell' } }));
  expect(pendingOpens(actor), 'settled by the failure too').toEqual([]);
});

/**
 * A terminal this window did not ask for opens with the defaults.
 *
 * An answer whose call names no outstanding ask has no intent to read, and the branch that reads one must
 * not fall back to whatever another ask left behind.
 */
it('opens a terminal it has no record of asking for into the panel, with no command', () => {
  const actor = createActor(terminalState).start();
  actor.send({ type: 'terminal.CREATE', command: 'echo hi', target: 'tab' });

  actor.send(answerTo('c-another-ask', { type: 'terminal.OPENED', data: aTerminal('t-stray') }));

  expect(parent.updateParentState, 'the panel, not the tab the other ask wanted').toHaveBeenCalledWith(expect.anything(), { panelTerminalId: 't-stray' });
  expect(parent.addTabToParent).not.toHaveBeenCalled();
  expect(sendToSystem.mock.calls.filter(([, e]) => (e as { type: string }).type === 'terminal.TERMINAL_INPUT'), 'and no command').toEqual([]);
  expect(pendingOpens(actor), "the outstanding ask is still outstanding").toEqual([createCall(0)]);
});
