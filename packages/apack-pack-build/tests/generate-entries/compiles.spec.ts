// @slow: each case builds a TypeScript program over generated sends, services and views, which is the subject rather than a detail
// That the generated sends, services and views actually type-check.
// Settings compilation cases live alongside in `compiles-settings.spec.ts` so the two halves run in parallel.
import { buildSync } from 'esbuild';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PackSnapshot } from '@apackdev/pack-format';
import { execFileWhileWorking } from '@apackdev/sdk/progress';
import { setupPackFixture, dependency, facade, generatePackFiles, manifest, root, system, withSurface, withSurfaceState, write, writeSurfaceState, writeSystemEntry } from './_support/pack.ts';
import { typecheck } from './_support/typecheck.ts';

setupPackFixture();

/** A dependency whose facade declares `systems` (feature id → incoming event type) */
function typedDependency(systems: Record<string, string>): PackSnapshot {
  const events = Object.entries(systems).map(([id, type]) => `'${id}': { type: '${type}'; n: number }`).join('; ');
  return dependency({ features: Object.keys(systems).map((id) => system(id)) }, facade({ PackSystemEvents: `{ ${events} }` }));
}

describe('generated sends compile', () => {
  it('for feature ids that match generated names, beside a dependency with the same feature ids', async () => {
    const ids = ['foo', 'fooEntry', 'specs', 'specEvents', 'ref', 'openSurface', 'registration', 'steps'];
    for (const id of ids) writeSystemEntry(id, "{ type: 'DONE' }", `{ type: '${id.toUpperCase()}_RUN'; n: number }`);
    const files = await generatePackFiles(manifest({ features: ids.map((id) => ({ ...system(id), designation: id === 'foo' ? 'foo' : undefined })) }), {
      packRoot: root,
      depSnapshots: new Map([['base-pack', typedDependency({ foo: 'BASE_FOO_RUN', calendar: 'CALENDAR_RUN' })]]),
    });
    write('src/probe.ts', [
      "import { tell } from './__generated__/events.ts';",
      ...ids.map((id) => `tell('${id}', { type: '${id.toUpperCase()}_RUN', n: 1 });`),
      "tell('base-pack/foo', { type: 'BASE_FOO_RUN', n: 1 });",
      '// @ts-expect-error the own foo system receives FOO_RUN',
      "tell('foo', { type: 'BASE_FOO_RUN', n: 1 });",
    ].join('\n'));
    expect(typecheck(files, ['src/probe.ts', 'src/__generated__/pack-entry.ts'], true)).toEqual([]);
  });

  it("for a pack without systems, sending to its dependencies'", async () => {
    const files = await generatePackFiles(manifest({ features: [{ id: 'sidebar', surface: { label: 'Fixture', state: writeSurfaceState('src/features/sidebar/fe/surface.ts') } }] }), {
      packRoot: root,
      depSnapshots: new Map([['base-pack', typedDependency({ calendar: 'CALENDAR_RUN' })]]),
    });
    write('src/probe.ts', [
      "import { tell } from './__generated__/events.ts';",
      "tell('base-pack/calendar', { type: 'CALENDAR_RUN', n: 1 });",
      '// @ts-expect-error CALENDAR_RUN needs its n',
      "tell('base-pack/calendar', { type: 'CALENDAR_RUN' });",
      '// @ts-expect-error the pack has no system of its own',
      "tell('sidebar', { type: 'CALENDAR_RUN', n: 1 });",
    ].join('\n'));
    expect(typecheck(files, ['src/probe.ts'])).toEqual([]);
  });

  it("to a dependency's surfaces and a host surface, with the events their owner declares", async () => {
    writeSystemEntry('memos', "{ type: 'MEMO_ADDED'; text: string }");
    const base = dependency(
      { features: [withSurface(system('calendar')), withSurface(system('code'))] },
      withSurfaceState(facade({ PackSurfaceEvents: "{ 'calendar': { type: 'TAG_ADDED'; name: string }; 'code': { type: 'FILE_OPENED'; path: string } }" }), ['calendar', 'code']),
    );
    const files = await generatePackFiles(
      manifest({ features: [withSurface(system('memos'))] }),
      { packRoot: root, depSnapshots: new Map([['base-pack', base]]) },
    );
    write('src/probe.ts', [
      "import { sendToSurface } from './__generated__/events.ts';",
      "sendToSurface('memos', { type: 'MEMO_ADDED', text: 'x' });",
      "sendToSurface('base-pack/calendar', { type: 'TAG_ADDED', name: 'x' });",
      "sendToSurface('base-pack/code', { type: 'FILE_OPENED', path: 'x' });",
      "sendToSurface('host/application', { type: 'SURFACE_VISIBILITY_UPDATED', surfaceVisibility: { 'demo-pack/memos': false } });",
      "// @ts-expect-error a dependency's surface takes only the events its own pack declares for it",
      "sendToSurface('base-pack/calendar', { type: 'MEMO_ADDED', text: 'x' });",
      "// @ts-expect-error a dependency's surface is named <pack>/<feature>, as the send resolves it",
      "sendToSurface('calendar', { type: 'TAG_ADDED', name: 'x' });",
      '// @ts-expect-error the host declares what its application surface receives',
      "sendToSurface('host/application', { type: 'MEMO_ADDED', text: 'x' });",
    ].join('\n'));
    expect(typecheck(files, ['src/probe.ts'])).toEqual([]);
  });
});

