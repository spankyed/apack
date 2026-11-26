import { afterEach, expect, it, vi } from 'vitest';
import { effectScope, watchEffect, nextTick } from 'vue';
import { bindFeHost, boundFeHost, unbindFeHost } from '../../src/runtime/fe-host.ts';
import type { PackCatalogView, StepCatalogEntry } from '../../src/framework/catalog-view.ts';
import type { StepFrontendBinding } from '../../src/fe/step-bindings.ts';
import { getStepDeclarations, getStepDeclaration, getStepBinding, onStepsChanged, useStepDeclarations } from '../../src/fe/step-reader.ts';

afterEach(unbindFeHost);
function fixture() {
  const entry: StepCatalogEntry = { type: 'memo', packId: 'author', origin: 'installed', enabled: true,
    declarationRevision: 'declaration-one', buildRevision: 'build-one', declaration: {
      node: { label: 'Memo', defaults: { tags: ['draft'] } },
      fe: { nodeConfig: { icon: 'File', category: 'data', connectionRules: { inputs: 1, outputs: 1 } } },
    } };
  const render = vi.fn();
  const accepted: StepFrontendBinding = { packId: entry.packId, declaration: entry.declaration,
    declarationRevision: entry.declarationRevision, buildRevision: entry.buildRevision, registrationId: 'runtime-one',
    binding: { type: entry.type, node: { label: 'Memo', defaults: { tags: ['draft'] } }, fe: { nodeConfig: { icon: { render }, category: 'data', connectionRules: { inputs: 1, outputs: 1 } } } } };
  const state: { status: ReturnType<PackCatalogView['status']>; entries: StepCatalogEntry[] } = { status: 'ready', entries: [entry] };
  const bindings = new Map([['memo', accepted]]);
  const catalogListeners = new Set<() => void>(); const bindingListeners = new Set<() => void>();
  bindFeHost({ application: {} as never, settings: {} as never, secrets: {} as never, client: {} as never,
    catalog: { status: () => state.status, problem: () => undefined, references: () => [], frontend: () => [], artifacts: () => [], blocks: () => [], events: () => [], dsl: () => [], steps: () => state.entries,
      subscribe(listener) { catalogListeners.add(listener); return () => { catalogListeners.delete(listener); }; } },
    packs: { stepBindings: () => bindings,
      onChanged(listener: () => void) { bindingListeners.add(listener); return () => { bindingListeners.delete(listener); }; } } as never });
  return { entry, accepted, state, bindings, render, catalogListeners, bindingListeners };
}

it('reads owned declarations and stable eligible bindings without executing components', () => {
  const f = fixture();
  expect(getStepDeclarations()).toEqual(f.state.entries);
  expect(getStepDeclaration('memo')).toBe(f.entry);
  expect(getStepBinding('memo')).toBe(f.accepted);
  expect(getStepBinding('missing')).toBeUndefined();
  expect(f.render).not.toHaveBeenCalled();
});

it.each(['loading', 'disconnected', 'error', 'disposed'] as const)('retains metadata but refuses bindings while %s', status => {
  const f = fixture(); f.state.status = status;
  expect(getStepDeclaration('memo')).toBe(f.entry);
  expect(getStepBinding('memo')).toBeUndefined();
});

it.each([
  ['disabled', { enabled: false }], ['missing enablement', { enabled: undefined }],
  ['new declaration', { declarationRevision: 'next' }], ['missing declaration identity', { declarationRevision: undefined }],
  ['new build', { buildRevision: 'next' }], ['missing build identity', { buildRevision: undefined }],
  ['foreign owner', { packId: 'other' }], ['source preview', { origin: 'source' as const }],
])('refuses %s while retaining its declared node data', (_name, change) => {
  const f = fixture(); f.state.entries = [{ ...f.entry, ...change }];
  expect(getStepDeclaration('memo')?.declaration.node.label).toBe('Memo');
  expect(getStepBinding('memo')).toBeUndefined();
});

