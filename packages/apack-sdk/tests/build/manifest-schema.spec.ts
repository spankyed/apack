import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { FeatureEntrySchema, _NativePackDeclarationSchema } from '../../src/framework/declaration-schema.ts';
import { parseManifest } from '../../src/build/validate.ts';
import { ALLOWABLE_PACK_CHECKS } from '../../src/framework/pack-checks.ts';
import { _HOST_SERVICE_NAMES } from '../../src/framework/service-consumption.ts';

describe('parseManifest', () => {
  it('offers known host service refs and duplicate diagnostics in the generated editor schema', () => {
    const schema = JSON.parse(readFileSync(resolve(__dirname, '../../apack.schema.json'), 'utf8'));
    const services = schema.properties.consumes.properties.services;
    expect(services.uniqueItems).toBe(true);
    expect(services.items.anyOf[0].enum).toEqual(_HOST_SERVICE_NAMES.map(name => `host/${name}`));
    expect(services.description).toContain('directly declare the service');
  });
  it('validates inline node labels and JSON defaults without a code target', () => {
    const pack = { id: 'nodes', name: 'Nodes', version: '1.0.0' };
    const parse = (node: unknown) => parseManifest({ ...pack, extensions: { steps: { memo: { node } } } });
    expect(parse({ label: 'Memo', defaults: { tags: ['draft'], ready: false, nested: { value: null } } }).status).toBe('valid');
    for (const node of [{}, { label: ' ' }, { label: 'Memo', extra: true },
      { label: 'Memo', defaults: { value: undefined } }, { label: 'Memo', defaults: { value: Infinity } },
      { label: 'Memo', defaults: { value() {} } }]) {
      const result = parse(node);
      expect(result.status).toBe('invalid');
      expect(result.diagnostics[0].path.slice(0, 4)).toEqual(['extensions', 'steps', 'memo', 'node']);
    }
  });
  it('documents and enforces the same inline check allowances', () => {
    const schema = JSON.parse(readFileSync(resolve(__dirname, '../../apack.schema.json'), 'utf8'));
    expect(schema.properties.checks.properties.allow.items.enum).toEqual([...ALLOWABLE_PACK_CHECKS]);
    const pack = { id: 'checks', name: 'Checks', version: '1.0.0' };
    expect(parseManifest({ ...pack, checks: { allow: [...ALLOWABLE_PACK_CHECKS] } }).status).toBe('valid');
    for (const checks of [{ allow: ['host-imports'] }, { allow: ['unknown'] }, { allow: 'backend-console' }, null, { unknown: true }]) {
      const report = parseManifest({ ...pack, checks });
      expect(report.status).toBe('invalid');
      expect(report.diagnostics[0].path[0]).toBe('checks');
    }
  });

  it('enforces the same default-surface uniqueness for native declarations', () => {
    const feature = { description: 'Show fixture items.', surface: { label: 'Items', state: 'state.ts', default: true } };
    expect(_NativePackDeclarationSchema.safeParse({ id: 'native', features: { first: feature } }).success).toBe(true);
    const result = _NativePackDeclarationSchema.safeParse({ id: 'native', features: { first: feature, second: feature } });
    expect(result.success).toBe(false);
    if (result.success) throw new Error('Duplicate defaults accepted');
    expect(result.error.issues[0].path).toEqual(['features', 'second', 'surface', 'default']);
    expect(result.error.issues[0].message).toContain('"first" and "second"');
  });

  it('distinguishes whole modules from named contract exports before reading any source', () => {
    const pack = { id: 'grammar', name: 'Grammar', version: '1.0.0' };
    const settings = { schema: { type: 'object' }, defaults: {} };
    const fields = [
      { features: { memos: { description: 'Manage memos.', system: { entry: 'src/module#value' } } } },
      { features: { memos: { description: 'Manage memos.', settings: { ...settings, form: 'src/module#value' } } } },
      { extensions: { settings: { extra: { ...settings, form: 'src/module#value' } } } },
      { extensions: { blocks: { extra: { fe: 'src/module#value' } } } },
      { extensions: { artifacts: { extra: { icon: 'File', fe: 'src/module#value' } } } },
      { extensions: { textEditor: { editor: { popups: { extra: 'src/module#value' } } }, appExtensions: { extra: 'src/module#value' } } },
      { extensions: { dsl: { extra: { entry: 'src/module#value', targets: ['monaco'] } } } },
      { content: { formats: { extra: { compiler: 'src/module#value' } } } },
      { content: { sources: { extra: { applier: 'src/module#value' } } } },
    ];
    for (const fieldsOf of fields) {
      const report = parseManifest({ ...pack, ...fieldsOf });
      expect(report.status).toBe('invalid');
      expect(report.diagnostics.every(issue => issue.message.includes('without an export selector'))).toBe(true);
    }
    for (const owner of ['system', 'surface']) {
      const declaration = owner === 'system' ? { entry: 'src/system', contract: 'src/types' }
        : { label: 'Memos', state: 'src/surface#machine', contract: 'src/types' };
      const feature = { description: 'Manage memos.', [owner]: declaration };
      expect(parseManifest({ ...pack, features: { memos: feature } }).diagnostics[0].path)
        .toEqual(['features', 'memos', owner, 'contract']);
      expect(parseManifest({ ...pack, features: { memos: { ...feature, [owner]: { ...declaration, contract: 'src/types#Contract' } } } }).status).toBe('valid');
    }
  });

  it('names both editor groups claiming one Tiptap extension for native and external packs', () => {
    const surface = { extensions: { mention: 'src/editor.ts#Mention' } };
    const contributions = { textEditor: { first: surface, second: surface } };
    const external = parseManifest({ id: 'editor', name: 'Editor', version: '1.0.0', extensions: contributions });
    expect(external.status).toBe('invalid');
    expect(external.diagnostics[0].path).toEqual(['extensions', 'textEditor', 'second', 'extensions', 'mention']);
    expect(external.diagnostics[0].message).toContain('"first" and "second"');
    const native = _NativePackDeclarationSchema.safeParse({ id: 'editor', ...contributions });
    expect(native.success).toBe(false);
    if (native.success) throw new Error('Duplicate native text editor extension accepted');
    expect(native.error.issues[0].path).toEqual(['textEditor', 'second', 'extensions', 'mention']);
    expect(native.error.issues[0].message).toContain('"first" and "second"');
  });

  it('requires a nonblank feature purpose without changing authored text', () => {
    const pack = { id: 'test-pack', name: 'Test', version: '0.1.0' };
    expect(parseManifest({ ...pack, features: { notes: {} } }).status).toBe('invalid');
    for (const description of ['', ' \n\t']) {
      expect(messagesOf(parseManifest({ ...pack, features: { notes: { description } } })))
        .toEqual([expect.stringContaining('Feature description must not be blank')]);
    }
    expect(parseManifest({ ...pack, features: { notes: { description: 'Write notes.' } } }).status).toBe('valid');
    expect(FeatureEntrySchema.parse({ description: '  Write notes.  ' }).description).toBe('  Write notes.  ');
  });
  it('accepts default-setup apack.json', () => {
    const raw = JSON.parse(
      readFileSync(resolve(__dirname, '../../../default-setup/apack.json'), 'utf-8'),
    );
    const result = parseManifest(raw);
    expect(messagesOf(result)).toEqual([]);
  });

  it("rejects declaring the SDK's entities or relation kinds, by name or value, naming each", () => {
    const pack = { id: 'test-pack', name: 'Test', version: '0.1.0' };
    const errorsOf = (field: object) => messagesOf(parseManifest({ ...pack, ...field }));
    expect(errorsOf({ data: { entities: { Flow: {}, Memo: {} } } })).toEqual([
      'apack.json "data.entities": "Flow" is defined by the SDK and available to every pack: remove it',
    ]);
    expect(errorsOf({ data: { relations: ['contains', 'transitions_to', 'holds', 'pinned'] } })).toEqual([
      'apack.json "data.relations": "CONTAINS": "contains", "TRANSITIONS_TO": "transitions_to" are defined by the SDK and available to every pack: remove them',
    ]);
    expect(errorsOf({ data: { relations: ['holds'] } })).toEqual([]);
    // A name only an object's prototype has is a pack's to use
    expect(errorsOf({ data: { entities: { constructor: {}, toString: {} } } })).toEqual([]);
    // Settings is not an SDK-reserved entity name
    expect(errorsOf({ data: { entities: { Memo: {}, Note: {}, Settings: {} }, relations: ['pinned'] }, })).toEqual([]);
  });

  it("rejects an entity type the engine's own ids are written with: a relation's", () => {
    const errorsOf = (entities: object) => messagesOf(parseManifest({ id: 'test-pack', name: 'Test', version: '0.1.0', data: { entities } }));
    expect(errorsOf({ Relation: {}, Sequence: {}, Memo: {} })).toEqual([
      'apack.json "data.entities": "Relation" is the engine\'s own, which its ids are written with (Relation-…): name the entity type something else',
    ]);
  });

  it("takes an entity's shape and short code prefix in its own entry, and refuses an entry that breaks the rules", () => {
    const pack = { id: 'test-pack', name: 'Test', version: '0.1.0' };
    const refused = (data: object) => messagesOf(parseManifest({ ...pack, data })).join('\n');
    expect(refused({ entities: { Memo: { shape: 'src/types.ts#Memo', shortCode: 'MEM' }, Tag: { shortCode: 'TAG' }, Index: {} } })).toBe('');
    // Three uppercase letters
    expect(refused({ entities: { Memo: { shortCode: 'MEMO' } } })).toContain('three uppercase letters');
    expect(refused({ entities: { Memo: { shortCode: 'mem' } } })).toContain('three uppercase letters');
    // An entry is an object of known keys: neither a bare target nor a key it doesn't know
    expect(refused({ entities: { Memo: 'src/types.ts#Memo' } })).not.toBe('');
    expect(refused({ entities: { Memo: { shape: 'src/types.ts#Memo', prefix: 'MEM' } } })).not.toBe('');
    // One entity per prefix, and the SDK's are taken
    expect(refused({ entities: { Memo: { shortCode: 'MEM' }, Tag: { shortCode: 'MEM' } } })).toContain('declared for both "Memo" and "Tag"');
    expect(refused({ entities: { Memo: { shortCode: 'DOC' } } })).toContain("the SDK's Document prefix");
  });


  it('rejects malformed shape targets and names both duplicate owners', () => {
    const pack = { id: 'test-pack', name: 'Test', version: '0.1.0' };
    expect(messagesOf(parseManifest({ ...pack, data: { entities: { Memo: { shape: 'src/types.ts#' } } } }))[0]).toContain('path#exportName');
    expect(messagesOf(parseManifest({ ...pack, data: { entities: { Memo: {} } },
      features: { memos: { description: 'Feature validation fixture.', entities: { Memo: {} } } } }))[0]).toContain('both "data" and "features.memos"');
  });

  it('keeps type-module validation and generated schema assistance consistent', () => {
    const pack = { id: 'test-pack', name: 'Test', version: '0.1.0' };
    const field = JSON.parse(readFileSync(resolve(__dirname, '../../apack.schema.json'), 'utf-8'))
      .properties.features.additionalProperties.properties.types;
    expect(new RegExp(field.pattern).test('src/public/types.ts')).toBe(true);
    expect(new RegExp(field.pattern).test('src/public/types.ts#Memo')).toBe(false);
    expect(messagesOf(parseManifest({ ...pack, features: { memos: { description: 'Feature validation fixture.', types: 'src/public/types.ts' } } }))).toEqual([]);
    expect(messagesOf(parseManifest({ ...pack, features: { memos: { description: 'Feature validation fixture.', types: 'src/public/types.ts#Memo' } } }))[0])
      .toContain('Must name a TypeScript module, not a single export');
  });

  it('accepts a minimal valid manifest', () => {
    const result = parseManifest({ id: 'test-pack', name: 'Test', version: '0.1.0' });
    expect(messagesOf(result)).toEqual([]);
  });

  it('rejects unknown top-level keys', () => {
    const result = parseManifest({
      id: 'test-pack', name: 'Test', version: '0.1.0',
      bogusField: true,
    });
    expect(messagesOf(result).length).toBeGreaterThan(0);
    expect(messagesOf(result)[0]).toContain('bogusField');
  });

  it('rejects unknown keys in feature system entries', () => {
    const result = parseManifest({
      id: 'test-pack', name: 'Test', version: '0.1.0',
      features: { main: { description: 'Feature validation fixture.', system: { entry: 'src/system.ts', exportName: 'mainEntry' } } },
    });
    expect(messagesOf(result).length).toBeGreaterThan(0);
    expect(messagesOf(result)[0]).toContain('exportName');
  });

  it('rejects missing required fields', () => {
    const result = parseManifest({ name: 'Test' });
    expect(messagesOf(result).length).toBeGreaterThan(0);
  });

  it('rejects invalid id format', () => {
    const result = parseManifest({ id: 'BadCase', name: 'Test', version: '0.1.0' });
    expect(messagesOf(result).length).toBeGreaterThan(0);
    expect(messagesOf(result)[0]).toContain('id');
  });

  it('rejects feature ids generated code reserves: reserved words', () => {
    const pack = { id: 'test-pack', name: 'Test', version: '0.1.0' };
    for (const id of ['default', 'export', 'eval']) {
      expect(messagesOf(parseManifest({ ...pack, features: { [id]: { description: 'Feature validation fixture.',} } }))).toEqual([expect.stringContaining(`"${id}" is reserved in generated code`)]);
    }
    expect(messagesOf(parseManifest({ ...pack, features: { defaults: { description: 'Feature validation fixture.',}, specs: { description: 'Feature validation fixture.',} } }))).toEqual([]);
  });

  // JSON cannot hold a key twice, so this is a property of the format rather than a check anything runs:
  // two features with one id used to collapse last-wins across five generated modules, silently
  it('cannot be given one feature id twice', () => {
    const pack = { id: 'test-pack', name: 'Test', version: '0.1.0' };
    const parsed = JSON.parse('{"notes": {"description": "Manage notes.", "settings": {"schema": {"type": "object"}, "defaults": {}}}, "notes": {"description": "Manage notes.", "settings": {"schema": {"type": "object"}, "defaults": {}}}}');
    expect(Object.keys(parsed)).toEqual(['notes']);
    expect(messagesOf(parseManifest({ ...pack, features: parsed }))).toEqual([]);
  });

  it('rejects unsupported root fields through the current schema', () => {
    const errors = messagesOf(parseManifest({ id: 'test-pack', name: 'Test', version: '0.1.0', nonsense: 1 }));
    expect(errors).toEqual([expect.stringContaining('nonsense')]);
  });

  it('rejects an app extension name that is not an identifier', () => {
    const pack = { id: 'test-pack', name: 'Test', version: '0.1.0' };
    expect(messagesOf(parseManifest({ ...pack, extensions: {  appExtensions: { 'my-ext': 'x.vue' }  } }))).toEqual([expect.stringContaining('Must be an identifier')]);
    expect(messagesOf(parseManifest({ ...pack, extensions: {  appExtensions: { welcome: 'x.vue' }  } }))).toEqual([]);
  });
});