it('preserves prototype-like entity wires in generated registrations and typed/untyped EARS', async () => {
  write('src/shape.ts', 'throw new Error("shape modules must never execute");\nexport interface EntityShape { title: string }\n');
  const fields = { data: { entities: Object.fromEntries([['__proto__', { shape: 'src/shape.ts#EntityShape' }], ['Untyped', {}]]) } };
  const files = await generatePackFiles(manifest(fields), { packRoot: root });
  write('src/probe.ts', `import { EARS, type EntityShape } from './__generated__/ears.ts';
    import { registration } from './__generated__/pack-entry.ts';
    function check(typed: EntityShape<'__proto__'>, untyped: EntityShape<'Untyped'>) {
      const title: string = typed.title;
      // @ts-expect-error a declared string field is not a number
      const bad: number = typed.title;
      const extra: unknown = untyped.extra;
      // @ts-expect-error untyped entities do not acquire typed fields
      const invented: string = untyped.extra;
    }
    const wire: EARS.Entity.__proto__ = EARS.Entity.__proto__;
    if (wire !== '__proto__' || !Object.hasOwn(EARS.Entity, '__proto__')) throw new Error('EARS wire lost');
    if (registration.ears?.entities?.['__proto__'] !== wire || !Object.hasOwn(registration.ears.entities, '__proto__')) throw new Error('Registration wire lost');
    if (Object.getPrototypeOf(registration.ears.entities) !== Object.prototype) throw new Error('Prototype changed');
  `);
  expect(typecheck(files, ['src/probe.ts'])).toEqual([]);
  const outfile = path.join(root, 'probe.mjs');
  buildSync({ entryPoints: [path.join(root, 'src/probe.ts')], outfile,
    bundle: true, platform: 'node', format: 'esm', external: ['@apackdev/sdk/*', '@elmdb/ears'] });
  await execFileWhileWorking(process.execPath, [outfile]);
});

