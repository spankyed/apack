import { afterEach, expect, it, vi } from 'vitest';
import { _createTestEngine } from '../../src/testing/index.ts';
import { bindHost, unbindHost } from '../../src/runtime/host-runtime.ts';
import { bindFeHost, unbindFeHost } from '../../src/runtime/fe-host.ts';
import type { StepCatalogEntry } from '../../src/framework/catalog-view.ts';
import { getStepBinding, getStepDeclaration, getStepDeclarations, type StepBackendBinding } from '../../src/steps/catalog.ts';
import { stepRegistry } from '../../src/steps/registry.ts';

afterEach(() => { unbindHost(); unbindFeHost(); });
function fixture() {
  const entry: StepCatalogEntry = { type: 'memo', packId: 'author', origin: 'installed', enabled: true,
    declarationRevision: 'declaration-one', buildRevision: 'build-one', declaration: {
      node: { label: 'Memo', defaults: { tags: ['draft'] } }, runtime: { handler: 'src/handler.ts#handler' },
    } };
  const handler = vi.fn();
  const accepted: StepBackendBinding = { servicesForAction: () => ({}), packId: entry.packId, declaration: entry.declaration,
    declarationRevision: entry.declarationRevision, buildRevision: entry.buildRevision, registrationId: 'runtime-one',
    binding: { type: 'memo', node: { label: 'Memo', defaults: { tags: ['draft'] } }, runtime: { handler } } };
  const state = { entries: [entry] };
  const bindings = new Map([['memo', accepted]]);
  bindHost({ ears: _createTestEngine({ entityTypes: ['Memo'] }), appVersion: '1.0.0', services: {} as never,
    transport: {} as never, packs: { stepDeclarations: () => state.entries, stepBindings: () => bindings,
      step: (type: string) => bindings.get(type)?.binding, steps: () => [...bindings.values()].map(value => value.binding) } as never });
  return { entry, accepted, state, bindings, handler };
}

it('reads defaults from declarations without requiring or invoking the runtime', () => {
  const f = fixture(); f.bindings.clear();
  expect(getStepDeclaration('memo')).toBe(f.entry); expect(getStepDeclarations()).toEqual([f.entry]);
  expect(stepRegistry.getNode('memo')).toBe(f.entry.declaration.node);
  const defaults = stepRegistry.createNodeDefaults('memo'); (defaults.tags as string[]).push('edited');
  expect(stepRegistry.createNodeDefaults('memo')).toEqual({ nodeType: 'memo', label: 'Memo', tags: ['draft'] });
  expect(getStepBinding('memo')).toBeUndefined(); expect(f.handler).not.toHaveBeenCalled();
});

it('returns a current accepted backend without calling it', () => {
  const f = fixture(); expect(getStepBinding('memo')).toBe(f.accepted); expect(f.handler).not.toHaveBeenCalled();
});

it.each([
  ['disabled', { enabled: false }], ['missing enablement', { enabled: undefined }], ['foreign owner', { packId: 'other' }],
  ['changed declaration identity', { declarationRevision: 'next' }], ['missing declaration identity', { declarationRevision: undefined }],
  ['changed build identity', { buildRevision: 'next' }], ['missing build identity', { buildRevision: undefined }],
])('retains metadata and refuses a %s provider', (_label, change) => {
  const f = fixture(); f.state.entries = [{ ...f.entry, ...change }];
  expect(getStepBinding('memo')).toBeUndefined(); expect(stepRegistry.createNodeDefaults('memo').label).toBe('Memo');
});

it('refuses missing runtime identity, foreign wire identity and changed declaration data', () => {
  const f = fixture();
  for (const binding of [ { ...f.accepted, registrationId: '' },
    { ...f.accepted, binding: { ...f.accepted.binding, type: 'other' } },
    { ...f.accepted, declaration: { node: { label: 'Changed' } } } ]) {
    f.bindings.set('memo', binding); expect(getStepBinding('memo')).toBeUndefined();
  }
});

it('supports accepted source execution and compiled dependency metadata without inventing build receipts', () => {
  const f = fixture(); const accepted = { ...f.accepted, buildRevision: undefined }; f.bindings.set('memo', accepted);
  f.state.entries = [{ ...f.entry, buildRevision: undefined }]; expect(getStepBinding('memo')).toBe(accepted);
  f.state.entries = [{ ...f.entry, origin: 'source', enabled: undefined, buildRevision: undefined }];
  expect(getStepBinding('memo')).toBe(accepted);
  f.bindings.clear(); expect(getStepBinding('memo')).toBeUndefined(); expect(getStepDeclarations()).toHaveLength(1);
});

it('supports native runtime generations without installed declaration/build stamps', () => {
  const f = fixture(); const native = { ...f.accepted, declarationRevision: undefined, buildRevision: undefined };
  f.bindings.set('memo', native); f.state.entries = [{ ...f.entry, origin: 'native', declarationRevision: undefined, buildRevision: undefined }];
  expect(getStepBinding('memo')).toBe(native);
  f.bindings.set('memo', { ...native, declarationRevision: 'fabricated' }); expect(getStepBinding('memo')).toBeUndefined();
  f.bindings.set('memo', { ...native, buildRevision: 'fabricated' }); expect(getStepBinding('memo')).toBeUndefined();
});

it('selects a unique runtime owner before previews and refuses ambiguous ownership', () => {
  const f = fixture(); f.state.entries.push({ ...f.entry, origin: 'source' });
  expect(getStepDeclarations()).toEqual([f.entry]); expect(getStepBinding('memo')).toBe(f.accepted);
  f.state.entries.push({ ...f.entry, packId: 'other' }); expect(getStepDeclarations()).toEqual([]);
  expect(getStepBinding('memo')).toBeUndefined();
});

it('runs the enabled owner when a disabled pack declares the same step', () => {
  const f = fixture(); f.state.entries.push({ ...f.entry, packId: 'other', enabled: false });
  expect(getStepBinding('memo')).toBe(f.accepted);
});

it('keeps backend lookups on the backend when a frontend is also bound', () => {
  const f = fixture(); bindFeHost({} as never);
  expect(stepRegistry.get('memo')).toBe(f.accepted.binding); expect(getStepDeclaration('memo')).toBe(f.entry);
  unbindHost(); expect(() => stepRegistry.get('memo')).toThrow('No host is bound');
});
