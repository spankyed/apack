// A terminal opens in the window that asked for it, and appears in every window's list.
import { afterEach, expect, it, vi } from 'vitest';
import { startMachine } from './_support/asks.ts';

// The pool renders a terminal with the emulator, which reaches `self` as it loads; nothing here draws anything
vi.mock('#features/code/fe/utils/terminal-pool.ts', () => ({ terminalPool: { dispose: vi.fn(), syncProcesses: vi.fn(), describe: vi.fn() } }));
vi.mock('#features/code/fe/utils/terminal-events.ts', () => ({
  terminalEventBus: { emit: vi.fn(), clearOutput: vi.fn(), prunePersistedOutputs: vi.fn() },
}));

const { terminalState } = await import('#features/code/fe/features/terminal/state.ts');

const TERMINAL_REPORTS = [
  'TERMINAL_LIST_LOADED',
  'TERMINAL_CREATED_FOR_WINDOW',
  'TERMINAL_CLOSED_REPORT',
  'TERMINAL_TAB_INFO_CHANGED',
  'TERMINAL_OPEN_TAB_REQUEST',
] as const;

const running: Array<{ stop(): void }> = [];
function startTerminal() {
  const h = startMachine(terminalState, { reports: TERMINAL_REPORTS });
  running.push(h);
  return h;
}

afterEach(() => {
  for (const h of running.splice(0)) h.stop();
});

const aTerminal = (id: string) => ({ id, title: id, cwd: '/tmp', submit: '\n' }) as never;
const terminals = (h: ReturnType<typeof startTerminal>) => h.read().data.terminals.map((t) => t.id);

it('asks for the list again on the news, and opens nothing', async () => {
  // This window never asked — it is any other window, which the broadcast also reaches
  const other = startTerminal();

  other.send({ type: 'terminal.CREATED', data: { terminalId: 't-1' } });
  expect(other.made.map(({ event }) => event), 'the news names the terminal; the list is an answer').toEqual([{ type: 'terminal.REFRESH_LIST' }]);
  await other.latestAsk('terminal.REFRESH_LIST').answer([aTerminal('t-0'), aTerminal('t-1')]);

  expect(terminals(other)).toEqual(['t-0', 't-1']);
  expect(other.reportsOf('TERMINAL_CREATED_FOR_WINDOW'), 'and nothing is routed into a panel nobody asked about').toEqual([]);
});

it('opens the terminal for the window that asked', async () => {
  const h = startTerminal();
  h.send({ type: 'terminal.CREATE', command: 'echo hi' });

  await h.asksOf('terminal.CREATE_TERMINAL')[0]!.answer(aTerminal('t-1'));

  expect(h.reportsOf('TERMINAL_CREATED_FOR_WINDOW')).toEqual([
    { type: 'TERMINAL_CREATED_FOR_WINDOW', terminalInfo: aTerminal('t-1'), target: null },
  ]);
  // The command this window typed is run in the terminal this window asked for, and nowhere else
  expect(h.tellsOf('terminal.TERMINAL_INPUT')).toEqual([
    { to: 'default-setup/code', event: expect.objectContaining({ type: 'terminal.TERMINAL_INPUT', terminalId: 't-1', data: 'echo hi\n' }) },
  ]);
});

it('opens it as a tab when that is what was asked for', async () => {
  const h = startTerminal();
  h.send({ type: 'terminal.CREATE', target: 'tab' });

  await h.asksOf('terminal.CREATE_TERMINAL')[0]!.answer(aTerminal('t-2'));

  expect(h.reportsOf('TERMINAL_CREATED_FOR_WINDOW')).toEqual([
    { type: 'TERMINAL_CREATED_FOR_WINDOW', terminalInfo: aTerminal('t-2'), target: 'tab' },
  ]);
});

it('leaves the asker with one entry and one open', async () => {
  const h = startTerminal();
  h.send({ type: 'terminal.CREATE', command: 'echo hi' });

  h.send({ type: 'terminal.CREATED', data: { terminalId: 't-3' } });
  await h.asksOf('terminal.CREATE_TERMINAL')[0]!.answer(aTerminal('t-3'));
  await h.latestAsk('terminal.REFRESH_LIST').answer([aTerminal('t-3')]);

  expect(terminals(h)).toEqual(['t-3']);
  expect(h.reportsOf('TERMINAL_CREATED_FOR_WINDOW')).toHaveLength(1);
});