it('keeps retained backend service roots retired across rebind and failed cleanup', async () => {
  const files = await generatePackFiles(manifest({}), { packRoot: root });
  write('src/probe.ts', `
    import type { SettingsService } from '@apackdev/sdk/services';
    import { services, servicesForAction, bindServices } from './__generated__/services.ts';
    let cleanupFails = false;
    const settings: SettingsService = {
      get: <T,>() => ({ count: 10 } as T), set() {}, reset() {},
      onChange: () => () => { if (cleanupFails) throw new Error('Cleanup failed'); },
    };
    function retired(root: typeof services) {
      try { root.settings.get({ kind: 'app' }); }
      catch (error) { if (String(error).includes('revoked')) return; throw error; }
      throw new Error('Retained root was revived');
    }
    const first = services;
    const firstFactory = servicesForAction;
    const dispose = bindServices({ services: { settings }, servicesForAction: () => ({ settings }) });
    if (first !== services) throw new Error('Initial binding lost its constructed frame');
    if (services.settings.get<{ count: number }>({ kind: 'app' }).count !== 10) throw new Error('Missing bound settings');
    dispose();
    if (first === services) throw new Error('Disposal retained the old root');
    retired(first);
    let refusedFactory = false;
    try { firstFactory('retired'); } catch (error) { refusedFactory = String(error).includes('revoked'); }
    if (!refusedFactory) throw new Error('Retained action factory was revived');
    const second = services;
    const disposeSecond = bindServices({ services: { settings }, servicesForAction: () => ({ settings }) });
    retired(first);
    services.settings.onChange(() => {});
    cleanupFails = true;
    let failed = false;
    try { disposeSecond(); } catch { failed = true; }
    if (!failed) throw new Error('Cleanup error was swallowed');
    if (second === services) throw new Error('Failed cleanup retained the old export');
    retired(second);
    cleanupFails = false;
    const disposeThird = bindServices({ services: { settings }, servicesForAction: () => ({ settings }) });
    retired(first);
    retired(second);
    if (services.settings.get<{ count: number }>({ kind: 'app' }).count !== 10) throw new Error('Rebind did not publish a fresh root');
    disposeThird();
  `);
  expect(typecheck(files, ['src/probe.ts'])).toEqual([]);
  const outfile = path.join(root, 'probe.mjs');
  buildSync({ entryPoints: [path.join(root, 'src/probe.ts')], outfile,
    bundle: true, platform: 'node', format: 'esm', external: ['@apackdev/sdk/*'] });
  await execFileWhileWorking(process.execPath, [outfile]);
});

it('typechecks only consumed host APIs and directly owned dependency service members', async () => {
  const snapshot = dependency({ services: { search: 'unavailable.ts#search', hidden: 'unavailable.ts#hidden' } },
    facade({ Services: '{ search: { read(): string }; hidden: { read(): string } }' }));
  const files = await generatePackFiles(manifest({ dependencies: { 'base-pack': '*' },
    consumes: { services: ['host/onboarding', 'base-pack/search'] },
  }), { packRoot: root, depSnapshots: new Map([['base-pack', snapshot]]) });
  write('src/probe.ts', `import { services } from './__generated__/services.ts';
    services.onboarding.isComplete(); services.search.read();
    services.appData.reset(); services.hidden.read();`);
  const diagnostics = typecheck(files, ['src/probe.ts']);
  expect(diagnostics).toHaveLength(2);
  expect(diagnostics.every(diagnostic => diagnostic.includes('src/probe.ts'))).toBe(true);
  expect(diagnostics.join('\n')).toContain("Property 'appData' does not exist");
  expect(diagnostics.join('\n')).toContain("Property 'hidden' does not exist");
});

describe('generated views compile', () => {
  it("type useView and fromView by each feature's declaration: its names, its arguments and its result", async () => {
    write('src/features/notes/be/views.ts', [
      "import { defineViews } from '@apackdev/sdk/framework';",
      'export const noteViews = defineViews({',
      "  all: () => ['a'],",
      '  page: ({ page }: { page: number }) => ({ page, titles: [] as string[] }),',
      '});',
    ].join('\n'));
    const files = await generatePackFiles(manifest({ features: [{
      ...withSurface(system('notes')),
      views: 'src/features/notes/be/views.ts#noteViews',
    }] }), { packRoot: root });
    expect(files['src/__generated__/pack-entry.ts']).toContain("import { noteViews as __views_notes } from '../features/notes/be/views.ts';");
    expect(files['src/__generated__/pack-entry.ts']).toContain('      views: __views_notes');
    expect(files['src/__generated__/state.ts'], 'state.ts names the views module for its types alone and carries no Vue')
      .toContain("import type { noteViews as __views_notes } from '../features/notes/be/views.ts';");
    expect(files['src/__generated__/state.ts']).not.toMatch(/\bvue\b/i);
    expect(files['src/__generated__/fe.ts'], 'fe.ts re-exports PackViews from state.ts without value-importing the views module')
      .toContain("import type { PackViews } from './state.ts';");
    expect(files['src/__generated__/fe.ts']).not.toContain('../features/notes/be/views.ts');
    expect(files['src/__generated__/pack-types.ts']).toContain("export type { PackViews } from './state.ts';");
    write('src/probe.ts', [
      "import { useView } from './__generated__/fe.ts';",
      "const all: string[] | undefined = useView('notes', 'all').data;",
      "const page: number | undefined = useView('notes', 'page', { page: 1 }).data?.page;",
      "useView('notes', 'page', () => null);",
      '// @ts-expect-error a view with arguments needs them',
      "useView('notes', 'page');",
      '// @ts-expect-error and takes the ones it declares',
      "useView('notes', 'page', { page: 'one' });",
      '// @ts-expect-error a view the feature does not declare',
      "useView('notes', 'missing');",
      "import { fromView } from './__generated__/fe.ts';",
      "fromView('notes', 'page', (update, args) => ({ type: 'PAGE.READ', page: args.page, titles: update.ok ? update.value.titles : [] }));",
      '// @ts-expect-error a machine reads the result the view declares',
      "fromView('notes', 'all', (update) => ({ type: 'ALL.READ', count: update.ok ? update.value.length + update.value.nope : 0 }));",
      'void all; void page;',
    ].join('\n'));
    expect(typecheck(files, ['src/probe.ts', 'src/__generated__/pack-entry.ts'])).toEqual([]);
  });

  it('refuses a views export that is not the object defineViews returns', async () => {
    write('src/features/notes/be/views.ts', 'export function noteViews() { return {}; }\n');
    await expect(generatePackFiles(manifest({ features: [{ ...system('notes'), views: 'src/features/notes/be/views.ts#noteViews' }] }), { packRoot: root }))
      .rejects.toThrow('Feature "notes": views: "noteViews" in src/features/notes/be/views.ts must export the object defineViews returns');
  });
});

