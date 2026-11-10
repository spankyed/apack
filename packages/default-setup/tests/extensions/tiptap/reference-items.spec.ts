import { afterEach, expect, it, vi } from 'vitest';
import { computed, effectScope, onScopeDispose, ref } from 'vue';
import { startFeTestRuntime, stopFeTestRuntime } from '@apackdev/sdk/testing';
import { resolveName } from '@apackdev/sdk/ids';
import type { ReferenceCatalogEntry } from '@apackdev/sdk/framework';
import type { ReferenceBinding, ReferenceBindings, ReferenceTypeConfig } from '@apackdev/sdk/fe/references';
import { useReferenceItems } from '../../../src/extensions/tiptap/useReferenceItems.ts';

const scopes: ReturnType<typeof effectScope>[] = [];
afterEach(() => { for (const scope of scopes.splice(0)) scope.stop(); stopFeTestRuntime(); });
function fixture() {
  const featureRef = resolveName('notes', 'external');
  const entry: ReferenceCatalogEntry = { packId: 'external', featureRef, origin: 'native', enabled: true, declaration: {
    types: { memo: { category: 'memos', icon: 'NotebookText', svgElements: [] } },
    categories: { memos: { label: 'Memos', icon: 'NotebookText', useItems: 'src/ref.ts#useItems' } },
  } };
  const raw = ref([{ id: 'Memo-one', label: 'First Memo', shortCode: 'M-1', type: 'memo' }]);
  const disposed = vi.fn(); const useItems = vi.fn(() => { onScopeDispose(disposed); return raw; });
  const categoryBinding: ReferenceBinding<ReferenceBindings['categories'][string]> = { featureRef, binding: { label: 'Memos', icon: {}, useItems } };
  const typeBinding: ReferenceBinding<ReferenceTypeConfig> = { featureRef, binding: { category: 'memos', icon: {}, svgElements: [] } };
  const categories = new Map([['memos', categoryBinding]]); const types = new Map([['memo', typeBinding]]);
  const declarations = new Set<() => void>(); const accepted = new Set<() => void>();
  const state = { entries: [entry], ready: true };
  startFeTestRuntime({ application: {} as never, settings: {} as never, secrets: {} as never, client: {} as never,
    catalog: { frontend: () => [], artifacts: () => [], blocks: () => [], events: () => [], dsl: () => [], steps: () => [], status: () => state.ready ? 'ready' : 'disconnected', problem: () => undefined, references: () => state.entries,
      subscribe(listener) { declarations.add(listener); return () => { declarations.delete(listener); }; } },
    packs: { referenceTypes: () => types, referenceCategories: () => categories,
      onChanged(listener: () => void) { accepted.add(listener); return () => { accepted.delete(listener); }; } } as never });
  const category = ref<string | null>(null); const query = ref(''); const active = ref(false);
  const scope = effectScope(); scopes.push(scope);
  const reader = scope.run(() => useReferenceItems(category, query, active))!;
  const publish = () => {
    const notified = [...declarations, ...accepted];
    for (const listener of notified) listener();
  };
  const open = () => { category.value = 'memos'; active.value = true; };
  return { reader, category, query, active, scope, categories, types, categoryBinding, declarations, accepted, useItems, disposed, raw, state, publish, open };
}

it('discovers external categories without starting providers and owns only the active selection', () => {
  const f = fixture();
  expect(f.reader.categories.value).toMatchObject([{ id: 'memos', featureRef: 'external/notes' }]);
  expect(f.useItems).not.toHaveBeenCalled();
  f.open(); expect(f.useItems).toHaveBeenCalledOnce(); expect(f.reader.items.value[0].id).toBe('Memo-one');
  f.query.value = 'm-1'; expect(f.reader.items.value).toHaveLength(1);
  f.query.value = 'missing'; expect(f.reader.items.value).toEqual([]);
  f.active.value = false; expect(f.disposed).toHaveBeenCalledOnce(); expect(f.reader.items.value).toEqual([]);
  f.active.value = true; expect(f.useItems).toHaveBeenCalledTimes(2);
  f.category.value = null; expect(f.disposed).toHaveBeenCalledTimes(2);
});