it('refuses missing runtime identity, changed declared data, foreign types and removed implementations', () => {
  const f = fixture();
  for (const accepted of [ { ...f.accepted, registrationId: undefined },
    { ...f.accepted, declaration: { node: { label: 'Changed' } } },
    { ...f.accepted, binding: { ...f.accepted.binding, type: 'other' } } ]) {
    f.bindings.set('memo', accepted); expect(getStepBinding('memo')).toBeUndefined();
  }
  f.bindings.delete('memo'); expect(getStepBinding('memo')).toBeUndefined();
  expect(getStepDeclaration('memo')).toBe(f.entry);
});

it('matches native data without fabricated stamps and ignores object field order', () => {
  const f = fixture(); f.state.entries = [{ ...f.entry, origin: 'native', declarationRevision: undefined, buildRevision: undefined }];
  const native = { ...f.accepted, declarationRevision: undefined, buildRevision: undefined, registrationId: undefined };
  f.bindings.set('memo', native); expect(getStepBinding('memo')).toBe(native);
  f.state.entries = [{ ...f.state.entries[0], declaration: { fe: f.entry.declaration.fe, node: f.entry.declaration.node } }];
  expect(getStepBinding('memo')).toBe(native);
  f.state.entries = [{ ...f.state.entries[0], declaration: { node: { label: 'Replacement' } } }];
  expect(getStepBinding('memo')).toBeUndefined();
  f.bindings.set('memo', f.accepted); expect(getStepBinding('memo')).toBeUndefined();
});

it('prefers runtime ownership over previews and refuses ambiguous owners', () => {
  const f = fixture(); f.state.entries.push({ ...f.entry, origin: 'source' });
  expect(getStepDeclaration('memo')).toBe(f.entry); expect(getStepBinding('memo')).toBe(f.accepted);
  f.state.entries.push({ ...f.entry, packId: 'other' });
  expect(getStepDeclaration('memo')).toBeUndefined(); expect(getStepBinding('memo')).toBeUndefined();
  expect(getStepDeclarations()).toEqual([]);
  f.state.entries = [{ ...f.entry, origin: 'source' }];
  expect(getStepDeclaration('memo')).toBe(f.state.entries[0]); expect(getStepBinding('memo')).toBeUndefined();
});

it('reacts to independent publications and releases both subscriptions with its scope', async () => {
  const f = fixture(); const scope = effectScope(); const labels: string[] = [];
  scope.run(() => {
    const entries = useStepDeclarations();
    watchEffect(() => { void entries.value; labels.push(getStepBinding('memo') ? 'ready' : 'unavailable'); });
  });
  f.bindings.delete('memo'); for (const listener of f.bindingListeners) listener(); await nextTick();
  f.bindings.set('memo', f.accepted); for (const listener of f.bindingListeners) listener(); await nextTick();
  f.state.entries = [{ ...f.entry, enabled: false }]; for (const listener of f.catalogListeners) listener(); await nextTick();
  expect(labels).toEqual(['ready', 'unavailable', 'ready', 'unavailable']);
  scope.stop(); expect(f.catalogListeners.size).toBe(0); expect(f.bindingListeners.size).toBe(0);
  expect(() => useStepDeclarations()).toThrow('active Vue effect scope');
});

it('supports explicit subscription disposal', () => {
  const f = fixture(); const changed = vi.fn(); const stop = onStepsChanged(changed);
  for (const listener of f.catalogListeners) listener(); for (const listener of f.bindingListeners) listener();
  expect(changed).toHaveBeenCalledTimes(2); stop();
  expect(f.catalogListeners.size).toBe(0); expect(f.bindingListeners.size).toBe(0);
});


it.each(['declarationRevision', 'buildRevision', 'registrationId'] as const)('refuses fabricated native %s', stamp => {
  const f = fixture(); f.state.entries = [{ ...f.entry, origin: 'native', declarationRevision: undefined, buildRevision: undefined }];
  f.bindings.set('memo', { ...f.accepted, declarationRevision: undefined, buildRevision: undefined, registrationId: undefined, [stamp]: 'fabricated' });
  expect(getStepBinding('memo')).toBeUndefined();
});

it('releases the catalog listener when frontend subscription setup fails', () => {
  const f = fixture(); vi.spyOn(boundFeHost().packs, 'onChanged').mockImplementation(() => { throw new Error('closed registry'); });
  expect(() => onStepsChanged(() => {})).toThrow('closed registry');
  expect(f.catalogListeners.size).toBe(0);
});
