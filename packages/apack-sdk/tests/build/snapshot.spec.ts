import { describe, expect, it } from 'vitest';
import { PACK_SNAPSHOT_FORMAT, _snapshotFormatMismatch, type PackSnapshot, type PackDependencySnapshot } from '../../src/build/manifest.ts';
import { parseSnapshot, parseDependencySnapshot } from '../../src/build/snapshot.ts';
import { _declarationRevision } from '../../src/build/declaration-revision.ts';

const snapshot = (): PackSnapshot => ({
  declarationRevision: _declarationRevision({ id: 'fixture-pack', name: 'Fixture', version: '1.0.0' }),
  format: PACK_SNAPSHOT_FORMAT,
  manifest: { id: 'fixture-pack', name: 'Fixture', version: '1.0.0' },
  types: { entities: {}, relKinds: {}, roles: {} }, entityDestinations: {}, facades: {},
});

describe('snapshot data reader', () => {
  it('requires compiled contracts for every declared endpoint and refuses foreign or malformed contracts', () => {
    const data = snapshot();
    data.manifest.features = { jobs: { description: 'Run jobs', system: { entry: 'src/jobs.ts' } } };
    data.declarationRevision = _declarationRevision(data.manifest);
    expect(parseSnapshot(data).diagnostics[0].code).toBe('snapshot.eventContracts');
    data.eventContracts = { jobs: { system: { incoming: ['START'], outgoing: [] } } };
    expect(parseSnapshot(data).status).toBe('valid');
    expect(parseSnapshot({ ...data, eventContracts: { foreign: data.eventContracts.jobs } }).status).toBe('invalid');
    expect(parseSnapshot({ ...data, eventContracts: { jobs: { surface: { receives: [] } } } }).status).toBe('invalid');
    expect(parseSnapshot({ ...data, eventContracts: { jobs: { system: { incoming: ['START', 'START'], outgoing: [] } } } }).status).toBe('invalid');
  });
  it('requires complete, exclusively declared Monaco definitions without requiring globals', () => {
    const data = snapshot();
    data.manifest.extensions = { dsl: { rows: { entry: 'src/rows.ts', targets: ['monaco'] } } };
    data.declarationRevision = _declarationRevision(data.manifest);
    expect(parseSnapshot(data).diagnostics).toMatchObject([{ code: 'snapshot.dslDefinitions', message: expect.stringContaining('rows') }]);
    data.dslDefinitions = { rows: 'declare module "@app/defs/rows" { export interface Row {} }' };
    expect(parseSnapshot(data).status).toBe('valid');
    expect(parseDependencySnapshot(data).status).toBe('valid');
    data.dslDefinitions.foreign = 'export {}';
    expect(parseSnapshot(data).diagnostics[0].message).toContain('undeclared DSL "foreign"');
    expect(parseSnapshot({ ...snapshot(), dslDefinitions: {} }).diagnostics[0].message).toContain('no declared Monaco targets');
    expect(parseSnapshot({ ...data, dslDefinitions: Object.create({ rows: 'inherited' }) }).diagnostics[0].message).toContain('Missing compiled');
  });

  it('requires materialized help only for a declared contribution', () => {
    const data = snapshot();
    data.manifest.extensions = { help: { path: 'help' } };
    data.declarationRevision = _declarationRevision(data.manifest);
    expect(parseSnapshot(data).diagnostics[0].code).toBe('snapshot.help.incomplete');
    data.help = [{ id: 'start', title: 'Start', body: 'Details' }];
    expect(parseSnapshot(data).status).toBe('valid');
    data.help.push({ id: 'start', title: 'Duplicate', body: '' });
    expect(parseSnapshot(data).diagnostics[0].message).toContain('Duplicate help article');
  });

  it('refuses foreign feature filters and undeclared help data', () => {
    const data = snapshot();
    data.manifest.extensions = { help: { path: 'help' } };
    data.declarationRevision = _declarationRevision(data.manifest);
    data.help = [{ id: 'start', title: 'Start', body: '', features: ['foreign'] }];
    expect(parseSnapshot(data).diagnostics[0].message).toContain('undeclared feature');
    expect(parseSnapshot({ ...snapshot(), help: [] }).diagnostics[0].message).toContain('undeclared help');
  });
  it('rejects a manifest changed without rebuilding its bindings', () => {
    const data = snapshot();
    data.manifest.name = 'Changed';
    expect(parseSnapshot(data).diagnostics).toMatchObject([{ code: 'snapshot.declarations' }]);
    data.declarationRevision = _declarationRevision(data.manifest);
    expect(parseSnapshot(data).status).toBe('valid');
  });

  it.each([undefined, 'old', 'a'.repeat(63)])('requires a complete declaration identity: %j', declarationRevision => {
    expect(parseSnapshot({ ...snapshot(), declarationRevision }).status).toBe('invalid');
  });

  it('reads all supported fields without changing the snapshot', () => {
    const data: PackSnapshot = {
      ...snapshot(), sdkVersion: '0.4.0',
      provenance: { entities: { Memo: 'ancestor' }, surfaces: { 'fixture-pack/notes': 'fixture-pack' } },
      flowHelpers: { exports: ['memo'], module: 'export const memo = 1;', types: 'export declare const memo: number;' },
    };
    const before = structuredClone(data);
    expect(parseSnapshot(data)).toEqual({ status: 'valid', diagnostics: [], skippedChecks: [], snapshot: data });
    expect(data).toEqual(before);
  });

  it.each([null, undefined, [], 'snapshot', 7])('refuses non-object snapshots: %j', data => {
    expect(parseSnapshot(data).status).toBe('invalid');
    expect(_snapshotFormatMismatch(data)?.problem).toContain('format (none)');
  });

  it('checks format before interpreting fields from another contract', () => {
    const result = parseSnapshot({ format: PACK_SNAPSHOT_FORMAT + 1, sdkVersion: '9.0.0', manifest: 'new grammar' });
    expect(result.snapshot).toBeUndefined();
    expect(result.diagnostics).toMatchObject([{ code: 'snapshot.format', path: ['format'] }]);
    expect(result.diagnostics[0].message).toContain('SDK 9.0.0');
    expect(result.diagnostics[0].suggestion).toContain('Update');
  });

  it('preserves ordinary record names that resemble object prototype properties', () => {
    const data = JSON.parse(JSON.stringify(snapshot()));
    data.types.entities = JSON.parse('{"__proto__":"__proto__","constructor":"constructor"}');
    data.provenance = { entities: JSON.parse('{"__proto__":"ancestor","constructor":"ancestor"}') };
    expect(Object.keys(parseSnapshot(data).snapshot!.types.entities)).toEqual(['__proto__', 'constructor']);
    expect(Object.keys(parseSnapshot(data).snapshot!.provenance!.entities!)).toEqual(['__proto__', 'constructor']);
    data.types.entities.__proto__ = false;
    expect(parseSnapshot(data).status).toBe('invalid');
  });

  it('checks entity grammar and SDK ownership before decoding original record keys', () => {
    const data = snapshot();
    data.manifest.data = { entities: JSON.parse('{"__proto__":{}}') };
    data.declarationRevision = _declarationRevision(data.manifest);
    expect(parseSnapshot(data).status).toBe('valid');
    data.manifest.data.entities = JSON.parse('{"__proto__":{"shape":"src/types.ts#"}}');
    expect(parseSnapshot(data).diagnostics.some(issue => issue.message.includes('path#exportName'))).toBe(true);
    data.manifest.data.entities = { Flow: {} };
    expect(parseSnapshot(data).diagnostics.some(issue => issue.message.includes('defined by the SDK'))).toBe(true);
    delete data.manifest.data;
    data.manifest.data = { relations: { contains: {} } };
    expect(parseSnapshot(data).diagnostics.some(issue => issue.path.join('.') === 'manifest.data.relations')).toBe(true);
  });

  it.each([
    ['manifest', { id: 'fixture-pack', version: '1.0.0' }, ['manifest', 'name']],
    ['manifest', { id: 'fixture-pack', name: 'Fixture', version: '1.0.0', features: { notes: { surface: {} } } }, ['manifest', 'features', 'notes', 'surface', 'label']],
    ['types', {}, ['types', 'entities']],
    ['types', { entities: { Memo: 1 }, relKinds: {}, roles: {} }, ['types', 'entities', 'Memo']],
    ['facades', { 'pack-types': false }, ['facades', 'pack-types']],
    ['flowHelpers', { exports: [], module: '' }, ['flowHelpers', 'types']],
    ['provenance', { unknownKind: {} }, ['provenance', 'unknownKind']],
    ['provenance', { entities: { Memo: false } }, ['provenance', 'entities', 'Memo']],
  ])('refuses malformed %s at its actual path', (field, value, path) => {
    const result = parseSnapshot({ ...snapshot(), [field]: value });
    expect(result.status).toBe('invalid');
    expect(result.snapshot).toBeUndefined();
    expect(result.diagnostics.some(issue => JSON.stringify(issue.path) === JSON.stringify(path))).toBe(true);
  });


  it.each(['../outside', '../../outside', 'nested/name', 'nested\\name', '/absolute', 'pack-types.d.ts', '', '..'])
  ('refuses a facade name that cannot be a cache filename: %j', name => {
    const result = parseSnapshot({ ...snapshot(), facades: { [name]: 'export {};' } });
    expect(result.status).toBe('invalid');
    expect(result.snapshot).toBeUndefined();
    expect(result.diagnostics.some(issue => issue.path.join('.') === ['facades', name].join('.'))).toBe(true);
  });

  it('refuses unknown fields instead of silently stripping contributions', () => {
    const result = parseSnapshot({ ...snapshot(), futureContribution: {} });
    expect(result.status).toBe('invalid');
    expect(result.diagnostics[0].message).toContain('futureContribution');
  });
});


