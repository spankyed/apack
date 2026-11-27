// Code surface starts its panel children directly via `@apackdev/state` `starts`, so components read and send
// straight to each child handle and every child ask crosses the surface's system port with full sender identity.
import { afterEach, expect, it, vi } from 'vitest';
import { startMachine } from '../_support/asks.ts';

vi.mock('#features/code/fe/utils/terminal-pool.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#features/code/fe/utils/terminal-pool.ts')>()),
  terminalPool: { dispose: vi.fn(), syncProcesses: vi.fn(), disposeAll: vi.fn(), setCopyOnSelect: vi.fn(), setViewSettings: vi.fn() },
}));
vi.mock('#features/code/fe/utils/terminal-events.ts', () => ({
  terminalEventBus: { emit: vi.fn(), clearOutput: vi.fn(), prunePersistedOutputs: vi.fn() },
}));

const codeState = (await import('#features/code/fe/state.ts')).default;

let h: ReturnType<typeof startMachine<any, any>> | undefined;
afterEach(() => {
  h?.stop();
  h = undefined;
});

it('starts all eight panel children natively and routes child asks through the system port', async () => {
  h = startMachine(codeState, { id: 'default-setup/code' });
  h.send({ type: 'SURFACE_STARTED', ownsAppLayout: true });
  await h.latestAsk('GET_CODE_START').answer({ baseDirectory: '/work' });

  for (const name of ['explorer', 'terminal', 'search', 'commit', 'pr', 'codeActions', 'codePrompts', 'github'] as const) {
    expect(h.child(name), `child ${name} is running`).toBeDefined();
  }

  const searchHandle = h.childHandle('search');
  (h.sys.send as (to: unknown, ev: unknown) => void)(searchHandle, { type: 'search.START', query: 'needle' });

  expect(h.latestAsk('search.SEARCH_FILES').event).toMatchObject({
    type: 'search.SEARCH_FILES',
    path: '/work',
    query: 'needle',
  });
  const search = h.child('search') as { at: string; data: { searchQuery: string } };
  expect(search.at).toBe('searching');
  expect(search.data.searchQuery).toBe('needle');
});
