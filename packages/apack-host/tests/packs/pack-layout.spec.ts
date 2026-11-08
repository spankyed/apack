import { eventContractsFixture, sealBuild } from './runtime/build-fixture.ts';
import { _declarationRevision } from '@apackdev/sdk/build';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PACK_LAYOUT, PACK_LAYOUT_VERSION,
  createPackArchive,
  extractPackArchive,
  readPackIntegrity,
  sha256File,
  packFrontendFiles,
  packBuildProblem,
  packFileHashes,
  readPackBuild,
  stagePack,
  verifyPack,
} from '../../src/packs/layout.ts';
import { installPack, installPackFromGitHub, installPackFromLocal, installPackFromUrl, uninstallPack } from '../../src/packs/installer.ts';
import { PACK_SNAPSHOT_FORMAT } from '@apackdev/sdk/build';
import { execFileWhileWorking } from '@apackdev/sdk/progress';
import { packBuildRevision, readPackAsset } from '../../src/packs/assets.ts';

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-spec-'));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** A pack source dir as `apack pack build` leaves it. */
function builtPack(overrides: Record<string, unknown> = {}): string {
  const root = path.join(tmp, 'src-pack');
  const write = (rel: string, content: string) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
  };
  write('apack.json', JSON.stringify({
    id: 'demo-pack',
    name: 'Demo Pack',
    version: '1.2.3',
    hostVersion: '>=0.3.0',
    ...overrides,
  }));
  write('dist/runtime/index.cjs', 'module.exports = { registration: { id: "demo-pack" } };');
  write('dist/runtime/index.cjs.map', '{}');
  write('dist/runtime/fe.js', 'export default {};');
  write('dist/runtime/content/actions.content.json', '[]');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'apack.json'), 'utf8'));
  write('dist/types/snapshot.json', JSON.stringify({ declarationRevision: _declarationRevision(manifest), types: { entities: {}, relKinds: {}, roles: {} }, entityDestinations: {}, facades: {}, manifest, eventContracts: eventContractsFixture(manifest), format: PACK_SNAPSHOT_FORMAT }));
  write('src/ignored.ts', 'not part of the pack');
  sealBuild(root);
  return root;
}

describe('stagePack', () => {
  it('assembles the pack layout with the manifest and checksums, without source maps', () => {
    const stage = path.join(tmp, 'stage');
    const info = stagePack(builtPack(), stage, { sdkVersion: '0.1.0', provenance: { commit: 'abc' } });

    expect(info).toMatchObject({ formatVersion: PACK_LAYOUT_VERSION, id: 'demo-pack', version: '1.2.3', hostVersion: '>=0.3.0', sdkVersion: '0.1.0', provenance: { commit: 'abc' } });
    expect(Object.keys(info.files).sort()).toEqual([
      'apack.json',
      'runtime/content/actions.content.json',
      'runtime/fe.js',
      'runtime/index.cjs',
      'types/snapshot.json',
    ]);
    expect(info.files['runtime/index.cjs']).toBe(sha256File(path.join(stage, 'runtime/index.cjs')));

    expect(JSON.parse(fs.readFileSync(path.join(stage, 'apack.json'), 'utf-8'))).toEqual(JSON.parse(fs.readFileSync(path.join(tmp, 'src-pack', 'apack.json'), 'utf-8')));
    expect(readPackIntegrity(stage)).toEqual(info);
  });

  it('refuses a pack that has not been built in the pack layout', () => {
    const root = builtPack();
    fs.rmSync(path.join(root, 'dist', 'runtime'), { recursive: true });
    expect(() => stagePack(root, path.join(tmp, 'stage'))).toThrow(/not built/);
  });

  // A dependent range-checks the version in the snapshot (fetch-deps' inRange) while the app and the
  // installer read apack.json, so a staged pack naming two versions is two answers to "which version
  // is this". Staging the built manifest as it is keeps there being one.
  it('stages one version: the built manifest, which integrity and the built snapshot agree on', () => {
    const root = builtPack();
    const stage = path.join(tmp, 'stage');

    const integrity = stagePack(root, stage);

    const staged = (rel: string) => JSON.parse(fs.readFileSync(path.join(stage, rel), 'utf-8'));
    expect([integrity.version, staged('apack.json').version, staged('types/snapshot.json').manifest.version])
      .toEqual(['1.2.3', '1.2.3', '1.2.3']);
  });

  it.each(['version', 'name', 'features'])('refuses edited %s declarations before replacing an existing stage', field => {
    const root = builtPack();
    const stage = path.join(tmp, 'stage');
    stagePack(root, stage);
    const before = packFileHashes(stage);
    const file = path.join(root, 'apack.json');
    const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
    manifest[field] = field === 'features' ? { added: {} } : field === 'version' ? '2.0.0' : 'Changed';
    fs.writeFileSync(file, JSON.stringify(manifest));
    expect(() => stagePack(root, stage)).toThrow('manifest does not match its built declarations');
    expect(packFileHashes(stage)).toEqual(before);
    expect(verifyPack(stage).id).toBe('demo-pack');
  });

  it('refuses malformed current-format data before touching the destination', () => {
    const root = builtPack();
    const stage = path.join(tmp, 'stage');
    stagePack(root, stage);
    const before = packFileHashes(stage);
    const file = path.join(root, 'dist/types/snapshot.json');
    const snapshot = JSON.parse(fs.readFileSync(file, 'utf8'));
    snapshot.facades = { bad: 1 };
    fs.writeFileSync(file, JSON.stringify(snapshot));
    expect(() => stagePack(root, stage)).toThrow('snapshot.json facades.bad');
    expect(packFileHashes(stage)).toEqual(before);
  });
  it.each(['runtime/index.cjs', 'runtime/index.cjs.map', 'types/snapshot.json'])('refuses edited output %s without replacing an accepted stage', file => {
    const root = builtPack();
    const stage = path.join(tmp, 'stage');
    stagePack(root, stage);
    const before = packFileHashes(stage);
    fs.appendFileSync(path.join(root, 'dist', file), '\n');
    expect(() => stagePack(root, stage)).toThrow(`checksum mismatch ${file}`);
    expect(packFileHashes(stage)).toEqual(before);
  });

  it('refuses an output without its producer receipt', () => {
    const root = builtPack();
    fs.rmSync(path.join(root, 'dist/integrity.json'));
    expect(() => stagePack(root, path.join(tmp, 'stage'))).toThrow('no integrity.json');
  });

  it('refuses bytes changed during copying and preserves the accepted stage', () => {
    const root = builtPack();
    const stage = path.join(tmp, 'stage');
    stagePack(root, stage);
    const before = packFileHashes(stage);
    const copy = fs.copyFileSync;
    const spy = vi.spyOn(fs, 'copyFileSync').mockImplementation((from, to, mode) => {
      copy(from, to, mode);
      if (String(from).endsWith('/runtime/index.cjs')) fs.appendFileSync(to, '\n// changed during copy');
    });
    syncBuiltinESMExports();
    try {
      expect(() => stagePack(root, stage)).toThrow('checksum mismatch runtime/index.cjs');
      expect(packFileHashes(stage)).toEqual(before);
      expect(fs.readdirSync(tmp).some(file => file.startsWith('.apack-stage-'))).toBe(false);
    } finally { spy.mockRestore(); syncBuiltinESMExports(); }
  });

});