describe('generated #generated/state compiles', () => {
  it('binds PackNet with bare own refs, qualified dependency/host refs, normalized asks, and Vue-free PackViews', async () => {
    write('src/features/notes/be/contract.ts', [
      'export type Contract = {',
      "  incoming: { type: 'NOTE_PING'; id: string };",
      '  asks: {',
      '    GET_NOTE: { args: { id: string }; answer: { title: string }; refuses: { "not-found": {} } };',
      '    EMPTY_TRASH: {};',
      '  };',
      "  internal: { type: 'INTERNAL_ONLY' };",
      "  outgoing: { type: 'NOTE_SAVED'; id: string };",
      '};',
    ].join('\n'));
    write('src/features/notes/be/system.ts', [
      "import { defineSystem } from '@apackdev/sdk/framework';",
      "import type { Contract } from './contract.ts';",
      'export default { spec: defineSystem<Contract>(), machine: undefined as never };',
    ].join('\n'));
    write('src/features/notes/be/views.ts', [
      "import { defineViews } from '@apackdev/sdk/framework';",
      'export const noteViews = defineViews({',
      "  all: () => ['a'],",
      '  byId: ({ id }: { id: string }) => ({ id, title: "t" }),',
      '});',
    ].join('\n'));
    const depViewsFacade = `${facade({
      PackSystemEvents: "{ 'memos': { type: 'MEMO_PING'; n: number } | { type: 'GET_MEMO'; id: string } }",
      PackSystemAsks: "{ 'memos': { GET_MEMO: { args: { id: string }; answer: { text: string } }; PING_MEMO: {} } }",
      PackSurfaceEvents: "{ 'memos': { type: 'MEMO_OPENED'; id: string } }",
    })['pack-types']}\nexport type PackSurfaceState = { 'memos': never };\nexport type PackViews = { 'memos': { list: () => string[]; one: (args: { id: string }) => string } };`;
    const dep = dependency(
      {
        features: [{
          id: 'memos',
          description: 'Memos.',
          system: { entry: 'x' },
          surface: { label: 'Memos', state: 'y' },
          views: 'z#memoViews',
        }],
      },
      { 'pack-types': depViewsFacade },
    );
    const files = await generatePackFiles(
      manifest({
        features: [{
          ...withSurface(system('notes'), "{ type: 'NOTE_FOCUS'; id: string }"),
          views: 'src/features/notes/be/views.ts#noteViews',
        }],
      }),
      { packRoot: root, depSnapshots: new Map([['base-pack', dep]]) },
    );

    expect(files['src/__generated__/state.ts']).not.toMatch(/\bvue\b/i);
    expect(files['src/__generated__/pack-types.ts']).toContain("export type { PackViews } from './state.ts';");

    write('src/probe.ts', [
      "import type { Net } from '@apackdev/state';",
      "import { state, type PackNet } from './__generated__/state.ts';",
      'type _CheckNet<T extends Net> = T;',
      'type _PackNetExtendsNet = _CheckNet<PackNet>;',
      'const machine = state<{ data: { id: string } }, { type: "RUN" }>()({',
      '  data: { id: "1" },',
      '  follows: (follow) => ({',
      '    allNotes: follow("notes", "all", { updated: () => {} }),',
      '    oneNote: follow("notes", "byId", { from: ["id"], args: ({ id }) => ({ id }), updated: () => {} }),',
      '    depList: follow("base-pack/memos", "list", { updated: () => {} }),',
      '    depOne: follow("base-pack/memos", "one", { from: ["id"], args: ({ id }) => ({ id }), updated: () => {} }),',
      '  }),',
      '  loads: (load) => ({',
      '    note: load("notes", "GET_NOTE", { from: ["id"], args: ({ id }) => ({ id }), done: () => {} }),',
      '    trash: load("notes", "EMPTY_TRASH", { done: () => {} }),',
      '    depMemo: load("base-pack/memos", "GET_MEMO", { from: ["id"], args: ({ id }) => ({ id }), done: () => {} }),',
      '    depPing: load("base-pack/memos", "PING_MEMO", { done: () => {} }),',
      '    // @ts-expect-error wrong ask args rejected',
      '    badArgs: load("notes", "GET_NOTE", { from: ["id"], args: () => ({ id: 123 }), done: () => {} }),',
      '  }),',
      '  on: {',
      '    RUN: (_ev, { tell, broadcast }) => {',
      '      tell("notes", { type: "NOTE_PING", id: "1" });',
      '      tell("base-pack/memos", { type: "MEMO_PING", n: 1 });',
      '      tell("host/bus", { type: "PACK_CHANGED", packId: "demo-pack" });',
      '      broadcast("notes", { type: "NOTE_SAVED", id: "1" });',
      '      broadcast("notes", { type: "NOTE_FOCUS", id: "1" });',
      '      broadcast("base-pack/memos", { type: "MEMO_OPENED", id: "1" });',
      '      broadcast("host/settings", { type: "CLI_TEST_RESULT", provider: "codex", success: true });',
      '      // @ts-expect-error asks are disjoint from tell events on own systems',
      '      tell("notes", { type: "GET_NOTE", id: "1" });',
      '      // @ts-expect-error internal events are never in PackNet',
      '      tell("notes", { type: "INTERNAL_ONLY" });',
      '      // @ts-expect-error asks are stripped from dependency PackSystemEvents',
      '      tell("base-pack/memos", { type: "GET_MEMO", id: "1" });',
      '      // @ts-expect-error own systems use bare feature ids, not qualified refs',
      '      tell("demo-pack/notes", { type: "NOTE_PING", id: "1" });',
      '    },',
      '  },',
      '});',
      'const resolvedOwn: string | undefined = machine.resolve?.("notes");',
      'void resolvedOwn;',
      'export type { _PackNetExtendsNet };',
    ].join('\n'));
    expect(typecheck(files, ['src/probe.ts', 'src/__generated__/state.ts'], true)).toEqual([]);
  });

  it('omits PackViews from pack-types.ts and state.ts when no feature declares views', async () => {
    const dep = dependency({ features: [system('memos')] }, facade());
    const files = await generatePackFiles(manifest({ features: [system('notes')] }), {
      packRoot: root,
      depSnapshots: new Map([['base-pack', dep]]),
    });
    expect(files['src/__generated__/pack-types.ts']).not.toContain('PackViews');
    expect(files['src/__generated__/state.ts']).not.toContain('PackViews');
    expect(files['src/__generated__/state.ts']).toContain('views: {};');
    expect(typecheck(files, ['src/__generated__/state.ts'], true)).toEqual([]);
    expect(typecheck(files, ['src/__generated__/pack-types.ts'])).toEqual([]);
  });
});

