import { test, expect } from '@apackdev/testing';

test('pack loads and renders', async ({ app }) => {
  // await app.waitForSurface('your-surface-id');
  // await app.navigate('your-surface-id');
  await app.screenshot('pack-default');
});

test('app reaches connected state', async ({ app }) => {
  const state = await app.getState();
  expect(state).toBe('running.connected');
});