describe('packFrontendFiles', () => {
  it("lists the pack's FE entry and stylesheet only when the build wrote them", () => {
    const stage = path.join(tmp, 'stage');
    stagePack(builtPack(), stage);
    expect(packFrontendFiles(stage)).toEqual({ entry: 'runtime/fe.js', styles: undefined });

    fs.writeFileSync(path.join(stage, 'runtime', 'fe.css'), '.x{}');
    expect(packFrontendFiles(stage)).toEqual({ entry: 'runtime/fe.js', styles: 'runtime/fe.css' });

    fs.rmSync(path.join(stage, 'runtime', 'fe.js'));
    fs.rmSync(path.join(stage, 'runtime', 'fe.css'));
    expect(packFrontendFiles(stage)).toEqual({ entry: undefined, styles: undefined });
  });
});

describe('verifyPack', () => {
  it.each([PACK_LAYOUT_VERSION + 0.25, PACK_LAYOUT_VERSION - 0.25, PACK_LAYOUT_VERSION + 1, -1, String(PACK_LAYOUT_VERSION), null])
    ('refuses an inexact format stamp in verification and asset delivery: %j', formatVersion => {
      const stage = path.join(tmp, 'stage');
      stagePack(builtPack(), stage);
      const info = readPackIntegrity(stage);
      const revision = packBuildRevision(info);
      expect(readPackAsset(stage, 'demo-pack', revision, 'runtime/fe.js').toString()).toBe('export default {};');
      const changed = { ...info, formatVersion };
      fs.writeFileSync(path.join(stage, 'integrity.json'), JSON.stringify(changed));
      expect(() => verifyPack(stage)).toThrow();
      // Match the malformed receipt's revision, so the format gate must reject it independently.
      const changedRevision = packBuildRevision(readPackIntegrity(stage));
      expect(() => readPackAsset(stage, 'demo-pack', changedRevision, 'runtime/fe.js')).toThrow('build changed');
    });

  it('accepts an untouched bundle', () => {
    const stage = path.join(tmp, 'stage');
    stagePack(builtPack(), stage);
    expect(verifyPack(stage).id).toBe('demo-pack');
  });

  it('reports modified, missing and unexpected files', () => {
    const stage = path.join(tmp, 'stage');
    stagePack(builtPack(), stage);
    fs.appendFileSync(path.join(stage, 'runtime/index.cjs'), '\n// tampered');
    fs.rmSync(path.join(stage, 'runtime/fe.js'));
    fs.writeFileSync(path.join(stage, 'runtime/extra.js'), '');

    const message = (() => { try { verifyPack(stage); return ''; } catch (e) { return (e as Error).message; } })();
    expect(message).toContain('checksum mismatch runtime/index.cjs');
    expect(message).toContain('missing runtime/fe.js');
    expect(message).toContain('unexpected runtime/extra.js');
  });

  it('rejects an unsupported format version', () => {
    const stage = path.join(tmp, 'stage');
    stagePack(builtPack(), stage);
    const info = readPackIntegrity(stage);
    fs.writeFileSync(path.join(stage, 'integrity.json'), JSON.stringify({ ...info, formatVersion: PACK_LAYOUT_VERSION + 1 }));
    expect(() => verifyPack(stage)).toThrow(/uses format/);
  });
});

describe('compiled content admission', () => {
  function contentBuild() {
    const root = builtPack({ data: { entities: { Memo: {} } }, content: {
      formats: { records: { format: 'json', entity: 'Memo', identity: ['id'] }, lookup: { format: 'json' } },
      sources: { memos: { path: 'src/memos', format: 'records' }, custom: { applier: 'src/custom.ts' } },
      datasets: { inventory: { path: 'src/inventory', format: 'lookup' } },
    } });
    const dir = path.join(root, 'dist/runtime/content');
    const index = { version: 1, packId: 'demo-pack', entries: [
      { key: 'memos', written: true, count: 0, items: [] },
      { key: 'inventory', written: false, count: 0, items: [] },
    ] };
    fs.writeFileSync(path.join(dir, 'content.json'), JSON.stringify(index));
    for (const entry of index.entries) fs.writeFileSync(path.join(dir, `${entry.key}.content.json`), '{"records":[]}');
    sealBuild(root);
    return { root, dir, index };
  }

  it('captures a source-free index including empty datasets and excluding applier-only sources', () => {
    const { root, index } = contentBuild();
    expect(readPackBuild(path.join(root, 'dist')).content).toEqual(index);
  });

  it('retains verified index bytes when its path changes after capture', () => {
    const { root, dir, index } = contentBuild();
    const indexFile = path.join(dir, 'content.json');
    const read = fs.readFileSync;
    let reads = 0;
    const capture = vi.spyOn(fs, 'readFileSync').mockImplementation(((file, ...args) => {
      const bytes = read(file, ...args);
      if (String(file) === indexFile && ++reads === 1) fs.writeFileSync(indexFile, JSON.stringify({ ...index, packId: 'replacement-pack' }));
      return bytes;
    }) as typeof fs.readFileSync);
    syncBuiltinESMExports();
    try {
      expect(readPackBuild(path.join(root, 'dist')).content).toEqual(index);
      expect(reads).toBe(1);
      expect(() => readPackBuild(path.join(root, 'dist'))).toThrow('checksum mismatch runtime/content/content.json');
    } finally { capture.mockRestore(); syncBuiltinESMExports(); }
  });

  it.each(['index', 'owner', 'missing entry', 'extra entry', 'source policy', 'dataset policy', 'data'] as const)('refuses incomplete or contradictory content: %s', async problem => {
    const { root, dir, index } = contentBuild();
    const stage = path.join(tmp, 'stage');
    stagePack(root, stage);
    const before = packFileHashes(stage);
    switch (problem) {
      case 'owner': index.packId = 'other-pack'; break;
      case 'missing entry': index.entries.pop(); break;
      case 'extra entry': index.entries.push({ key: 'ghost', written: true, count: 0, items: [] }); break;
      case 'source policy': index.entries[0].written = false; break;
      case 'dataset policy': index.entries[1].written = true; break;
      case 'data': fs.rmSync(path.join(dir, 'memos.content.json')); break;
    }
    fs.writeFileSync(path.join(dir, 'content.json'), JSON.stringify(index));
    if (problem === 'index') fs.rmSync(path.join(dir, 'content.json'));
    sealBuild(root);
    expect(() => readPackBuild(path.join(root, 'dist'))).toThrow(/content/i);
    expect(packBuildProblem(path.join(root, 'dist'))).toMatchObject({ kind: 'declarations' });
    expect(() => stagePack(root, stage)).toThrow(/content/i);
    expect(packFileHashes(stage)).toEqual(before);
    const beforePlace = vi.fn();
    await expect(installPackFromLocal(path.join(root, 'dist'), path.join(tmp, 'packs'), { beforePlace })).rejects.toThrow(/content/i);
    expect(beforePlace).not.toHaveBeenCalled();
  });
});

