// The typed surface codegen derives from a manifest.
//
// Entity shapes, feature settings, repositories and services — the declarations a pack compiles against,
// and what happens when two features name one service.
//
// One of five files split from a 1,365-line original; `_support/pack.ts` holds the fixture and why.
//
// @slow: 24 cases, every one a temp pack and a full codegen pass — the file 6.3-9.7s
// Every case mkdtemps a pack and removes it (`setupPackFixture`) and runs `generatePackFiles` over a
// fresh manifest, so the cost is the work rather than the test, and it is per case rather than per file —
// which is why splitting the original by subject moved the three compiling cases into `compiles.spec.ts`
// and left the pure ones costing what they cost. `goal-one-job-pool.md` Phase 5 has the boundary.
//
// The range is the span across runs rather than noise: a pool spreads across workers, so these read
// faster when fewer projects run beside them — measured 2026-10-06, this file was at the low end in a
// two-project run and the high end in an eleven-project one. Which is why the count is the durable
// figure here and a per-case millisecond is not.
import { describe, expect, it } from 'vitest';
import { entitiesWithoutShapes, generatePackFiles } from '../../../src/build/generate-entries.ts';
import { setupPackFixture, dependency, facade, FACADE_DEFAULTS, generate, manifest, root, system, write } from './_support/pack.ts';

setupPackFixture();

