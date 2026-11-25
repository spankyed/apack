import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _declarationRevision, PACK_SNAPSHOT_FORMAT, type ContentIndex, type PackManifest } from '@apackdev/pack-format';
import { _packEntityTypes } from '@apackdev/sdk/framework';
import { cacheDependency, PACK_LAYOUT, sealPackBuild } from '@apackdev/host/packs';
import type { PackEventContracts } from '@apackdev/sdk/framework';
import { inspectPack, info } from '../../src/commands/info.ts';

let root: string;
const manifest: PackManifest = { id: 'inspection-pack', name: 'Inspection', version: '1.0.0',
  features: { memos: { description: 'Inspection fixture.', entities: { Memo: {} } } },
  content: { formats: { records: { format: 'json', entity: 'Memo', identity: ['id'] } },
    sources: { memos: { path: 'content', format: 'records' } } },
};
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-pack-inspection-'));
  fs.writeFileSync(path.join(root, 'apack.json'), JSON.stringify(manifest));
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Inspection must not fetch'); }));
  vi.stubEnv('APACK_HOST', '');
  vi.stubEnv('APACK_HOST_ROOT', '');
  vi.stubEnv('APACK_HOST_EXECUTABLE', '');
  vi.stubEnv('APACK_USER_DATA_DIR', path.join(root, 'isolated-app'));
});
afterEach(() => {
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});

function writeBuild(directory: string, declared = manifest, index?: object, entityDestinations: Record<string, string> = {}, eventContracts: PackEventContracts = Object.fromEntries(Object.entries(declared.features ?? {})
  .filter(([, feature]) => feature.system || feature.surface).map(([id, feature]) => [id, {
    ...(feature.system && { system: { incoming: feature.system.events?.incoming ?? [], outgoing: [] } }),
    ...(feature.surface && { surface: { receives: [] } }),
  }]))): string {
  const output = path.join(directory, 'dist');
  fs.mkdirSync(path.join(output, 'types'), { recursive: true });
  fs.mkdirSync(path.join(output, 'runtime'), { recursive: true });
  fs.writeFileSync(path.join(output, PACK_LAYOUT.runtimeEntry), 'throw new Error("Inspection imported executable code");');
  fs.writeFileSync(path.join(output, PACK_LAYOUT.feEntry), 'throw new Error("Inspection imported executable frontend code");');
  fs.writeFileSync(path.join(output, PACK_LAYOUT.snapshot), JSON.stringify({
    manifest: declared, declarationRevision: _declarationRevision(declared), format: PACK_SNAPSHOT_FORMAT,
    types: { entities: _packEntityTypes(declared), relKinds: {}, roles: {} }, entityDestinations, eventContracts, facades: {},
  }));
  if (index) {
    fs.mkdirSync(path.join(output, PACK_LAYOUT.contentDir));
    fs.writeFileSync(path.join(output, PACK_LAYOUT.contentDir, 'content.json'), JSON.stringify(index));
    for (const entry of (index as ContentIndex).entries) {
      fs.writeFileSync(path.join(output, PACK_LAYOUT.contentDir, `${entry.key}.content.json`), '{"records":[]}');
    }
  }
  sealPackBuild(output, declared);
  return output;
}

const index = { version: 1, packId: manifest.id, entries: [
  { key: 'memos', written: true, count: 2, identity: ['id'], items: [{ key: 'first', description: 'First memo' }, { key: 'second' }] },
] };

