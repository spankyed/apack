import { state } from '@apackdev/state';
import { createNativeFrontendTestRegistry } from '@apackdev/host/fe/testing';
import { describe, expect, it, vi } from 'vitest';
import type { PackFERegistration, SettingsPort } from '@apackdev/sdk/fe';
import type { StepDefinition } from '@apackdev/sdk/steps';
import { fakeSettings } from '@apackdev/sdk/testing';
import type { Message } from '@apackdev/sdk/events';
import type { SettingsSnapshot } from '@apackdev/sdk/types';
import { createWindowSettingsRuntime } from '../../src/fe/settings-runtime.ts';
import { createContributionCatalog } from '../../src/packs/catalog.ts';
import { appSettingsDefinition } from '../../src/features/settings/be/app-definition.ts';

const target = { kind: 'feature', featureRef: 'owner/code' } as const;
const formTarget = { kind: 'pack', packId: 'owner', groupId: 'preferences' } as const;

function binding() {
  const source = fakeSettings({ features: { 'owner/code': { limit: 1 } } });
  const dispose = vi.fn();
  const cleanup = vi.fn();
  let port!: SettingsPort;
  const hook = vi.fn((accepted: SettingsPort) => { port = accepted; return { activate() {}, dispose: cleanup }; });
  return { source, dispose, cleanup, hook, get port() { return port; }, transport: { port: source, dispose } };
}

const registration = (name: string, hook?: PackFERegistration['bindSettings']): PackFERegistration => ({
  id: 'owner', bindSettings: hook,
  features: { code: { designation: 'editor', surface: { label: name, state: state()({}) } } },
  settingsForms: { preferences: { name } }, appExtensions: { toolbar: { name } },
});

