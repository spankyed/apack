import { expect, it, vi } from 'vitest';
import { startApp, mockService } from '@apackdev/testing/harness';
import type { Services } from '#generated/services.ts';

it('returns the native refusal under the requesting chooser call', async () => {
  const executeIfFound = vi.fn().mockResolvedValue({ success: false, reason: 'Bypass permissions is disabled by policy' });
  mockService<Services, 'action'>('action', { executeIfFound });
  const app = await startApp({ systems: ['threads'] });
  await app.connect();
  const call = await app.send('threads', { type: 'SET_CLAUDE_PERMISSION_MODE', threadId: 'claude-thread', mode: 'bypassPermissions' },
    { sender: 'default-setup/threads', client: 'chooser-window' });
  expect(await app.nextEmit('threads', 'CLAUDE_PERMISSION_MODE_RESULT', { answering: call })).toEqual({
    type: 'CLAUDE_PERMISSION_MODE_RESULT', threadId: 'claude-thread', success: false,
    reason: 'Bypass permissions is disabled by policy',
  });
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
  expect(app.emitted('threads').filter(event => event.type === 'CLAUDE_PERMISSION_MODE_RESULT')).toEqual([]);
});