it('opens two terminals asked for together the way each was asked for', async () => {
  const h = startTerminal();

  h.send({ type: 'terminal.CREATE', command: 'build' });
  h.send({ type: 'terminal.CREATE', command: 'test', target: 'tab' });
  expect(h.asksOf('terminal.CREATE_TERMINAL'), 'two asks under way at once').toHaveLength(2);

  await h.asksOf('terminal.CREATE_TERMINAL')[1]!.answer(aTerminal('t-test'));
  await h.asksOf('terminal.CREATE_TERMINAL')[0]!.answer(aTerminal('t-build'));

  // Each command in the terminal its own ask created, which is the whole of T4
  expect(h.tellsOf('terminal.TERMINAL_INPUT')).toContainEqual({
    to: 'default-setup/code',
    event: expect.objectContaining({ terminalId: 't-build', data: 'build\n' }),
  });
  expect(h.tellsOf('terminal.TERMINAL_INPUT')).toContainEqual({
    to: 'default-setup/code',
    event: expect.objectContaining({ terminalId: 't-test', data: 'test\n' }),
  });
  // And the targets likewise: the tab was the second ask's, the panel the first's
  expect(h.reportsOf('TERMINAL_CREATED_FOR_WINDOW')).toEqual([
    { type: 'TERMINAL_CREATED_FOR_WINDOW', terminalInfo: aTerminal('t-test'), target: 'tab' },
    { type: 'TERMINAL_CREATED_FOR_WINDOW', terminalInfo: aTerminal('t-build'), target: null },
  ]);
});

it('holds an intent only while its ask is outstanding, and keeps a failure to show', async () => {
  const h = startTerminal();

  h.send({ type: 'terminal.CREATE', command: 'echo hi' });
  expect(h.read().pending.create, 'one ask outstanding').toBe(1);

  await h.asksOf('terminal.CREATE_TERMINAL')[0]!.answer(aTerminal('t-1'));
  expect(h.read().pending.create, 'settled by the answer').toBe(0);

  h.send({ type: 'terminal.CREATE', command: 'fails' });
  await h.asksOf('terminal.CREATE_TERMINAL')[1]!.refuse('no shell');
  expect(h.read().pending.create, 'settled by the failure too').toBe(0);
  expect(h.read().data.failures).toEqual([{ message: 'no shell' }]);
  expect(h.reportsOf('TERMINAL_CREATED_FOR_WINDOW'), 'and nothing was opened for it').toHaveLength(1);
});

it('keeps the failure of an ask that only needed doing', async () => {
  const h = startTerminal();

  h.send({ type: 'terminal.CLOSE', terminalId: 't-gone' });
  expect(h.latestAsk('terminal.CLOSE_TERMINAL').event).toEqual({ type: 'terminal.CLOSE_TERMINAL', terminalId: 't-gone' });
  await h.latestAsk('terminal.CLOSE_TERMINAL').refuse('Terminal not found');

  expect(h.read().data.failures).toEqual([{ message: 'Terminal not found' }]);
});

it('holds every failure until it is told, and drops only the ones told', async () => {
  const h = startTerminal();
  const failures = () => h.read().data.failures;

  h.send({ type: 'terminal.CLOSE', terminalId: 't-1' });
  h.send({ type: 'terminal.RESTART', terminalId: 't-2' });
  await h.latestAsk('terminal.CLOSE_TERMINAL').refuse('first');
  await h.latestAsk('terminal.RESTART_TERMINAL').refuse('second');
  expect(failures(), 'the second does not replace the first').toEqual([{ message: 'first' }, { message: 'second' }]);

  const told = [...failures()];
  h.send({ type: 'terminal.RENAME', terminalId: 't-3', customTitle: 'x' });
  await h.latestAsk('terminal.RENAME_TERMINAL').refuse('third');
  h.send({ type: 'terminal.FAILURES_TOLD', told });
  expect(failures()).toEqual([{ message: 'third' }]);
});

it('asks for the list again when a terminal is created while it is being listed', async () => {
  const h = startTerminal();

  h.send({ type: 'CODE_STARTED' });
  h.send({ type: 'terminal.CREATED', data: { terminalId: 't-1' } });
  const [first, second] = h.asksOf('terminal.REFRESH_LIST');
  expect(first!.stopped, 'the list from before the news is no longer waited for').toBe(true);

  await second!.answer([aTerminal('t-1')]);
  expect(terminals(h)).toEqual(['t-1']);
});

it('takes the grid its own fit was answered with', async () => {
  const h = startTerminal();
  h.send({ type: 'terminal.REFRESH_LIST' });
  await h.latestAsk('terminal.REFRESH_LIST').answer([aTerminal('t-1')]);

  h.send({ type: 'terminal.RESIZE', terminalId: 't-1', cols: 120, rows: 40 });
  await h.latestAsk('terminal.RESIZE_TERMINAL').answer({ terminalId: 't-1', cols: 80, rows: 24 });
  const held = () => h.read().data.terminals[0];
  expect(held()).toMatchObject({ cols: 80, rows: 24 });

  // A fit that took is answered with nothing, and changes nothing
  h.send({ type: 'terminal.RESIZE', terminalId: 't-1', cols: 100, rows: 30 });
  await h.latestAsk('terminal.RESIZE_TERMINAL').answer(null);
  expect(held()).toMatchObject({ cols: 80, rows: 24 });
});