describe('dependency type-data reader', () => {
  it.each([undefined, 0, PACK_SNAPSHOT_FORMAT, PACK_SNAPSHOT_FORMAT + 1])('retains an honest recorded stamp: %s', format => {
    const data: PackDependencySnapshot = snapshot();
    if (format === undefined) delete data.format;
    else data.format = format;
    const result = parseDependencySnapshot(data);
    expect(result.status).toBe('valid');
    expect(result.snapshot).toEqual(data);
    expect(result.snapshot?.format).toBe(format);
    expect(Object.hasOwn(result.snapshot!, 'format')).toBe(format !== undefined);
    expect(result.diagnostics.length).toBe(format === PACK_SNAPSHOT_FORMAT ? 0 : 1);
    if (format !== PACK_SNAPSHOT_FORMAT) expect(result.diagnostics[0].severity).toBe('warning');
    expect(parseSnapshot(data).status).toBe(format === PACK_SNAPSHOT_FORMAT ? 'valid' : 'invalid');
  });

  it('uses the same current grammar, names, declaration revision and help checks', () => {
    const { format: _format, ...data } = snapshot();
    for (const fields of [{ facades: { '../escape': 'export {};' } }, { declarationRevision: '0'.repeat(64) },
      { types: { entities: {}, relKinds: { bad: false }, roles: {} } }, { extra: true },
      { manifest: { ...data.manifest, extensions: { help: { path: 'help' } } } }]) {
      const result = parseDependencySnapshot({ ...data, ...fields });
      expect(result.status).toBe('invalid');
      expect(result.snapshot).toBeUndefined();
    }
  });
});