describe('read-only pack inspection', () => {
  it('attributes stale compiled endpoints to their built owner after an authored pack rename', async () => {
    const declared: PackManifest = { ...manifest, features: { memos: { ...manifest.features!.memos,
      surface: { label: 'Memos', state: 'src/missing.ts' },
    } } };
    writeBuild(root, declared, index, { Memo: 'memos' });
    fs.writeFileSync(path.join(root, 'apack.json'), JSON.stringify({ ...declared, id: 'renamed-pack' }));
    const report = await inspectPack(root);
    expect(report.build.status).toBe('stale');
    expect(report.build.metadata?.packId).toBe('inspection-pack');
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(process, 'cwd').mockReturnValue(root);
    await info([]);
    expect(output.mock.calls.flat().join('\n')).toContain('Memo → inspection-pack/memos');
    expect(output.mock.calls.flat().join('\n')).not.toContain('Memo → renamed-pack/memos');
  });
  it('inspects compiled endpoint events with no authored sources and a poisoned runtime', async () => {
    const declared: PackManifest = { ...manifest, features: { memos: { ...manifest.features!.memos,
      system: { entry: 'src/missing-system.ts' }, surface: { label: 'Memos', state: 'src/missing-state.ts' },
    } } };
    const events = { memos: { system: { incoming: ['SAVE'], outgoing: ['SAVED'] }, surface: { receives: ['SAVED', 'SHOW'] } } };
    fs.writeFileSync(path.join(root, 'apack.json'), JSON.stringify(declared));
    writeBuild(root, declared, index, {}, events);
    const report = await inspectPack(root);
    expect(report.build.status).toBe('verified');
    expect(report.build.metadata?.eventContracts).toEqual(events);
    expect(fs.existsSync(path.join(root, 'src'))).toBe(false);
  });
  it('reads node defaults and step bindings from an installed build without authored modules', async () => {
    const steps = { memo: { node: { label: 'Memo', defaultLabel: 'Write a memo', defaults: { tags: ['draft'], pinned: false } },
      build: { compile: 'src/unavailable.ts#compile', validate: 'src/unavailable.ts#validate', getLabel: 'src/unavailable.ts#getLabel', relation: { field: 'memoId', targetEntity: 'Memo' } }, fe: { nodeConfig: { icon: 'File', category: 'data' as const, connectionRules: { inputs: 1, outputs: 1 } }, components: { form: 'src/unavailable.vue' }, layout: { getHeight: 'src/unavailable.ts#getHeight' } } }, pulse: { kind: 'trigger' as const, node: { label: 'Pulse' },
      trigger: { trackField: 'every', persistent: true, queryFields: ['interval'], compile: 'src/unavailable.ts#compilePulse',
        decompile: 'src/unavailable.ts#decompilePulse', validate: 'src/unavailable.ts#validatePulse' } } };
    const declaration: PackManifest = { ...manifest, extensions: { steps } };
    fs.writeFileSync(path.join(root, 'apack.json'), JSON.stringify(declaration));
    writeBuild(root, declaration, index);
    const report = await inspectPack(root);
    expect(report.declared.extensions?.steps).toEqual(steps);
    expect(report.build.status).toBe('verified');
    expect(fs.existsSync(path.join(root, 'src'))).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('lists frontend member identities without requiring authored modules or activating the build', async () => {
    const declaration: PackManifest = { ...manifest, extensions: {
      appExtensions: { welcome: 'src/unavailable.vue' }, textEditor: { suggestions: {
        extensions: { mention: 'src/unavailable.ts#Mention' }, popups: { mention: 'src/unavailable.vue' },
        isSuggestionActive: 'src/unavailable.ts#isSuggestionActive',
      } },
    } };
    fs.writeFileSync(path.join(root, 'apack.json'), JSON.stringify(declaration));
    writeBuild(root, declaration, index);
    const report = await inspectPack(root);
    expect(report.declared).toEqual(declaration);
    expect(report.build.status).toBe('verified');
    expect(fs.existsSync(path.join(root, 'src'))).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('shows actual compiled identities and counts without importing modules or counting source files', async () => {
    writeBuild(root, manifest, index);
    fs.mkdirSync(path.join(root, 'content'));
    for (let i = 0; i < 5; i++) fs.writeFileSync(path.join(root, 'content', `${i}.ts`), 'throw new Error("Not content items");');
    const before = fs.readdirSync(root);
    const report = await inspectPack(root);
    expect(report.build.status).toBe('verified');
    expect(report.build.content).toEqual(index);
    expect(report.declared.features?.memos.entities).toEqual({ Memo: {} });
    expect(fs.readdirSync(root)).toEqual(before);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reports compiled entity destinations without source modules or runtime activation', async () => {
    const declared: PackManifest = { ...manifest, features: { memos: { ...manifest.features!.memos,
      surface: { label: 'Memos', state: 'src/missing-state.ts', canvas: 'src/missing-canvas.vue' },
    } } };
    fs.writeFileSync(path.join(root, 'apack.json'), JSON.stringify(declared));
    writeBuild(root, declared, index, { Memo: 'memos' });
    expect((await inspectPack(root)).build.metadata?.entityDestinations).toEqual({ Memo: 'memos' });
    vi.spyOn(process, 'cwd').mockReturnValue(root);
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    await info([]);
    expect(output.mock.calls.flat().join('\n')).toContain('Memo → inspection-pack/memos');
    expect(fs.existsSync(path.join(root, 'src'))).toBe(false);
  });

  it('inspects dependency targets from verified output without source or activation', async () => {
    const content = { ...index, entries: [{ key: 'flows', written: true, count: 1, items: [{ key: 'Demo' }], references: [
      { item: 'Demo', path: 'Demo.action', kind: 'static', target: { key: 'actions', item: 'Removed' } },
      { item: 'Demo', path: 'Demo.prompt', kind: 'dynamic', target: { key: 'prompts' } },
    ] }] };
    const declaration: PackManifest = { ...manifest, content: { sources: { flows: 'src/flows' } } };
    fs.writeFileSync(path.join(root, 'apack.json'), JSON.stringify(declaration));
    writeBuild(root, declaration, content);
    expect((await inspectPack(root)).build.content).toEqual(content);
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(process, 'cwd').mockReturnValue(root);
    await info([]);
    const text = output.mock.calls.flat().join('\n');
    expect(text).toContain('actions/Removed [not-indexed]');
    expect(text).toContain('prompts/(computed) [dynamic]');
    expect(text).toContain('not user data');
    expect(fs.existsSync(path.join(root, 'src'))).toBe(false);
  });

  it('preserves the complete declaration and lists feature-owned services and repositories offline', async () => {
    const declaration: PackManifest = { ...manifest,
      lifecycle: { onInit: 'src/unavailable.ts#initialize' },
      features: { memos: { description: 'Inspect owned contributions.', entities: { Memo: {} },
        system: { entry: 'src/unavailable.ts' },
        services: { memos: 'src/unavailable.ts#service' },
        repositories: { memoQueries: 'src/unavailable.ts#queries' },
      } },
      extensions: { services: { shared: 'src/unavailable.ts#shared' },
        artifacts: { memo: { icon: 'File' } }, blocks: { memo: { kind: 'display', fe: 'src/unavailable.vue' } },
      },
    };
    fs.writeFileSync(path.join(root, 'apack.json'), JSON.stringify(declaration));
    writeBuild(root, declaration, index);
    expect((await inspectPack(root)).declared).toEqual(declaration);
    vi.spyOn(process, 'cwd').mockReturnValue(root);
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    await info(['--json']);
    expect(JSON.parse(String(output.mock.calls[0][0])).declared).toEqual(declaration);
    output.mockClear();
    await info([]);
    const text = output.mock.calls.flat().join('\n');
    for (const expected of ['Services: memos', 'Repositories: memoQueries', 'Declared services: shared',
      'Declared artifacts: memo', 'Declared blocks: memo', 'Declared lifecycle: onInit']) {
      expect(text).toContain(expected);
    }
    expect(fs.existsSync(path.join(root, 'src'))).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('distinguishes unbuilt source from an invalid build directory instead of inventing content counts', async () => {
    expect((await inspectPack(root)).build).toMatchObject({ status: 'unbuilt' });
    fs.mkdirSync(path.join(root, 'dist'));
    const report = await inspectPack(root);
    expect(report.build.status).toBe('invalid');
    expect(report.build.content).toBeUndefined();
  });

  it('refuses changed content bytes and content belonging to another pack', async () => {
    const output = writeBuild(root, manifest, index);
    const file = path.join(output, PACK_LAYOUT.contentDir, 'content.json');
    fs.writeFileSync(file, JSON.stringify({ ...index, packId: 'another-pack' }));
    expect((await inspectPack(root)).build.problem).toContain('checksum mismatch');
    sealPackBuild(output, manifest);
    expect((await inspectPack(root)).build.problem).toContain('belongs to "another-pack"');
  });

  it('reports a missing declared content index instead of presenting an empty compiled inventory', async () => {
    writeBuild(root);
    const report = await inspectPack(root);
    expect(report.build.status).toBe('invalid');
    expect(report.build.problem).toContain('missing its declared compiled content index');
    expect(report.build.content).toBeUndefined();
  });

  it('refuses a changed runtime even when compiled inventory bytes are unchanged', async () => {
    const output = writeBuild(root, manifest, index);
    fs.writeFileSync(path.join(output, PACK_LAYOUT.runtimeEntry), 'changed runtime');
    const report = await inspectPack(root);
    expect(report.build.status).toBe('invalid');
    expect(report.build.problem).toContain('checksum mismatch runtime/index.cjs');
  });

  it('names stale declarations while retaining the verified compiled inventory', async () => {
    writeBuild(root, manifest, index);
    fs.writeFileSync(path.join(root, 'apack.json'), JSON.stringify({ ...manifest, description: 'Changed source declaration' }));
    const report = await inspectPack(root);
    expect(report.build.status).toBe('stale');
    expect(report.build.content).toEqual(index);
  });

  it('presents cached origin, version and identity without mutating the cache or fetching', async () => {
    const provider = { id: 'provider', name: 'Provider', version: '1.2.0' };
    const source = path.join(root, 'producer');
    const output = writeBuild(source, provider);
    const cached = cacheDependency(root, provider.id, output, 'github:example/provider ^1.0.0', {
      kind: 'github', repository: 'example/provider', tag: 'v1.2.0', archive: 'https://example.test/provider.tgz', checksum: 'https://example.test/provider.tgz.sha256',
    });
    fs.rmSync(source, { recursive: true });
    fs.writeFileSync(path.join(root, 'apack.json'), JSON.stringify({ ...manifest, dependencies: { provider: 'github:example/provider ^1.0.0' } }));
    const record = path.join(root, '.apack/deps/provider/resolution.json');
    const before = fs.readFileSync(record);
    const report = await inspectPack(root);
    expect(report.dependencies).toMatchObject([{ id: 'provider', spec: 'github:example/provider ^1.0.0', status: 'resolved', version: '1.2.0',
      origin: cached.resolution.origin, revision: cached.resolution.revision, delivery: 'cache', execution: { runtime: true } }]);
    expect(fs.readFileSync(record)).toEqual(before);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('inspects an explicit linked build without creating a dependency cache', async () => {
    const provider = { id: 'provider', name: 'Provider', version: '1.2.0' };
    const source = path.join(root, 'linked-provider');
    writeBuild(source, provider);
    fs.writeFileSync(path.join(root, 'apack.json'), JSON.stringify({ ...manifest, dependencies: { provider: `file:${source}` } }));
    const report = await inspectPack(root);
    expect(report.dependencies).toMatchObject([{ id: 'provider', version: '1.2.0', delivery: 'source', origin: { kind: 'file', directory: source } }]);
    expect(fs.existsSync(path.join(root, '.apack'))).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps unavailable dependency data explicit and emits one JSON report', async () => {
    fs.writeFileSync(path.join(root, 'apack.json'), JSON.stringify({ ...manifest, dependencies: { unavailable: 'file:./missing' } }));
    vi.spyOn(process, 'cwd').mockReturnValue(root);
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    await info(['--json']);
    expect(output).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(output.mock.calls[0][0]))).toMatchObject({ build: { status: 'unbuilt' },
      dependencies: [{ id: 'unavailable', status: 'unavailable' }] });
    expect(fs.existsSync(path.join(root, '.apack'))).toBe(false);
  });
});
