import { _declarationRevision } from '../../../src/build/declaration-revision.ts';
// The generated modules' own surface.
//
// What the generated modules import and re-export: a diamond dependency resolved once, the EARS facade,
// the SDK re-exports, appliers, flow helpers, the type barrel, and the snapshot format that carries them.
//
// One of five files split from a 1,365-line original; `_support/pack.ts` holds the fixture and why.
//
// @slow: 26 cases, every one a temp pack and a full codegen pass — the file 3.5-5.5s
// Every case mkdtemps a pack and removes it (`setupPackFixture`) and runs `generatePackFiles` over a
// fresh manifest, so the cost is the work rather than the test, and it is per case rather than per file —
// which is why splitting the original by subject moved the three compiling cases into `compiles.spec.ts`
// and left the pure ones costing what they cost. `goal-one-job-pool.md` Phase 5 has the boundary.
//
// The range is the span across runs rather than noise: a pool spreads across workers, so these read
// faster when fewer projects run beside them — measured 2026-10-06, this file was at the low end in a
// two-project run and the high end in an eleven-project one. Which is why the count is the durable
// figure here and a per-case millisecond is not.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { transformSync } from 'esbuild';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { PROVENANCE_KINDS, _buildProvenance } from '../../../src/build/manifest.ts';
import { SDK_ENTITIES, SDK_REL_KINDS } from '../../../src/types/sdk-entities.ts';
import type { PackFeatureEntry, PackManifest, PackSurfaceEntry, PackSnapshot, PackSystemEntry, ContentFormatConfig } from '../../../src/build/manifest.ts';
import type { PackFeature, PackFeatureSurface, PackFeatureSystem, PackRegistration } from '../../../src/framework/index.ts';
import { setupPackFixture, PACK_SNAPSHOT_FORMAT, dependency, facade, generate, generatePackFiles, manifest, root, system, withSurface, withSurfaceState, write, writeSurfaceState, writeSystemEntry  } from './_support/pack.ts';

setupPackFixture();

// A → B and A → C, both of which depend on D. Nothing exercised two dependencies converging, which
// is where a collision is silent rather than obvious: each dependency is fine on its own.
describe('a diamond dependency', () => {
  const surfacing = (id: string, owner: string) => ({ declarationRevision: _declarationRevision(manifest({ id })),
    types: { entities: { Memo: 'Memo' }, relKinds: {}, roles: {} },
    entityDestinations: {}, facades: facade(),
    provenance: { entities: { Memo: owner } },
    manifest: manifest({ id }),
    format: PACK_SNAPSHOT_FORMAT,
  }) as PackSnapshot;

  // Both sides surface deep-pack's Memo, because a snapshot carries its dependencies' names so a
  // chain resolves one level deep. Attributing it to the dependency it arrived through made this
  // read as two packs declaring Memo — and since every pack depends on the base pack, that was every
  // pack with two dependencies.
  it('accepts one ancestor\'s entity arriving through both sides', async () => {
    await expect(generate({ features: [system('brain')] }, {
      'left-pack': surfacing('left-pack', 'deep-pack'),
      'right-pack': surfacing('right-pack', 'deep-pack'),
    })).resolves.toBeDefined();
  });

  /**
   * The same diamond, on an entity name assignment to an ordinary object would have lost. Each side's
   * provenance is produced by `_buildProvenance` and put through JSON, as a real build's is, because
   * that round trip is where the two halves of the hazard differ: `JSON.parse` defines `__proto__` as an
   * own property, while the assignment that wrote it did not.
   */
  /**
   * The read half, which the write half does not cover. A dependency can surface a name its provenance
   * does not record — its own dependency was built without provenance, say — and the lookup is then meant
   * to fall back to the pack the name arrived through. On an ordinary object a name like `constructor`
   * finds `Object`'s constructor instead, and that function becomes the declaring pack: it is compared
   * against other packs' names, and printed if a collision is reported.
   */
  it('falls back to the dependency for a surfaced name its provenance omits, even one Object.prototype has', async () => {
    const { mergeRegistries } = await import('../../../src/build/generate-entries.ts');
    const depTypes = new Map([['base-pack', { entities: { constructor: 'constructor' }, relKinds: {}, roles: {} }]]);
    const provenanceOmittingIt = new Map([['base-pack', { entities: JSON.parse('{"Memo":"deep-pack"}') }]]);

    const registry = mergeRegistries('app-pack', manifest({ id: 'app-pack' }), depTypes, provenanceOmittingIt);

    expect(registry.entities.get('constructor')?.source).toBe('base-pack');
  });

  it("accepts an ancestor's entity named __proto__ arriving through both sides", async () => {
    const side = (id: string) => ({ declarationRevision: _declarationRevision(manifest({ id })),
      types: { entities: { ['__proto__']: '__proto__' }, relKinds: {}, roles: {} },
      entityDestinations: {}, facades: facade(),
        provenance: JSON.parse(JSON.stringify(_buildProvenance(
        [['deep-pack', { manifest: { data: { entities: { ['__proto__']: {} } } } }] as const],
        { id, manifest: {} },
      ))),
      manifest: manifest({ id }),
      format: PACK_SNAPSHOT_FORMAT,
    }) as PackSnapshot;

    await expect(generate({ features: [system('brain')] }, {
      'left-pack': side('left-pack'),
      'right-pack': side('right-pack'),
    })).resolves.toBeDefined();
  });

  it('still reports two different packs that each declare the same entity', async () => {
    await expect(generate({ features: [system('brain')] }, {
      'left-pack': surfacing('left-pack', 'left-pack'),
      'right-pack': surfacing('right-pack', 'right-pack'),
    })).rejects.toThrow(/entity "Memo" declared by both/);
  });

});