describe('compiled entity destinations', () => {
  it('requires the data map in both complete and dependency snapshots', () => {
    const { entityDestinations: _destinations, ...missing } = snapshot();
    expect(parseSnapshot(missing).diagnostics[0].path).toEqual(['entityDestinations']);
    expect(parseDependencySnapshot(missing).status).toBe('invalid');
  });

  it('accepts known entities only at an own declared surface feature', () => {
    const data = snapshot();
    data.manifest.features = { notes: { description: 'Opens notes', surface: { label: 'Notes', state: 'src/notes.ts' } } };
    data.types.entities = { Note: 'Note' };
    data.entityDestinations = { Note: 'notes', Action: 'notes' };
    data.eventContracts = { notes: { surface: { receives: [] } } };
    data.declarationRevision = _declarationRevision(data.manifest);
    expect(parseSnapshot(data).snapshot?.entityDestinations).toEqual(data.entityDestinations);
    for (const invalid of [{ Missing: 'notes' }, { Note: 'missing' }, { Note: 'constructor' }]) {
      expect(parseSnapshot({ ...data, entityDestinations: invalid }).diagnostics[0].code).toBe('snapshot.entityDestinations');
    }
    data.manifest.features.notes = { description: 'No longer a surface' };
    data.eventContracts = {};
    expect(parseSnapshot(data).diagnostics[0].code).toBe('snapshot.entityDestinations');
  });
});