describe('generated entity shapes', () => {
  const missingFacades: Record<string, string>[] = [{}, { 'pack-types': '' }, { 'pack-types': '  ' }];
  it.each(missingFacades)('refuses missing dependency facades before emitting generated typing: %s', async facades => {
    await expect(generate({}, { 'base-pack': dependency({}, facades) }))
      .rejects.toThrow('Dependency "base-pack" is missing its pack-types facade; rebuild that dependency');
  });


  it.each(Object.keys(FACADE_DEFAULTS))('names a dependency missing required type %s', async name => {
    const content = Object.entries(FACADE_DEFAULTS).filter(([key]) => key !== name)
      .map(([key, type]) => `export type ${key} = ${type};`).join('\n');
    await expect(generate({}, { 'base-pack': dependency({}, { 'pack-types': content }) }))
      .rejects.toThrow(`does not export required type "${name}"`);
  });

  it.each(['export const PackEntityShapes = {};', 'export type PackEntityShapes = Missing;', 'export type PackEntityShapes = unknown;'])
  ('refuses a non-type or unresolved capability without emitting fake typing: %s', async badExport => {
    const content = Object.entries(FACADE_DEFAULTS).filter(([key]) => key !== 'PackEntityShapes')
      .map(([key, type]) => `export type ${key} = ${type};`).join('\n') + '\n' + badExport;
    await expect(generate({}, { 'base-pack': dependency({}, { 'pack-types': content }) }))
      .rejects.toThrow('Dependency "base-pack" has an unusable pack-types facade');
  });



  it('refuses malformed facade text even when its required exports can be recovered', async () => {
    const content = facade()['pack-types'] + '\nexport const broken = ;';
    await expect(generate({}, { 'base-pack': dependency({}, { 'pack-types': content }) }))
      .rejects.toThrow('Dependency "base-pack" has an unusable pack-types facade: base-pack.d.ts: invalid TypeScript syntax');
  });

  it('requires surface state when a frontend consumer actually imports it', async () => {
    const surface = { features: { inbox: { surface: { label: 'Inbox', state: 'src/surface.ts' } } } };
    await expect(generate({}, { 'base-pack': dependency(surface) })).resolves.toBeDefined();
    write('src/surface.ts', 'export default {};');
    await expect(generate(surface, { 'base-pack': dependency(surface) }))
      .rejects.toThrow('does not export required type "PackSurfaceState"');
    const withState = { 'pack-types': facade()['pack-types'] + '\nexport type PackSurfaceState = {};' };
    await expect(generate(surface, { 'base-pack': dependency(surface, withState) })).resolves.toBeDefined();
  });

  it('resolves facade type aliases without reading executable modules', async () => {
    const content = facade()['pack-types'].replace('export type PackEntityShapes = {};',
      'type Shapes = {}; export type { Shapes as PackEntityShapes };');
    await expect(generate({}, { 'base-pack': dependency({}, { 'pack-types': content }) })).resolves.toBeDefined();
  });

  it('checks snapshot facade text rather than accepting stale generated typing on disk', async () => {
    write('src/__generated__/deps/base-pack.ts', facade()['pack-types']);
    const content = facade()['pack-types'].replace('export type PackEntityShapes = {};', '');
    await expect(generate({}, { 'base-pack': dependency({}, { 'pack-types': content }) }))
      .rejects.toThrow('Dependency "base-pack" has an unusable pack-types facade: does not export required type "PackEntityShapes"');
  });

  it('imports own shapes under aliases and dependency shapes from their facade types', async () => {
    write('src/features/memos/be/types.ts', 'export interface ItemEntity { text: string }\n');
    const files = await generate(
      { data: { entities: { Memo: { shape: "src/features/memos/be/types.ts#ItemEntity" } } },  },
      { 'base-pack': dependency({}) },
    );
    const ears = files['src/__generated__/ears.ts'];
    expect(ears).toContain("import type { ItemEntity as __shape_Memo } from '../features/memos/be/types.ts';");
    expect(ears).toContain("'Memo': __shape_Memo;");
    expect(ears).toContain("export type PackShapes = Omit<SdkEntityShapes & OwnEntityShapes & __dep_base_pack_PackEntityShapes, 'Node'> & {");
  });

  it("reads Node rows as the step node types of the pack and its dependencies, NodeBase when none define any", async () => {
    write('src/steps/ping/types.ts', "import type { NodeBase } from '@apackdev/sdk';\nexport interface PingNode extends NodeBase { nodeType: 'ping' }\n");
    write('src/steps/ping/build.ts', "export const compile = () => ({ entity: {}, relations: [] });\nexport const validate = () => [];\nexport const getLabel = () => '';\n");
    const withSteps = (await generate(
      { steps: { ping: { node: { label: 'Ping' }, build: { compile: 'src/steps/ping/build.ts#compile', validate: 'src/steps/ping/build.ts#validate', getLabel: 'src/steps/ping/build.ts#getLabel' }, types: 'src/steps/ping/types.ts' } } },
      { 'base-pack': dependency({}) },
    ))['src/__generated__/ears.ts'];
    expect(withSteps).toContain("import type { NodeEntity } from './types.ts';");
    expect(withSteps).toContain("import type { PackStepNodes as __dep_base_pack_PackStepNodes } from './deps/base-pack.ts';");
    expect(withSteps).toContain('export type PackStepNodes = NodeEntity | __dep_base_pack_PackStepNodes;');
    expect(withSteps).toContain("Node: [PackStepNodes] extends [never] ? SdkEntityShapes['Node'] : PackStepNodes;");

    const withoutSteps = (await generate({}, { 'base-pack': dependency({}) }))['src/__generated__/ears.ts'];
    expect(withoutSteps).not.toContain("import type { NodeEntity }");
    expect(withoutSteps).toContain('export type PackStepNodes = never | __dep_base_pack_PackStepNodes;');
  });

  it('fails when a declared shape type is not exported', async () => {
    write('src/types.ts', 'interface ItemEntity { text: string }\n');
    await expect(generate({ data: { entities: { Memo: { shape: "src/types.ts#ItemEntity" } } },  })).rejects.toThrow('Entity shape "Memo": src/types.ts doesn\'t export a type named "ItemEntity"');
  });

  it("fails when a pack redeclares the SDK's Flow shape", async () => {
    write('src/types.ts', 'export interface MyFlow { x: string }\n');
    await expect(generate({ data: { entities: { Flow: { shape: "src/types.ts#MyFlow" } } } })).rejects.toThrow('is defined by the SDK');
  });

  it('accepts a shape exported by name from a list', async () => {
    write('src/types.ts', 'interface ItemEntity { text: string }\nexport type { ItemEntity };\n');
    await expect(generate({ data: { entities: { Memo: { shape: "src/types.ts#ItemEntity" } } } })).resolves.toBeDefined();
  });
});

