import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ApiServer } from '../src/modules/api-server/ApiServer.ts';
import { ProcessManager, broadcastEvent } from '../src/modules/api-server/process-manager.ts';
import { API_CONFIG, API_EVENTS } from '../src/modules/api-server/config.ts';
import { IDLE_MS } from '@apackdev/sdk/progress';

vi.mock('../src/modules/api-server/logger.ts', () => ({
  logInfo: vi.fn(), logError: vi.fn(), logWarn: vi.fn(), getLogger: vi.fn(), logStartupBanner: vi.fn(),
}));
vi.mock('../src/modules/api-server/process-manager.ts', async (original) => ({
  ...await original<object>(), broadcastEvent: vi.fn(),
}));
vi.mock('../src/modules/api-server/config.ts', async (original) => ({
  ...await original<object>(), getApiPaths: () => ({ apiPath: '/api/server.js' }),
}));

const REFUSAL = 'The database at /data/ears-db is in format 9, newer than this elmdb\'s 1; update elmdb to open it';

/** An API server whose launches run nothing: each one is told how it ended, as the process's handlers would */
function server() {
  const api = new ApiServer() as unknown as {
    startApiServer(): Promise<void>;
    handleProcessExit(code: number | null, signal: NodeJS.Signals | null): void;
    handleServerReady(socket?: string): void;
    waitForReady(): Promise<void>;
    launchApiServer(apiPath: string): Promise<void>;
    cleanupOrphanedApiChildren(apiPath: string): Promise<void>;
  };
  api.launchApiServer = vi.fn(async () => {});
  api.cleanupOrphanedApiChildren = vi.fn(async () => {});
  return api;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(ProcessManager.prototype, 'isRunning').mockReturnValue(false);
  vi.spyOn(ProcessManager.prototype, 'getLastStderr').mockReturnValue('');
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it("rejects the window's wait with the API's own error once its restarts run out, not after its idle window", async () => {
  vi.spyOn(ProcessManager.prototype, 'getFatalErrors').mockReturnValue([{ message: REFUSAL }]);
  const api = server();
  const ready = api.waitForReady();
  const outcome = ready.then(() => 'ready', (error: Error) => error.message);
  await api.startApiServer();
  for (let launch = 0; launch <= API_CONFIG.MAX_RESTART_ATTEMPTS; launch++) {
    api.handleProcessExit(1, null);
    await vi.advanceTimersByTimeAsync(API_CONFIG.RESTART_DELAY);
  }
  expect(await outcome).toBe(REFUSAL);
  // Inside the window a launch doing nothing is given, so the answer is the restarts running out and not the wait
  expect(API_CONFIG.RESTART_DELAY * (API_CONFIG.MAX_RESTART_ATTEMPTS + 1)).toBeLessThan(IDLE_MS);
});

it("resolves the window's wait when a launch after a crash becomes ready", async () => {
  vi.spyOn(ProcessManager.prototype, 'getFatalErrors').mockReturnValue([{ message: 'crashed once' }]);
  const api = server();
  const ready = api.waitForReady();
  const outcome = ready.then(() => 'ready', (error: Error) => error.message);
  await api.startApiServer();
  api.handleProcessExit(1, null);
  await vi.advanceTimersByTimeAsync(API_CONFIG.RESTART_DELAY);
  api.handleServerReady();
  expect(await outcome).toBe('ready');
});


/**
 * An API server whose launches are counted as launches: each schedules the forgiveness a real one does, and the
 * process is running from its launch until the spec says it exited
 */
function supervised() {
  const running = vi.spyOn(ProcessManager.prototype, 'isRunning').mockReturnValue(false);
  const api = server() as ReturnType<typeof server> & {
    scheduleRestartResetTimeout(): void;
    /** The crashes counted against the restarts: read as the class holds it, since its status also reads the log */
    restartAttempts: number;
  };
  api.launchApiServer = vi.fn(async () => { running.mockReturnValue(true); api.scheduleRestartResetTimeout(); });
  const crash = () => { running.mockReturnValue(false); api.handleProcessExit(1, null); };
  return { api, crash };
}

it('forgives the crashes before a launch that has stayed up', async () => {
  vi.spyOn(ProcessManager.prototype, 'getFatalErrors').mockReturnValue([{ message: 'crashed once' }]);
  const { api, crash } = supervised();
  await api.startApiServer();
  crash();
  await vi.advanceTimersByTimeAsync(API_CONFIG.RESTART_DELAY);
  expect(api.restartAttempts).toBe(1);
  await vi.advanceTimersByTimeAsync(API_CONFIG.SUCCESS_CHECK_DELAY);
  expect(api.restartAttempts).toBe(0);
});

it('does not forgive a crash because the launch after it is running when the crashed one would have been forgiven', async () => {
  vi.spyOn(ProcessManager.prototype, 'getFatalErrors').mockReturnValue([{ message: REFUSAL }]);
  const { api, crash } = supervised();
  await api.startApiServer();
  // Up for less than it takes to be forgiven, then relaunched: the first launch's moment arrives with the second running
  const lived = API_CONFIG.SUCCESS_CHECK_DELAY - API_CONFIG.RESTART_DELAY - 500;
  await vi.advanceTimersByTimeAsync(lived);
  crash();
  await vi.advanceTimersByTimeAsync(API_CONFIG.RESTART_DELAY);
  await vi.advanceTimersByTimeAsync(API_CONFIG.SUCCESS_CHECK_DELAY - lived - API_CONFIG.RESTART_DELAY + 100);
  expect(api.restartAttempts).toBe(1);
});

it('runs out of restarts for an API that dies soon after each launch', async () => {
  vi.spyOn(ProcessManager.prototype, 'getFatalErrors').mockReturnValue([{ message: REFUSAL }]);
  const { api, crash } = supervised();
  const outcome = api.waitForReady().then(() => 'ready', (error: Error) => error.message);
  await api.startApiServer();
  const lived = API_CONFIG.SUCCESS_CHECK_DELAY - API_CONFIG.RESTART_DELAY - 500;
  for (let launch = 0; launch <= API_CONFIG.MAX_RESTART_ATTEMPTS; launch++) {
    await vi.advanceTimersByTimeAsync(lived);
    crash();
    await vi.advanceTimersByTimeAsync(API_CONFIG.RESTART_DELAY);
  }
  expect(await outcome).toBe(REFUSAL);
});

it('cancels a pending crash-restart timer when reloadApiServer() runs', async () => {
  vi.spyOn(ProcessManager.prototype, 'getFatalErrors').mockReturnValue([{ message: 'crashed once' }]);
  vi.spyOn(ProcessManager.prototype, 'stop').mockResolvedValue();
  const { api, crash } = supervised();
  await api.startApiServer();
  expect(api.launchApiServer).toHaveBeenCalledTimes(1);

  // Crash schedules a delayed restart timer; reload before it fires cancels that timer
  crash();
  await (api as unknown as { reloadApiServer(): Promise<void> }).reloadApiServer();
  expect(api.launchApiServer).toHaveBeenCalledTimes(2);

  // Advancing past RESTART_DELAY must NOT trigger a second launch from the old crash timer
  await vi.advanceTimersByTimeAsync(API_CONFIG.RESTART_DELAY * 2);
  expect(api.launchApiServer).toHaveBeenCalledTimes(2);
});

it('serializes concurrent startApiServer() calls across async orphan cleanup', async () => {
  const running = vi.spyOn(ProcessManager.prototype, 'isRunning').mockReturnValue(false);
  const api = server();
  let finishCleanup!: () => void;
  api.cleanupOrphanedApiChildren = vi.fn(() => new Promise<void>((resolve) => { finishCleanup = resolve; }));
  api.launchApiServer = vi.fn(async () => { running.mockReturnValue(true); });

  const first = api.startApiServer();
  const second = api.startApiServer();
  finishCleanup();
  await Promise.all([first, second]);

  expect(api.cleanupOrphanedApiChildren).toHaveBeenCalledTimes(1);
  expect(api.launchApiServer).toHaveBeenCalledTimes(1);
});

it('does not broadcast terminal api:error from handleProcessError while automatic restarts can still recover', () => {
  vi.mocked(broadcastEvent).mockClear();
  const api = server() as ReturnType<typeof server> & {
    handleProcessError(error: Error): void;
    restartAttempts: number;
  };

  api.handleProcessError(new Error('transient v8 failure'));
  expect(vi.mocked(broadcastEvent).mock.calls.filter(([ev]) => ev === API_EVENTS.ERROR)).toEqual([]);

  api.restartAttempts = API_CONFIG.MAX_RESTART_ATTEMPTS;
  api.handleProcessError(new Error('final v8 failure'));
  expect(vi.mocked(broadcastEvent).mock.calls.filter(([ev]) => ev === API_EVENTS.ERROR)).toEqual([
    [API_EVENTS.ERROR, { error: 'final v8 failure' }],
  ]);
});
