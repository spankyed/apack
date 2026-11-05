import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => ({ ws: vi.fn(() => ({ close: vi.fn() })), client: vi.fn(() => ({})) }));
vi.mock('@trpc/client', () => ({ createWSClient: calls.ws, createTRPCClient: calls.client, wsLink: vi.fn() }));
const original = Object.getOwnPropertyDescriptor(window, 'electronAPI');
beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); });
afterEach(() => {
  if (original) Object.defineProperty(window, 'electronAPI', original);
  else Reflect.deleteProperty(window, 'electronAPI');
});
function bridge(whenReady: () => Promise<{ port: number; startupId: string }>) {
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: {
    apiPort: 3001, apiToken: 'owned-test-token', apiStatus: { whenReady },
  } });
}
it('creates no transport until readiness and connects to the authoritative selected port', async () => {
  let release!: (status: { port: number; startupId: string }) => void;
  const ready = vi.fn(() => new Promise<{ port: number; startupId: string }>(resolve => { release = resolve; }));
  bridge(ready);
  const loading = import('../../src/transport/index.ts');
  await vi.waitFor(() => expect(ready).toHaveBeenCalledOnce());
  expect(calls.ws).not.toHaveBeenCalled();
  release({ port: 4123, startupId: 'startup-1' });
  const transport = await loading;
  expect(calls.ws).toHaveBeenCalledOnce();
  expect(calls.ws).toHaveBeenCalledWith(expect.objectContaining({ url: 'ws://127.0.0.1:4123' }));
  expect(transport.reconnectApiClient(4123)).toBe(false);
  expect(calls.ws).toHaveBeenCalledOnce();
});
it('preserves startup rejection without opening a connection to the fallback port', async () => {
  bridge(async () => { throw new Error('API startup refused'); });
  await expect(import('../../src/transport/index.ts')).rejects.toThrow('API startup refused');
  expect(calls.ws).not.toHaveBeenCalled();
});