describe('generated imports', () => {
  it.each(['js', 'mjs', 'cjs'])('inspects a %s system module without executing it', async (extension) => {
    const entry = `src/system.${extension}`;
    const fields = { features: { memos: { description: 'Manage memos.', system: { entry } } } };
    write(entry, `throw new Error("Must not execute"); ${extension === 'cjs' ? 'module.exports = {};' : 'export default {};'}`);
    await expect(generate(fields)).resolves.toBeDefined();
    if (extension !== 'cjs') {
      write(entry, 'export const named = {};');
      await expect(generate(fields)).rejects.toThrow('export "default" as a value');
    }
  });

  it.each([
    ['system', { features: { memos: { description: 'Manage memos.', system: { entry: 'src/module' } } } }, 'default'],
    ['form', { features: { memos: { description: 'Manage memos.', settings: { schema: { type: 'object' }, defaults: {}, form: 'src/module' } } } }, 'default'],
    ['compiler', { content: { formats: { custom: { compiler: 'src/module' } } } }, 'default'],
    ['applier', { content: { sources: { custom: { applier: 'src/module' } } } }, 'apply'],
  ])('checks the %s conventional export without executing its module', async (_name, fields, expected) => {
    await expect(generate(fields)).rejects.toThrow('no module found at src/module');
    write('src/module/index.ts', 'throw new Error("Must not execute"); export interface TypeOnly {}');
    await expect(generate(fields)).rejects.toThrow(`doesn't export "${expected}" as a value`);
    write('src/module/index.ts', `export interface TypeOnly {} export type { TypeOnly as ${expected} };`);
    await expect(generate(fields)).rejects.toThrow(`doesn't export "${expected}" as a value`);
    write('src/module/index.ts', `throw new Error("Must not execute"); ${expected === 'default' ? 'export default function value() {}' : 'export function apply() {}'}`);
    await expect(generate(fields)).resolves.toBeDefined();
  });

  it('checks whole-module grammar even without any named exports to inspect', async () => {
    await expect(generate({ features: { memos: { description: 'Manage memos.', system: { entry: 'src/system#default' } } } }))
      .rejects.toThrow('without an export selector');
    await expect(generate({ extensions: { blocks: { text: { fe: 'src/view.vue#default' } } } }))
      .rejects.toThrow('without an export selector');
  });

  // The extension the module has, not the `.js` this used to write for a `.ts` file: a pack is bundled rather
  // than emitted as individual modules, and every tool in its toolchain resolves `.ts`. Explicit either way,
  // because no runtime resolves an extensionless specifier in ESM — which the second assertion pins.
  it('names generated modules by the file that is there', async () => {
    const files = await generate({ features: [system('memos')] });
    expect(files['src/__generated__/pack-entry.ts']).toContain("import { appliers } from './appliers.ts';");
    expect(files['src/__generated__/pack-entry.ts']).not.toMatch(/from '\.\/appliers';/);
  });

  it('keeps dots in extensionless names and normalizes backslashes', async () => {
    write('src/features/memos/be/memo.types.ts', 'export interface MemoEntity { text: string }\n');
    const ears = (await generate({ data: { entities: { Memo: { shape: "src\\features\\memos\\be\\memo.types#MemoEntity" } } } }))['src/__generated__/ears.ts'];
    expect(ears).toContain("from '../features/memos/be/memo.types.ts';");
  });
});

