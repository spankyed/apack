// Which terminal the panel shows, and whether the user can see it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startMachine } from '../../_support/asks.ts';

vi.mock('#features/code/fe/utils/terminal-pool.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#features/code/fe/utils/terminal-pool.ts')>()),
  terminalPool: { dispose: vi.fn(), syncProcesses: vi.fn(), disposeAll: vi.fn(), setCopyOnSelect: vi.fn(), setViewSettings: vi.fn() },
}));
vi.mock('#features/code/fe/utils/terminal-events.ts', () => ({
  terminalEventBus: { emit: vi.fn(), clearOutput: vi.fn(), prunePersistedOutputs: vi.fn() },
}));

const codeState = (await import('#features/code/fe/state.ts')).default;

const aTerminal = (id: string) => ({ id, title: id, cwd: '/tmp', submit: '\n' }) as never;

const running: Array<{ stop(): void }> = [];
function startCode() {
  const h = startMachine(codeState, { id: 'default-setup/code' });
  running.push(h);
  const terminalHandle = h.childHandle('terminal') as Parameters<typeof h.sys.send>[0];
  const sendTerminal = (ev: unknown) => h.sys.send(terminalHandle, ev as never);
  return { h, sendTerminal };
}

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  for (const h of running.splice(0)) h.stop();
});

async function listTerminals(
  ctx: ReturnType<typeof startCode>,
  terminals: unknown[],
): Promise<void> {
  ctx.sendTerminal({ type: 'terminal.REFRESH_LIST' });
  await ctx.h.latestAsk('terminal.REFRESH_LIST').answer(terminals);
}

describe('the terminal the panel shows next', () => {
  it('is never the one that just closed', async () => {
    const ctx = startCode();
    await listTerminals(ctx, [aTerminal('t-1'), aTerminal('t-2')]);
    ctx.h.send({ type: 'SELECT_PANEL_TERMINAL', terminalId: 't-1' });

    ctx.sendTerminal({ type: 'terminal.CLOSED', data: { terminalId: 't-1' } });

    expect(ctx.h.read().data.panelTerminalId, 'the dead terminal is not a terminal to show').toBe('t-2');
  });

  it('is nothing at all when the one that closed was the only one', async () => {
    const ctx = startCode();
    await listTerminals(ctx, [aTerminal('t-1')]);
    ctx.h.send({ type: 'SELECT_PANEL_TERMINAL', terminalId: 't-1' });

    ctx.sendTerminal({ type: 'terminal.CLOSED', data: { terminalId: 't-1' } });

    expect(ctx.h.read().data.panelTerminalId).toBeNull();
  });

  it('is left alone when some other terminal closed', async () => {
    const ctx = startCode();
    await listTerminals(ctx, [aTerminal('t-1'), aTerminal('t-2')]);
    ctx.h.send({ type: 'SELECT_PANEL_TERMINAL', terminalId: 't-1' });

    ctx.sendTerminal({ type: 'terminal.CLOSED', data: { terminalId: 't-2' } });

    expect(ctx.h.read().data.panelTerminalId).toBe('t-1');
  });
});

describe('a terminal routed to the panel', () => {
  it('shows the panel, since a terminal the user cannot see is not one they asked for', async () => {
    const ctx = startCode();
    // No target: the panel is where a create goes unless a tab was asked for
    ctx.sendTerminal({ type: 'terminal.CREATE', cwd: '/repo' });

    await ctx.h.latestAsk('terminal.CREATE_TERMINAL').answer(aTerminal('t-1'));

    expect(ctx.h.read().data.panelTerminalId).toBe('t-1');
    expect(ctx.h.read().data.panelTerminalExpanded).toBe(true);
  });

  it('does not touch the panel when a tab was asked for', async () => {
    const ctx = startCode();
    ctx.sendTerminal({ type: 'terminal.CREATE', target: 'tab' });

    await ctx.h.latestAsk('terminal.CREATE_TERMINAL').answer(aTerminal('t-1'));

    expect(ctx.h.read().data.openFiles.map((f) => f.path)).toContain('terminal:t-1');
    expect(ctx.h.read().data.panelTerminalId).toBeNull();
    expect(ctx.h.read().data.panelTerminalExpanded).toBe(false);
  });
});