describe('installed build reader', () => {
  it('refuses a backend entry omitted before sealing, including at installation', async () => {
    const root = builtPack();
    fs.rmSync(path.join(root, 'dist/runtime/index.cjs'));
    sealBuild(root);
    const dist = path.join(root, 'dist');
    expect(() => readPackBuild(dist)).toThrow('missing required runtime/index.cjs');
    expect(packBuildProblem(dist)).toMatchObject({ kind: 'declarations', message: expect.stringContaining('missing required runtime/index.cjs') });
    const beforePlace = vi.fn();
    await expect(installPackFromLocal(dist, path.join(tmp, 'packs'), { beforePlace })).rejects.toThrow('missing required runtime/index.cjs');
    expect(beforePlace).not.toHaveBeenCalled();
  });

  const feature = (entry: Record<string, unknown>) => ({ features: { view: { description: 'Present a fixture contribution.', ...entry } } });
  it.each([
    ['surface', feature({ surface: { label: 'View', state: 'src/state.ts' } })],
    ['designation', feature({ designation: 'home' })],
    ['feature form', feature({ settings: { schema: { type: 'object' }, defaults: {}, form: 'src/Form.vue' } })],
    ['references', feature({ references: { types: {}, categories: {} } })],
    ['group form', { extensions: { settings: { extra: { schema: { type: 'object' }, defaults: {}, form: 'src/Form.vue' } } } }],
    ['step', { extensions: { steps: { demo: { node: { label: 'Demo' } } } } }],
    ['block', { extensions: { blocks: { demo: {} } } }],
    ['artifact', { extensions: { artifacts: { demo: { icon: 'File' } } } }],
    ['editor', { extensions: { textEditor: { demo: {} } } }],
    ['app extension', { extensions: { appExtensions: { demo: 'src/Demo.vue' } } }],
  ])('requires the frontend entry for a declared %s without reading authored modules', (_label, declaration) => {
    const root = builtPack(declaration);
    const dist = path.join(root, 'dist');
    fs.writeFileSync(path.join(dist, 'runtime/index.cjs'), 'throw new Error("Do not activate during discovery");');
    sealBuild(root);
    expect(readPackBuild(dist).snapshot.manifest.id).toBe('demo-pack');
    const stage = path.join(tmp, 'stage');
    stagePack(root, stage);
    const before = packFileHashes(stage);
    fs.rmSync(path.join(dist, 'runtime/fe.js'));
    sealBuild(root);
    expect(() => readPackBuild(dist)).toThrow('missing required runtime/fe.js');
    expect(packBuildProblem(dist)).toMatchObject({ kind: 'declarations', message: expect.stringContaining('missing required runtime/fe.js') });
    expect(() => stagePack(root, stage)).toThrow('missing required runtime/fe.js');
    expect(packFileHashes(stage)).toEqual(before);
  });

  it('accepts backend-only declarations without a frontend entry or authored modules', () => {
    const root = builtPack({ extensions: { settings: { extra: { schema: { type: 'object' }, defaults: {} } }, steps: {}, blocks: {}, artifacts: {}, textEditor: {}, appExtensions: {} } });
    fs.rmSync(path.join(root, 'dist/runtime/fe.js'));
    sealBuild(root);
    const stage = path.join(tmp, 'stage');
    stagePack(root, stage);
    expect(readPackBuild(stage).snapshot.manifest.extensions?.settings).toHaveProperty('extra');
  });

  it('reads declarations and a content identity without executing a runtime', () => {
    const stage = path.join(tmp, 'stage');
    const root = builtPack();
    fs.writeFileSync(path.join(root, 'dist/runtime/index.cjs'), 'throw new Error("discovery executed the runtime");');
    sealBuild(root);
    stagePack(root, stage);
    const reads = vi.spyOn(fs, 'readFileSync');
    syncBuiltinESMExports();
    let build;
    try {
      build = readPackBuild(stage);
      for (const file of [PACK_LAYOUT.manifest, PACK_LAYOUT.snapshot]) {
        expect(reads.mock.calls.filter(([name]) => name === path.join(stage, file))).toHaveLength(1);
      }
    } finally { reads.mockRestore(); syncBuiltinESMExports(); }
    expect(build.snapshot.manifest.id).toBe('demo-pack');
    expect(build.revision).toMatch(/^[a-f0-9]{64}$/);
    const copy = path.join(tmp, 'copy');
    fs.cpSync(stage, copy, { recursive: true });
    const integrity = readPackIntegrity(copy);
    integrity.files = Object.fromEntries(Object.entries(integrity.files).reverse());
    fs.writeFileSync(path.join(copy, 'integrity.json'), JSON.stringify(integrity));
    expect(readPackBuild(copy).revision).toBe(build.revision);
  });

  it('changes identity when different bytes are deliberately staged with the same declarations', () => {
    const stage = path.join(tmp, 'stage');
    const root = builtPack();
    stagePack(root, stage);
    const before = readPackBuild(stage);
    fs.appendFileSync(path.join(root, 'dist/runtime/index.cjs'), '\n// new build');
    sealBuild(root);
    stagePack(root, stage);
    const after = readPackBuild(stage);
    expect(after.snapshot.declarationRevision).toBe(before.snapshot.declarationRevision);
    expect(after.revision).not.toBe(before.revision);
  });

  it('refuses a different valid build replacing files during verified capture', () => {
    const stage = path.join(tmp, 'stage');
    stagePack(builtPack(), stage);
    const read = fs.readFileSync;
    let replaced = false;
    const spy = vi.spyOn(fs, 'readFileSync').mockImplementation((file, options) => {
      if (file === path.join(stage, 'runtime/index.cjs') && !replaced) {
        replaced = true;
        const snapshot = JSON.parse(read(path.join(stage, 'types/snapshot.json'), 'utf8'));
        snapshot.manifest.name = 'New build';
        snapshot.declarationRevision = _declarationRevision(snapshot.manifest);
        fs.writeFileSync(path.join(stage, 'types/snapshot.json'), JSON.stringify(snapshot));
        fs.writeFileSync(path.join(stage, 'apack.json'), JSON.stringify(snapshot.manifest));
        const integrity = JSON.parse(read(path.join(stage, 'integrity.json'), 'utf8'));
        fs.writeFileSync(path.join(stage, 'integrity.json'), JSON.stringify({ ...integrity, files: packFileHashes(stage) }));
      }
      return read(file, options);
    });
    syncBuiltinESMExports();
    try {
      expect(() => readPackBuild(stage)).toThrow('checksum mismatch types/snapshot.json');
      expect(replaced).toBe(true);
      expect(readPackBuild(stage).snapshot.manifest.name).toBe('New build');
    } finally {
      spy.mockRestore();
      syncBuiltinESMExports();
    }
  });

  it('refuses an integrity identity that differs from the descriptor', () => {
    const stage = path.join(tmp, 'stage');
    stagePack(builtPack(), stage);
    const integrity = readPackIntegrity(stage);
    fs.writeFileSync(path.join(stage, 'integrity.json'), JSON.stringify({ ...integrity, id: 'another-pack' }));
    expect(() => readPackBuild(stage)).toThrow('identity does not match');
  });

  it.each(['id', 'version'] as const)('refuses mismatched integrity %s before replacing an installed pack', async field => {
    const stage = path.join(tmp, 'stage');
    stagePack(builtPack(), stage);
    const packsDir = path.join(tmp, 'installed');
    const installed = await installPackFromLocal(stage, packsDir);
    const before = fs.readFileSync(path.join(installed.dir, 'integrity.json'), 'utf8');
    const integrity = readPackIntegrity(stage);
    integrity[field] = field === 'id' ? 'another-pack' : '9.9.9';
    fs.writeFileSync(path.join(stage, 'integrity.json'), JSON.stringify(integrity));
    const beforePlace = vi.fn();
    await expect(installPackFromLocal(stage, packsDir, { beforePlace })).rejects.toThrow('identity does not match');
    expect(beforePlace).not.toHaveBeenCalled();
    expect(fs.readFileSync(path.join(installed.dir, 'integrity.json'), 'utf8')).toBe(before);
  });

  it.each(['../outside', '/absolute', 'runtime/../index.cjs', 'runtime\\index.cjs', 'integrity.json'])('refuses a nonportable checksum path: %s', file => {
    const stage = path.join(tmp, 'stage');
    stagePack(builtPack(), stage);
    const integrity = readPackIntegrity(stage);
    integrity.files[file] = 'a'.repeat(64);
    fs.writeFileSync(path.join(stage, 'integrity.json'), JSON.stringify(integrity));
    expect(() => readPackBuild(stage)).toThrow(`invalid checksum entry ${file}`);
  });

  it.each([null, [], {}, { files: {} }])('refuses malformed integrity data: %j', integrity => {
    const stage = path.join(tmp, 'stage');
    stagePack(builtPack(), stage);
    fs.writeFileSync(path.join(stage, 'integrity.json'), JSON.stringify(integrity));
    expect(() => readPackBuild(stage)).toThrow('Invalid integrity.json');
  });

  it('refuses unrecorded symbolic links instead of silently omitting them', () => {
    const stage = path.join(tmp, 'stage');
    stagePack(builtPack(), stage);
    fs.symlinkSync('index.cjs', path.join(stage, 'runtime/linked.cjs'));
    expect(() => readPackBuild(stage)).toThrow('symbolic link: runtime/linked.cjs');
  });

  it('records an own __proto__ file name instead of losing it to object assignment', () => {
    const stage = path.join(tmp, 'stage');
    stagePack(builtPack(), stage);
    fs.writeFileSync(path.join(stage, '__proto__'), 'data');
    const integrity = readPackIntegrity(stage);
    integrity.files = packFileHashes(stage);
    expect(Object.hasOwn(integrity.files, '__proto__')).toBe(true);
    fs.writeFileSync(path.join(stage, 'integrity.json'), JSON.stringify(integrity));
    expect(readPackBuild(stage).integrity.files.__proto__).toBe(sha256File(path.join(stage, '__proto__')));
  });
});