it('keeps unchanged providers on unrelated publications and disposes before replacement', () => {
  const f = fixture(); f.open(); f.publish();
  expect(f.useItems).toHaveBeenCalledOnce(); expect(f.disposed).not.toHaveBeenCalled();
  const replacedDisposed = vi.fn();
  const replacement = vi.fn(() => { expect(f.disposed).toHaveBeenCalledOnce(); onScopeDispose(replacedDisposed); return ref([]); });
  f.categories.set('memos', { ...f.categoryBinding, binding: { ...f.categoryBinding.binding, useItems: replacement } });
  f.publish(); expect(replacement).toHaveBeenCalledOnce();
  f.categories.clear(); f.publish(); expect(replacedDisposed).toHaveBeenCalledOnce();
  expect(f.reader.items.value).toEqual([]);
});

it.each(['disconnect', 'disable', 'remove'] as const)('stops provider execution on %s while following metadata', change => {
  const f = fixture(); f.open();
  if (change === 'disconnect') f.state.ready = false;
  if (change === 'disable') f.state.entries = f.state.entries.map(entry => ({ ...entry, enabled: false }));
  if (change === 'remove') f.state.entries = [];
  f.publish(); expect(f.disposed).toHaveBeenCalledOnce(); expect(f.reader.items.value).toEqual([]);
  expect(f.reader.categories.value).toHaveLength(change === 'remove' ? 0 : 1);
});

it('drops unknown, inactive and wrong-category items and caps the filtered results', () => {
  const f = fixture(); f.open();
  f.raw.value.push({ id: 'Unknown', label: 'Unknown', shortCode: 'U', type: 'unknown' });
  expect(f.reader.items.value).toHaveLength(1);
  f.types.clear(); f.publish(); expect(f.reader.items.value).toEqual([]);
  expect(f.useItems).toHaveBeenCalledOnce();
  f.types.set('memo', { featureRef: resolveName('notes', 'external'), binding: { category: 'memos', icon: {}, svgElements: [] } });
  f.raw.value = Array.from({ length: 40 }, (_, index) => ({ id: `Memo-${index}`, label: `Memo ${index}`, shortCode: `M-${index}`, type: 'memo' }));
  f.publish(); expect(f.reader.items.value).toHaveLength(25);
  f.state.entries = f.state.entries.map(entry => ({ ...entry, declaration: { ...entry.declaration,
    types: { memo: { ...entry.declaration.types.memo, category: 'other' } } } }));
  f.publish(); expect(f.reader.items.value).toEqual([]);
});

it('releases provider and both publication listeners on view teardown', () => {
  const f = fixture(); f.open(); f.scope.stop();
  expect(f.disposed).toHaveBeenCalledOnce(); expect(f.declarations.size).toBe(0); expect(f.accepted.size).toBe(0);
  f.publish(); expect(f.useItems).toHaveBeenCalledOnce();
});

it('does not publish items from setup that closes its picker synchronously', () => {
  const f = fixture();
  const stopped = vi.fn();
  f.categories.set('memos', { ...f.categoryBinding, binding: { ...f.categoryBinding.binding, useItems() {
    onScopeDispose(stopped);
    f.active.value = false;
    return f.raw;
  } } });
  f.open(); expect(stopped).toHaveBeenCalledOnce(); expect(f.reader.items.value).toEqual([]);
});

it('hands a provider what was typed, so one that searches answers for it', () => {
  const f = fixture();
  f.categories.set('memos', { ...f.categoryBinding, binding: { ...f.categoryBinding.binding,
    useItems: (query: Readonly<{ value: string }>) => computed(() => query.value ? [{ id: `Memo-${query.value}`, label: `${query.value} memo`, shortCode: '', type: 'memo' }] : []) } });
  f.publish(); f.open();
  expect(f.reader.items.value).toEqual([]);
  f.query.value = 'second';
  expect(f.reader.items.value.map(item => item.id)).toEqual(['Memo-second']);
});