describe('generated EARS facade', () => {
  it("registers the fields each of its shaped entities requires, read off the shape, for the engine's runtime check", async () => {
    write('src/memo.ts', 'export interface MemoEntity { text: string; pinned: boolean | null; note?: string; createdAt: number }\n');
    const entry = (await generate({ data: { entities: { Memo: { shape: "src/memo.ts#MemoEntity" }, Tag: {} } } }))['src/__generated__/pack-entry.ts'];
    // Optional fields and the engine's own are not required; an unshaped entity is held to nothing
    expect(entry).toContain('rowRules: {"Memo":{"required":["pinned","text"],"fields":{"note":{"type":"string","optional":true,"nullable":true},"pinned":{"type":"boolean","nullable":true},"text":{"type":"string","nullable":true}}}}');
    // This pack checks no nulls (it has no tsconfig), so its `| null` is erased and every field takes null
  });

  it("types each field from its shape, as the database holds it, and holds what it can't map as anything", async () => {
    // Its ids are typed through #generated/ears, which no build has written yet: the reader is handed the one this
    // generation writes, so a clean tree types them as a built one does
    write('tsconfig.json', JSON.stringify({ compilerOptions: {
      strict: true, module: 'esnext', moduleResolution: 'bundler', allowImportingTsExtensions: true, noEmit: true,
      paths: { '#generated/*': ['./src/__generated__/*'] },
    } }));
    write('src/tag.ts', 'export interface TagEntity { label: string }\n');
    // An id's type is the engine's, which a pack reads from its installed @apackdev/ears
    fs.mkdirSync(path.join(root, 'node_modules', '@apackdev'), { recursive: true });
    fs.symlinkSync(path.resolve(import.meta.dirname, '../../../../apack-ears'), path.join(root, 'node_modules', '@apackdev', 'ears'), 'dir');
    write('src/memo.ts', `import type { EARS } from '#generated/ears.ts';
export interface MemoEntity {
  title: string; count: number; done: boolean; stage: 'draft' | 'final'; kind: 'note';
  owner: EARS.EntityId<'Memo'>; either: EARS.EntityId<'Memo' | 'Tag'>; plain: EARS.EntityId;
  tags: string[]; frozen: readonly number[]; mixed: (string | null)[];
  icon: string | null; note?: string; loose?: boolean | null;
  meta: { at: number }; record: Record<string, string>; unknown: unknown; when: Date; numberOrText: string | number;
  createdAt: number;
}
`);
    const entry = (await generate({ data: { entities: { Memo: { shape: 'src/memo.ts#MemoEntity' }, Tag: { shape: 'src/tag.ts#TagEntity' } } } }))['src/__generated__/pack-entry.ts'];
    const rules = JSON.parse(/rowRules: (\{.*\}),\n/.exec(entry)![1]!);
    expect(rules.Memo.fields).toEqual({
      title: { type: 'string' }, count: { type: 'number' }, done: { type: 'boolean' },
      stage: { type: 'enum', values: ['draft', 'final'] }, kind: { type: 'enum', values: ['note'] },
      owner: { type: 'ref', to: ['Memo'] }, either: { type: 'ref', to: ['Memo', 'Tag'] }, plain: { type: 'string' },
      tags: { type: 'list', of: { type: 'string' } }, frozen: { type: 'list', of: { type: 'number' } }, mixed: { type: 'list', of: { type: 'any' } },
      icon: { type: 'string', nullable: true }, note: { type: 'string', optional: true }, loose: { type: 'boolean', optional: true, nullable: true },
      meta: { type: 'any' }, record: { type: 'any' }, unknown: { type: 'any' }, when: { type: 'any' }, numberOrText: { type: 'any' },
    });
  });

  it("numbers an entity with the prefix its manifest entry declares, and types its rows' code from it", async () => {
    write('src/memo.ts', 'export interface MemoEntity { text: string }\n');
    const files = await generate({ data: {
      entities: { Memo: { shape: 'src/memo.ts#MemoEntity', shortCode: 'MEM' }, Tag: { shortCode: 'TAG' } },
    } });
    expect(files['src/__generated__/pack-entry.ts']).toContain('"Memo":{"required":["text"],"shortCode":"MEM","fields":{"text":{"type":"string","nullable":true}}}');
    // An unshaped entity is numbered too, held to nothing else
    expect(files['src/__generated__/pack-entry.ts']).toContain('"Tag":{"required":[],"shortCode":"TAG"}');
    // The shape declares no short code: the generated shapes add it from the entry, and ShortCodeOf reads it back
    expect(files['src/__generated__/ears.ts']).toContain("'Memo': __shape_Memo & { shortCode: ShortCode<'MEM'> };");
    expect(files['src/__generated__/ears.ts']).toContain('export type ShortCodeOf<E extends keyof PackShapes>');
  });

  it("refuses a short code prefix a dependency numbers with, at build time rather than at install", async () => {
    write('src/memo.ts', 'export interface MemoEntity { text: string }\n');
    const deps = { 'base-pack': { ...dependency({ data: { entities: { Memo: { shortCode: 'MEM' } } } }), types: { entities: { Memo: 'Memo' }, relKinds: {}, roles: {} } } };
    await expect(generate({ dependencies: { 'base-pack': '*' }, data: { entities: { Note: { shape: 'src/memo.ts#MemoEntity', shortCode: 'MEM' } } } }, deps))
      .rejects.toThrow('Entity "Note": the short code prefix "MEM" numbers Memo of the dependency "base-pack": choose another');
  });

  it('refuses a shape that declares shortCode, which the engine writes and the entry types', async () => {
    write('src/memo.ts', 'export interface CodedEntity { shortCode: string; text: string }\n');
    await expect(generate({ data: { entities: { Memo: { shape: 'src/memo.ts#CodedEntity', shortCode: 'MEM' } } } }))
      .rejects.toThrow(/declares shortCode, which the engine writes: remove it — the manifest entry's "MEM" types the field, as ShortCodeOf<'Memo'>/);
    await expect(generate({ data: { entities: { Memo: { shape: 'src/memo.ts#CodedEntity' } } } }))
      .rejects.toThrow(/number the entity by giving its manifest entry a "shortCode" prefix/);
  });

  it('refuses a shape requiring a field the database holds no name for, and takes it optional', async () => {
    write('src/memo.ts', 'export interface MemoEntity { text: string; due_at: number }\nexport interface LooseEntity { text: string; due_at?: number }\n');
    await expect(generate({ data: { entities: { Memo: { shape: 'src/memo.ts#MemoEntity' } } } }))
      .rejects.toThrow(`Entity "Memo": src/memo.ts#MemoEntity requires "due_at", which the database can't hold as a required field`);
    const files = await generate({ data: { entities: { Memo: { shape: 'src/memo.ts#LooseEntity' } } } });
    expect(files['src/__generated__/pack-entry.ts']).toContain('"Memo":{"required":["text"],"fields":{"due_at":{"type":"number","optional":true,"nullable":true},"text":{"type":"string","nullable":true}}}');
  });

  it("indexes the fields an entity's entry declares, and refuses one its shape doesn't", async () => {
    write('src/memo.ts', 'export interface MemoEntity { text: string; status?: string }\n');
    const files = await generate({ data: {
      entities: { Memo: { shape: 'src/memo.ts#MemoEntity', indexes: ['status'] }, Chunk: { indexes: ['indexId'] } },
    } });
    expect(files['src/__generated__/pack-entry.ts']).toContain('"Memo":{"required":["text"],"indexes":["status"],"fields":{"status":{"type":"string","optional":true,"nullable":true},"text":{"type":"string","nullable":true}}}');
    // An unshaped entity has no fields to check its indexes against
    expect(files['src/__generated__/pack-entry.ts']).toContain('"Chunk":{"required":[],"indexes":["indexId"]}');
    await expect(generate({ data: { entities: { Memo: { shape: 'src/memo.ts#MemoEntity', indexes: ['status', 'staus'] } } } }))
      .rejects.toThrow(`Entity "Memo": its indexes name "staus", which src/memo.ts#MemoEntity doesn't declare`);
  });

  it('names the declared entities and passes them to the typed helpers, with the writes', async () => {
    write('src/memo.ts', 'export interface MemoEntity { text: string }\n');
    const ears = (await generate({ data: { entities: { Memo: { shape: "src/memo.ts#MemoEntity" }, Tag: {} } }, }))['src/__generated__/ears.ts'];
    expect(ears).toContain(`export type EntityName = ${['Memo', 'Tag', ...Object.values(SDK_ENTITIES)].map((name) => `'${name}'`).join(' | ')};`);
    expect(ears).toContain('defineEars<PackSchema>(boundEars)');
    expect(ears).toMatch(/export const \{\n  query, create, upsert, write, transact, newId, getAttr,\n\}/);
  });
});

describe("the SDK's entities and relation kinds", () => {
  it('are in every pack, with no entities or dependencies declared', async () => {
    const ears = (await generate({}))['src/__generated__/ears.ts'];
    for (const entity of Object.values(SDK_ENTITIES)) expect(ears).toContain(`export const ${entity} = '${entity}';`);
    for (const [name, kind] of Object.entries(SDK_REL_KINDS)) expect(ears).toContain(`export const ${name} = '${kind}';`);
    expect(ears).toContain(`export type EntityName = ${Object.values(SDK_ENTITIES).map((name) => `'${name}'`).join(' | ')};`);
    expect(ears).toContain("import type { SdkEntityShapes } from '@apackdev/sdk';");
    // Relation alone doesn't close the pack's Entity type
    expect(ears).toContain('export type Entity = string;');
  });

  it("rejects a dependency whose types still declare the SDK's names, asking to rebuild it", async () => {
    const base = { ...dependency({}), types: { entities: { Flow: 'Flow', Tag: 'Tag' }, relKinds: { NEXT: 'transitions_to' }, roles: {} } };
    await expect(generate({ dependencies: { 'base-pack': '*' } }, { 'base-pack': base })).rejects.toThrow('Type conflicts:\n  entity "Flow" from "base-pack" is defined by the SDK: rebuild "base-pack" with the current apack CLI');
    const relKindsOnly = { ...dependency({}), types: { entities: { Tag: 'Tag' }, relKinds: { NEXT: 'transitions_to' }, roles: {} } };
    await expect(generate({ dependencies: { 'base-pack': '*' } }, { 'base-pack': relKindsOnly })).rejects.toThrow('relKind "NEXT": "transitions_to" from "base-pack" is defined by the SDK');
  });

  it('rejects a name or value two sources declare', async () => {
    const base = { ...dependency({}), types: { entities: { Tag: 'Tag' }, relKinds: { TAGGED: 'tagged' }, roles: {} } };
    const withBase = (manifest: object) => generate({ ...manifest, dependencies: { 'base-pack': '*' } }, { 'base-pack': base });
    await expect(withBase({ data: { entities: { Tag: {} } } })).rejects.toThrow('entity "Tag" declared by both "demo-pack" and "base-pack"');
    await expect(withBase({ data: { relations: { tagged: {} } } })).rejects.toThrow('relKind "TAGGED" declared by both "demo-pack" and "base-pack"');
    const conflictingName = { ...base, types: { entities: { Tag: 'Tag' }, relKinds: { LABELLED: 'tagged' }, roles: {} } };
    await expect(generate({ data: { relations: { labelled: {} } } }, { 'base-pack': conflictingName }))
      .rejects.toThrow('relKind "LABELLED" declared by both "demo-pack" and "base-pack"');
  });

  it('uses entity keys as unchanged wire names in EntityName', async () => {
    const base = { ...dependency({}), types: { entities: { Tag: 'Tag' }, relKinds: {}, roles: {} } };
    const ears = (await generate({ data: { entities: { Memo: {} } }, dependencies: { 'base-pack': '*' } }, { 'base-pack': base }))['src/__generated__/ears.ts'];
    const names = ears.match(/export type EntityName = ([^;]*);/)![1];
    expect(names).toContain("'Memo'");
    expect(names).toContain("'Tag'");
    expect(names).toContain("'Flow'");
    // A relation is no entity, so no name stands for one
    expect(names).not.toContain("'Relation'");
  });

  it("registers only the pack's own entities and relation kinds, not its dependencies' or the SDK's", async () => {
    const base = { ...dependency({}), types: { entities: { Tag: 'Tag' }, relKinds: { TAGGED: 'tagged' }, roles: {} } };
    const entry = (await generate({ data: { entities: { Memo: {} }, relations: { pinned: {} } }, dependencies: { 'base-pack': '*' } }, { 'base-pack': base }))['src/__generated__/pack-entry.ts'];
    expect(entry).toContain('entities: {"Memo":"Memo"},');
    expect(entry).toContain('relKinds: {"PINNED":"pinned"},');
  });

  it("rejects a pack's own declaration of the SDK's names", async () => {
    await expect(generate({ data: { entities: { Flow: {} } } })).rejects.toThrow(/entity "Flow" is defined by the SDK/);
    await expect(generate({ data: { entities: { Action: {} } } })).rejects.toThrow(/entity "Action" is defined by the SDK/);
    await expect(generate({ data: { relations: { transitions_to: {} } } })).rejects.toThrow(/relKind "TRANSITIONS_TO": "transitions_to" is defined by the SDK/);
  });
});

describe('generated appliers', () => {
  it('registers the generic applier with its format settings, and SDK appliers for specialty keys', async () => {
    write('src/content/compilers/help.ts', 'export default () => [];');
    const files = await generate({
      data: { entities: { Memo: {} } },
      content: {
        formats: {
          memos: { format: 'markdown-tree', entity: 'Memo', identity: ['title', 'parent'], tree: { relKind: 'has_memo' }, media: 'media' },
          help: { compiler: 'src/content/compilers/help.ts' },
        },
        sources: {
          actions: { path: 'src/content/actions', onUserEdit: 'offer' },
          flows: { path: 'src/content/flows' },
          memos: { path: 'src/content/memos', format: 'memos', onUserEdit: 'offer' },
        },
        datasets: { help: { path: 'src/content/help', format: 'help' } },
      },
    });
    const appliers = files['src/__generated__/appliers.ts'];
    // `onUserEdit` reaches the applier for a specialty key and a format entry alike, which is what makes the
    // policy the manifest's rather than a property of whichever compiler writes the entry
    expect(appliers).toContain(`export const appliers: ContentApplier[] = [\n  createFormatApplier({"key":"actions","entities":["Action"],"identity":["label"],"onUserEdit":"offer"}),`);
    expect(appliers).toContain('  createFlowApplier(),');
    expect(appliers).toContain('  createFormatApplier({"key":"memos","entities":["Memo"],"identity":["title","parent"],"relKind":"has_memo","media":true,"onUserEdit":"offer"}),');
    expect(appliers).not.toContain('help');
  });

  it("uses a dependency's format settings for an entry naming it", async () => {
    const deps = { 'base-pack': { ...dependency({ content: { formats: { notes: { format: 'markdown-tree', entity: 'Note', identity: ['title'], tree: { branch: 'index.md' } } } } }), types: { entities: { Note: 'Note' }, relKinds: {}, roles: {} } } };
    const appliers = (await generate({ dependencies: { 'base-pack': '*' }, content: { sources: { team: { path: 'src/content/team', format: 'base-pack:notes' } } } }, deps))['src/__generated__/appliers.ts'];
    expect(appliers).toContain('  createFormatApplier({"key":"team","entities":["Note"],"identity":["title"]}),');
    await expect(generate({ dependencies: { 'base-pack': '*' }, content: { sources: { team: { path: 'p', format: 'base-pack:missing' } } } }, deps)).rejects.toThrow('Content "team": dependency "base-pack" has no format "missing"');
  });

  it("registers a pack applier module under a content key that isn't an identifier", async () => {
    write('src/content/memos.ts', 'export function apply() {}');
    const appliers = (await generate({ content: { sources: { 'my-memos': { applier: 'src/content/memos.ts' } } } }))['src/__generated__/appliers.ts'];
    expect(appliers).toContain("import { apply as __applier_my_memos } from '../content/memos.ts';");
    expect(appliers).toContain('  { key: "my-memos", apply: __applier_my_memos },');
  });

  it("registers a pack applier module for a content source naming one, and still compiles it", async () => {
    write('src/content/compilers/settings.ts', 'export default () => [];');
    write('src/content/settings-applier.ts', 'export function apply() {}');
    const files = await generate({
      data: { entities: { Memo: {} } },
      content: {
        formats: { settings: { compiler: 'src/content/compilers/settings.ts', entity: 'Memo' } },
        sources: { settings: { path: 'src/content/settings.ts', format: 'settings', applier: 'src/content/settings-applier.ts' } },
      },
    });
    const appliers = files['src/__generated__/appliers.ts'];
    expect(appliers).toContain("import { apply as __applier_settings } from '../content/settings-applier.ts';");
    expect(appliers).toContain('  { key: "settings", apply: __applier_settings },');
    expect(appliers).not.toContain('createFormatApplier');
  });

  it('accepts format entities from the SDK and dependencies, and rejects one nobody declares', async () => {
    const deps = { 'base-pack': { ...dependency({}), types: { entities: { Note: 'Note' }, relKinds: {}, roles: {} } } };
    await expect(generate({ dependencies: { 'base-pack': '*' }, content: { formats: {
      notes: { format: 'markdown-tree', entity: 'Note' },
      actions2: { format: 'json', entity: 'Action', identity: ['label'] },
    } } }, deps)).resolves.toBeDefined();
    // Unused formats are checked too: dependents may use them
    await expect(generate({ content: { formats: { notes: { format: 'json', entity: 'Memo' } } } })).rejects.toThrow(`Content format "notes": entity "Memo" isn't declared by this pack, its dependencies or the SDK`);
    await expect(generate({ content: { formats: { notes: { format: 'markdown-tree', entity: 'Action', tree: { branchEntity: 'Folder' } } } } })).rejects.toThrow(`entity "Folder" isn't declared`);
  });

  it("registers the pack's content writers by entity type", async () => {
    write('src/memo-writers.ts', 'export const memoWriter = {};');
    const entry = (await generate({ data: { entities: { Memo: {} } }, content: { writers: { Memo: 'src/memo-writers.ts#memoWriter' } } }))['src/__generated__/pack-entry.ts'];
    expect(entry).toContain("import { memoWriter as __contentWriter_0 } from '../memo-writers.ts';");
    expect(entry).toContain('contentWriters: { "Memo": __contentWriter_0 },');
    await expect(generate({ data: { entities: { Memo: {} } }, content: { writers: { Memo: 'src/memo-writers.ts#missing' } } })).rejects.toThrow(`A content writer for "Memo": src/memo-writers.ts doesn't export "missing"`);
  });

  it('names content writer imports validly whatever the entity is called', async () => {
    write('src/writers.ts', 'export const docWriter = {};\nexport const noteWriter = {};');
    const files = await generate({
      data: { entities: { 'team-doc': {}, 'team.note': {} } },
      content: { writers: { 'team-doc': 'src/writers.ts#docWriter', 'team.note': 'src/writers.ts#noteWriter' } },
    });
    for (const file of ['src/__generated__/pack-entry.ts', 'src/__generated__/content-runtime.ts']) {
      expect(() => transformSync(files[file], { loader: 'ts' }), file).not.toThrow();
      expect(files[file]).toContain('contentWriters: { "team-doc": __contentWriter_0, "team.note": __contentWriter_1 },');
    }
  });
});

describe('generated flow helpers', () => {
  const helpers = (exports: string[], name: string) => ({ exports, module: `// ${name} module`, types: `// ${name} types` });

  it("types a step helper's options with the step's DSL node fields", async () => {
    write('src/steps/pour/types.ts', "export interface DSLPourNode { type: 'pour'; cup: string; size?: 'small' | 'large'; [key: string]: unknown }\n");
    write('src/steps/pour/build.ts', "export const compile = () => ({ entity: {}, relations: [] });\nexport const validate = () => [];\nexport const getLabel = () => '';\n");
    const files = await generate({ steps: { pour: { node: { label: 'Pour' }, build: { compile: 'src/steps/pour/build.ts#compile', validate: 'src/steps/pour/build.ts#validate', getLabel: 'src/steps/pour/build.ts#getLabel' }, types: 'src/steps/pour/types.ts', dsl: { primaryField: 'cup' } } } });

    expect(files['src/__generated__/flow-helpers.ts']).toContain(
      "export function pour(cup: string, opts?: { [K in keyof DSLPourNode as K extends 'type' | 'cup' ? never : K]: DSLPourNode[K] }): DSLStepNode {",
    );
  });

  it('names helpers in camelCase, splitting step types and track fields on - and _', async () => {
    write('src/steps/pour-cup/types.ts', "export interface DSLPourCupNode { type: 'pour-cup'; cup: string; [key: string]: unknown }\n");
    for (const dir of ['pour-cup', 'keep-alive', 'stop-now']) write(`src/steps/${dir}/build.ts`, "export const compile = () => ({ entity: {}, relations: [] });\nexport const validate = () => [];\nexport const getLabel = () => '';\n");
    write('src/steps/every-day/build.ts', "export function compile() { return {}; } export function decompile() { return {}; }\n");
    const files = await generate({ steps: {
      'pour-cup': { node: { label: 'Pour cup' }, build: { compile: 'src/steps/pour-cup/build.ts#compile', validate: 'src/steps/pour-cup/build.ts#validate', getLabel: 'src/steps/pour-cup/build.ts#getLabel' }, types: 'src/steps/pour-cup/types.ts', dsl: { primaryField: 'cup' } },
      keep_alive: { node: { label: 'Keep alive' }, build: { compile: 'src/steps/keep-alive/build.ts#compile', validate: 'src/steps/keep-alive/build.ts#validate', getLabel: 'src/steps/keep-alive/build.ts#getLabel' }, dsl: {} },
      'stop-now': { node: { label: 'Stop' }, build: { compile: 'src/steps/stop-now/build.ts#compile', validate: 'src/steps/stop-now/build.ts#validate', getLabel: 'src/steps/stop-now/build.ts#getLabel' }, dsl: { defaultLabel: 'Stop' } },
      'every-day': { node: { label: 'Every day' }, kind: 'trigger', trigger: { trackField: 'every_day', compile: 'src/steps/every-day/build.ts#compile', decompile: 'src/steps/every-day/build.ts#decompile' } },
    } });
    const flowHelpers = files['src/__generated__/flow-helpers.ts'];

    expect(flowHelpers).toContain('export function pourCup(cup: string, opts?:');
    expect(flowHelpers).toContain("return { type: 'pour-cup', cup, ...opts };");
    expect(flowHelpers).toContain('export function keepAlive(label?: string): DSLStepNode {');
    expect(flowHelpers).toContain("export function stopNow(label: string = \"Stop\"): DSLStepNode {");
    expect(flowHelpers).toContain('export function everyDay(every_day: string, exits: DSLStepNode[][], label?: string): Track {');
    const { diagnostics } = ts.transpileModule(flowHelpers, { reportDiagnostics: true, compilerOptions: { module: ts.ModuleKind.ESNext } });
    expect(diagnostics?.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n'))).toEqual([]);
  });

  it("re-exports each dependency's flow helpers from the module its snapshot carries, except names already exported", async () => {
    write('src/steps/pour/types.ts', "export interface DSLPourNode { type: 'pour'; cup: string }\n");
    write('src/steps/pour/build.ts', "export const compile = () => ({ entity: {}, relations: [] });\nexport const validate = () => [];\nexport const getLabel = () => '';\n");
    const files = await generate(
      { steps: { pour: { node: { label: 'Pour' }, build: { compile: 'src/steps/pour/build.ts#compile', validate: 'src/steps/pour/build.ts#validate', getLabel: 'src/steps/pour/build.ts#getLabel' }, types: 'src/steps/pour/types.ts', dsl: { primaryField: 'cup' } } } },
      {
        'base-pack': { ...dependency({}), flowHelpers: helpers(['branch', 'entry', 'on', 'pour', 'schedule'], 'base-pack') },
        'other-pack': { ...dependency({ id: 'other-pack' }), flowHelpers: helpers(['branch', 'every'], 'other-pack') },
        'untyped-pack': dependency({ id: 'untyped-pack' }),
      },
    );
    const flowHelpers = files['src/__generated__/flow-helpers.ts'];

    expect(flowHelpers).toContain("export { branch, schedule } from './deps/base-pack.flow-helpers.js';");
    expect(flowHelpers).toContain("export { every } from './deps/other-pack.flow-helpers.js';");
    expect(flowHelpers).not.toContain('untyped-pack');
    expect(flowHelpers).not.toContain('Record<string, unknown>');
    expect(files['src/__generated__/deps/base-pack.flow-helpers.js']).toContain('// base-pack module');
    expect(files['src/__generated__/deps/base-pack.flow-helpers.d.ts']).toContain('// base-pack types');
  });
});

/**
 * What `PACK_SNAPSHOT_FORMAT` covers: the snapshot's fields, the manifest's, the provenance kinds, the facade exports
 * a dependent's generated code imports, and the registration the app loads. When this fails, the snapshot's contract changed. If a CLI on the
 * other side would misread the change (anything removed, renamed or reshaped) and the last release shipped
 * this format number, bump it; then update the expectation. A pure addition every reader ignores needs only
 * the expectation.
 */
describe('the snapshot format', () => {
  // Each typed against its interface, so adding, renaming or removing a field fails the typecheck until it is listed
  const SNAPSHOT_FIELDS: Record<keyof PackSnapshot, true> = {
    declarationRevision: true, dslDefinitions: true, eventContracts: true,
    types: true, facades: true, entityDestinations: true, manifest: true, help: true, format: true, sdkVersion: true, provenance: true, flowHelpers: true,
  };
  /** The snapshot's manifest, which a dependent's codegen reads (features, services, content formats, version…) */
  const MANIFEST_FIELDS: Record<keyof PackManifest, true> = {
    $schema: true, lifecycle: true, build: true, checks: true,
    dependencies: true, consumes: true, description: true, data: true,  extensions: true, features: true,
    hostVersion: true, id: true, license: true, migrations: true, name: true,
    permissions: true, content: true, version: true,
  };
  /** What the pack contributes, which a dependent reads to know what it may send to and build with */
  const MANIFEST_EXTENSION_FIELDS: Record<keyof NonNullable<PackManifest['extensions']>, true> = {
    artifacts: true, blocks: true, commands: true, dsl: true, appExtensions: true, textEditor: true, help: true, services: true, settings: true, steps: true,
  };
  // No `id`: a feature's id is the key its entry sits under, which is what makes a duplicate unrepresentable
  const MANIFEST_FEATURE_FIELDS: Record<keyof PackFeatureEntry, true> = {
    description: true, entities: true, designation: true, surface: true, references: true, repositories: true, services: true,
    settings: true, system: true, types: true, views: true,
  };
    const MANIFEST_SYSTEM_FIELDS: Record<keyof PackSystemEntry, true> = { contract: true, entry: true, events: true };
  const MANIFEST_SYSTEM_EVENTS_FIELDS: Record<keyof NonNullable<PackSystemEntry['events']>, true> = { incoming: true };
  const MANIFEST_SURFACE_FIELDS: Record<keyof PackSurfaceEntry, true> = { contract: true, default: true, defaultVisible: true, label: true, state: true, icon: true, canvas: true, panel: true, chat: true, isPinned: true, hotkeys: true, options: true, fallbackPanel: true };
  /** A dependency's content formats, which a dependent's `content.sources` compiles its own sources with */
  const FORMAT_FIELDS: Record<keyof ContentFormatConfig, true> = {
    compiler: true, entity: true, fields: true, format: true, identity: true, media: true, tree: true,
  };
  const TREE_FIELDS: Record<keyof NonNullable<ContentFormatConfig['tree']>, true> = { branch: true, branchEntity: true, relKind: true };
  const FIELD_FIELDS: Record<keyof NonNullable<ContentFormatConfig['fields']>[string], true> = { default: true, from: true, type: true };
  /** The registration the runtime bundle exports, which the app loads */
  const REGISTRATION_FIELDS: Record<keyof PackRegistration, true> = {
    declarationRevision: true,
    id: true, features: true, services: true, bindServices: true, ears: true, repositories: true, lifecycle: true, migrations: true, steps: true,
    artifacts: true, blocks: true, contentWriters: true, appliers: true, settings: true, dependencies: true,
  };
  const REGISTRATION_FEATURE_FIELDS: Record<keyof PackFeature, true> = {
    designation: true, system: true, surface: true, services: true, settings: true, views: true,
  };
  const REGISTRATION_SYSTEM_FIELDS: Record<keyof PackFeatureSystem, true> = { machine: true, receives: true };
  const REGISTRATION_SURFACE_FIELDS: Record<keyof PackFeatureSurface, true> = { receives: true };

  /** Every name generated code imports from a dependency's facade, with a send to one of its surfaces */
  async function facadeImports(): Promise<string[]> {
    const deps = { 'base-pack': dependency({ services: { search: 'unavailable.ts#search' }, features: [{ id: 'memos', system: { entry: 'x' }, surface: { label: 'Fixture', state: writeSurfaceState('y') } }] }, withSurfaceState(facade({ Services: '{ search: { read(): string } }' }), ['memos'])) };
    const files = await generate({ dependencies: { 'base-pack': '1.0.0' }, consumes: { services: ['base-pack/search'] }, features: [withSurface(system('actions'))] }, deps);
    const names = Object.values(files).flatMap((file) => [...file.matchAll(/import type \{ (\w+) as \w+ \} from '\.\/deps\/base-pack\.ts'/g)].map((m) => m[1]));
    return [...new Set(names)].sort();
  }

  it('covers exactly what dependents read', async () => {
    expect({
      format: PACK_SNAPSHOT_FORMAT,
      fields: Object.keys(SNAPSHOT_FIELDS).sort(),
      manifest: {
        fields: Object.keys(MANIFEST_FIELDS).sort(),
        extensions: Object.keys(MANIFEST_EXTENSION_FIELDS).sort(),
        feature: Object.keys(MANIFEST_FEATURE_FIELDS).sort(),
        system: Object.keys(MANIFEST_SYSTEM_FIELDS).sort(),
        systemEvents: Object.keys(MANIFEST_SYSTEM_EVENTS_FIELDS).sort(),
        surface: Object.keys(MANIFEST_SURFACE_FIELDS).sort(),
        contentFormat: Object.keys(FORMAT_FIELDS).sort(),
        contentTree: Object.keys(TREE_FIELDS).sort(),
        contentField: Object.keys(FIELD_FIELDS).sort(),
      },
      registration: {
        fields: Object.keys(REGISTRATION_FIELDS).sort(),
        feature: Object.keys(REGISTRATION_FEATURE_FIELDS).sort(),
        system: Object.keys(REGISTRATION_SYSTEM_FIELDS).sort(),
        surface: Object.keys(REGISTRATION_SURFACE_FIELDS).sort(),
      },
      provenanceKinds: Object.keys(PROVENANCE_KINDS).sort(),
      facadeImports: await facadeImports(),
    }).toEqual({
      format: 1,
      fields: ['declarationRevision', 'dslDefinitions', 'entityDestinations', 'eventContracts', 'facades', 'flowHelpers', 'format', 'help', 'manifest', 'provenance', 'sdkVersion', 'types'],
      manifest: {
        fields: ['$schema', 'build', 'checks', 'consumes', 'content', 'data', 'dependencies', 'description', 'extensions', 'features', 'hostVersion', 'id', 'license', 'lifecycle', 'migrations', 'name', 'permissions', 'version'],
        extensions: ['appExtensions', 'artifacts', 'blocks', 'commands', 'dsl', 'help', 'services', 'settings', 'steps', 'textEditor'],
        feature: ['description', 'designation', 'entities', 'references', 'repositories', 'services', 'settings', 'surface', 'system', 'types', 'views'],
        system: ['contract', 'entry', 'events'],
        systemEvents: ['incoming'],
        surface: ['canvas', 'chat', 'contract', 'default', 'defaultVisible', 'fallbackPanel', 'hotkeys', 'icon', 'isPinned', 'label', 'options', 'panel', 'state'],
        contentFormat: ['compiler', 'entity', 'fields', 'format', 'identity', 'media', 'tree'],
        contentTree: ['branch', 'branchEntity', 'relKind'],
        contentField: ['default', 'from', 'type'],
      },
      registration: {
        fields: ['appliers', 'artifacts', 'bindServices', 'blocks', 'contentWriters', 'declarationRevision', 'dependencies', 'ears', 'features', 'id', 'lifecycle', 'migrations', 'repositories', 'services', 'settings', 'steps'],
        feature: ['designation', 'services', 'settings', 'surface', 'system', 'views'],
        system: ['machine', 'receives'],
        surface: ['receives'],
      },
      provenanceKinds: ['entities', 'referenceCategories', 'referenceTypes', 'relKinds', 'roles', 'surfaces', 'tiptapExtensions'],
      facadeImports: ['PackEntityShapes', 'PackFeatureSettings', 'PackGroupSettings', 'PackStepNodes', 'PackSurfaceEvents', 'PackSurfaceState', 'PackSystemEvents', 'Repositories', 'Services'],
    });
  });
});

// The barrel is how one feature names another's types (`#generated/types`). A feature may have repositories or
// services and no system at all, and the types its callers need are the ones its repository and service signatures
// use — so the declaration decides, independently of whether it has a system.
describe('generated type barrel', () => {
  it("takes every feature's types module, with or without a system", async () => {
    write('src/features/records/be/types.ts', 'export interface RecordRow { id: string }');
    write('src/features/records/be/repository/index.ts', 'export const recordQueries = {};');
    write('src/features/memos/be/types.ts', 'export interface Memo { text: string }');
    writeSystemEntry('memos', "{ type: 'MEMO_ADDED' }");

    const files = await generatePackFiles(manifest({
      features: [
        // Data for the rest of the pack, and no system of its own
        { id: 'records', description: 'Expose record types.', types: 'src/features/records/be/types.ts', repositories: { recordQueries: 'src/features/records/be/repository/index.ts#recordQueries' } },
        { ...system('memos'), types: 'src/features/memos/be/types' },
      ] as PackFeatureEntry[],
    }), { packRoot: root });

    expect(files['src/__generated__/types.ts']).toContain("export type * from '../features/records/be/types.ts';");
    expect(files['src/__generated__/types.ts']).toContain("export type * from '../features/memos/be/types.ts';");
  });

  it('leaves out undeclared modules even when conventional files exist', async () => {
    writeSystemEntry('memos', "{ type: 'MEMO_ADDED' }");
    write('src/features/memos/be/types.ts', 'throw new Error("must not execute"); export interface Memo {}');
    write('src/features/memos/be/export-types.ts', 'export interface ExportedMemo {}');

    const files = await generatePackFiles(manifest({
      features: [system('memos')] as PackFeatureEntry[],
    }), { packRoot: root });

    expect(files['src/__generated__/types.ts']).not.toContain('features/memos/be/types');
    expect(files['src/__generated__/types.ts']).not.toContain('export-types');
  });

  it('names the feature when a declared type module is missing', async () => {
    await expect(generate({ features: { memos: { types: 'src/missing.ts' } } }))
      .rejects.toThrow('Feature "memos": types: no TypeScript module found at src/missing.ts');
  });

  it('exports an explicitly located type barrel without executing it or probing companions', async () => {
    write('src/public/index.ts', 'throw new Error("must not execute"); export type * from "./models.ts";');
    write('src/public/models.ts', 'export interface Memo { text: string }');
    write('src/public/export-types.ts', 'export interface Undeclared {}');
    const files = await generate({ features: { memos: { types: 'src/public' } } });
    expect(files['src/__generated__/types.ts']).toContain("export type * from '../public/index.ts';");
    expect(files['src/__generated__/types.ts']).not.toContain('export-types');
  });
});