describe('the pack id', () => {
  // The app is the pack `host`: its features are `host/<feature>`, so a pack of that id would share them
  it("refuses the host's own", () => {
    expect(messagesOf(parseManifest({ id: 'host', name: 'Host', version: '0.1.0' })))
      .toEqual([expect.stringContaining('"host" is the app\'s own pack id')]);
    expect(messagesOf(parseManifest({ id: 'hosted', name: 'Hosted', version: '0.1.0' }))).toEqual([]);
  });
});

describe('content.formats, content.sources and content.datasets', () => {
  const pack = { id: 'test-pack', name: 'Test', version: '0.1.0', data: { entities: { Memo: {} } }, dependencies: { 'base-pack': '*' } };
  const memos = {
    format: 'markdown-tree', entity: 'Memo', identity: ['title', 'parent'],
    tree: { branch: 'index.md', relKind: 'contains' },
    fields: { title: { from: 'frontmatter.title', default: 'filename', type: 'string' }, body: { from: 'body' } },
    media: 'media',
  };
  const errorsFor = (sources: Record<string, unknown>, formats: Record<string, unknown> = { memos }) =>
    messagesOf(parseManifest({ ...pack, content: { formats, sources } }));
  const datasetErrors = (datasets: Record<string, unknown>, formats: Record<string, unknown> = { memos }) =>
    messagesOf(parseManifest({ ...pack, content: { formats, datasets } }));

  it('accepts specialty paths, sources naming own or dependency formats, applier sources, and format sources with an applier', () => {
    expect(errorsFor({
      actions: 'src/content/actions',
      flows: { path: 'src/content/flows' },
      memos: { path: 'src/content/memos', format: 'memos' },
      tags: { path: 'src/content/tags.json', format: 'tags' },
      docs: { path: 'src/content/docs', format: 'docs' },
      notes: { path: 'src/content/notes', format: 'base-pack:notes' },
      custom: { applier: 'src/content/custom.ts' },
      pinned: { path: 'src/content/pinned.json', format: 'tags', applier: 'src/content/pinned.ts' },
    }, {
      memos,
      tags: { format: 'json', entity: 'Memo', identity: ['name'] },
      docs: { compiler: 'src/content/compilers/docs.ts', entity: ['Memo'] },
    })).toEqual([]);
  });

  it('rejects a path string for a key the SDK does not compile', () => {
    expect(errorsFor({ library: 'src/content/library' })).toEqual([expect.stringMatching(/"content\.sources\.library": Unknown content key "library"/)]);
  });

  it('rejects a source that is neither { path, format } (with or without an applier) nor { applier }', () => {
    const shape = /Content "memos" must be \{ "path", "format" \}, optionally with "applier", or \{ "applier" \}/;
    expect(errorsFor({ memos: { path: 'src/content/memos' } })).toEqual([expect.stringMatching(shape)]);
    expect(errorsFor({ memos: { format: 'memos' } })).toEqual([expect.stringMatching(shape)]);
    expect(errorsFor({ memos: { applier: 's.ts', path: 'p' } })).toEqual([expect.stringMatching(shape)]);
    expect(errorsFor({ memos: { applier: 's.ts', format: 'memos' } })).toEqual([expect.stringMatching(shape)]);
    expect(errorsFor({ memos: {} })).toEqual([expect.stringMatching(shape)]);
  });

  /**
   * A dataset is compiled and never written, so it takes no applier — and a key is a file name in the
   * compiled output, so the two sections cannot share one.
   */
  it('takes { path, format } for a dataset, and refuses an applier or a key a source has', () => {
    expect(datasetErrors({ faqs: { path: 'src/content/faqs', format: 'memos' } })).toEqual([]);
    expect(datasetErrors({ faqs: { path: 'p', format: 'memos', applier: 'a.ts' } }))
      .toEqual([expect.stringMatching(/Dataset "faqs" must be \{ "path", "format" \}: it is compiled and never written/)]);
    expect(datasetErrors({ faqs: { format: 'memos' } }))
      .toEqual([expect.stringMatching(/Dataset "faqs" must be \{ "path", "format" \}/)]);
    expect(messagesOf(parseManifest({
      ...pack,
      content: { formats: { memos }, sources: { memos: { path: 'p', format: 'memos' } }, datasets: { memos: { path: 'q', format: 'memos' } } },
    }))).toEqual([expect.stringMatching(/"memos" is both a content source and a dataset/)]);
  });

  it('rejects format settings on a source: they belong to a content.formats format', () => {
    expect(errorsFor({ memos: { path: 'p', format: 'memos', fields: { title: { from: 'body' } } } })).toEqual([expect.stringMatching(/Unrecognized key.*fields/)]);
    expect(errorsFor({ memos: { path: 'p', format: 'memos', entity: 'Memo' } })).toEqual([expect.stringMatching(/Unrecognized key.*entity/)]);
  });

  it("treats settings as a pack's own content key: a source, in any pack", () => {
    expect(errorsFor({ settings: 'src/content/default-settings.ts' })).toEqual([expect.stringMatching(/"content\.sources\.settings": Unknown content key "settings": only actions, prompts, flows, documents, commands take a path/)]);
    expect(errorsFor({ settings: { path: 'src/content/settings.json', format: 'memos', applier: 'src/content/settings.ts' } })).toEqual([]);
  });

  // `earlySystem` was a built-in pack's privilege, policed by a refinement that named it. The capability is
  // gone, so there is nothing left to permit and no bespoke message to write: an unknown key is an unknown
  // key, which `.strict()` refuses for every pack alike
  it('refuses features[].earlySystem as the unknown key it now is, in any pack', () => {
    const features = { logs: { description: 'Inspect logs.', earlySystem: true, system: { entry: 'src/logs/system.ts' } } };
    expect(messagesOf(parseManifest({ ...pack, features }))).toEqual([expect.stringMatching(/features\.logs.*[Uu]nrecognized key/)]);
  });

  // The shorthand: names and placeholders in the manifest, desugared into ordinary content at build time.
  // `list` is nested so `onUserEdit` has somewhere to sit that is not also a command name.
  it('takes slash commands declared in the manifest, with an optional edit policy beside them', () => {
    const commands = (value: unknown) => ({ ...pack, extensions: { commands: value } });

    expect(messagesOf(parseManifest(commands({ list: { 'pr2md': { placeholder: 'PR number' } } })))).toEqual([]);
    expect(messagesOf(parseManifest(commands({ onUserEdit: 'theirs', list: { 'pr2md': { placeholder: 'PR number' } } })))).toEqual([]);

    expect(messagesOf(parseManifest(commands({ list: { 'PR2MD': { placeholder: 'x' } } }))))
      .toEqual([expect.stringMatching(/A command name must be a lowercase letter/)]);
    expect(messagesOf(parseManifest(commands({ list: { 'pr2md': { placeholder: '' } } }))).length).toBeGreaterThan(0);
    expect(messagesOf(parseManifest(commands({ list: { 'pr2md': { placeholder: 'x', extra: 1 } } }))).length).toBeGreaterThan(0);
    expect(messagesOf(parseManifest(commands({ list: {} })))).toEqual([expect.stringMatching(/declares no command/)]);
    expect(messagesOf(parseManifest(commands({ onUserEdit: 'theirs' }))).length).toBeGreaterThan(0);
  });

  // A pack used to name a function that served its slash commands. The app reads the stored documents
  // itself now, so there is nothing to declare and the key is refused rather than quietly ignored.
  it('refuses features[].getCommands as the unknown key it now is, in any pack', () => {
    const features = { library: { description: 'Serves them.', getCommands: 'src/library/be/commands.ts#commands' } };
    expect(messagesOf(parseManifest({ ...pack, features }))).toEqual([expect.stringMatching(/features\.library.*[Uu]nrecognized key/)]);
  });

  // Which surface opens first is an annotation on the surface, not a feature id at the root: an id there
  // could name a feature the pack doesn't have, and codegen then emitted no default at all. A pack
  // claiming none has no default surface, which the shell handles.
  it('takes the default surface from the surface that claims it, and refuses two claims', () => {
    const surface = (id: string, isDefault?: boolean) =>
      ({ [id]: { description: `Exercise ${id} navigation.`, surface: { label: 'Fixture', state: `src/${id}/fe/surface.ts`, ...(isDefault ? { default: true } : {}) } } });

    expect(messagesOf(parseManifest({ ...pack, features: { ...surface('notes'), ...surface('cards', true) } }))).toEqual([]);
    expect(messagesOf(parseManifest({ ...pack, features: { ...surface('notes', true), ...surface('cards', true) } })))
      .toEqual([expect.stringMatching(/"features\.cards\.surface\.default": Two features claim the default surface: "notes" and "cards"/)]);
  });

  it('has no root defaultSurface to name a feature that may not exist', () => {
    expect(messagesOf(parseManifest({ ...pack, defaultSurface: 'threads' }))).toEqual([expect.stringMatching(/Unrecognized key.*defaultSurface/)]);
  });

  it('rejects anything but a path on a specialty key', () => {
    expect(errorsFor({ actions: { path: 'src/content/actions', format: 'memos' } })).toEqual([expect.stringMatching(/"actions" is compiled by the SDK/)]);
  });

  it('rejects content keys that aren\'t plain names: they become file paths and identifiers', () => {
    for (const key of ['../x', 'x/y', 'a_b', 'Memos', '']) {
      expect(errorsFor({ [key]: { path: 'p', format: 'memos' } }), key).toEqual([expect.stringMatching(/Must be a lowercase letter, then lowercase letters, digits and hyphens/)]);
    }
    expect(errorsFor({ 'quick-memos': { path: 'p', format: 'memos' } })).toEqual([]);
  });

  it("rejects a format name that isn't in content.formats, or a dependency prefix that isn't a dependency", () => {
    expect(errorsFor({ memos: { path: 'p', format: 'notes' } })).toEqual([expect.stringMatching(/"content\.sources\.memos\.format": Content "memos": no format "notes" in content\.formats/)]);
    expect(errorsFor({ memos: { path: 'p', format: 'other-pack:notes' } })).toEqual([expect.stringMatching(/format "other-pack:notes" names "other-pack", which isn't a dependency/)]);
    expect(errorsFor({ memos: { path: 'p', format: 'Not A Name' } })).toEqual([expect.stringMatching(/Must be a content\.formats name, or "<dependency id>:<name>"/)]);
    // A dataset's format is checked in the same two places
    expect(datasetErrors({ faqs: { path: 'p', format: 'notes' } }))
      .toEqual([expect.stringMatching(/"content\.datasets\.faqs\.format": Content "faqs": no format "notes" in content\.formats/)]);
  });

  it.each(['sources', 'datasets'] as const)('requires explicit format and dependency declarations for content.%s', section => {
    const errors = section === 'sources' ? errorsFor : datasetErrors;
    expect(errors({ items: { path: 'p', format: 'constructor' } }))
      .toEqual([expect.stringContaining('no format "constructor" in content.formats')]);
    expect(errors({ items: { path: 'p', format: 'constructor:memos' } }))
      .toEqual([expect.stringContaining('names "constructor", which isn\'t a dependency')]);
    expect(errors({ items: { path: 'p', format: 'constructor' } }, { constructor: memos })).toEqual([]);
    expect(messagesOf(parseManifest({ ...pack, dependencies: { constructor: '*' },
      content: { [section]: { items: { path: 'p', format: 'constructor:memos' } } },
    }))).toEqual([]);
  });

  it('checks source/dataset collisions against declared source names only', () => {
    const entry = { path: 'p', format: 'memos' };
    expect(datasetErrors({ constructor: entry })).toEqual([]);
    expect(messagesOf(parseManifest({ ...pack, content: {
      formats: { memos }, sources: { constructor: entry }, datasets: { constructor: entry },
    } }))).toEqual([expect.stringContaining('"constructor" is both a content source and a dataset')]);
  });

  it('rejects unknown format keys, bad field sources, and format/compiler misuse', () => {
    const sources = { memos: { path: 'p', format: 'memos' } };
    expect(errorsFor(sources, { memos: { format: 'json', entityType: 'Memo' } })).toEqual([expect.stringMatching(/Unrecognized key.*entityType/)]);
    expect(errorsFor(sources, { memos: { format: 'markdown-tree', fields: { title: { from: 'heading' } } } }))
      .toEqual([expect.stringMatching(/"content\.formats\.memos\.fields\.title\.from": Must be "body", "filename", "path" or "frontmatter\.<name>"/)]);
    expect(errorsFor(sources, { memos: { format: 'json', compiler: 'c.ts' } })).toEqual([expect.stringMatching(/needs "format" or "compiler", not both/)]);
    expect(errorsFor(sources, { memos: { entity: 'Memo' } })).toEqual([expect.stringMatching(/needs "format" or "compiler", not both/)]);
    expect(errorsFor(sources, { memos: { format: 'json', fields: { title: { from: 'body' } } } })).toEqual([expect.stringMatching(/"fields" applies only to format "markdown-tree"/)]);
    expect(errorsFor({}, { Memos: { format: 'json' } })).toEqual([expect.stringMatching(/Must be a lowercase letter, then lowercase letters, digits and hyphens/)]);
  });

  it('rejects a markdown-tree format with a list of entities: it writes one entity type', () => {
    expect(errorsFor({ memos: { path: 'p', format: 'memos' } }, { memos: { ...memos, entity: ['Memo'] } }))
      .toEqual([expect.stringMatching(/"content\.formats\.memos\.entity": Format "markdown-tree" writes one entity type/)]);
  });

  it('rejects a media directory outside the source\'s path', () => {
    const sources = { memos: { path: 'p', format: 'memos' } };
    for (const media of ['..', '../shared', 'media/../..', '/abs', 'C:/x', 'a\\b', './media', 'media/', '']) {
      expect(errorsFor(sources, { memos: { ...memos, media } }), media)
        .toEqual([expect.stringMatching(/"content\.formats\.memos\.media": Must be a relative directory under the entry's path/)]);
    }
    expect(errorsFor(sources, { memos: { ...memos, media: 'assets/images' } })).toEqual([]);
  });
});

describe('content.writers', () => {
  const pack = { id: 'test-pack', name: 'Test', version: '0.1.0', data: { entities: { Memo: {} } } };

  it('accepts a writer for an entity type the pack declares', () => {
    expect(messagesOf(parseManifest({ ...pack, content: { writers: { Memo: 'src/memo-writers.ts#memoWriter' } } }))).toEqual([]);
  });

  it("rejects a writer for an entity type the pack doesn't declare", () => {
    expect(messagesOf(parseManifest({ ...pack, content: { writers: { Action: 'src/writers.ts#actionWriter' } } })))
      .toEqual([expect.stringMatching(/A content writer for "Action": only entity types this pack declares/)]);
  });

  it('rejects a target without an export name', () => {
    expect(messagesOf(parseManifest({ ...pack, content: { writers: { Memo: 'src/memo-writers.ts' } } }))).toEqual([expect.stringMatching(/Must be "path#exportName"/)]);
  });
});

describe('services', () => {
  const pack = { id: 'test-pack', name: 'Test', version: '0.1.0' };
  const feature = (services: Record<string, string>) => ({ ...pack, features: { memos: { description: 'Feature validation fixture.', services } } });

  it('accepts feature and pack-level services naming their export', () => {
    expect(messagesOf(parseManifest({ ...feature({ memo: 'src/features/memos/be/services/memo.ts#memoService' }), extensions: { services: { cache: 'src/cache#cacheService' } } }))).toEqual([]);
  });

  it('rejects a service path without an export name', () => {
    expect(messagesOf(parseManifest(feature({ memo: 'src/features/memos/be/services/memo.ts' })))).toEqual([expect.stringMatching(/Must be "path#exportName"/)]);
    expect(messagesOf(parseManifest({ ...pack, extensions: { services: { cache: 'src/cache' } } }))).toEqual([expect.stringMatching(/Must be "path#exportName"/)]);
  });

  it('rejects a service name that is not an identifier', () => {
    expect(messagesOf(parseManifest({ ...pack, extensions: { services: { 'my-cache': 'src/cache.ts#cacheService' } } }))).toEqual([expect.stringMatching(/Must be an identifier/)]);
  });
});

function messagesOf(result: { diagnostics: { message: string }[] }): string[] {
  return result.diagnostics.map(issue => issue.message);
}

it('preserves opaque JSON default keys across authored and native declaration decoding', async () => {
  const { ManifestSchema } = await import('../../src/framework/declaration-schema.ts');
  const defaults = JSON.parse('{"__proto__":{"retained":true},"constructor":"value","nested":{"value":1}}');
  const settings = { schema: { type: 'object' }, defaults };
  const source = { id: 'data-pack', name: 'Data', version: '1.0.0', extensions: {
    settings: { preferences: settings }, steps: { memo: { node: { label: 'Memo', defaults } } },
  } };
  const parsed = ManifestSchema.parse(source);
  expect(Object.hasOwn(parsed.extensions!.steps!.memo.node.defaults!, '__proto__')).toBe(true);
  expect(Object.hasOwn(parsed.extensions!.settings!.preferences.defaults, '__proto__')).toBe(true);
  expect(parsed.extensions!.steps!.memo.node.defaults).toEqual(defaults);
  expect(parsed.extensions!.steps!.memo.node.defaults).not.toBe(defaults);
  const native = _NativePackDeclarationSchema.parse({ id: 'native', settings: { preferences: settings },
    steps: source.extensions.steps });
  expect(native.steps!.memo.node.defaults).toEqual(defaults);
  expect(native.settings!.preferences.defaults).toEqual(defaults);
});
