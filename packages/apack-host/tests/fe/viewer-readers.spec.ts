import { afterEach, expect, it, vi } from 'vitest';
import { effectScope, nextTick, watchEffect } from 'vue';
import { startFeTestRuntime } from '@apackdev/sdk/testing';
import { getArtifactBinding, getArtifactDeclarations, useArtifactDeclarations,
  getBlockBinding, getBlockDeclaration, useBlockDeclarations } from '@apackdev/sdk/fe';
import type { ArtifactCatalogEntry, BlockCatalogEntry, PackCatalogView } from '@apackdev/sdk/framework';
import { createFePackRegistry } from '../../src/fe/pack-store.ts';

let stop: (() => void) | undefined;
afterEach(() => { stop?.(); stop = undefined; });

function fixture() {
  const registry = createFePackRegistry();
  const artifact = { icon: 'FileText', fe: 'src/card.vue' };
  const block = { kind: 'input' as const, fe: 'src/answer.vue' };
  const component = { render: vi.fn() };
  const manifest = { id: 'author', name: 'Author', version: '1.0.0',
    extensions: { artifacts: { card: artifact }, blocks: { answer: block } } };
  const pack = { id: 'author', name: manifest.name, version: manifest.version, manifest, declarationRevision: 'declaration-one',
    buildRevision: 'a'.repeat(64), registrationId: 'runtime-one' };
  const registration = { id: 'author', declarationRevision: pack.declarationRevision,
    artifacts: [{ type: 'card', fe: { icon: component, component } }],
    blocks: [{ type: 'answer', kind: 'input' as const, fe: { component } }] };
  const owner = { packId: pack.id, origin: 'installed' as const, enabled: true,
    declarationRevision: pack.declarationRevision, buildRevision: pack.buildRevision };
  const state: { status: ReturnType<PackCatalogView['status']>; artifacts: ArtifactCatalogEntry[]; blocks: BlockCatalogEntry[] } = {
    status: 'ready', artifacts: [{ ...owner, type: 'card', declaration: artifact }],
    blocks: [{ ...owner, type: 'answer', declaration: block }],
  };
  const listeners = new Set<() => void>();
  stop = startFeTestRuntime({ packs: registry, catalog: { status: () => state.status, problem: () => undefined,
      artifacts: () => state.artifacts, blocks: () => state.blocks, events: () => [], dsl: () => [], steps: () => [], references: () => [], frontend: () => [],
      subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; } } });
  return { registry, pack, registration, component, state, listeners,
    publish: () => { for (const listener of listeners) listener(); },
    admit: () => registry.registerPackFE({ kind: 'loaded', pack }, registration) };
}

it('discovers viewers and input kinds before admission and keeps accepted identities without executing components', () => {
  const f = fixture();
  expect(getArtifactDeclarations()[0]?.declaration.icon).toBe('FileText');
  expect(getBlockDeclaration('answer')?.declaration.kind).toBe('input');
  expect(getArtifactBinding('card')).toBeUndefined();
  expect(getBlockBinding('answer')).toBeUndefined();
  f.admit();
  expect(getArtifactBinding('card')).toMatchObject({ packId: 'author', registrationId: 'runtime-one', buildRevision: f.pack.buildRevision });
  expect(getArtifactBinding('card')?.binding.fe?.component).toBe(f.component);
  expect(getBlockBinding('answer')?.binding.fe?.component).toBe(f.component);
  expect(f.component.render).not.toHaveBeenCalled();
  f.registry.unregisterPackFE('author');
  expect(getArtifactBinding('card')).toBeUndefined();
  expect(getBlockBinding('answer')).toBeUndefined();
  expect(getArtifactDeclarations()).toHaveLength(1);
});

it.each(['disabled', 'source', 'ambiguous', 'owner', 'declaration', 'build', 'metadata', 'disconnected'] as const)(
  'refuses executable viewers for %s catalog state while retaining metadata', reason => {
    const f = fixture(); f.admit();
    const artifact = f.state.artifacts[0]!; const block = f.state.blocks[0]!;
    const change = reason === 'disabled' ? { enabled: false } : reason === 'source' ? { origin: 'source' as const }
      : reason === 'owner' ? { packId: 'foreign' } : reason === 'declaration' ? { declarationRevision: 'changed' }
      : reason === 'build' ? { buildRevision: 'b'.repeat(64) } : {};
    f.state.artifacts = [{ ...artifact, ...change }]; f.state.blocks = [{ ...block, ...change }];
    if (reason === 'ambiguous') {
      f.state.artifacts.push({ ...artifact, packId: 'other' }); f.state.blocks.push({ ...block, packId: 'other' });
    }
    if (reason === 'metadata') {
      f.state.artifacts = [{ ...artifact, declaration: { ...artifact.declaration, icon: 'Folder' } }];
      f.state.blocks = [{ ...block, declaration: { ...block.declaration, kind: 'display' } }];
    }
    if (reason === 'disconnected') f.state.status = 'disconnected';
    expect(getArtifactBinding('card')).toBeUndefined(); expect(getBlockBinding('answer')).toBeUndefined();
    expect(getArtifactDeclarations()).toHaveLength(reason === 'ambiguous' ? 0 : 1);
  });

it('reacts to binding-only readiness, replacement and catalog-only disablement, disposing both subscriptions', async () => {
  const f = fixture(); const scope = effectScope(); const seen: unknown[][] = [];
  const subscribe = vi.spyOn(f.registry, 'onChanged');
  scope.run(() => {
    const artifacts = useArtifactDeclarations(); const blocks = useBlockDeclarations();
    watchEffect(() => { void artifacts.value; void blocks.value;
      seen.push([getArtifactBinding('card')?.binding.fe?.component, getBlockBinding('answer')?.binding.fe?.component]); });
  });
  f.admit(); await nextTick();
  const replacement = { render: vi.fn() };
  f.registry.replacePackFE({ kind: 'loaded', pack: { ...f.pack, registrationId: 'runtime-two' } }, {
    ...f.registration, artifacts: [{ type: 'card', fe: { icon: replacement, component: replacement } }],
    blocks: [{ type: 'answer', kind: 'input', fe: { component: replacement } }],
  });
  await nextTick();
  f.state.artifacts = f.state.artifacts.map(entry => ({ ...entry, enabled: false }));
  f.state.blocks = f.state.blocks.map(entry => ({ ...entry, enabled: false }));
  f.publish(); await nextTick();
  expect(seen).toEqual([[undefined, undefined], [f.component, f.component], [replacement, replacement], [undefined, undefined]]);
  expect(getArtifactBinding('card')).toBeUndefined();
  scope.stop(); expect(f.listeners.size).toBe(0);
  expect(subscribe).toHaveBeenCalledTimes(2);
  f.registry.unregisterPackFE('author'); await nextTick(); expect(seen).toHaveLength(4);
  expect(() => useArtifactDeclarations()).toThrow('active Vue effect scope');
  expect(() => useBlockDeclarations()).toThrow('active Vue effect scope');
});
