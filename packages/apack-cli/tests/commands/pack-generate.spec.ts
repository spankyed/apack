import * as sdkBuild from '@apackdev/sdk/build';
import { _declarationRevision } from '@apackdev/sdk/build';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { bundlePackTypes } from '../../src/build/types-bundler';
import { dependencyTypes } from '../../src/commands/generate';
import { readDependencyBuild, PACK_LAYOUT } from '@apackdev/host/packs';
import { assertGeneratedCurrent, generateEntries } from '../../src/commands/generate-entries';
import { PACK_SNAPSHOT_FORMAT, PACK_TYPES_FACADE, type PackManifest, type PackSnapshot } from '@apackdev/sdk/build';

const compilation = {
  hash: 'test-compiler',
  configuration: undefined,
  declarationConfiguration: undefined,
  readTree() { throw new Error('No tree in hash-only fixture'); },
  sourcePath(file: string) { return file; },
  diagnostic(message: string) { return message; },
  isInput() { return true; },
  prepareNative() {},
  requireParent() { throw new Error('No module loading in hash-only fixture'); },
  nativeModule() { throw new Error('No native module loading in hash-only fixture'); },
  retainInputs() {},
  async finish(): Promise<never> { throw new Error('No completion in hash-only fixture'); },
  prepareNativeSource() {},
  readMetadata(): never { throw new Error('Unexpected metadata read'); },
  openDirectory(): never { throw new Error('Unexpected directory open'); },
  readDirectory(): never { throw new Error('Unexpected directory read'); },
  readDataPath(): never { throw new Error('Unexpected data read'); },
  dispose() {},
  readFile() { return undefined; },
  captureGenerated() {},
  assertCurrent() {},
};


let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pack-generate-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeManifest(manifest: Record<string, unknown>) {
  fs.writeFileSync(path.join(tmpDir, 'apack.json'), JSON.stringify(manifest));
}

function readGenerated(): string {
  return fs.readFileSync(path.join(tmpDir, 'src', '__generated__', 'ears.ts'), 'utf-8');
}

