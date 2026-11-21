// A terminal opens in the window that asked for it, and appears in every window's list.
//
// Those are two jobs and they used to be one event. `terminal.CREATED` is a broadcast — `broadcast`
// reaches every window — and its handler both grew the list *and* routed the terminal into this window's
// panel and ran the pending command. So opening a terminal in one window opened it in all of them, and ran
// there a command nobody had typed there.
//
// The id is minted when the terminal is created, so nothing *about the terminal* could identify the ask — a
// slot keyed by what was asked for cannot settle this one. Two things settle it instead, and they answer
// different questions. **Addressing** says which window: the news stays a broadcast and the answer goes to the
// asker alone (`code/be/features/terminal.ts`), the same split the database system makes between
// `IMPORT_DATABASE_SUCCESS` and `DATABASE_REPLACED`. **The ask itself** says which of that window's asks, which
// addressing cannot — a window can have two creates in flight, and the intent held for each (a tab or the panel, a
// command to run) is not interchangeable, so one slot could not hold both.
import { beforeEach, expect, it, vi } from 'vitest';
import { createActor } from 'xstate';
import { asksOf, latestAsk, made, resetAsks } from './_support/asks.ts';

const tell = vi.hoisted(() => vi.fn());
vi.mock('#generated/events.ts', async () => ({ tell, fromAsk: (await import('./_support/asks.ts')).fromAsk }));

const parent = vi.hoisted(() => ({ updateParentState: vi.fn(), addTabToParent: vi.fn(), getParentContext: vi.fn(() => null), sendEventToParent: vi.fn() }));
vi.mock('#features/code/fe/utils/parent-communication.ts', () => parent);

// The pool renders a terminal with the emulator, which reaches `self` as it loads; nothing here draws anything
vi.mock('#features/code/fe/utils/terminal-pool.ts', () => ({ terminalPool: { dispose: vi.fn(), syncProcesses: vi.fn(), describe: vi.fn() } }));
vi.mock('#features/code/fe/utils/terminal-events.ts', () => ({
  terminalEventBus: { emit: vi.fn(), clearOutput: vi.fn(), prunePersistedOutputs: vi.fn() },
}));

const { terminalState } = await import('#features/code/fe/features/terminal/state.ts');

const aTerminal = (id: string) => ({ id, title: id, cwd: '/tmp', submit: '\n' }) as never;

const terminals = (actor: ReturnType<typeof createActor>) =>
  (actor.getSnapshot().context as { terminals: Array<{ id: string }> }).terminals.map((t) => t.id);

const pendingOpens = (actor: ReturnType<typeof createActor>) =>
  Object.keys((actor.getSnapshot().context as { pendingOpens: Record<string, unknown> }).pendingOpens);

/** The nth `terminal.CREATE_TERMINAL` this window asked */
const create = (nth: number) => asksOf('terminal.CREATE_TERMINAL')[nth]!;

beforeEach(() => {
  tell.mockReset();
  resetAsks();
  parent.updateParentState.mockReset();
  parent.addTabToParent.mockReset();
  parent.getParentContext.mockReset().mockReturnValue(null);
});

/** The code surface already showing `id` in its panel, so the list has no panel of its own to pick */
const showing = (id: string) => parent.getParentContext.mockReturnValue({ panelTerminalId: id } as never);

/** A window that has asked for a terminal, so its intent is recorded under that ask */
function asked() {
  const actor = createActor(terminalState).start();
  actor.send({ type: 'terminal.CREATE', command: 'echo hi' });
  return actor;
}

it('asks for the list again on the news, and opens nothing', async () => {
  // This window never asked — it is any other window, which the broadcast also reaches
  const other = createActor(terminalState).start();
  showing('t-0');

  other.send({ type: 'terminal.CREATED', data: { terminalId: 't-1' } });
  expect(made.map(({ event }) => event), 'the news names the terminal; the list is an answer').toEqual([{ type: 'terminal.REFRESH_LIST' }]);
  await latestAsk('terminal.REFRESH_LIST').answer([aTerminal('t-0'), aTerminal('t-1')]);

  expect(terminals(other)).toEqual(['t-0', 't-1']);
  expect(parent.updateParentState, 'and nothing is routed into a panel nobody asked about').not.toHaveBeenCalled();
  expect(parent.addTabToParent).not.toHaveBeenCalled();
});

