// @slow: each case starts the app on default-setup's flows and content and runs the onboarding flow through
import { expect, it } from 'vitest';
import { getTestSettings, importContent, importFlows, startApp, takeSystemErrors, type TestApp } from '@apackdev/testing/harness';
import { entry, keepAlive } from '#generated/flow-helpers.ts';
import { repository } from '#generated/repository.ts';
import { packSettings } from '#generated/settings.ts';
import { services } from '#generated/services.ts';
import { getAllFlowActorIds } from '#features/brain/be/flow-system.ts';

const initialized = (app: TestApp) => app.flowSteps('Onboarding Flow').filter(step => step.label === 'setup onboarding' && step.status === 'completed');
const thread = () => repository.threadQueries.idByRole('assistant_birth');
const progress = () => {
  const id = thread();
  return id ? repository.threadQueries.byId(id)?.context?.onboarding : undefined;
};
async function start(withRoot = true) {
  await importContent({ keys: ['actions', 'flows'] });
  if (!withRoot) {
    const root = repository.flowsQueries.rootFlow();
    if (root) repository.flowsCommands.revokeRootFlowRole(root);
  }
  return startApp({ systems: ['host/settings', 'threads', 'brain'] });
}
async function initializedOnce(app: TestApp) {
  await expect.poll(() => initialized(app).length).toBe(1);
  expect(progress()).toMatchObject({ step: 'welcome', threadId: thread() });
  expect(app.emitted('threads').some(event => event.type === 'LOAD_CHAT_THREAD')).toBe(true);
}

it('starts on readiness without keys, once across connections and preference reset', async () => {
  const app = await start();
  expect(thread()).toBeUndefined();
  const rootActors = getAllFlowActorIds().length;
  await app.connect();
  await initializedOnce(app);
  expect(getAllFlowActorIds()).toHaveLength(rootActors + 1);
  const first = thread();
  const state = structuredClone(progress());
  await app.connect();
  await app.connect();
  const reset = await app.send('host/settings', { type: 'RESET_ALL_SETTINGS' }, { settingsAccess: { kind: 'host', service: getTestSettings() }, sender: 'host/settings', client: 'c-window' });
  await app.nextEmit('host/settings', 'SETTINGS_SAVED', { answering: reset });
  await app.settle();
  expect(initialized(app)).toHaveLength(1);
  expect(getAllFlowActorIds()).toHaveLength(rootActors + 1);
  expect(thread()).toBe(first);
  expect(progress()).toEqual(state);
  expect(packSettings.forGroup('assistant').get()).toEqual({ name: '' });
});

it('waits for a usable root when the client arrives first', async () => {
  const app = await start(false);
  await app.connect();
  expect(thread()).toBeUndefined();
  expect(takeSystemErrors()).toHaveLength(1);
  const flow = repository.flowsQueries.list().flows.find(flow => flow.label === 'Root Flow');
  expect(flow).toBeDefined();
  repository.flowsCommands.grantRootFlowRole(flow!.id!);
  await app.send('brain', { type: 'START_BRAIN' });
  await initializedOnce(app);
});

it('queues readiness while paused and initializes after resume', async () => {
  const app = await start();
  await app.send('brain', { type: 'PAUSE_BRAIN' });
  await app.connect();
  expect(thread()).toBeUndefined();
  await app.send('brain', { type: 'RESUME_BRAIN' });
  await initializedOnce(app);
});

it('resumes existing progress after data replacement and explicit restart', async () => {
  const app = await start();
  await app.connect();
  await initializedOnce(app);
  const first = thread();
  const state = structuredClone(progress());
  await app.send('brain', { type: 'DATA_REPLACED' });
  expect(app.system('brain').getSnapshot().matches('stopped')).toBe(true);
  await app.connect();
  expect(initialized(app)).toHaveLength(1);
  await app.send('brain', { type: 'START_BRAIN' });
  await expect.poll(() => initialized(app).length).toBe(2);
  expect(initialized(app)[1]?.result).toMatchObject({ created: false });
  expect(thread()).toBe(first);
  expect(progress()).toEqual(state);
  await app.connect();
  expect(initialized(app)).toHaveLength(2);
});

it('leaves completed onboarding alone', async () => {
  services.onboarding.complete();
  const app = await start();
  await app.connect();
  expect(initialized(app)).toEqual([]);
  expect(thread()).toBeUndefined();
});

it('lets an authored root opt out of onboarding', async () => {
  await importContent({ keys: ['actions', 'flows'] });
  importFlows({ Custom: { root: true, tracks: [entry([keepAlive()])] } });
  const app = await startApp({ systems: ['host/settings', 'threads', 'brain'] });
  await app.connect();
  expect(initialized(app)).toEqual([]);
  expect(thread()).toBeUndefined();
});

it('discards paused readiness when the root is replaced', async () => {
  const app = await start();
  await app.send('brain', { type: 'PAUSE_BRAIN' });
  await app.connect();
  expect(thread()).toBeUndefined();
  await app.send('brain', { type: 'DATA_REPLACED' });
  await app.send('brain', { type: 'START_BRAIN' });
  await initializedOnce(app);
  await app.connect();
  expect(initialized(app)).toHaveLength(1);
});

it('keeps delayed readiness bound to its root across consecutive restarts', async () => {
  const app = await start();
  await app.connect();
  await initializedOnce(app);
  const first = thread();
  const actors = getAllFlowActorIds().length;
  app.system('brain').send({ type: 'RESTART_BRAIN' });
  app.system('brain').send({ type: 'RESTART_BRAIN' });
  await app.settle();
  await expect.poll(() => initialized(app).length).toBe(2);
  expect(thread()).toBe(first);
  expect(getAllFlowActorIds()).toHaveLength(actors);
  expect(initialized(app)[1]?.result).toMatchObject({ created: false });
});