describe('prepared frontend replacement', () => {
  it('keeps published lookups and incumbent authority when the candidate binding throws', async () => {
    const packs = createNativeFrontendTestRegistry();
    const old = binding();
    packs.registerFixture(registration('Old', old.hook), old.transport);
    const previous = packs.settingsForm(formTarget);
    const notified = vi.fn();
    packs.onChanged(notified);
    const next = binding();
    expect(() => packs.replaceFixture(registration('New', port => { next.hook(port); throw new Error('refused'); }), next.transport)).toThrow('refused');
    expect(packs.settingsForm(formTarget)).toBe(previous);
    expect(packs.getRegisteredSurfaces()[0].label).toBe('Old');
    expect(old.dispose).not.toHaveBeenCalled();
    expect(old.cleanup).not.toHaveBeenCalled();
    expect(old.port.get(target)).toEqual({ limit: 1 });
    expect(() => next.port.get(target)).toThrow('revoked');
    expect((await next.port.update(target, ['limit'], 9)).status).toBe('refused');
    expect(next.dispose).toHaveBeenCalledOnce();
    expect(notified).not.toHaveBeenCalled();
  });

  it('refuses an ownership collision without touching incumbent resources or authored facets', () => {
    const packs = createNativeFrontendTestRegistry();
    const old = binding();
    packs.registerFixture(registration('Old', old.hook), old.transport);
    const next = binding();
    const step: StepDefinition = { type: 'taken', node: { label: 'Taken' } };
    packs.registerFixture({ id: 'neighbour', features: { occupied: { designation: 'reserved' } } });
    expect(() => packs.replaceFixture({ ...registration('New', next.hook), features: { code: { designation: 'reserved' } }, steps: [step] }, next.transport)).toThrow(/Designation collision/);
    expect(next.hook).not.toHaveBeenCalled();
    expect(old.cleanup).not.toHaveBeenCalled();
    expect(old.port.get(target)).toEqual({ limit: 1 });
    expect(step.fe?.components).toBeUndefined();
    expect(packs.getRegisteredSurfaces()[0].label).toBe('Old');
  });

  it('publishes a successful replacement before retirement, and observers see only active new authority', () => {
    const packs = createNativeFrontendTestRegistry();
    const old = binding();
    packs.registerFixture(registration('Old', old.hook), old.transport);
    const next = binding();
    const observed = vi.fn(() => {
      expect(packs.settingsForm(formTarget)).toMatchObject({ name: 'New' });
      expect(old.port.status()).toBe('disposed');
      expect(next.port.get(target)).toEqual({ limit: 1 });
    });
    const stop = packs.onChanged(observed);
    packs.replaceFixture(registration('New', next.hook), next.transport);
    expect(observed).toHaveBeenCalledOnce();
    expect(old.cleanup).toHaveBeenCalledOnce();
    expect(old.dispose).toHaveBeenCalledOnce();
    expect(packs.designation('editor')).toBe('owner/code');
    stop();
    packs.unregisterPackFE('owner');
    expect(next.dispose).toHaveBeenCalledOnce();
  });

  it('stages pending authority without changing published forms, then disposes only the candidate', async () => {
    const packs = createNativeFrontendTestRegistry();
    const old = binding();
    packs.registerFixture(registration('Old', old.hook), old.transport);
    const next = binding();
    const candidate = packs.prepareFixture(registration('New', next.hook), next.transport, true);
    expect(packs.settingsForm(formTarget)).toMatchObject({ name: 'Old' });
    expect(next.port.status()).toBe('loading');
    expect(() => next.port.get(target)).toThrow('before host acceptance');
    expect((await next.port.update(target, ['limit'], 3)).status).toBe('refused');
    expect(next.source.get(target)).toEqual({ limit: 1 });
    candidate.dispose();
    candidate.dispose();
    expect(next.dispose).toHaveBeenCalledOnce();
    expect(next.cleanup).toHaveBeenCalledOnce();
    expect(old.dispose).not.toHaveBeenCalled();
    expect(() => candidate.commit()).toThrow('pending');
  });

  it('refuses stale prepared publication after another registry change', () => {
    const packs = createNativeFrontendTestRegistry();
    packs.registerFixture(registration('Old'));
    const next = binding();
    const candidate = packs.prepareFixture(registration('New', next.hook), next.transport, true);
    packs.registerFixture({ id: 'other' });
    expect(() => candidate.commit()).toThrow('changed while');
    expect(packs.settingsForm(formTarget)).toMatchObject({ name: 'Old' });
    expect(next.dispose).toHaveBeenCalledOnce();
    candidate.dispose();
    expect(next.dispose).toHaveBeenCalledOnce();
    expect(packs.hasPackFE('other')).toBe(true);
  });

  it('never publishes a failed prepared host resource commit', () => {
    const packs = createNativeFrontendTestRegistry();
    packs.registerFixture(registration('Old'));
    const next = binding();
    const candidate = packs.prepareFixture(registration('New', next.hook), next.transport, true);
    expect(() => candidate.commit(() => { throw new Error('style commit refused'); })).toThrow('style commit refused');
    expect(packs.settingsForm(formTarget)).toMatchObject({ name: 'Old' });
    expect(next.dispose).toHaveBeenCalledOnce();
    candidate.dispose();
    expect(next.dispose).toHaveBeenCalledOnce();
  });

  // Activation runs before the irreversible stylesheet commit, so a refusal there can follow it. The window
  // runtime queues a binding's write for a microtask and drops it once the binding is disposed in the same turn.
  it.each([
    ['refused', () => { throw new Error('style commit refused'); }, 0],
    ['accepted', () => {}, 1],
  ] as const)('sends a write made while activating only when the commit is %s', async (_outcome, beforePublish, sent) => {
    const messages: Message[] = [];
    const window = createWindowSettingsRuntime({ send: async message => { messages.push(message); } });
    window.connected();
    await Promise.resolve(); await Promise.resolve();
    const snapshot: SettingsSnapshot = { runId: 'run', revision: 0, status: 'ready',
      catalog: createContributionCatalog(appSettingsDefinition).settings(),
      values: { app: structuredClone(appSettingsDefinition.defaults) as unknown as SettingsSnapshot['values']['app'], packs: {}, features: {} } };
    window.receive({ to: 'host/settings', event: { type: 'ASK_ANSWERED', asked: 'GET_SETTINGS', answer: { snapshot } }, answering: messages[0].call });
    const writes: Message[] = [];
    const bound = window.bindPort('owner', async message => { writes.push(message); });
    const packs = createNativeFrontendTestRegistry();
    packs.registerFixture(registration('Old'));
    const candidate = packs.prepareFixture(registration('New', port => ({
      activate() { void port.update({ kind: 'app' }, ['personal', 'name'], 'Written while activating'); },
      dispose() {},
    })), { port: bound.port, dispose: bound.dispose }, true);
    if (sent) candidate.commit(beforePublish);
    else expect(() => candidate.commit(beforePublish)).toThrow('style commit refused');
    await Promise.resolve(); await Promise.resolve();
    expect(writes.filter(message => message.event.type === 'UPDATE_SETTINGS')).toHaveLength(sent);
    expect(packs.getRegisteredSurfaces()[0].label).toBe(sent ? 'New' : 'Old');
    candidate.dispose();
    window.dispose();
  });

  it('blocks reentrant admission while preparing executable bindings', () => {
    const packs = createNativeFrontendTestRegistry();
    packs.registerFixture(registration('Old'));
    const next = binding();
    expect(() => packs.replaceFixture(registration('New', () => {
      packs.registerFixture({ id: 'nested' });
      return { activate() {}, dispose() {} };
    }), next.transport)).toThrow('already in progress');
    expect(packs.hasPackFE('nested')).toBe(false);
    expect(packs.settingsForm(formTarget)).toMatchObject({ name: 'Old' });
  });

  it('revokes retained ports and subscriptions even when generated cleanup does nothing', async () => {
    const packs = createNativeFrontendTestRegistry();
    const old = binding();
    const stop = vi.fn();
    let deliver!: () => void;
    old.source.subscribe = listener => { deliver = listener; return stop; };
    packs.registerFixture(registration('Old', old.hook), old.transport);
    const listener = vi.fn();
    old.port.subscribe(listener);
    packs.replaceFixture(registration('New'));
    deliver();
    expect(listener).not.toHaveBeenCalled();
    expect(stop).toHaveBeenCalledOnce();
    expect((await old.port.reset(target)).status).toBe('refused');
  });

  it('contains retirement failures after publication', () => {
    const packs = createNativeFrontendTestRegistry();
    const old = binding();
    old.cleanup.mockImplementation(() => { throw new Error('cleanup refused'); });
    old.dispose.mockImplementation(() => { throw new Error('transport refused'); });
    packs.registerFixture(registration('Old', old.hook), old.transport);
    expect(() => packs.replaceFixture(registration('New'))).not.toThrow();
    expect(packs.settingsForm(formTarget)).toMatchObject({ name: 'New' });
    expect(old.port.status()).toBe('disposed');
  });

  it('refuses duplicate roles within one owner before binding or loading components', () => {
    const packs = createNativeFrontendTestRegistry();
    const next = binding();
    expect(() => packs.registerFixture({ id: 'owner', bindSettings: next.hook,
      features: { first: { designation: 'editor' }, second: { designation: 'editor' } },
    }, next.transport)).toThrow('declares designation "editor" twice');
    expect(next.hook).not.toHaveBeenCalled();
    expect(next.dispose).toHaveBeenCalledOnce();
    expect(packs.designation('editor')).toBeUndefined();
  });

  it('captures feature membership and role values once', () => {
    const packs = createNativeFrontendTestRegistry();
    const id = vi.fn(() => 'owner');
    const role = vi.fn(() => 'editor');
    const features = vi.fn(() => ({ code: { get designation() { return role(); } } }));
    packs.registerPackFE({ kind: 'native', declaration: { id: 'owner', features: { code: { description: 'Fixture.', designation: 'editor' } } } },
      { get id() { return id(); }, get features() { return features(); } });
    packs.registerFixture({ id: 'other' });
    packs.unregisterPackFE('owner');
    expect(id).toHaveBeenCalledOnce();
    expect(features).toHaveBeenCalledOnce();
    expect(role).toHaveBeenCalledOnce();
    expect(packs.designation('editor')).toBeUndefined();
  });

  it('prepares removal without revoking incumbent authority until publication', () => {
    const packs = createNativeFrontendTestRegistry();
    const old = binding();
    packs.registerFixture(registration('Old', old.hook), old.transport);
    const candidate = packs.prepareUnregisterPackFE('owner');
    expect(packs.hasPackFE('owner')).toBe(true);
    expect(old.port.get(target)).toEqual({ limit: 1 });
    candidate.dispose();
    expect(packs.hasPackFE('owner')).toBe(true);
    expect(old.dispose).not.toHaveBeenCalled();
    const removal = packs.prepareUnregisterPackFE('owner');
    removal.commit();
    expect(packs.hasPackFE('owner')).toBe(false);
    expect(old.dispose).toHaveBeenCalledOnce();
    expect(old.port.status()).toBe('disposed');
    expect(packs.settingsForm(formTarget)).toBeUndefined();
  });

  it('never rereads authored collection membership during another commit or removal', () => {
    const packs = createNativeFrontendTestRegistry();
    const type = vi.fn(() => 'captured');
    const steps: StepDefinition[] = [{ get type() { return type(); }, node: { label: 'Captured' } }];
    packs.registerPackFE({ kind: 'native', declaration: { id: 'owner', steps: { captured: { node: { label: 'Captured' } } } } }, { id: 'owner', steps });
    steps.length = 0;
    packs.registerFixture({ id: 'other' });
    expect(type).toHaveBeenCalledOnce();
    expect(packs.stepBindings().get('captured')).toBeDefined();
    packs.unregisterPackFE('owner');
    expect(packs.stepBindings().get('captured')).toBeUndefined();
  });
});

it('preserves the incumbent when candidate activation throws before host resource publication', () => {
  const packs = createNativeFrontendTestRegistry();
  const old = binding();
  packs.registerFixture(registration('Old', old.hook), old.transport);
  const next = binding();
  const dispose = vi.fn();
  const beforePublish = vi.fn();
  const candidate = packs.prepareFixture(registration('New', port => {
    next.hook(port);
    return { activate() { throw new Error('activation refused'); }, dispose };
  }), next.transport, true);
  expect(() => candidate.commit(beforePublish)).toThrow('activation refused');
  expect(beforePublish).not.toHaveBeenCalled();
  expect(packs.getRegisteredSurfaces()[0].label).toBe('Old');
  expect(old.port.get(target)).toEqual({ limit: 1 });
  expect(old.dispose).not.toHaveBeenCalled();
  expect(dispose).toHaveBeenCalledOnce();
  expect(next.dispose).toHaveBeenCalledOnce();
});