it('opens the terminal for the window that asked', async () => {
  asked();

  await create(0).answer(aTerminal('t-1'));

  expect(parent.updateParentState).toHaveBeenCalledWith(expect.anything(), { panelTerminalId: 't-1', panelTerminalExpanded: true });
  // The command this window typed is run in the terminal this window asked for, and nowhere else
  expect(tell).toHaveBeenCalledWith('code', expect.objectContaining({ type: 'terminal.TERMINAL_INPUT', terminalId: 't-1', data: 'echo hi\n' }));
});

it('opens it as a tab when that is what was asked for', async () => {
  const actor = createActor(terminalState).start();
  actor.send({ type: 'terminal.CREATE', target: 'tab' });

  await create(0).answer(aTerminal('t-2'));

  expect(parent.addTabToParent).toHaveBeenCalled();
  expect(parent.updateParentState, 'a tab, so not also the panel').not.toHaveBeenCalled();
});

/**
 * The pair, stated as one case: the window that asked does both jobs, and it does the opening *once*.
 *
 * Both events reach the asker — it is a window like any other, so the broadcast lands there too — and the
 * danger of splitting one handler in two is that the asker now adds the terminal twice or opens it twice.
 */
it('leaves the asker with one entry and one open', async () => {
  const actor = asked();

  actor.send({ type: 'terminal.CREATED', data: { terminalId: 't-3' } });
  await create(0).answer(aTerminal('t-3'));
  showing('t-3');
  await latestAsk('terminal.REFRESH_LIST').answer([aTerminal('t-3')]);

  expect(terminals(actor)).toEqual(['t-3']);
  expect(parent.updateParentState).toHaveBeenCalledTimes(1);
});

/**
 * **Two creates in flight, each opened the way it asked — the issue doc's repro.**
 *
 * `docs/issues/ISSUE-terminal-integration-review.md` (T4) is the repro: run "build" then "test" before the
 * first answer. A single slot holds the second create's intent, so the *first* answer reads the second's
 * command and the second answer finds nothing. Keyed by ask, each answer finds its own intent whatever
 * order the two arrive in — asserted here in the awkward order, the first ask answered second, since that
 * is the order one slot gets wrong in both directions at once.
 */
it('opens two terminals asked for together the way each was asked for', async () => {
  const actor = createActor(terminalState).start();

  actor.send({ type: 'terminal.CREATE', command: 'build' });
  actor.send({ type: 'terminal.CREATE', command: 'test', target: 'tab' });
  expect(asksOf('terminal.CREATE_TERMINAL'), 'two asks under way at once').toHaveLength(2);

  await create(1).answer(aTerminal('t-test'));
  await create(0).answer(aTerminal('t-build'));

  // Each command in the terminal its own ask created, which is the whole of T4
  expect(tell).toHaveBeenCalledWith('code', expect.objectContaining({ terminalId: 't-build', data: 'build\n' }));
  expect(tell).toHaveBeenCalledWith('code', expect.objectContaining({ terminalId: 't-test', data: 'test\n' }));
  // And the targets likewise: the tab was the second ask's, the panel the first's
  expect(parent.addTabToParent).toHaveBeenCalledTimes(1);
  expect(parent.updateParentState).toHaveBeenCalledWith(expect.anything(), { panelTerminalId: 't-build', panelTerminalExpanded: true });
});

/**
 * An ask that ends is no longer outstanding, whether it opened a terminal or failed to.
 *
 * Without the removal on the failure path a create that failed would leave its target and command in the map for
 * the life of the surface — and the map is the one piece of state here that grows per ask. The failure is kept for
 * the canvas to tell the person, since the window that asked is the only one told.
 */
