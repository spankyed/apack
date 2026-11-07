import { describe, expect, it } from 'vitest';
import { ManifestSchema } from '../../src/framework/declaration-schema.ts';
import { _surfaceTargets, type SurfaceDeclaration } from '../../src/framework/surface-declaration.ts';

const parse = (surface: unknown) => ManifestSchema.safeParse({ id: 'fixture-pack', name: 'Fixture', version: '1.0.0', features: { notes: { description: 'Feature declaration fixture.', surface } } });
const surface: SurfaceDeclaration = { label: 'Notes', state: 'src/state.ts#machine', icon: { entry: 'src/icon.vue' },
  canvas: { routes: { entry: 'src/list.vue', view: 'src/view.vue' } },
  panel: 'src/panel.vue', chat: 'src/chat.vue', isPinned: true, hotkeys: [{ action: 'open', global: false }],
  options: { headerClass: 'notes' }, fallbackPanel: { label: 'Inspect', toggle: { type: 'INSPECT' }, isShown: 'src/predicate.ts#isShown' } };

describe('declarative surfaces', () => {
  it('retains routed, lazy and custom component references as data', () => {
    const parsed = parse(surface);
    expect(parsed.success).toBe(true);
    if (!parsed.success) throw parsed.error;
    expect(parsed.data.features!.notes.surface).toEqual(surface);
    expect(_surfaceTargets(surface)).toEqual([
      ['state', 'src/state.ts#machine'], ['icon', 'src/icon.vue'], ['canvas.routes.entry', 'src/list.vue'],
      ['canvas.routes.view', 'src/view.vue'], ['panel', 'src/panel.vue'], ['chat', 'src/chat.vue'],
      ['fallbackPanel.isShown', 'src/predicate.ts#isShown'],
    ]);
  });
  it.each([
    { label: ' ', state: 'src/state.ts' }, { label: 'Notes', state: 'src/state.ts#bad-name' },
    { label: 'Notes', entry: 'src/surface.ts' }, { ...surface, canvas: { routes: {} } },
    { ...surface, panel: { entry: 'src/panel.vue', load: 'lazy' } },
    { ...surface, options: { undeclared: true } },
    { ...surface, canvas: { routes: JSON.parse('{"__proto__":"src/ghost.vue","view":"src/view.vue"}') } },
  ])('refuses ambiguous or invalid surface declarations (%j)', declaration => {
    expect(parse(declaration).success).toBe(false);
  });
});
