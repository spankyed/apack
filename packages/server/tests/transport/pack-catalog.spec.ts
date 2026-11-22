import { expect, it, vi } from 'vitest';
import { createContributionCatalog } from '@apackdev/host/packs';
import type { PackCatalogFrame } from '@apackdev/host/packs';

const catalog = createContributionCatalog({ schema: { type: 'object' }, defaults: {} });
vi.mock('../../src/runtime/index.ts', () => ({ appPacks: { catalog } }));
const { packsRouter } = await import('../../src/transport/packs.ts');

it('streams the common declaration catalog to each window without activating bindings', async () => {
  catalog.setNative([{ id: 'native-pack', features: { view: { description: 'Feature declaration fixture.', surface: { label: 'Cold', state: 'does-not-exist.ts' } } } }]);
  const caller = packsRouter.createCaller({ client: 'catalog-test', closed: new AbortController().signal });
  const stream = await caller.catalog();
  const first: PackCatalogFrame[] = []; const second: PackCatalogFrame[] = [];
  const a = stream.subscribe({ next: value => first.push(value) });
  const b = stream.subscribe({ next: value => second.push(value) });
  try {
    expect(first[0].snapshot.native[0].features?.view.surface?.label).toBe('Cold');
    expect(first[0].runId).toBeTruthy();
    expect(second[0]).toEqual(first[0]);
    catalog.setNative([{ id: 'native-pack', features: { view: { description: 'Feature declaration fixture.', surface: { label: 'Updated', state: 'still-absent.ts' } } } }]);
    expect(first.at(-1)?.snapshot.native[0].features?.view.surface?.label).toBe('Updated');
    expect(first.at(-1)?.runId).toBe(first[0].runId);
    a.unsubscribe(); const received = first.length;
    catalog.setNative([]);
    expect(first).toHaveLength(received); expect(second.at(-1)?.snapshot.native).toEqual([]);
  } finally { a.unsubscribe(); b.unsubscribe(); }
});

it('includes disabled installed declarations while no runtime is registered', async () => {
  const manifest = { id: 'disabled-pack', name: 'Disabled', version: '1.0.0', features: {
    view: { description: 'Feature declaration fixture.', surface: { label: 'Disabled view', state: 'do-not-load.ts' } },
  } };
  const { _declarationRevision, PACK_SNAPSHOT_FORMAT } = await import('@apackdev/sdk/build');
  catalog.replace([{ dir: '/isolated/disabled-pack', enabled: false, snapshot: {
    format: PACK_SNAPSHOT_FORMAT, declarationRevision: _declarationRevision(manifest), manifest, types: { entities: {}, relKinds: {}, roles: {} }, entityDestinations: {}, eventContracts: { view: { surface: { receives: [] } } }, facades: {},
  } }]);
  const stream = await packsRouter.createCaller({ client: 'disabled-reader', closed: new AbortController().signal }).catalog();
  const received: PackCatalogFrame[] = [];
  const subscription = stream.subscribe({ next: value => received.push(value) });
  try {
    expect(received[0].snapshot.packs).toMatchObject([{ enabled: false, snapshot: { manifest: { id: 'disabled-pack', features: { view: { description: 'Feature declaration fixture.', surface: { label: 'Disabled view' } } } } } }]);
  } finally { subscription.unsubscribe(); catalog.replace([]); }
});