it('holds an intent only while its ask is outstanding, and keeps a failure to show', async () => {
  const actor = createActor(terminalState).start();

  actor.send({ type: 'terminal.CREATE', command: 'echo hi' });
  expect(pendingOpens(actor), 'one ask outstanding').toHaveLength(1);

  await create(0).answer(aTerminal('t-1'));
  expect(pendingOpens(actor), 'settled by the answer').toEqual([]);

  actor.send({ type: 'terminal.CREATE', command: 'fails' });
  await create(1).refuse('no shell');
  expect(pendingOpens(actor), 'settled by the failure too').toEqual([]);
  expect(actor.getSnapshot().context.failures).toEqual([{ message: 'no shell' }]);
  expect(parent.updateParentState, 'and nothing was opened for it').toHaveBeenCalledTimes(1);
  expect(Object.keys(actor.getSnapshot().children), 'an ask that ended is no longer a child').toEqual([]);
});

/** Done is all a close answers with, so only its failure is this window's to show */
it('keeps the failure of an ask that only needed doing', async () => {
  const actor = createActor(terminalState).start();

  actor.send({ type: 'terminal.CLOSE', terminalId: 't-gone' });
  expect(latestAsk('terminal.CLOSE_TERMINAL').event).toEqual({ type: 'terminal.CLOSE_TERMINAL', terminalId: 't-gone' });
  await latestAsk('terminal.CLOSE_TERMINAL').refuse('Terminal not found');

  expect(actor.getSnapshot().context.failures).toEqual([{ message: 'Terminal not found' }]);
});

/** The canvas tells what it has shown, and a failure noted while it was showing those is still to tell */
it('holds every failure until it is told, and drops only the ones told', async () => {
  const actor = createActor(terminalState).start();
  const failures = () => actor.getSnapshot().context.failures;

  actor.send({ type: 'terminal.CLOSE', terminalId: 't-1' });
  actor.send({ type: 'terminal.RESTART', terminalId: 't-2' });
  await latestAsk('terminal.CLOSE_TERMINAL').refuse('first');
  await latestAsk('terminal.RESTART_TERMINAL').refuse('second');
  expect(failures(), 'the second does not replace the first').toEqual([{ message: 'first' }, { message: 'second' }]);

  const told = failures();
  actor.send({ type: 'terminal.RENAME', terminalId: 't-3', customTitle: 'x' });
  await latestAsk('terminal.RENAME_TERMINAL').refuse('third');
  actor.send({ type: 'terminal.FAILURES_TOLD', told });
  expect(failures()).toEqual([{ message: 'third' }]);
});

/** The list wanted is the one as it stands now: news arriving while it is asked for asks again */
it('asks for the list again when a terminal is created while it is being listed', async () => {
  const actor = createActor(terminalState).start();

  actor.send({ type: 'CODE_STARTED' });
  actor.send({ type: 'terminal.CREATED', data: { terminalId: 't-1' } });
  const [first, second] = asksOf('terminal.REFRESH_LIST');
  expect(first!.stopped, 'the list from before the news is no longer waited for').toBe(true);

  await second!.answer([aTerminal('t-1')]);
  expect(terminals(actor)).toEqual(['t-1']);
});

/** This window's fit was refused: the answer is the grid the pty runs at, which the list takes */
it('takes the grid its own fit was answered with', async () => {
  const actor = createActor(terminalState).start();
  actor.send({ type: 'terminal.REFRESH_LIST' });
  await latestAsk('terminal.REFRESH_LIST').answer([aTerminal('t-1')]);

  actor.send({ type: 'terminal.RESIZE', terminalId: 't-1', cols: 120, rows: 40 });
  await latestAsk('terminal.RESIZE_TERMINAL').answer({ terminalId: 't-1', cols: 80, rows: 24 });
  const held = () => (actor.getSnapshot().context as { terminals: Array<{ cols?: number; rows?: number }> }).terminals[0];
  expect(held()).toMatchObject({ cols: 80, rows: 24 });

  // A fit that took is answered with nothing, and changes nothing
  actor.send({ type: 'terminal.RESIZE', terminalId: 't-1', cols: 100, rows: 30 });
  await latestAsk('terminal.RESIZE_TERMINAL').answer(null);
  expect(held()).toMatchObject({ cols: 80, rows: 24 });
});
