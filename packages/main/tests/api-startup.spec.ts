import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ApiServer } from '../src/modules/api-server/ApiServer.ts';
import { ProcessManager } from '../src/modules/api-server/process-manager.ts';
import { API_CONFIG } from '../src/modules/api-server/config.ts';

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
    handleServerReady(port: number): void;
    waitForReady(timeout?: number): Promise<void>;
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

it("rejects the window's wait with the API's own error once its restarts run out, not after the ready timeout", async () => {
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
  expect(API_CONFIG.RESTART_DELAY * (API_CONFIG.MAX_RESTART_ATTEMPTS + 1)).toBeLessThan(API_CONFIG.READY_TIMEOUT);
});

it("resolves the window's wait when a launch after a crash becomes ready", async () => {
  vi.spyOn(ProcessManager.prototype, 'getFatalErrors').mockReturnValue([{ message: 'crashed once' }]);
  const api = server();
  const ready = api.waitForReady();
  const outcome = ready.then(() => 'ready', (error: Error) => error.message);
  await api.startApiServer();
  api.handleProcessExit(1, null);
  await vi.advanceTimersByTimeAsync(API_CONFIG.RESTART_DELAY);
  api.handleServerReady(3000);
  expect(await outcome).toBe('ready');
});
