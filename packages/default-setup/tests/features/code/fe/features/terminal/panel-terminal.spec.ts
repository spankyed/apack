// Which terminal the panel shows, and whether the user can see it.
//
// Two defects in that one path (T1 and T5 in the terminal integration review). The panel's replacement was
// chosen from a list the terminal that just closed was still in, so closing the panel's terminal could put
// the dead one straight back. And a terminal routed to the panel did not show the panel,
// so "Open Terminal Here" spawned a shell into a collapsed panel: the user asked for a terminal and got
// nothing they could see.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createActor } from 'xstate';
import { latestAsk, resetAsks } from '../../_support/asks.ts';

const tell = vi.hoisted(() => vi.fn());
vi.mock('#generated/events.ts', async () => ({ tell, fromAsk: (await import('../../_support/asks.ts')).fromAsk }));

const parent = vi.hoisted(() => ({ updateParentState: vi.fn(), addTabToParent: vi.fn(), getParentContext: vi.fn(() => null), sendEventToParent: vi.fn() }));
vi.mock('#features/code/fe/utils/parent-communication.ts', () => parent);

vi.mock('#features/code/fe/utils/terminal-pool.ts', () => ({ terminalPool: { dispose: vi.fn(), syncProcesses: vi.fn() } }));
vi.mock('#features/code/fe/utils/terminal-events.ts', () => ({
  terminalEventBus: { emit: vi.fn(), clearOutput: vi.fn(), prunePersistedOutputs: vi.fn() },
}));

const { terminalState } = await import('#features/code/fe/features/terminal/state.ts');

const aTerminal = (id: string) => ({ id, title: id, cwd: '/tmp' }) as never;

/** The machine given the running terminals, the way it gets them: it asks for the list, which is answered with these */
async function listTerminals(actor: { send(event: { type: 'terminal.REFRESH_LIST' }): void }, terminals: unknown[]): Promise<void> {
  actor.send({ type: 'terminal.REFRESH_LIST' })
  await latestAsk('terminal.REFRESH_LIST').answer(terminals)
}


/** What the surface was last told about its panel */
const panelUpdates = () => parent.updateParentState.mock.calls.map(([, update]) => update);

beforeEach(() => {
  tell.mockReset();
  resetAsks();
  parent.updateParentState.mockReset();
  parent.addTabToParent.mockReset();
  parent.getParentContext.mockReset().mockReturnValue(null);
});

describe('the terminal the panel shows next', () => {
  it('is never the one that just closed', async () => {
    const actor = createActor(terminalState).start();
    await listTerminals(actor, [aTerminal('t-1'), aTerminal('t-2')]);
    // The panel is showing t-1, and t-1 is what exits
    parent.getParentContext.mockReturnValue({ panelTerminalId: 't-1', openFiles: [] } as never);
    parent.updateParentState.mockReset();

    actor.send({ type: 'terminal.CLOSED', data: { terminalId: 't-1' } });

    const chosen = panelUpdates().map(update => update.panelTerminalId).filter(id => id !== undefined);
    expect(chosen, 'the dead terminal is not a terminal to show').toEqual(['t-2']);
  });

  it('is nothing at all when the one that closed was the only one', async () => {
    const actor = createActor(terminalState).start();
    await listTerminals(actor, [aTerminal('t-1')]);
    parent.getParentContext.mockReturnValue({ panelTerminalId: 't-1', openFiles: [] } as never);
    parent.updateParentState.mockReset();

    actor.send({ type: 'terminal.CLOSED', data: { terminalId: 't-1' } });

    expect(panelUpdates().map(update => update.panelTerminalId)).toEqual([null]);
  });

  it('is left alone when some other terminal closed', async () => {
    const actor = createActor(terminalState).start();
    await listTerminals(actor, [aTerminal('t-1'), aTerminal('t-2')]);
    parent.getParentContext.mockReturnValue({ panelTerminalId: 't-1', openFiles: [] } as never);
    parent.updateParentState.mockReset();

    actor.send({ type: 'terminal.CLOSED', data: { terminalId: 't-2' } });

    expect(panelUpdates().every(update => update.panelTerminalId === undefined)).toBe(true);
  });
});

describe('a terminal routed to the panel', () => {
  it('shows the panel, since a terminal the user cannot see is not one they asked for', async () => {
    const actor = createActor(terminalState).start();
    // No target: the panel is where a create goes unless a tab was asked for
    actor.send({ type: 'terminal.CREATE', cwd: '/repo' });

    await latestAsk('terminal.CREATE_TERMINAL').answer(aTerminal('t-1'));

    expect(panelUpdates()).toEqual([{ panelTerminalId: 't-1', panelTerminalExpanded: true }]);
  });

  it('does not touch the panel when a tab was asked for', async () => {
    const actor = createActor(terminalState).start();
    actor.send({ type: 'terminal.CREATE', target: 'tab' });

    await latestAsk('terminal.CREATE_TERMINAL').answer(aTerminal('t-1'));

    expect(parent.addTabToParent).toHaveBeenCalled();
    expect(panelUpdates()).toEqual([]);
  });
});