describe('feature-owned entity declarations', () => {
  it('checks type exports without executing their module and keeps null entities untyped', async () => {
    write('src/types.ts', 'throw new Error("must never execute");\nexport interface MemoShape { text: string }\nexport const valueOnly = {};\n');
    const files = await generate({ features: { memos: { entities: { Memo: { shape: 'src/types.ts#MemoShape' }, Index: {} } } } });
    expect(files['src/__generated__/ears.ts']).toContain("'Memo': __shape_Memo;");
    expect(files['src/__generated__/ears.ts']).not.toContain("'Index': __shape_Index;");
    expect(files['src/__generated__/pack-entry.ts']).toContain('entities: {"Memo":"Memo","Index":"Index"}');
    expect(files['src/__generated__/pack-entry.ts']).not.toContain('../types.ts');
    await expect(generate({ features: { memos: { entities: { Memo: { shape: 'src/types.ts#valueOnly' } } } } }))
      .rejects.toThrow('Entity shape "Memo": src/types.ts doesn\'t export a type named "valueOnly"');
    await expect(generate({ data: { entities: { Memo: { shape: 'src/missing.ts#MemoShape' } } } }))
      .rejects.toThrow('Entity shape "Memo": no file found at src/missing.ts');
    await expect(generate({ data: { entities: { Memo: { shape: '../outside.ts#MemoShape' } } } }))
      .rejects.toThrow('Entity shape "Memo": module must be pack-root-relative and stay within the pack');
  });

  it('refuses duplicate ownership before generating a runtime inventory', async () => {
    await expect(generate({ data: { entities: { Memo: {} } }, features: { memos: { entities: { Memo: {} } } } }))
      .rejects.toThrow('Entity "Memo" is declared by both "data" and "features.memos"');
    await expect(generate({ features: { memos: { entities: { Memo: {} } }, other: { entities: { Memo: {} } } } }))
      .rejects.toThrow('both "features.memos" and "features.other"');
  });
});

