import { expect, it, vi } from 'vitest';
import { startApp, mockService, takeSystemErrors } from '@apackdev/testing/harness';
import type { Services } from '#generated/services.ts';

it('returns the native refusal under the requesting chooser call', async () => {
  const executeIfFound = vi.fn().mockResolvedValue({ success: false, reason: 'Bypass permissions is disabled by policy' });
  mockService<Services, 'action'>('action', { executeIfFound });
  const app = await startApp({ systems: ['threads'] });
  await app.connect();
  const result = await app.ask('threads', { type: 'SET_CLAUDE_PERMISSION_MODE', threadId: 'claude-thread', mode: 'bypassPermissions' },
    { client: 'chooser-window' });
  expect(result).toMatchObject({ ok: false, failure: { message: 'Bypass permissions is disabled by policy' } });
  expect(takeSystemErrors()).toEqual([]);
  expect(executeIfFound).toHaveBeenCalledWith('CC: Update Permission Mode', { threadId: 'claude-thread', mode: 'bypassPermissions' });
});

it('does not execute an unrequested chooser change or broadcast an outcome', async () => {
  const executeIfFound = vi.fn();
  mockService<Services, 'action'>('action', { executeIfFound });
  const app = await startApp({ systems: ['threads'] });
  await app.connect();
  await app.send('threads', { type: 'SET_CLAUDE_PERMISSION_MODE', threadId: 'claude-thread', mode: 'default' });
  await app.settle();
  expect(executeIfFound).not.toHaveBeenCalled();
  expect(takeSystemErrors()).toMatchObject([{ message: 'A Claude permission change requires a requesting window' }]);
});
