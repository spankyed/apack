// A test run starts no Codex: the brain's Codex flow starts the server as it begins, so every spec that runs the
// brain would otherwise launch whatever Codex the machine has installed, signed in as its user
import { expect, it, vi } from 'vitest';

const spawn = vi.hoisted(() => vi.fn());
vi.mock('child_process', async (original) => ({ ...(await original<typeof import('child_process')>()), spawn }));

it('starts no process in the test environment, and says a spec stands the service in', async () => {
  const { CodexAppServer } = await import('#features/code/be/services/codex/app-server.ts');
  const server = new CodexAppServer();

  await expect(server.start()).rejects.toThrow('not started in the test environment');

  expect(spawn).not.toHaveBeenCalled();
  expect(server.status).not.toBe('ready');
});
