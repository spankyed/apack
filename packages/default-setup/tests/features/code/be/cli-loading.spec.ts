import { expect, it, vi } from 'vitest';
import type { ActionRun } from '#extensions/steps/action/sandbox.ts';

const loaded = vi.hoisted(() => {
  // Pack setup imports registration first; the check must observe fresh service modules.
  vi.resetModules();
  return { cli: false, zod: false };
});
vi.mock('#features/code/be/services/claude-code/index.ts', () => {
  loaded.cli = true;
  return { claudeCode: { system: { version: async () => 'test-version' }, auth: { status: async () => ({ loggedIn: false }) } } };
});
vi.mock('zod', () => {
  loaded.zod = true;
  return { z: { string: () => 'action-schema' } };
});

it('loads CLI and action schema implementations only on first use, including concurrent requests', async () => {
  const { cliService } = await import('#features/code/be/services/cli.ts');
  const { runActionCode } = await import('#extensions/steps/action/sandbox.ts');
  expect(loaded).toEqual({ cli: false, zod: false });
  const servicesForAction = vi.fn<ActionRun['servicesForAction']>();
  expect(await Promise.all([
    cliService.claudeCode.version(), cliService.claudeCode.authStatus(),
    runActionCode('return z.string()', { label: 'first-use', params: {}, servicesForAction }),
  ])).toEqual(['test-version', { loggedIn: false }, 'action-schema']);
  expect(loaded).toEqual({ cli: true, zod: true });
  expect(servicesForAction).toHaveBeenCalledWith('first-use');
});