describe('bundle archives', () => {
  it('round-trips through a reproducible .tgz with a matching .sha256 file', async () => {
    const stage = path.join(tmp, 'stage');
    stagePack(builtPack(), stage);

    const first = await createPackArchive(stage, path.join(tmp, 'out1'));
    const second = await createPackArchive(stage, path.join(tmp, 'out2'));
    expect(path.basename(first.file)).toBe('demo-pack-1.2.3.tgz');
    expect(second.sha256).toBe(first.sha256);
    expect(fs.readFileSync(first.checksumFile, 'utf-8')).toBe(`${first.sha256}  demo-pack-1.2.3.tgz\n`);

    const extracted = await extractPackArchive(first.file, path.join(tmp, 'extract'), first.sha256);
    expect(path.basename(extracted)).toBe('demo-pack');
    expect(verifyPack(extracted).version).toBe('1.2.3');
  });

  it('refuses an archive whose checksum does not match', async () => {
    const stage = path.join(tmp, 'stage');
    stagePack(builtPack(), stage);
    const { file } = await createPackArchive(stage, path.join(tmp, 'out'));
    await expect(extractPackArchive(file, path.join(tmp, 'extract'), '0'.repeat(64))).rejects.toThrow(/Checksum mismatch/);
  });
});

describe('verified installation candidate', () => {
  it.each(['unsealed-change', 'valid-replacement', 'changed-provenance'])('refuses %s during copying before teardown or replacement', async kind => {
    const packsDir = path.join(tmp, 'packs');
    const installed = await installPackFromLocal(builtPack(), packsDir);
    const before = readPackBuild(installed.dir).revision;
    const source = path.join(tmp, 'incoming-layout');
    stagePack(builtPack({ version: '2.0.0' }), source);
    const copy = fs.cpSync;
    const spy = vi.spyOn(fs, 'cpSync').mockImplementation((from, to, options) => {
      if (String(from) === fs.realpathSync(source)) {
        const receipt = readPackIntegrity(source);
        if (kind === 'changed-provenance') receipt.provenance = { commit: 'different-origin' };
        else fs.appendFileSync(path.join(source, 'runtime/index.cjs'), '\n// changed during copying');
        if (kind === 'valid-replacement') receipt.files = packFileHashes(source);
        fs.writeFileSync(path.join(source, 'integrity.json'), JSON.stringify(receipt));
      }
      copy(from, to, options);
    });
    syncBuiltinESMExports();
    const beforePlace = vi.fn();
    try {
      await expect(installPackFromLocal(source, packsDir, { beforePlace })).rejects.toThrow(
        kind === 'unsealed-change' ? 'checksum mismatch runtime/index.cjs' : 'Pack changed while preparing installation');
      expect(beforePlace).not.toHaveBeenCalled();
      expect(readPackBuild(installed.dir).revision).toBe(before);
      expect(fs.readdirSync(packsDir)).toEqual(['demo-pack']);
    } finally { spy.mockRestore(); syncBuiltinESMExports(); }
  });

  it('keeps the verified candidate independent of changes to the source during teardown', async () => {
    const source = path.join(tmp, 'incoming-layout');
    stagePack(builtPack(), source);
    const expected = readPackBuild(source);
    const result = await installPackFromLocal(source, path.join(tmp, 'packs'), { beforePlace: manifest => {
      expect(manifest.id).toBe(expected.snapshot.manifest.id);
      fs.appendFileSync(path.join(source, 'runtime/index.cjs'), '\n// changed after candidate acceptance');
      const receipt = readPackIntegrity(source);
      receipt.files = packFileHashes(source);
      fs.writeFileSync(path.join(source, 'integrity.json'), JSON.stringify(receipt));
    } });
    expect(readPackBuild(result.dir).revision).toBe(expected.revision);
    expect(result.integrity).toEqual(expected.integrity);
    expect(readPackBuild(source).revision).not.toBe(expected.revision);
  });

  it.each(['hostVersion', 'id'] as const)('checks copied %s when the source changed after its initial hint was read', async field => {
    const packsDir = path.join(tmp, 'packs');
    const installed = await installPackFromLocal(builtPack(), packsDir);
    const before = readPackBuild(installed.dir).revision;
    const source = path.join(tmp, 'incoming-layout');
    stagePack(builtPack({ version: '2.0.0' }), source);
    const read = fs.readFileSync;
    let changed = false;
    const spy = vi.spyOn(fs, 'readFileSync').mockImplementation((file, options) => {
      if (file === path.join(source, 'integrity.json') && !changed) {
        changed = true;
        const manifest = JSON.parse(read(path.join(source, 'apack.json'), 'utf8'));
        manifest[field] = field === 'hostVersion' ? '>=9.0.0' : 'other-pack';
        const snapshot = JSON.parse(read(path.join(source, 'types/snapshot.json'), 'utf8'));
        snapshot.manifest = manifest;
        snapshot.declarationRevision = _declarationRevision(manifest);
        fs.writeFileSync(path.join(source, 'apack.json'), JSON.stringify(manifest));
        fs.writeFileSync(path.join(source, 'types/snapshot.json'), JSON.stringify(snapshot));
        const receipt = readPackIntegrity(source);
        receipt[field] = manifest[field];
        receipt.files = packFileHashes(source);
        fs.writeFileSync(path.join(source, 'integrity.json'), JSON.stringify(receipt));
      }
      return read(file, options);
    });
    syncBuiltinESMExports();
    const beforePlace = vi.fn();
    try {
      await expect(installPackFromLocal(source, packsDir, { hostVersion: '0.3.14', beforePlace })).rejects.toThrow(field === 'hostVersion' ? '>=9.0.0' : 'Pack identity changed');
      expect(changed).toBe(true);
      expect(beforePlace).not.toHaveBeenCalled();
      expect(readPackBuild(source).snapshot.manifest[field]).toBe(field === 'hostVersion' ? '>=9.0.0' : 'other-pack');
      expect(readPackBuild(installed.dir).revision).toBe(before);
      expect(fs.readdirSync(packsDir)).toEqual(['demo-pack']);
    } finally { spy.mockRestore(); syncBuiltinESMExports(); }
  });

  it('does not let hook-owned metadata edits change the installation target or result', async () => {
    const source = path.join(tmp, 'incoming-layout');
    stagePack(builtPack({ dependencies: { dep: '*' } }), source);
    const expected = readPackBuild(source);
    const result = await installPackFromLocal(source, path.join(tmp, 'packs'), { beforePlace: manifest => {
      const editable = manifest as { id: string; version: string; dependencies: Record<string, string> };
      editable.id = '../outside';
      editable.version = 'changed';
      editable.dependencies = { other: '*' };
    } });
    expect(result.id).toBe('demo-pack');
    expect(result.version).toBe('1.2.3');
    expect(result.missingDependencies).toEqual(['dep']);
    expect(result.dir).toBe(path.join(tmp, 'packs/demo-pack'));
    expect(readPackBuild(result.dir).revision).toBe(expected.revision);
    expect(fs.existsSync(path.join(tmp, 'outside'))).toBe(false);
  });

  it('cleans the private candidate and retains the installed build if teardown refuses', async () => {
    const packsDir = path.join(tmp, 'packs');
    const installed = await installPackFromLocal(builtPack(), packsDir);
    const before = readPackBuild(installed.dir).revision;
    await expect(installPackFromLocal(builtPack({ version: '2.0.0' }), packsDir, { beforePlace: () => {
      throw new Error('teardown refused');
    } })).rejects.toThrow('teardown refused');
    expect(readPackBuild(installed.dir).revision).toBe(before);
    expect(fs.readdirSync(packsDir)).toEqual(['demo-pack']);
  });
});

