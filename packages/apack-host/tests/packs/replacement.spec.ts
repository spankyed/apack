import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _createTestEngine } from '@apackdev/sdk/testing';
import { _bindEars } from '@apackdev/sdk/ears';
import { _createPackServices, type SettingsService } from '@apackdev/sdk/services';
import { startTestRuntime } from '@apackdev/sdk/testing';
import type { PackRegistration } from '@apackdev/sdk/framework';
import { createPackRegistry } from '../../src/packs/registry.ts';

startTestRuntime();

const target = { kind: 'app' } as const;
let previousEngine: ReturnType<typeof _bindEars>;
let engine: ReturnType<typeof _createTestEngine>;
beforeEach(() => {
  engine = _createTestEngine();
  previousEngine = _bindEars(engine);
});
afterEach(() => { _bindEars(previousEngine); vi.restoreAllMocks(); });

function fixture() {
  const listeners = new Set<() => void>();
  const service: SettingsService = {
    get: <T,>() => ({ value: 1 }) as T,
    set() {}, reset() {},
    onChange(listener) { const notify = () => listener('written'); listeners.add(notify); return () => { listeners.delete(notify); }; },
  };
  const registry = createPackRegistry({
    nativeDeclarations: [{ id: 'incumbent', services: { value: 'fixtures/services.ts#value' },
      repositories: { records: 'fixtures/repositories.ts#records' },
      features: { widget: { description: 'Feature declaration fixture.', designation: 'before' } } }, { id: 'peer', features: {} }],
    settingsForPack: () => service,
  });
  const generated = _createPackServices();
  const handle = generated.settingsHandle(target);
  const records = { owner: 'old' };
  const registration: PackRegistration = {
    id: 'incumbent', bindServices: generated.bindServices,
    features: { widget: { designation: 'before' } },
    repositories: { records }, services: { value: 'old' },
  };
  registry.registerPack(registration);
  const heard = vi.fn();
  handle.onChange(heard);
  const fresh = _createPackServices();
  const next: PackRegistration = {
    ...registration, bindServices: fresh.bindServices,
    features: { widget: { designation: 'after' } },
    repositories: { records: { owner: 'new' } }, services: { value: 'new' },
  };
  return { registry, handle, heard, listeners, records, registration, fresh, next };
}

function declareRepositories(registry: ReturnType<typeof createPackRegistry>, names: string[]) {
  registry.catalog.setNative(registry.catalog.getSnapshot().native.map(pack => pack.id !== 'incumbent' ? pack : {
    ...pack, repositories: Object.fromEntries(names.map(name => [name, `fixtures/repositories.ts#${name}`])),
  }));
}

/** Native composition admits the new role before its replacement runtime can bind it. */
function declareCandidateRole(registry: ReturnType<typeof createPackRegistry>) {
  registry.catalog.setNative(registry.catalog.getSnapshot().native.map(pack => pack.id !== 'incumbent' ? pack : {
    ...pack, features: { ...pack.features, widget: { ...pack.features!.widget, designation: 'after' } },
  }));
}

function assertIncumbent(f: ReturnType<typeof fixture>) {
  expect(f.registry.getPackRegistration('incumbent')).toBe(f.registration);
  expect(f.registry.designation('before')).toBe('incumbent/widget');
  expect(f.registry.designation('after')).toBeUndefined();
  expect(f.registry.getRegisteredServices().value).toBe('old');
  expect(f.registry.repository('records')).toBe(f.records);
  expect(f.handle.get()).toEqual({ value: 1 });
  for (const notify of f.listeners) notify();
  expect(f.heard).toHaveBeenCalled();
}

