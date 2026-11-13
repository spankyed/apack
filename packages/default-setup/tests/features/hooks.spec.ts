import { beforeEach, expect, it, vi } from 'vitest';
const cleanup = vi.hoisted(() => {
  vi.resetModules();
  return {
    history: vi.fn(), sizing: vi.fn(), views: vi.fn(), handles: vi.fn(), schedules: vi.fn(),
    listeners: vi.fn(), actors: vi.fn(), unavailable: undefined as Error | undefined,
  };
});
vi.mock('#generated/services.ts', () => ({ services: {
  get runHistory() {
    if (cleanup.unavailable) throw cleanup.unavailable;
    return { stopActive: cleanup.history };
  },
  repository: { chatCommands: { foldStrandedMessageText: () => 0 } },
} }));
vi.mock('#features/code/be/features/terminal.ts', async (original) => ({
  ...await original<typeof import('#features/code/be/features/terminal.ts')>(), startTerminalSizing: () => cleanup.sizing,
}));
vi.mock('#features/threads/be/claude-ui.ts', async (original) => ({
  ...await original<typeof import('#features/threads/be/claude-ui.ts')>(), clearClaudeUiViews: cleanup.views,
}));
vi.mock('#features/code/be/services/claude-code/handle-store.ts', async (original) => ({
  ...await original<typeof import('#features/code/be/services/claude-code/handle-store.ts')>(), killAllHandles: cleanup.handles,
}));
vi.mock('#features/brain/be/services/scheduler.ts', async (original) => ({
  ...await original<typeof import('#features/brain/be/services/scheduler.ts')>(), clearAllSchedules: cleanup.schedules,
}));
vi.mock('#features/brain/be/services/brain.ts', async (original) => ({
  ...await original<typeof import('#features/brain/be/services/brain.ts')>(), removeAllListeners: cleanup.listeners,
}));
vi.mock('#features/brain/be/flow-system.ts', async (original) => ({
  ...await original<typeof import('#features/brain/be/flow-system.ts')>(), clearFlowActorRegistry: cleanup.actors,
}));
import { onInit, onShutdown } from '#features/hooks.ts';
beforeEach(() => {
  cleanup.unavailable = undefined;
  for (const value of Object.values(cleanup)) if (typeof value === 'function') value.mockReset();
});
it('disposes process-local owners even when the host refuses service access', () => {
  const unavailable = new Error('Pack services are unavailable until the host accepts this runtime');
  cleanup.unavailable = unavailable;
  let failure: unknown;
  try { onShutdown(); } catch (error) { failure = error; }
  expect(failure).toBeInstanceOf(AggregateError);
  expect((failure as AggregateError).errors).toEqual([unavailable]);
  for (const dispose of [cleanup.views, cleanup.handles, cleanup.schedules, cleanup.listeners, cleanup.actors]) expect(dispose).toHaveBeenCalledOnce();
  expect(cleanup.history).not.toHaveBeenCalled();
});
it('keeps every independent cleanup attempt and original failure when disposers throw', () => {
  const history = new Error('history write refused'), views = new Error('view disposal failed');
  cleanup.history.mockImplementation(() => { throw history; });
  cleanup.views.mockImplementation(() => { throw views; });
  let failure: unknown;
  try { onShutdown(); } catch (error) { failure = error; }
  expect(failure).toBeInstanceOf(AggregateError);
  expect((failure as AggregateError).errors).toEqual([history, views]);
  for (const dispose of [cleanup.handles, cleanup.schedules, cleanup.listeners, cleanup.actors]) expect(dispose).toHaveBeenCalledOnce();
});
it('releases its sizing subscription once even if that disposer throws', () => {
  onInit();
  cleanup.sizing.mockImplementation(() => { throw new Error('sizing unsubscribe failed'); });
  expect(onShutdown).toThrow(AggregateError);
  expect(onShutdown).not.toThrow();
  expect(cleanup.sizing).toHaveBeenCalledOnce();
  expect(cleanup.handles).toHaveBeenCalledTimes(2);
});

it('retires a stored Claude handle even when the runtime service binding is unavailable', async () => {
  const handles = await vi.importActual<typeof import('#features/code/be/services/claude-code/handle-store.ts')>('#features/code/be/services/claude-code/handle-store.ts');
  const kill = vi.fn();
  const handle = { kill } as unknown as import('#features/code/be/services/claude-code/query.ts').QueryHandle;
  handles.storeHandle('shutdown-revoked-owner', handle);
  cleanup.handles.mockImplementation(handles.killAllHandles);
  cleanup.unavailable = new Error('Pack service binding has been revoked');
  try {
    expect(onShutdown).toThrow(AggregateError);
    expect(kill).toHaveBeenCalledOnce();
    expect(handles.getHandle('shutdown-revoked-owner')).toBeUndefined();
  } finally {
    handles.killAllHandles();
  }
});