describe('installation acceptance', () => {
  it('keeps the prior verified build when runtime acceptance refuses a replacement', async () => {
    const packsDir = path.join(tmp, 'packs');
    const installed = await installPackFromLocal(builtPack(), packsDir);
    const previous = readPackBuild(installed.dir);
    const accept = vi.fn(candidate => {
      expect(candidate).toMatchObject({ id: installed.id, version: '2.0.0', dir: installed.dir });
      expect(readPackBuild(candidate.dir).integrity).toEqual(candidate.integrity);
      expect(readPackBuild(candidate.dir).revision).not.toBe(previous.revision);
      throw new Error('runtime registration refused');
    });
    await expect(installPackFromLocal(builtPack({ version: '2.0.0' }), packsDir, { accept }))
      .rejects.toThrow('runtime registration refused');
    expect(accept).toHaveBeenCalledOnce();
    expect(readPackBuild(installed.dir)).toEqual(previous);
    expect(fs.readdirSync(packsDir)).toEqual([installed.id]);
  });

  it('removes a refused first installation', async () => {
    const packsDir = path.join(tmp, 'packs');
    await expect(installPackFromLocal(builtPack(), packsDir, { accept: candidate => {
      expect(readPackBuild(candidate.dir).integrity).toEqual(candidate.integrity);
      throw new Error('runtime registration refused');
    } })).rejects.toThrow('runtime registration refused');
    expect(fs.readdirSync(packsDir)).toEqual([]);
  });

  it('publishes accepted bytes and keeps result metadata independent of the callback', async () => {
    const packsDir = path.join(tmp, 'packs');
    await installPackFromLocal(builtPack(), packsDir);
    const result = await installPackFromLocal(builtPack({ version: '2.0.0' }), packsDir, { accept: candidate => {
      expect(readPackBuild(candidate.dir).integrity).toEqual(candidate.integrity);
      candidate.integrity.files['runtime/index.cjs'] = 'callback mutation';
      candidate.missingDependencies.push('callback mutation');
      return undefined;
    } });
    expect(result.integrity).toEqual(readPackBuild(result.dir).integrity);
    expect(result.missingDependencies).toEqual([]);
    expect(result.version).toBe('2.0.0');
    expect(fs.readdirSync(packsDir)).toEqual([result.id]);
  });
});