describe('accepted pack replacement', () => {
  it('publishes the candidate while the coordinator retains incumbent authority through actor cleanup', () => {
    const f = fixture();
    let dispose!: () => string[];
    const candidate = f.fresh.settingsHandle(target);
    declareCandidateRole(f.registry);
    expect(f.registry.replacePack(f.next, undefined, { retireBinding: cleanup => { dispose = cleanup; } })).toEqual([]);
    expect(f.registry.getPackRegistration('incumbent')).toBe(f.next);
    expect(candidate.get()).toEqual({ value: 1 });
    expect(f.handle.get()).toEqual({ value: 1 });
    expect(f.listeners.size).toBe(1);
    expect(dispose()).toEqual([]);
    expect(f.listeners.size).toBe(0);
    expect(() => f.handle.get()).toThrow('revoked');
    expect(candidate.get()).toEqual({ value: 1 });
  });

  it.each(['__proto__', 'constructor', 'toString'])('publishes, replaces and removes the exact repository key %s', name => {
    const f = fixture();
    f.next.repositories = { [name]: { owner: 'candidate' } };
    declareRepositories(f.registry, [name]);
    declareCandidateRole(f.registry);
    f.registry.replacePack(f.next);
    expect(f.registry.repository(name)).toBe(f.next.repositories[name]);
    expect(f.registry.repository('records')).toBeUndefined();
    expect(f.registry.repository('owner')).toBeUndefined();
    f.registry.unregisterPack('incumbent');
    expect(f.registry.repository(name)).toBeUndefined();
    expect(f.registry.repository('owner')).toBeUndefined();
  });

  it('retains the same incumbent handle and subscription when candidate binding refuses', () => {
    const f = fixture();
    f.next.bindServices = () => {
      assertIncumbent(f); // Reentrant reads observe accepted state while the candidate is prepared.
      throw new Error('binding refused');
    };
    declareCandidateRole(f.registry);
    expect(() => f.registry.replacePack(f.next)).toThrow('binding refused');
    assertIncumbent(f);
    expect(f.listeners.size).toBe(1);
  });

  it('revokes a port captured by a hook that binds and then throws before returning cleanup', () => {
    const f = fixture();
    const provisional = f.fresh.settingsHandle(target);
    f.next.bindServices = port => { f.fresh.bindServices(port); throw new Error('hook refused after capture'); };
    declareCandidateRole(f.registry);
    expect(() => f.registry.replacePack(f.next)).toThrow('hook refused after capture');
    expect(() => provisional.get()).toThrow('revoked');
    assertIncumbent(f);
  });

  it('does not grant candidate operations until publication accepts its runtime', () => {
    const f = fixture();
    f.next.bindServices = port => {
      expect(() => (port.services.settings as SettingsService).get(target)).toThrow('until the host accepts');
      expect(() => (port.services.settings as SettingsService).set(target, ['value'], 2)).toThrow('until the host accepts');
      return f.fresh.bindServices(port);
    };
    declareCandidateRole(f.registry);
    f.registry.replacePack(f.next);
    expect(f.fresh.settingsHandle(target).get()).toEqual({ value: 1 });
  });

  it('publishes new contributions before retiring the old binding, without removing its repositories', () => {
    const f = fixture();
    declareCandidateRole(f.registry);
    expect(f.registry.replacePack(f.next)).toEqual([]);
    expect(f.registry.getPackRegistration('incumbent')).toBe(f.next);
    expect(f.registry.designation('before')).toBeUndefined();
    expect(f.registry.designation('after')).toBe('incumbent/widget');
    expect(f.registry.getRegisteredServices().value).toBe('new');
    expect(f.registry.repository('records')).toBe(f.next.repositories!.records);
    expect(() => f.handle.get()).toThrow('revoked');
    expect(f.listeners.size).toBe(0);
    expect(f.fresh.settingsHandle(target).get()).toEqual({ value: 1 });
    f.registry.unregisterPack('incumbent');
    expect(() => f.fresh.settingsHandle(target).get()).toThrow('until the host accepts');
    expect(f.registry.repository('records')).toBeUndefined();
  });

  it('reports old cleanup failure as committed replacement and never restores the disposed runtime', () => {
    const f = fixture();
    f.registry.unregisterPack('incumbent');
    const rebound = _createPackServices();
    const cleanup = vi.fn(() => { throw new Error('cleanup refused'); });
    f.registration.bindServices = port => {
      const dispose = rebound.bindServices(port);
      return () => { dispose(); cleanup(); };
    };
    f.registry.registerPack(f.registration);
    const old = rebound.settingsHandle(target);
    declareCandidateRole(f.registry);
    expect(f.registry.replacePack(f.next)).toEqual(['cleanup refused']);
    expect(f.registry.getPackRegistration('incumbent')).toBe(f.next);
    expect(() => old.get()).toThrow('revoked');
    expect(cleanup).toHaveBeenCalledOnce();
    f.registry.unregisterPack('incumbent');
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it('revokes host-owned authority and subscriptions even when the hook omits generated cleanup', () => {
    const f = fixture();
    f.next.bindServices = port => { f.fresh.bindServices(port); return () => {}; };
    declareCandidateRole(f.registry);
    f.registry.replacePack(f.next);
    const current = f.fresh.settingsHandle(target);
    current.onChange(() => {});
    expect(f.listeners.size).toBe(1);
    f.registry.unregisterPack('incumbent');
    expect(f.listeners.size).toBe(0);
    expect(() => current.get()).toThrow('revoked');
  });

  it('retains admitted collection identities despite later authored registration mutation', () => {
    const f = fixture();
    f.registration.repositories = { foreign: {} };
    f.registration.services = { unrelated: 'mutated' };
    f.registry.registerPack({ id: 'peer' });
    expect(f.registry.getRegisteredServices()).toEqual({ value: 'old' });
    expect(f.registry.repository('records')).toBe(f.records);
    expect(f.registry.repository('foreign')).toBeUndefined();
    f.registry.unregisterPack('incumbent');
    expect(f.registry.repository('records')).toBeUndefined();
  });

  it('retires all accepted state on unload even when binding cleanup throws', () => {
    const f = fixture();
    const dispose = f.fresh.bindServices;
    f.next.bindServices = port => {
      const stop = dispose(port);
      return () => { stop(); throw new Error('unload cleanup refused'); };
    };
    declareCandidateRole(f.registry);
    f.registry.replacePack(f.next);
    const current = f.fresh.settingsHandle(target);
    expect(() => f.registry.unregisterPack('incumbent')).toThrow('unload cleanup refused');
    expect(f.registry.getPackRegistration('incumbent')).toBeNull();
    expect(f.registry.designation('after')).toBeUndefined();
    expect(f.registry.repository('records')).toBeUndefined();
    expect(() => current.get()).toThrow('revoked');
  });

  it('retires incumbent authority if coordinated cleanup cannot be scheduled', () => {
    const f = fixture();
    declareCandidateRole(f.registry);
    const errors = f.registry.replacePack(f.next, undefined, { retireBinding() { throw new Error('coordinator refused'); } });
    expect(errors).toEqual([expect.stringContaining('retirement could not be scheduled')]);
    expect(() => f.handle.get()).toThrow('revoked');
    expect(f.fresh.settingsHandle(target).get()).toEqual({ value: 1 });
    expect(f.listeners.size).toBe(0);
  });

  it('refuses reentrant mutation while letting the candidate inspect accepted state', () => {
    const f = fixture();
    f.next.bindServices = () => {
      assertIncumbent(f);
      f.registry.unregisterPack('incumbent');
      return () => {};
    };
    declareCandidateRole(f.registry);
    expect(() => f.registry.replacePack(f.next)).toThrow('change is already in progress');
    assertIncumbent(f);
  });
});