describe('generated #generated/state-fe compiles', () => {
  it('binds @apackdev/state surfaces (default & named exports, children) while filtering out unmigrated XState surfaces', async () => {
    write('src/features/notes/fe/state.ts', [
      "import { given, state } from '@apackdev/state';",
      "import type { Each } from '@apackdev/state';",
      'const detail = state<{ data: { title: string } }, { type: "RENAME"; title: string }>()({',
      '  data: { title: given },',
      '  on: { RENAME: (ev) => ({ data: { title: ev.title } }) },',
      '});',
      'const card = state<{ data: { label: string } }, { type: "PING" }>()({',
      '  data: { label: given },',
      '  on: { PING: () => {} },',
      '});',
      'const notesSurface = state<{',
      '  data: { selected: string; cardIds: Record<string, string> };',
      '  starts: { detail: typeof detail; card: Each<typeof card> };',
      '}, { type: "SELECT"; id: string }>()({',
      '  data: { selected: "a", cardIds: {} },',
      '  starts: (start) => ({',
      '    detail: start(detail, { given: (data) => ({ title: data.selected }) }),',
      '    card: start(card, { each: "cardIds", given: (_key, data) => ({ label: data.selected }) }),',
      '  }),',
      '  on: { SELECT: (ev) => ({ data: { selected: ev.id } }) },',
      '});',
      'export default notesSurface;',
    ].join('\n'));
    write('src/features/board/fe/state.ts', [
      "import { state } from '@apackdev/state';",
      'export const boardState = state<{ data: { count: number } }, { type: "INC" }>()({',
      '  data: { count: 0 },',
      '  on: { INC: (_ev, { data }) => ({ data: { count: data.count + 1 } }) },',
      '});',
    ].join('\n'));
    write('src/features/legacy/fe/state.ts', [
      'const legacyXStateMachine = { id: "legacy", transition: () => ({}) };',
      'export default legacyXStateMachine;',
    ].join('\n'));

    const files = await generatePackFiles(manifest({
      features: [
        { id: 'notes', description: 'Notes.', surface: { label: 'Notes', state: 'src/features/notes/fe/state.ts' } },
        { id: 'board', description: 'Board.', surface: { label: 'Board', state: 'src/features/board/fe/state.ts#boardState' } },
        { id: 'legacy', description: 'Legacy.', surface: { label: 'Legacy', state: 'src/features/legacy/fe/state.ts' } },
      ],
    }), { packRoot: root });

    const stateFe = files['src/__generated__/state-fe.ts'];
    expect(stateFe).toBeDefined();
    expect(stateFe).toContain("import { vueBinding } from '@apackdev/state/vue';");
    expect(stateFe).toContain("import type __surface_notes from '../features/notes/fe/state.ts';");
    expect(stateFe).toContain("import type { boardState as __surface_board } from '../features/board/fe/state.ts';");
    expect(stateFe).toContain("import type __surface_legacy from '../features/legacy/fe/state.ts';");
    expect(stateFe).toContain("name.includes('/') ? name : `demo-pack/${name}`");

    write('src/probe-fe.ts', [
      "import { provide, useState, type PackSurfaces } from './__generated__/state-fe.ts';",
      'const notes = useState("notes");',
      'const selected: string = notes.state.value.data.selected;',
      'notes.send({ type: "SELECT", id: "b" });',
      'const detail = useState(() => notes.child("detail"));',
      'const detailTitle: string | undefined = detail.state.value?.data.title;',
      'detail.send({ type: "RENAME", title: "next" });',
      'const card = useState(() => notes.child("card", "k1"));',
      'const cardLabel: string | undefined = card.state.value?.data.label;',
      'card.send({ type: "PING" });',
      'const board = useState("board");',
      'const count: number = board.state.value.data.count;',
      'board.send({ type: "INC" });',
      '// @ts-expect-error unmigrated XState surface is excluded from PackSurfaces',
      'useState("legacy");',
      '// @ts-expect-error bare feature ids only, not qualified own refs',
      'useState("demo-pack/notes");',
      '// @ts-expect-error unknown surface name rejected',
      'useState("missing");',
      '// @ts-expect-error wrong event payload rejected',
      'notes.send({ type: "SELECT", id: 123 });',
      '// @ts-expect-error keyed child requires key argument',
      'notes.child("card");',
      'void [provide, selected, detailTitle, cardLabel, count];',
      'export type { PackSurfaces };',
    ].join('\n'));

    expect(typecheck(files, ['src/probe-fe.ts', 'src/__generated__/state-fe.ts'], true)).toEqual([]);
  });

  it('omits state-fe.ts when a pack declares no surfaces', async () => {
    const files = await generatePackFiles(manifest({ features: [system('notes')] }), { packRoot: root });
    expect(files['src/__generated__/state-fe.ts']).toBeUndefined();
  });
});
