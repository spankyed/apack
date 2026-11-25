import { createNativePackTestRegistry } from '@apackdev/host/testing';
import { describe, expect, it } from 'vitest';
import type { HelpDocument } from '@apackdev/sdk/framework';
import { ManifestSchema, _declarationRevision } from '@apackdev/pack-format';

const article = (id: string): HelpDocument => ({ id, title: id, body: `About ${id}` });
function declaration(id: string, name: string, help?: HelpDocument[]) {
  const manifest = ManifestSchema.parse({ id, name, version: '1.0.0', extensions: { help: { path: 'help' } } });
  return { manifest, declarationRevision: _declarationRevision(manifest), dir: `/sources/${id}`, help };
}
describe('the pack-qualified help catalog', () => {
  it('keeps identical article IDs distinct across packs and sorts by display name', () => {
    const registry = createNativePackTestRegistry();
    registry.catalog.setSources([declaration('second', 'Zebra', [article('start')]), declaration('first', 'Alpha', [article('start')])]);
    expect(registry.help().articles.map(a => [a.packId, a.id])).toEqual([['first', 'start'], ['second', 'start']]);
  });
  it('updates declaration data and removes articles only when the declaration is removed', () => {
    const registry = createNativePackTestRegistry();
    registry.catalog.setSources([declaration('pack', 'Pack', [article('old')])]);
    registry.catalog.setSources([declaration('pack', 'Pack', [article('new')])]);
    expect(registry.help().articles.map(a => a.id)).toEqual(['new']);
    registry.catalog.setSources([]);
    expect(registry.help()).toEqual({ articles: [], problems: [] });
  });
  it('refuses a malformed update without losing accepted articles', () => {
    const registry = createNativePackTestRegistry();
    const good = declaration('good', 'Good', [article('valid')]);
    registry.catalog.setSources([good]);
    expect(() => registry.catalog.setSources([good, declaration('broken', 'Broken', [article('duplicate'), article('duplicate')])])).toThrow('Duplicate help article');
    expect(registry.help().articles.map(a => a.packId)).toEqual(['good']);
    expect(registry.help().problems).toEqual([]);
  });
  it('orders articles by explicit order, then title', () => {
    const registry = createNativePackTestRegistry();
    registry.catalog.setSources([declaration('pack', 'Pack', [article('z'), article('a'), { ...article('first'), order: 1 }])]);
    expect(registry.help().articles.map(a => a.id)).toEqual(['first', 'a', 'z']);
  });
  it('reports unbuilt source help without trying to load an implementation', () => {
    const registry = createNativePackTestRegistry();
    registry.catalog.setSources([declaration('unbuilt', 'Unbuilt')]);
    expect(registry.help()).toEqual({ articles: [], problems: [{ packId: 'unbuilt', message: 'Help data is unavailable; build the complete pack.' }] });
    expect(registry.getPackRegistration('unbuilt')).toBeNull();
  });
});