describe('generated feature settings', () => {
  it('embeds declarative defaults without importing or executing a settings module', async () => {
    const settings = { schema: { type: 'object', properties: { sort: { type: 'string' } }, required: ['sort'] }, defaults: { sort: 'newest' } };
    const entry = (await generate({ features: [{ ...system('memos'), settings }, system('todos')] }))['src/__generated__/pack-entry.ts'];
    expect(entry).toContain(`settings: JSON.parse(${JSON.stringify(JSON.stringify(settings))})`);
    expect(entry).not.toContain('import __settings');
    expect(entry).toContain("    'todos': {\n      system: packSystem(__system_todos, { incoming: [\"TODOS_RUN\"] }),\n      services: [],\n    }");
  });

  it('preserves ordinary JSON prototype-named keys in emitted registrations', async () => {
    const declaration = { schema: { type: 'object' }, defaults: JSON.parse('{"__proto__":{"enabled":true}}') };
    const entry = (await generate({ features: [{ id: 'memos', settings: declaration }] }))['src/__generated__/pack-entry.ts'];
    const expression = entry.split('\n').find(line => line.trim().startsWith('settings:'))!;
    const encoded = expression.match(/settings: JSON.parse\((.*)\),$/)![1];
    const emitted = JSON.parse(JSON.parse(encoded));
    expect(emitted).toEqual(declaration);
    expect(Object.hasOwn(emitted.defaults, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(emitted.defaults)).toBe(Object.prototype);
  });

  it('invokes validateSettings when provided during settings generation', async () => {
    await expect(generatePackFiles(manifest({ features: [{ ...system('memos'), settings: {
      schema: { type: 'object', properties: { count: { type: 'number' } }, required: ['count'] },
      defaults: { count: 'wrong' },
    } }] }), {
      packRoot: root,
      validateSettings: () => { throw new Error('Invalid settings defaults'); },
    })).rejects.toThrow('Invalid settings defaults');
  });
});

describe('generated repositories', () => {
  it('types repositories from their declarations and puts them in the registration, registering nothing on import', async () => {
    write('src/features/memos/be/repository.ts', 'export const memoQueries = {};\n');
    const files = await generate({ features: [{ ...system('memos'), repositories: { memoQueries: 'src/features/memos/be/repository.ts#memoQueries' } }] });
    expect(files['src/__generated__/repository.ts']).toContain("import type { memoQueries as __repo_memoQueries } from '../features/memos/be/repository.ts';");
    expect(files['src/__generated__/repository.ts']).toContain('memoQueries: typeof __repo_memoQueries;');
    expect(files['src/__generated__/repositories.ts']).toContain('  memoQueries: __repo_memoQueries,');
    expect(files['src/__generated__/pack-entry.ts']).toContain("import { repositories } from './repositories.ts';");
    expect(files['src/__generated__/pack-entry.ts']).toContain('  repositories,\n');
  });

  it('accepts a repository exported through a barrel', async () => {
    write('src/memos/queries.ts', 'export const memoQueries = {};\n');
    write('src/memos/index.ts', "export * from './queries';\n");
    expect((await generate({ features: [{ ...system('memos'), repositories: { memoQueries: 'src/memos#memoQueries' } }] }))['src/__generated__/repositories.ts'])
      .toContain("import { memoQueries as __repo_memoQueries } from '../memos/index.ts';");
  });

  it('fails on a repository export that does not exist', async () => {
    write('src/repo.ts', 'export const other = {};\n');
    await expect(generate({ features: [{ ...system('memos'), repositories: { memoQueries: 'src/repo.ts#memoQueries' } }] })).rejects.toThrow('Repository "memoQueries" (feature "memos"): src/repo.ts doesn\'t export "memoQueries"');
  });

  it('writes no repositories module for a pack without repositories', async () => {
    const files = await generate({ features: [system('memos')] });
    expect(files['src/__generated__/repositories.ts']).toBeUndefined();
    expect(files['src/__generated__/pack-entry.ts']).not.toContain('repositories');
  });

  it("fails on a repository name a dependency declares, naming both packs: the app would refuse to register it", async () => {
    write('src/features/memos/be/repository.ts', 'export const memoQueries = {};\n');
    const deps = { 'base-pack': dependency({ features: [{ ...system('memos'), repositories: { memoQueries: 'src/repo.ts#memoQueries' } }] }) };
    await expect(generate({ features: [{ ...system('memos'), repositories: { memoQueries: 'src/features/memos/be/repository.ts#memoQueries' } }] }, deps)).rejects.toThrow('Repository "memoQueries" (feature "memos") is declared by "base-pack", which this pack depends on');
  });

  it("accepts a repository name no dependency declares", async () => {
    write('src/features/memos/be/repository.ts', 'export const memoQueries = {};\n');
    // A different name to the pack's: equal names are the case above, which throws
    const deps = { 'base-pack': dependency({ features: [{ ...system('memos'), repositories: { tagQueries: 'src/repo.ts#tagQueries' } }] }) };
    await expect(generate({ features: [{ ...system('memos'), repositories: { memoQueries: 'src/features/memos/be/repository.ts#memoQueries' } }] }, deps)).resolves.toBeDefined();
  });
});

describe('service name collisions', () => {
  const withService = (id: string, name: string) => ({ id, services: { [name]: 'src/x.ts#svc' } });

  // Services from dependencies are intersected (_S0 & _S1), which says nothing about a collision:
  // two `db` services merge into an unusable type with no error. The registry refuses the second
  // pack at registration, so without this the report arrives at app start instead of at build.
  it('fails when two dependencies declare the same service name', async () => {
    await expect(generate({ features: [system('brain')] }, {
      'base-pack': dependency({ id: 'base-pack', features: [withService('a', 'db')] }),
      'other-pack': dependency({ id: 'other-pack', features: [withService('b', 'db')] }),
    })).rejects.toThrow('Service "db" is declared by both');
  });

  it("fails when this pack declares a name a dependency declares, as commands and repositories do", async () => {
    await expect(generate({ features: [withService('mine', 'db')] }, {
      'base-pack': dependency({ id: 'base-pack', features: [withService('a', 'db')] }),
    })).rejects.toThrow('Service "db" is declared by "base-pack"');
  });

  it('covers pack-level services, not only a feature\'s', async () => {
    await expect(generate({ features: [system('brain')] }, {
      'base-pack': dependency({ id: 'base-pack', services: { db: 'src/x.ts#svc' } }),
      'other-pack': dependency({ id: 'other-pack', features: [withService('b', 'db')] }),
    })).rejects.toThrow('Service "db" is declared by both');
  });

  it('accepts distinct names across dependencies', async () => {
    await expect(generate({ features: [system('brain')] }, {
      'base-pack': dependency({ id: 'base-pack', features: [withService('a', 'db')] }),
      'other-pack': dependency({ id: 'other-pack', features: [withService('b', 'cache')] }),
    })).resolves.toBeDefined();
  });
});

describe('generated services', () => {
  const service = async (target: string, key = 'memo') => (await generate({ features: [{ id: 'memos', services: { [key]: target } }] }))['src/__generated__/services.ts'];

  it('imports the named service object under an alias, so a service named "services" does not shadow the export', async () => {
    write('src/services.ts', 'export const servicesService = { value: 1 };\n');
    const services = await service('src/services.ts#servicesService', 'services');
    expect(services).toContain("import { servicesService as __service_services } from '../services.ts';");
    expect(services).toContain('  services: __service_services,');
    expect(services).toContain("import { runtimeServices } from './runtime-services.ts'");
    expect(services).toContain("export function bindServices(source: PackServiceAccess)");
  });

  it('imports pack-level services the same way', async () => {
    write('src/cache/index.ts', 'export const cacheService = { get: (key: string) => key };\n');
    const services = (await generate({ services: { cache: 'src/cache#cacheService' } }))['src/__generated__/services.ts'];
    expect(services).toContain("import { cacheService as __service_cache } from '../cache/index.ts';");
    expect(services).toContain('  cache: __service_cache,');
  });

  it('accepts a service object re-exported from another module, a barrel or a multi-line export list', async () => {
    write('src/impl.ts', 'class MemoStore { list(): string[] { return []; } }\n/* export const memoService = 1 */\nconst memoService = new MemoStore();\nexport {\n  MemoStore,\n  memoService,\n};\n');
    write('src/reexport.ts', "export { memoService } from './impl';\n");
    write('src/barrel.ts', "export * from './reexport';\n");
    write('src/renamed.ts', "import { memoService as impl } from './impl';\nexport { impl as memoService };\n");
    for (const source of ['src/impl.ts', 'src/reexport.ts', 'src/barrel.ts', 'src/renamed.ts']) {
      expect(await service(`${source}#memoService`)).toContain('  memo: __service_memo,');
    }
  });

  it("fails on a target without an export, a missing file or export, and an export that isn't a service object", async () => {
    write('src/memo.ts', [
      'export type MemoType = { list(): string[] };',
      'export interface MemoInterface { list(): string[] }',
      'export function createMemoService() { return {}; }',
      'export const memoFactory = () => ({});',
      'export class MemoService {}',
      'const typeOnly = {};',
      'export type { typeOnly };',
      '// export const commented = {};',
    ].join('\n'));
    await expect(service('src/memo.ts')).rejects.toThrow('Feature "memos": services.memo: "src/memo.ts" must name its export, as "path#exportName"');
    await expect(service('src/missing.ts#memoService')).rejects.toThrow('Service "memo": no file found at src/missing.ts');
    await expect(service('src/memo.ts#memoService')).rejects.toThrow('Service "memo": src/memo.ts doesn\'t export "memoService"');
    await expect(service('src/memo.ts#commented')).rejects.toThrow('Service "memo": src/memo.ts doesn\'t export "commented"');
    for (const name of ['MemoType', 'MemoInterface', 'typeOnly']) {
      await expect(service(`src/memo.ts#${name}`)).rejects.toThrow(`Service "memo": src/memo.ts exports "${name}" only as a type, not a value`);
    }
    for (const name of ['createMemoService', 'memoFactory']) {
      await expect(service(`src/memo.ts#${name}`)).rejects.toThrow(`Service "memo": "${name}" in src/memo.ts is a function; export the service object itself`);
    }
    await expect(service('src/memo.ts#MemoService')).rejects.toThrow('Service "memo": "MemoService" in src/memo.ts is a class; export an instance of it');
  });

  it("exposes only the baseline when dependency services are not consumed", async () => {
    const services = (await generate({}, { 'base-pack': dependency({}) }))['src/__generated__/services.ts'];
    expect(services).toContain('Pick<HostServices, "logger" | "settings"> & { repository: Repositories; emitter: PackEmitter }');
    expect(services).not.toContain(' & Omit<__dep_base_pack_Services');
  });

  it("types the emitter with the pack's events, naming every system <pack>/<feature>", async () => {
    const files = await generate({ features: [system('memos')] }, { 'base-pack': dependency({ features: [system('calendar')] }, facade()) });
    expect(files['src/__generated__/events.ts']).toContain("export type QualifiedSystemEvents = Qualified<'demo-pack', PackSystemEvents> & Qualified<'base-pack', __dep_base_pack_PackSystemEvents> & HostSystemEvents;");
    const services = files['src/__generated__/services.ts'];
    expect(services).toContain("import type { QualifiedSurfaceEvents, QualifiedSystemEvents } from './events.ts';");
    expect(services).toContain('  broadcast: TypedSendToSurface<QualifiedSurfaceEvents>;\n  sendToWindow: TypedSendToWindow<QualifiedSurfaceEvents>;\n  tell: TypedTell<QualifiedSystemEvents>;');
  });
});

describe('entitiesWithoutShapes', () => {
  it("lists the pack's entities with no shape, leaving out those the SDK shapes", () => {
    expect(entitiesWithoutShapes({
      data: { entities: { Memo: { shape: "src/memo.ts#MemoEntity" }, Tag: {} } },

    })).toEqual(['Tag']);
    expect(entitiesWithoutShapes({})).toEqual([]);
  });
});
