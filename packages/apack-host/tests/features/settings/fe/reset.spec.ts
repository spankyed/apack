import { expect, it, vi } from 'vitest';
import { system } from '@apackdev/state';
import { defectGuard } from '@apackdev/state/testing';
import { createSettingsMachine } from '../../../../src/features/settings/fe/machine.ts';

it('submits app resets through injected host administration and reports ingress failures', async () => {
  const reset = vi.fn(async () => { throw new Error('connection closed'); });
  const report = vi.fn();
  using guard = defectGuard();
  using sys = system({ side: 'window', onDefect: guard.onDefect });
  sys.attach({ tell: () => {}, ask: () => () => {}, follow: () => ({ stop: () => {} }) });
  const handle = sys.start('host/settings', createSettingsMachine({ reset, report, restart() {} }));

  sys.send(handle, { type: 'APP.RESET' });
  sys.send(handle, { type: 'APP.RESET' });
  expect(reset).toHaveBeenCalledTimes(1);
  await Promise.resolve();
  expect(report).toHaveBeenCalledWith('Reset failed: Error: connection closed');
  expect(sys.read(handle).data.resetting).toBe(false);
});