describe('apack pack generate-entries', () => {
  it('creates src/__generated__/ears.ts from manifest entities', async () => {
    writeManifest({
      id: 'test-pack',
      name: 'Test Pack',
      version: '0.1.0',
      data: { entities: { Widget: {}, Gadget: {} }, relations: {} },
    });

    await generateEntries(['--force'], tmpDir, undefined, compilation);

    const output = readGenerated();
    expect(output).toContain("export const Widget = 'Widget'");
    expect(output).toContain('export type Widget = typeof Widget');
    expect(output).toContain("export const Gadget = 'Gadget'");
    expect(output).toContain('export type Gadget = typeof Gadget');
  });

  it('generates relKind consts and Custom helper', async () => {
    writeManifest({
      id: 'test-pack',
      name: 'Test Pack',
      version: '0.1.0',
      data: { entities: {}, relations: { owns: {}, follows: {} } },
    });

    await generateEntries(['--force'], tmpDir, undefined, compilation);

    const output = readGenerated();
    expect(output).toContain("export const OWNS = 'owns'");
    expect(output).toContain("export const FOLLOWS = 'follows'");
    expect(output).toContain('export const Custom =');
  });

  it('generates Entity union type from all declared entities', async () => {
    writeManifest({
      id: 'test-pack',
      name: 'Test Pack',
      version: '0.1.0',
      data: { entities: { Alpha: {}, Beta: {} }, relations: {} },
    });

    await generateEntries(['--force'], tmpDir, undefined, compilation);

    const output = readGenerated();
    expect(output).toContain('export type Entity = Entity.Alpha | Entity.Beta');
  });

  it('emits BaseEntity re-export and AllEntities compat export', async () => {
    writeManifest({
      id: 'test-pack',
      name: 'Test Pack',
      version: '0.1.0',
      data: { entities: { Item: {} }, relations: {} },
    });

    await generateEntries(['--force'], tmpDir, undefined, compilation);

    const output = readGenerated();
    // BaseEntity is re-exported from the SDK rather than redeclared per pack,
    // so the shape stays in one place.
    expect(output).toContain('export type BaseEntity');
    expect(output).toContain('export const AllEntities = EARS.Entity');
    expect(output).toContain('export type AllEntities = EARS.Entity');
  });

  it('handles empty entities and relKinds', async () => {
    writeManifest({
      id: 'test-pack',
      name: 'Test Pack',
      version: '0.1.0',
      data: { entities: {}, relations: {} },
    });

    await generateEntries(['--force'], tmpDir, undefined, compilation);

    const output = readGenerated();
    expect(output).toContain('export type Entity = string');
    // Relation kinds are closed even with none of the pack's own: the SDK's are named
    expect(output).toContain('export const RELATION_KINDS = [RelKind.CONTAINS,');
    expect(output).toContain('export type RelKind = (typeof RELATION_KINDS)[number];');
  });

  it('includes AttrKind namespace with Role', async () => {
    writeManifest({
      id: 'test-pack',
      name: 'Test Pack',
      version: '0.1.0',
      data: { entities: {}, relations: {} },
    });

    await generateEntries(['--force'], tmpDir, undefined, compilation);

    const output = readGenerated();
    expect(output).toContain("export const Role = 'role'");
    expect(output).not.toContain('RelationDetails');
  });

  it('merges dependency type manifests into generated output', async () => {
    writeManifest({
      id: 'test-pack',
      name: 'Test Pack',
      version: '0.1.0',
      data: { entities: { MyEntity: {} }, relations: {} },
      dependencies: { 'dep-pack': '>=0.1.0' },
    });

    const depManifest: PackManifest = { id: 'dep-pack', name: 'Dep Pack', version: '0.1.0',
      data: { entities: { DepWidget: {} }, relations: { dep_rel: {} } } };
    const snapshot: PackSnapshot = { declarationRevision: _declarationRevision(depManifest),
      format: PACK_SNAPSHOT_FORMAT,
      types: {
        entities: { DepWidget: 'DepWidget' },
        relKinds: { DEP_REL: 'dep_rel' }, roles: {},
      },
      entityDestinations: {}, facades: {},
      manifest: depManifest,
    };

    const depRoot = path.join(tmpDir, '.apack', 'dependency');
    fs.mkdirSync(depRoot, { recursive: true });
    fs.symlinkSync(path.resolve(__dirname, '../../../..', 'node_modules'), path.join(depRoot, 'node_modules'), 'dir');
    for (const [file, content] of Object.entries(await sdkBuild.generatePackFiles(snapshot.manifest, { packRoot: depRoot }))) {
      const target = path.join(depRoot, file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content);
    }
    const facade = await bundlePackTypes(depRoot, path.join(depRoot, 'pack-types.d.ts'));
    if (!facade.success) throw new Error(facade.error);
    snapshot.facades[PACK_TYPES_FACADE] = facade.content;
    const snapshotFile = path.join(depRoot, PACK_LAYOUT.snapshot);
    fs.mkdirSync(path.dirname(snapshotFile), { recursive: true });
    const resolve = () => {
      fs.writeFileSync(snapshotFile, JSON.stringify(snapshot));
      return dependencyTypes(new Map([['dep-pack', readDependencyBuild(depRoot)]]));
    };
    let dependencies = resolve();

    await generateEntries(['--force'], tmpDir, dependencies, compilation);

    const output = readGenerated();
    // Own entity
    expect(output).toContain("export const MyEntity = 'MyEntity'");
    // Dep entity (with source comment)
    expect(output).toContain("export const DepWidget = 'DepWidget'");
    const manifest = JSON.parse(fs.readFileSync(path.join(tmpDir, 'apack.json'), 'utf8'));
    expect(() => assertGeneratedCurrent(tmpDir, manifest, dependencies, compilation)).not.toThrow();
    snapshot.facades[PACK_TYPES_FACADE] += '\n// same-version facade change\n';
    dependencies = resolve();
    expect(() => assertGeneratedCurrent(tmpDir, manifest, dependencies, compilation)).toThrow('inputs changed');
    await generateEntries([], tmpDir, dependencies, compilation);
    expect(() => assertGeneratedCurrent(tmpDir, manifest, dependencies, compilation)).not.toThrow();
    expect(output).toContain('// dep-pack');
    // Dep relKind
    expect(output).toContain("export const DEP_REL = 'dep_rel'");
  });

  it('is idempotent — running twice produces identical output', async () => {
    writeManifest({
      id: 'test-pack',
      name: 'Test Pack',
      version: '0.1.0',
      data: { entities: { A: {}, B: {} }, relations: { r: {} } },
    });

    await generateEntries(['--force'], tmpDir, undefined, compilation);
    const first = readGenerated();

    await generateEntries(['--force'], tmpDir, undefined, compilation);
    const second = readGenerated();

    expect(first).toBe(second);
  });
});