describe('installPackFromLocal (pack layout path)', () => {
  it('removes its temporary staging directory when declaration validation refuses the source', async () => {
    const root = builtPack();
    const file = path.join(root, 'apack.json');
    const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
    manifest.version = '2.0.0';
    fs.writeFileSync(file, JSON.stringify(manifest));
    const staging = vi.spyOn(fs, 'mkdtempSync');
    syncBuiltinESMExports();
    const created = () => staging.mock.results.flatMap(result => result.type === 'return' && typeof result.value === 'string' ? [result.value] : []);
    try {
      await expect(installPackFromLocal(root, path.join(tmp, 'packs'))).rejects.toThrow('manifest does not match its built declarations');
      expect(created()).toHaveLength(1);
      expect(fs.existsSync(created()[0])).toBe(false);
    } finally {
      const directories = created();
      staging.mockRestore();
      syncBuiltinESMExports();
      for (const directory of directories) fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it.each([
    ['source', undefined], ['source', PACK_SNAPSHOT_FORMAT],
    ['layout', undefined], ['layout', PACK_SNAPSHOT_FORMAT],
  ] as const)('retains an installed build and skips teardown when a %s has mismatched declarations (app format %s)', async (kind, packFormat) => {
    const packsDir = path.join(tmp, 'packs');
    const installed = await installPackFromLocal(builtPack(), packsDir);
    const before = packFileHashes(installed.dir);
    const root = builtPack();
    const stage = path.join(tmp, 'stage');
    if (kind === 'layout') stagePack(root, stage);
    const input = kind === 'layout' ? stage : root;
    const file = path.join(input, 'apack.json');
    const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
    manifest.features = { newFeature: { description: 'Exercise changed declarations.' } };
    fs.writeFileSync(file, JSON.stringify(manifest));
    if (kind === 'layout') {
      // Valid checksums prove file integrity, not agreement with the built declarations.
      const integrity = readPackIntegrity(input);
      fs.writeFileSync(path.join(input, 'integrity.json'), JSON.stringify({ ...integrity, files: packFileHashes(input) }));
      expect(verifyPack(input).id).toBe('demo-pack');
      expect(() => readPackBuild(input)).toThrow('manifest does not match its built declarations');
      expect(packBuildProblem(input)).toMatchObject({ kind: 'declarations', message: expect.stringContaining('manifest does not match its built declarations') });
    }
    const beforePlace = vi.fn();
    await expect(installPackFromLocal(input, packsDir, { packFormat, beforePlace })).rejects.toThrow('manifest does not match its built declarations');
    expect(beforePlace).not.toHaveBeenCalled();
    expect(packFileHashes(installed.dir)).toEqual(before);
    expect(verifyPack(installed.dir).version).toBe('1.2.3');
  });

  it.each(['directory', 'archive'])('routes a local %s through the sourceKind selector', async (kind) => {
    let inputPath = builtPack();
    if (kind === 'archive') {
      const stage = path.join(tmp, 'stage');
      stagePack(inputPath, stage);
      inputPath = (await createPackArchive(stage, path.join(tmp, 'out'))).file;
    }
    const result = await installPack(inputPath, 'local', path.join(tmp, 'packs'));
    expect(result).toMatchObject({ id: 'demo-pack', version: '1.2.3' });
    expect(verifyPack(result.dir).id).toBe('demo-pack');
  });
  it('stages a built source pack and installs only the staged pack', async () => {
    const packsDir = path.join(tmp, 'packs');
    const result = await installPackFromLocal(builtPack(), packsDir);

    expect(result.integrity.id).toBe('demo-pack');
    expect(fs.readdirSync(result.dir).sort()).toEqual(['apack.json', 'integrity.json', 'runtime', 'types']);
    expect(verifyPack(result.dir).version).toBe('1.2.3');
    // no staging or replacement leftovers in the packs dir
    expect(fs.readdirSync(packsDir)).toEqual(['demo-pack']);
  });

  // At install, rather than skipped at the app's next start
  it('refuses a pack an older apack CLI built than the app reads, leaving nothing installed', async () => {
    const packsDir = path.join(tmp, 'packs');
    const source = builtPack();
    fs.writeFileSync(path.join(source, 'dist', 'types', 'snapshot.json'), JSON.stringify({ types: {} }));

    await expect(installPackFromLocal(source, packsDir, { packFormat: PACK_SNAPSHOT_FORMAT })).rejects.toThrow(
      `Pack "demo-pack" can't be installed: its snapshot is format (none), written by an older apack CLI; this apack reads format ${PACK_SNAPSHOT_FORMAT}. Rebuild it with the apack CLI that matches this apack`,
    );
    expect(fs.existsSync(path.join(packsDir, 'demo-pack'))).toBe(false);
  });

  // `apack pack install` and `apack pack dev` pass the format the app recorded, which need not be the one this process reads
  it("checks against the app's format, not this process's: refusing one only this process reads, installing one only the app reads", async () => {
    const packsDir = path.join(tmp, 'packs');
    const appFormat = PACK_SNAPSHOT_FORMAT + 1;

    await expect(installPackFromLocal(builtPack(), packsDir, { packFormat: appFormat })).rejects.toThrow(
      `Pack "demo-pack" can't be installed: its snapshot is format ${PACK_SNAPSHOT_FORMAT}, written by an older apack CLI; this apack reads format ${appFormat}. Rebuild it with the apack CLI that matches this apack`,
    );
    expect(fs.existsSync(path.join(packsDir, 'demo-pack'))).toBe(false);

    const source = builtPack();
    fs.writeFileSync(path.join(source, 'dist', 'types', 'snapshot.json'), JSON.stringify({ declarationRevision: _declarationRevision(JSON.parse(fs.readFileSync(path.join(source, 'apack.json'), 'utf-8'))), types: { entities: {}, relKinds: {}, roles: {} }, entityDestinations: {}, facades: {}, manifest: JSON.parse(fs.readFileSync(path.join(source, 'apack.json'), 'utf-8')), format: appFormat }));
    sealBuild(source);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await installPackFromLocal(source, packsDir, { packFormat: appFormat });
      expect(fs.existsSync(path.join(packsDir, 'demo-pack', 'apack.json'))).toBe(true);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('says a pack newer than the app reads needs the app updated', async () => {
    const source = builtPack();
    fs.writeFileSync(path.join(source, 'dist', 'types', 'snapshot.json'), JSON.stringify({ types: {}, format: PACK_SNAPSHOT_FORMAT }));

    await expect(installPackFromLocal(source, path.join(tmp, 'packs'), { packFormat: PACK_SNAPSHOT_FORMAT - 1 })).rejects.toThrow(
      `its snapshot is format ${PACK_SNAPSHOT_FORMAT}, written by a newer apack CLI; this apack reads format ${PACK_SNAPSHOT_FORMAT - 1}. Update apack to use it`,
    );
  });

  // No apack that records its format has started with the data dir, so nothing says which one it reads
  it("installs, when the app's format isn't known, a pack in a format this process doesn't read, warning that the app decides", async () => {
    const packsDir = path.join(tmp, 'packs');
    const source = builtPack();
    fs.writeFileSync(path.join(source, 'dist', 'types', 'snapshot.json'), JSON.stringify({ types: {}, format: PACK_SNAPSHOT_FORMAT + 1 }));
    sealBuild(source);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await installPackFromLocal(source, packsDir);

      expect(fs.existsSync(path.join(packsDir, 'demo-pack', 'apack.json'))).toBe(true);
      const warning = warn.mock.calls.flat().join('\n');
      expect(warning).toContain(`"demo-pack" may not load: its snapshot is format ${PACK_SNAPSHOT_FORMAT + 1}`);
      expect(warning).toContain("which one apack reads isn't recorded");
    } finally {
      warn.mockRestore();
    }
  });

  it('installs a verified archive and replaces the previous version', async () => {
    const packsDir = path.join(tmp, 'packs');
    await installPackFromLocal(builtPack({ version: '1.0.0' }), packsDir);

    const stage = path.join(tmp, 'stage');
    stagePack(builtPack({ version: '2.0.0' }), stage);
    const { file, sha256 } = await createPackArchive(stage, path.join(tmp, 'out'));
    const result = await installPackFromLocal(file, packsDir, { sha256 });

    expect(result.version).toBe('2.0.0');
    expect(fs.readdirSync(packsDir)).toEqual(['demo-pack']);
  });

  it('refuses a tampered bundle and leaves the installed version in place', async () => {
    const packsDir = path.join(tmp, 'packs');
    await installPackFromLocal(builtPack({ version: '1.0.0' }), packsDir);

    const stage = path.join(tmp, 'stage');
    stagePack(builtPack({ version: '2.0.0' }), stage);
    fs.appendFileSync(path.join(stage, 'runtime/index.cjs'), '\n// tampered');

    await expect(installPackFromLocal(stage, packsDir)).rejects.toThrow(/failed verification/);
    expect(JSON.parse(fs.readFileSync(path.join(packsDir, 'demo-pack', 'apack.json'), 'utf-8')).version).toBe('1.0.0');
    expect(fs.readdirSync(packsDir)).toEqual(['demo-pack']);
  });

  it('refuses an unbuilt pack directory, naming the build it needs', async () => {
    const root = builtPack();
    fs.rmSync(path.join(root, 'dist'), { recursive: true });
    await expect(installPackFromLocal(root, path.join(tmp, 'packs'))).rejects.toThrow(
      /^Pack demo-pack is not built: .* has no integrity\.json and no dist\/runtime\/index\.cjs with dist\/types\/snapshot\.json\. Run "apack pack build" first\.$/,
    );
    expect(fs.existsSync(path.join(tmp, 'packs', 'demo-pack'))).toBe(false);
  });

  it('refuses a pack the host version does not satisfy', async () => {
    await expect(
      installPackFromLocal(builtPack({ hostVersion: '>=99.0.0' }), path.join(tmp, 'packs'), { hostVersion: '0.3.14' }),
    ).rejects.toThrow(/requires apack >=99\.0\.0; this is 0\.3\.14/);
  });

  it('accepts prerelease hosts within range', async () => {
    const result = await installPackFromLocal(builtPack({ hostVersion: '>=0.3.0' }), path.join(tmp, 'packs'), { hostVersion: '0.4.0-beta.1' });
    expect(result.id).toBe('demo-pack');
  });
});

describe('installPackFromLocal (checksums)', () => {
  /** The built pack zipped up, or null where `zip` isn't installed. */
  async function zippedPack(): Promise<string | null> {
    const zipPath = path.join(tmp, 'pack.zip');
    try {
      await execFileWhileWorking('zip', ['-r', zipPath, '.'], { cwd: builtPack() });
    } catch {
      return null;
    }
    return zipPath;
  }

  it('refuses a .zip whose checksum does not match, unpacking nothing', async () => {
    const zipPath = await zippedPack();
    if (!zipPath) return;
    const packsDir = path.join(tmp, 'packs');

    await expect(installPackFromLocal(zipPath, packsDir, { sha256: '0'.repeat(64) })).rejects.toThrow(/Checksum mismatch for pack\.zip/);
    expect(fs.readdirSync(packsDir)).toEqual([]);
  });

  it('installs a .zip whose checksum matches', async () => {
    const zipPath = await zippedPack();
    if (!zipPath) return;
    const packsDir = path.join(tmp, 'packs');

    const result = await installPackFromLocal(zipPath, packsDir, { sha256: sha256File(zipPath) });
    expect(result.version).toBe('1.2.3');
  });
});

describe('installPackFromGitHub', () => {
  /** A release of demo-pack serving its archive from memory; `checksum` defaults to the archive's own, null publishes none. */
  async function mockRelease(checksum?: string | null) {
    const stage = path.join(tmp, 'stage');
    stagePack(builtPack(), stage);
    const { file, sha256 } = await createPackArchive(stage, path.join(tmp, 'out'));
    const name = path.basename(file);
    const published = checksum === undefined ? sha256 : checksum;
    const assets = [
      { name, browser_download_url: `https://example.test/${name}` },
      ...(published === null ? [] : [{ name: `${name}.sha256`, browser_download_url: `https://example.test/${name}.sha256` }]),
    ];

    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.startsWith('https://api.github.com/')) return new Response(JSON.stringify({ assets }), { status: 200 });
      if (url.endsWith('.sha256')) return new Response(`${published}  ${name}\n`, { status: 200 });
      return new Response(fs.readFileSync(file), { status: 200 });
    }));
    return { name };
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each(['', 'invalid', 'a'.repeat(63)])('refuses a malformed explicit pin before any GitHub request: %s', async sha256 => {
    const request = vi.fn();
    vi.stubGlobal('fetch', request);
    await expect(installPackFromGitHub('acme/pack@v1.2.3', path.join(tmp, 'packs'), { sha256 })).rejects.toThrow(/64-character SHA-256/);
    expect(request).not.toHaveBeenCalled();
  });

  it.each([undefined, 'github'])('routes a GitHub release with sourceKind %s', async sourceKind => {
    await mockRelease();

    const result = await installPack('acme/pack', sourceKind, path.join(tmp, 'packs'));
    expect(result.version).toBe('1.2.3');
  });

  it('encodes release tags as a single URL component', async () => {
    await mockRelease();
    await installPackFromGitHub('acme/pack@release/v1.2.3', path.join(tmp, 'packs'));
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe('https://api.github.com/repos/acme/pack/releases/tags/release%2Fv1.2.3');
  });

  it('refuses a release with no checksum asset, naming how to publish one', async () => {
    const { name } = await mockRelease(null);

    await expect(installPackFromGitHub('acme/pack@v1.2.3', path.join(tmp, 'packs'))).rejects.toThrow(
      `Release v1.2.3 of acme/pack has no ${name}.sha256; publish one with "apack pack release", or install with a checksum you know`,
    );
    expect(fs.existsSync(path.join(tmp, 'packs'))).toBe(false);
  });

  it("refuses a release whose published checksum isn't the archive's", async () => {
    await mockRelease('0'.repeat(64));

    await expect(installPackFromGitHub('acme/pack', path.join(tmp, 'packs'))).rejects.toThrow(/Checksum mismatch/);
  });

  it('refuses a checksum file that holds something else', async () => {
    await mockRelease('not a checksum');

    await expect(installPackFromGitHub('acme/pack', path.join(tmp, 'packs'))).rejects.toThrow(/doesn't hold a sha256 checksum/);
  });
});

describe('installPackFromUrl', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([undefined, 'url'])('routes a URL with sourceKind %s under a timeout', async sourceKind => {
    const stage = path.join(tmp, 'stage');
    stagePack(builtPack(), stage);
    const { file, sha256 } = await createPackArchive(stage, path.join(tmp, 'out'));
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(fs.readFileSync(file), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await installPack('https://example.test/demo-pack-1.2.3.tgz', sourceKind, path.join(tmp, 'packs'), { sha256 });
    expect(result.version).toBe('1.2.3');
    expect(fetchMock.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('names the URL when the download times out', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('The operation was aborted due to timeout'); }));

    await expect(installPackFromUrl('https://example.test/demo-pack-1.2.3.tgz', path.join(tmp, 'packs'))).rejects.toThrow(
      'Downloading https://example.test/demo-pack-1.2.3.tgz failed: The operation was aborted due to timeout',
    );
  });
});

// The id is joined onto the packs dir and deleted recursively, whoever passes it
describe('uninstallPack', () => {
  it.each([['..'], [''], ['a/../..'], ['.'], ['/tmp']])('refuses %j, which is not a pack id, and deletes nothing', async (packId) => {
    const packsDir = path.join(tmp, 'data', 'packs');
    fs.mkdirSync(path.join(packsDir, 'demo-pack'), { recursive: true });

    await expect(uninstallPack(packId, packsDir, { installedPacksFile: path.join(tmp, 'installed-packs.json') })).rejects.toThrow(`"${packId}" is not a pack id`);
    expect(fs.existsSync(path.join(packsDir, 'demo-pack'))).toBe(true);
  });

  it('deletes an installed pack', async () => {
    const packsDir = path.join(tmp, 'packs');
    fs.mkdirSync(path.join(packsDir, 'demo-pack'), { recursive: true });

    await uninstallPack('demo-pack', packsDir, { installedPacksFile: path.join(tmp, 'installed-packs.json') });
    expect(fs.existsSync(path.join(packsDir, 'demo-pack'))).toBe(false);
    expect(fs.existsSync(packsDir)).toBe(true);
  });
});