/**
 * The stamp records what the last run read *and* what it wrote. Recording only the inputs meant deleting a
 * generated file left the hash matching, so the command reported "inputs unchanged, skipping" over a tree it
 * had not made, and the pack stayed unbuildable until someone passed `--force`.
 */
describe('the inputs stamp', () => {
  const generated = (name: string) => path.join(tmpDir, 'src', '__generated__', name);

  it('holds its lock until async generation settles and preserves files and stamp after rejection', async () => {
    writeManifest({ id: 'test-pack', name: 'Test', version: '0.1.0' });
    await generateEntries([], tmpDir, undefined, compilation);
    const output = fs.readFileSync(generated('settings.ts'), 'utf8');
    const stamp = fs.readFileSync(path.join(tmpDir, '.apack/generate-entries.json'), 'utf8');
    let refuse!: (error: Error) => void;
    const pending = new Promise<Record<string, string>>((_, reject) => { refuse = reject; });
    const spy = vi.spyOn(sdkBuild, 'generatePackFiles').mockReturnValueOnce(pending);
    try {
      const result = expect(generateEntries(['--force'], tmpDir, undefined, compilation)).rejects.toThrow('type generation failed');
      await vi.waitFor(() => expect(fs.existsSync(generated('.generating.lock'))).toBe(true));
      expect(fs.readFileSync(path.join(tmpDir, '.apack/generate-entries.json'), 'utf8')).toBe(stamp);
      refuse(new Error('type generation failed'));
      await result;
      expect(fs.existsSync(generated('.generating.lock'))).toBe(false);
      expect(fs.readFileSync(generated('settings.ts'), 'utf8')).toBe(output);
      expect(fs.readFileSync(path.join(tmpDir, '.apack/generate-entries.json'), 'utf8')).toBe(stamp);
    } finally {
      spy.mockRestore();
    }
    await generateEntries(['--force'], tmpDir, undefined, compilation);
    expect(fs.existsSync(generated('.generating.lock'))).toBe(false);
  });


  it('rechecks changed module exports outside src without forcing codegen', async () => {
    writeManifest({ id: 'test-pack', name: 'Test', version: '0.1.0', extensions: { services: { service: 'modules/service.ts#service' } } });
    fs.mkdirSync(path.join(tmpDir, 'modules'));
    const file = path.join(tmpDir, 'modules/service.ts');
    fs.writeFileSync(file, 'export const service = { before: () => 1 };');
    await generateEntries([], tmpDir, undefined, compilation);
    const output = generated('services.ts');
    expect(fs.readFileSync(output, 'utf8')).toContain('service as __service_service');
    fs.writeFileSync(file, 'export const renamed = { after: () => 2 };');
    await expect(generateEntries([], tmpDir, undefined, compilation)).rejects.toThrow('service');
  });

  it('regenerates a file that was deleted, rather than reporting the tree unchanged', async () => {
    writeManifest({ id: 'test-pack', name: 'Test Pack', version: '0.1.0', data: { entities: { Widget: {} }, relations: {} }, });
    await generateEntries([], tmpDir, undefined, compilation);
    expect(fs.existsSync(generated('ears.ts'))).toBe(true);

    fs.rmSync(generated('ears.ts'));
    const said: string[] = [];
    const log = vi.spyOn(console, 'log').mockImplementation((m) => { said.push(String(m)); });
    await generateEntries([], tmpDir, undefined, compilation);
    log.mockRestore();

    expect(fs.existsSync(generated('ears.ts')), 'the missing file is back').toBe(true);
    expect(said.join('\n'), 'and it did not claim the tree was current').not.toMatch(/inputs unchanged/);
  });

  it('refuses edited outputs on the skip path and repairs them on normal generation', async () => {
    const manifest = { id: 'test-pack', name: 'Test', version: '0.1.0' };
    writeManifest(manifest);
    await generateEntries([], tmpDir, undefined, compilation);
    const original = readGenerated();
    fs.writeFileSync(generated('ears.ts'), original + '\n// edited\n');
    expect(() => assertGeneratedCurrent(tmpDir, manifest, dependencyTypes(new Map()), compilation)).toThrow('modified src/__generated__/ears.ts');
    await generateEntries([], tmpDir, undefined, compilation);
    expect(readGenerated()).toBe(original);
    expect(() => assertGeneratedCurrent(tmpDir, manifest, dependencyTypes(new Map()), compilation)).not.toThrow();
  });

  it('refuses same-version source changes on the skip path', async () => {
    const manifest = { id: 'test-pack', name: 'Test', version: '0.1.0' };
    writeManifest(manifest);
    const source = path.join(tmpDir, 'module.ts');
    fs.writeFileSync(source, 'export const value = 1;');
    await generateEntries([], tmpDir, undefined, compilation);
    fs.writeFileSync(source, 'export const value = 2;');
    expect(() => assertGeneratedCurrent(tmpDir, manifest, dependencyTypes(new Map()), compilation)).toThrow('inputs changed');
  });

  it('still skips when every recorded file is there', async () => {
    writeManifest({ id: 'test-pack', name: 'Test Pack', version: '0.1.0', data: { entities: { Widget: {} }, relations: {} }, });
    await generateEntries([], tmpDir, undefined, compilation);

    const said: string[] = [];
    const log = vi.spyOn(console, 'log').mockImplementation((m) => { said.push(String(m)); });
    await generateEntries([], tmpDir, undefined, compilation);
    log.mockRestore();
    expect(said.join('\n')).toMatch(/inputs unchanged/);
  });

  it('ignores Markdown that is not a declared help input', async () => {
    writeManifest({ id: 'test-pack', name: 'Test', version: '0.1.0' });
    fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
    const prose = path.join(tmpDir, 'src/README.md');
    fs.writeFileSync(prose, 'Draft');
    await generateEntries([], tmpDir, undefined, compilation);
    fs.writeFileSync(prose, 'Updated prose');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await generateEntries([], tmpDir, undefined, compilation);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('inputs unchanged'));
    log.mockRestore();
  });

  // The case that makes the list recorded rather than fixed: a pack with no surfaces never writes `fe.ts`,
  // and an expectation hard-coded from a fuller pack would call it stale on every run, forever.
  it('does not treat a file this pack never generates as missing', async () => {
    writeManifest({ id: 'test-pack', name: 'Test Pack', version: '0.1.0', data: { entities: { Widget: {} }, relations: {} }, });
    await generateEntries([], tmpDir, undefined, compilation);
    expect(fs.existsSync(generated('fe.ts')), 'no surfaces, so no fe.ts').toBe(false);

    const stamp = JSON.parse(fs.readFileSync(path.join(tmpDir, '.apack/generate-entries.json'), 'utf-8')) as { files: Record<string, string> };
    expect(Object.keys(stamp.files), 'and it is not recorded as an output').not.toContain('src/__generated__/fe.ts');

    const said: string[] = [];
    const log = vi.spyOn(console, 'log').mockImplementation((m) => { said.push(String(m)); });
    await generateEntries([], tmpDir, undefined, compilation);
    log.mockRestore();
    expect(said.join('\n')).toMatch(/inputs unchanged/);
  });
});

it('keeps Markdown help out of executable generation and its cache inputs', async () => {
  writeManifest({ id: 'test-pack', name: 'Test', version: '0.1.0', extensions: { help: { path: 'docs/help' } } });
  const help = path.join(tmpDir, 'docs/help');
  fs.mkdirSync(help, { recursive: true });
  const file = path.join(help, 'start.md');
  fs.writeFileSync(file, '# Start\nFirst body');
  await generateEntries([], tmpDir, undefined, compilation);
  const entry = path.join(tmpDir, 'src/__generated__/pack-entry.ts');
  const before = fs.readFileSync(entry, 'utf8');
  expect(before).not.toContain('First body');
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  try {
    for (const body of ['# Start\nUpdated body', 'Missing title']) {
      fs.writeFileSync(file, body);
      await generateEntries([], tmpDir, undefined, compilation);
      expect(fs.readFileSync(entry, 'utf8')).toBe(before);
      expect(log).toHaveBeenLastCalledWith(expect.stringContaining('inputs unchanged'));
    }
  } finally { log.mockRestore(); }
});
