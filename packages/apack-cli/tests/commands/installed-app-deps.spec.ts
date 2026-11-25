import { sealPackBuild } from '@apackdev/host/packs';
import { _declarationRevision } from '@apackdev/pack-format';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPackArchive, installPackFromLocal, stagePack } from '@apackdev/host/packs';
import { resolveDepFiles } from '../../src/commands/fetch-deps';
import { PACK_SNAPSHOT_FORMAT } from '@apackdev/pack-format';
import { _appDirOf } from '@apackdev/sdk/env';
import { PACK_LAYOUT } from '@apackdev/host/packs';

let tmp: string;
const saved = { env: process.env.APACK_ENV, dir: process.env.APACK_USER_DATA_DIR, host: process.env.APACK_HOST };

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'installed-app-deps-'));
  process.env.APACK_USER_DATA_DIR = path.join(tmp, 'userdata');
  delete process.env.APACK_HOST;
});

afterEach(() => {
  for (const [key, value] of [['APACK_ENV', saved.env], ['APACK_USER_DATA_DIR', saved.dir], ['APACK_HOST', saved.host]] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.unstubAllEnvs();
  fs.rmSync(tmp, { recursive: true, force: true });
});

function builtInPack(snapshot: object = { declarationRevision: _declarationRevision({ id: 'base-pack', name: 'Base Pack', version: '1.0.0' }), types: { entities: {}, relKinds: {}, roles: {} }, entityDestinations: {}, facades: {}, manifest: { id: 'base-pack', name: 'Base Pack', version: '1.0.0' }, format: PACK_SNAPSHOT_FORMAT }) {
  // Deliberately not a sibling/workspace path of the author pack, so only the installed-app source can find it
  const dir = path.join(tmp, 'app-bundle', 'resources', 'default-pack-source');
  fs.mkdirSync(path.join(dir, 'dist', 'build'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'dist', PACK_LAYOUT.typesDir), { recursive: true });
  // The manifest beside `dist/`, as the app ships a pack and as installing one requires
  const version = (snapshot as { manifest?: { version?: string } }).manifest?.version ?? '1.0.0';
  fs.writeFileSync(path.join(dir, PACK_LAYOUT.manifest), JSON.stringify({ id: 'base-pack', name: 'Base Pack', version }));
  fs.writeFileSync(path.join(dir, 'dist', PACK_LAYOUT.snapshot), JSON.stringify(snapshot));
  fs.writeFileSync(path.join(dir, 'dist', 'build', 'steps.build.mjs'), 'export const steps = [];');
  fs.mkdirSync(path.join(dir, 'dist', 'runtime'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'dist', 'runtime', 'index.cjs'), 'exports.registration = { id: "base-pack" };');
  // Compiled content at the top of a shipped pack's dist, beside files that aren't content
  // Compiled content, where `apack pack build` writes them for every pack
  fs.mkdirSync(path.join(dir, 'dist', PACK_LAYOUT.contentDir), { recursive: true });
  fs.writeFileSync(path.join(dir, 'dist', PACK_LAYOUT.contentDir, 'settings.content.json'), '{"theme":"dark"}');
  fs.writeFileSync(path.join(dir, 'dist', PACK_LAYOUT.contentDir, 'content.json'), JSON.stringify({ version: 1, packId: 'base-pack', entries: [] }));
  fs.mkdirSync(path.join(dir, 'dist', PACK_LAYOUT.contentDir, 'media', 'library'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'dist', PACK_LAYOUT.contentDir, 'media', 'library', 'pic.png'), 'PNG');
  fs.mkdirSync(path.join(dir, 'dist', 'defs'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'dist', 'defs', 'actions.d.ts'), '');
  sealPackBuild(path.join(dir, 'dist'), JSON.parse(fs.readFileSync(path.join(dir, 'apack.json'), 'utf8')));
  return dir;
}

describe('dependency resolution from an installed app', () => {
  /** The app's packs dir, where an installed pack is — the ones the app ships among them */
  const packsDir = () => {
    const dir = path.join(_appDirOf(path.join(tmp, 'userdata')), 'packs');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  };

  it('inspects an installed dependency without executing its runtime, downloading or populating the author cache', async () => {
    const source = builtInPack();
    fs.writeFileSync(path.join(source, 'dist', 'runtime', 'index.cjs'), 'throw new Error("Runtime must not execute");');
    sealPackBuild(path.join(source, 'dist'), JSON.parse(fs.readFileSync(path.join(source, 'apack.json'), 'utf8')));
    await installPackFromLocal(source, packsDir());
    const packRoot = path.join(tmp, 'author-pack');
    fs.mkdirSync(packRoot);
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network must not run'));
    try {
      const found = await resolveDepFiles(packRoot, 'base-pack', '*', { readOnly: true });
      expect(found?.snapshot.manifest.id).toBe('base-pack');
      expect(found?.resolvedFrom).toMatch(/^installed app/);
      expect(fs.readdirSync(packRoot)).toEqual([]);
      expect(await resolveDepFiles(packRoot, 'missing-pack', 'github:acme/missing-pack', { readOnly: true })).toBeNull();
      expect(fetch).not.toHaveBeenCalled();
      expect(fs.readdirSync(packRoot)).toEqual([]);
    } finally {
      fetch.mockRestore();
    }
  });

  it('resolves a shipped dependency (snapshot, step build code, runtime) from the installed app, and caches it in the pack', async () => {
    await installPackFromLocal(builtInPack(), packsDir());

    const packRoot = path.join(tmp, 'author-pack');
    fs.mkdirSync(packRoot, { recursive: true });

    const files = await resolveDepFiles(packRoot, 'base-pack', '*');
    expect(files?.snapshot.manifest.id).toBe('base-pack');
    expect(files?.buildDir).toBe(path.join(files!.directory, 'build'));
    expect(fs.existsSync(path.join(files!.buildDir!, 'steps.build.mjs'))).toBe(true);
    expect(files?.runtimeEntry).toBe(path.join(files!.directory, 'runtime', 'index.cjs'));
    expect(fs.readFileSync(files!.runtimeEntry!, 'utf-8')).toContain('registration');
    expect(files?.contentDir).toBe(path.join(files!.directory, 'runtime', 'content'));
    expect(fs.readdirSync(files!.contentDir!).sort()).toEqual(['content.json', 'media', 'settings.content.json']);
  });

  it('refuses a file dependency whose build belongs to a different pack', async () => {
    const source = builtInPack();
    const root = path.join(tmp, 'author-pack');
    fs.mkdirSync(root);
    await expect(resolveDepFiles(root, 'wrong-pack', `file:${source}`, { readOnly: true }))
      .rejects.toThrow('Dependency "wrong-pack" resolved to pack "base-pack"');
    expect(fs.existsSync(path.join(root, '.apack'))).toBe(false);
  });

  it('refuses a valid cached build renamed under another dependency id', async () => {
    await installPackFromLocal(builtInPack(), packsDir());
    const root = path.join(tmp, 'author-pack');
    fs.mkdirSync(root);
    await resolveDepFiles(root, 'base-pack', '*');
    fs.rmSync(path.join(packsDir(), 'base-pack'), { recursive: true });
    fs.renameSync(path.join(root, '.apack/deps/base-pack'), path.join(root, '.apack/deps/wrong-pack'));
    await expect(resolveDepFiles(root, 'wrong-pack', '*', { readOnly: true }))
      .rejects.toThrow('Dependency "wrong-pack" resolution declares "base-pack"');
  });

  it('retains dependency origin and content identity across cache reuse', async () => {
    await installPackFromLocal(builtInPack(), packsDir());
    const packRoot = path.join(tmp, 'author-pack');
    fs.mkdirSync(packRoot, { recursive: true });

    const first = await resolveDepFiles(packRoot, 'base-pack', '*');
    expect(first?.resolvedFrom).toMatch(/^installed app \(/);

    // The cached build preserves the original resolution after its source disappears.
    fs.rmSync(path.join(packsDir(), 'base-pack'), { recursive: true });
    const record = path.join(packRoot, '.apack/deps/base-pack/resolution.json');
    const recorded = fs.readFileSync(record);
    const cached = await resolveDepFiles(packRoot, 'base-pack', '*', { readOnly: true });
    expect(cached?.snapshot.manifest.id).toBe('base-pack');
    expect(cached?.resolution).toEqual(first?.resolution);
    expect(cached?.resolvedFrom).toBe(first?.resolvedFrom);
    expect(fs.readFileSync(record)).toEqual(recorded);
  });

  it("drops a cached runtime when the dependency stops shipping one", async () => {
    const src = builtInPack();
    await installPackFromLocal(src, packsDir());
    const packRoot = path.join(tmp, 'author-pack');
    fs.mkdirSync(packRoot, { recursive: true });
    const first = await resolveDepFiles(packRoot, 'base-pack', '*');
    expect(first?.runtimeEntry).toBeDefined();

    // The installed copy loses its runtime — an install cannot produce a pack without one, so this is the
    // state an update to a pack that dropped its backend leaves, read from the app rather than written by it
    const installed = path.join(packsDir(), 'base-pack');
    fs.rmSync(path.join(installed, 'runtime'), { recursive: true });
    sealPackBuild(installed, JSON.parse(fs.readFileSync(path.join(installed, 'apack.json'), 'utf8')));
    const files = await resolveDepFiles(packRoot, 'base-pack', '*');
    expect(files?.runtimeEntry).toBeUndefined();
    expect(fs.existsSync(path.join(files!.directory, 'runtime'))).toBe(false);
    expect(fs.existsSync(first!.runtimeEntry!)).toBe(true);
  });

  it('resolves a shipped dependency from the app configured for apack pack test, before the app has run', async () => {
    const checkout = path.join(tmp, 'apack');
    fs.mkdirSync(path.join(checkout, 'packages'), { recursive: true });
    fs.renameSync(builtInPack(), path.join(checkout, 'packages', 'base-pack'));
    process.env.APACK_HOST = checkout;

    const packRoot = path.join(tmp, 'author-pack');
    fs.mkdirSync(packRoot, { recursive: true });

    const files = await resolveDepFiles(packRoot, 'base-pack', '*');
    expect(files?.snapshot.manifest.id).toBe('base-pack');
    expect(fs.existsSync(path.join(files!.buildDir!, 'steps.build.mjs'))).toBe(true);
    // A checkout's shipped pack: dist/runtime/index.cjs, as default-setup's build writes it
    expect(fs.readFileSync(files!.runtimeEntry!, 'utf-8')).toContain('registration');
  });

  /** A shipped pack's snapshot; `fields` overrides any of it, `format: undefined` included */
  const snapshotOf = (version: string, fields: object = {}) =>
    ({ declarationRevision: _declarationRevision({ id: 'base-pack', name: 'Base Pack', version }), types: { entities: {}, relKinds: {}, roles: {} }, entityDestinations: {}, facades: {}, manifest: { id: 'base-pack', name: 'Base Pack', version }, format: PACK_SNAPSHOT_FORMAT, ...fields });

  /** The pack installed in an app's data dir, as the app's boot leaves it */
  async function publishInstalled(version: string, steps = 'export const steps = [];', fields: object = {}) {
    const src = builtInPack(snapshotOf(version, fields));
    fs.writeFileSync(path.join(src, 'dist', 'build', 'steps.build.mjs'), steps);
    const dir = path.join(_appDirOf(path.join(tmp, 'userdata')), 'packs');
    fs.mkdirSync(dir, { recursive: true });
    sealPackBuild(path.join(src, 'dist'), JSON.parse(fs.readFileSync(path.join(src, 'apack.json'), 'utf8')));
    await installPackFromLocal(src, dir);
  }

  function authorPack(): string {
    const packRoot = path.join(tmp, 'author-pack');
    fs.mkdirSync(packRoot, { recursive: true });
    return packRoot;
  }

  it('refreshes the cached dependency when the app provides a new version', async () => {
    const packRoot = authorPack();
    await publishInstalled('1.0.0', 'export const steps = ["v1"];');
    expect((await resolveDepFiles(packRoot, 'base-pack', '*'))?.snapshot.manifest.version).toBe('1.0.0');

    await publishInstalled('2.0.0', 'export const steps = ["v2"];');
    const files = await resolveDepFiles(packRoot, 'base-pack', '*');
    expect(files?.snapshot.manifest.version).toBe('2.0.0');
    expect(fs.readFileSync(path.join(files!.buildDir!, 'steps.build.mjs'), 'utf-8')).toContain('v2');
  });

  it('only accepts a dependency version that satisfies the declared range, cached or not', async () => {
    const packRoot = authorPack();
    await publishInstalled('1.0.0');
    expect(await resolveDepFiles(packRoot, 'base-pack', '*')).not.toBeNull(); // now cached

    expect(await resolveDepFiles(packRoot, 'base-pack', '>=2.0.0')).toBeNull();
    expect((await resolveDepFiles(packRoot, 'base-pack', '^1.0.0'))?.snapshot.manifest.version).toBe('1.0.0');
  });

  it('prefers the app configured for apack pack test over an installed app', async () => {
    await publishInstalled('1.0.0');
    const checkout = path.join(tmp, 'apack');
    fs.mkdirSync(path.join(checkout, 'packages'), { recursive: true });
    fs.renameSync(
      builtInPack(snapshotOf('3.0.0')),
      path.join(checkout, 'packages', 'base-pack'),
    );
    process.env.APACK_HOST = checkout;

    expect((await resolveDepFiles(authorPack(), 'base-pack', '*'))?.snapshot.manifest.version).toBe('3.0.0');
  });

  it("resolves a dependency from the checkout a pack sits in at any depth, before an installed app's copy", async () => {
    await publishInstalled('1.0.0');
    const checkout = path.join(tmp, 'apack');
    fs.mkdirSync(path.join(checkout, 'packages'), { recursive: true });
    fs.renameSync(
      builtInPack(snapshotOf('4.0.0')),
      path.join(checkout, 'packages', 'base-pack'),
    );
    // Three levels down, like tests/packs/external-pack
    const fixture = path.join(checkout, 'tests', 'packs', 'author-pack');
    fs.mkdirSync(fixture, { recursive: true });

    expect((await resolveDepFiles(fixture, 'base-pack', '*'))?.snapshot.manifest.version).toBe('4.0.0');
  });

  describe('type data and execution stamps', () => {
    it('reads an explicitly selected host without substituting another source', async () => {
      await publishInstalled('1.0.0');
      const checkout = path.join(tmp, 'apack');
      fs.mkdirSync(path.join(checkout, 'packages'), { recursive: true });
      fs.renameSync(builtInPack(snapshotOf('3.0.0', { format: undefined })), path.join(checkout, 'packages', 'base-pack'));
      process.env.APACK_HOST = checkout;
      const found = await resolveDepFiles(authorPack(), 'base-pack', '*');
      expect(found?.snapshot.manifest.version).toBe('3.0.0');
      expect(found?.snapshot.format).toBeUndefined();
      expect(found?.executionProblem).toContain('format (none)');
      expect(found?.runtimeEntry).toBeUndefined();
      expect(found?.buildDir).toBeUndefined();
    });

    it.each([undefined, PACK_SNAPSHOT_FORMAT + 1])('reads installed type data without exposing executable files: %s', async format => {
      await publishInstalled('1.0.0', undefined, { format, sdkVersion: '0.3.14' });
      const found = await resolveDepFiles(authorPack(), 'base-pack', '*');
      expect(found?.snapshot.format).toBe(format);
      expect(found?.snapshot.sdkVersion).toBe('0.3.14');
      expect(found?.executionProblem).toContain('its snapshot is format');
      expect(found?.runtimeEntry).toBeUndefined();
      expect(found?.buildDir).toBeUndefined();
    });

    it('retains stamp context and execution refusal after cache reuse', async () => {
      const packRoot = authorPack();
      await publishInstalled('1.0.0', undefined, { format: undefined });
      expect(await resolveDepFiles(packRoot, 'base-pack', '*')).not.toBeNull();
      fs.rmSync(path.join(_appDirOf(path.join(tmp, 'userdata')), 'packs', 'base-pack'), { recursive: true });
      const found = await resolveDepFiles(packRoot, 'base-pack', '*');
      expect(found?.snapshot.format).toBeUndefined();
      expect(found?.executionProblem).toContain('format (none)');
      expect(found?.runtimeEntry).toBeUndefined();
      expect(found?.buildDir).toBeUndefined();
    });
  });

  /** An archived release of dep-pack in snapshot `format`, and its checksum, as `apack pack release` publishes them */
  async function publishedRelease(version: string, format: number | undefined, snapshotIdentity: { id?: string; version?: string } = {}) {
    const src = path.join(tmp, `dep-pack-${version}`);
    fs.mkdirSync(path.join(src, 'dist', 'types'), { recursive: true });
    fs.mkdirSync(path.join(src, 'dist', 'runtime'), { recursive: true });
    const manifest = { id: 'dep-pack', name: 'Dep', version };
    fs.writeFileSync(path.join(src, 'apack.json'), JSON.stringify(manifest));
    fs.writeFileSync(path.join(src, 'dist', 'runtime', 'index.cjs'), 'exports.registration = { id: "dep-pack" };');
    const snapshotManifest = { ...manifest, ...snapshotIdentity };
    fs.writeFileSync(path.join(src, 'dist', PACK_LAYOUT.snapshot), JSON.stringify({ declarationRevision: _declarationRevision(snapshotManifest), types: { entities: {}, relKinds: {}, roles: {} }, entityDestinations: {}, facades: {}, manifest: snapshotManifest, format }));
    const stage = path.join(tmp, `stage-${version}`);
    sealPackBuild(path.join(src, 'dist'), manifest);
    stagePack(src, stage);
    const archive = await createPackArchive(stage, path.join(tmp, 'releases'));
    return {
      tag_name: `v${version}`,
      assets: [
        { name: `dep-pack-${version}.tgz`, url: `https://example.test/${path.basename(archive.file)}` },
        { name: `dep-pack-${version}.tgz.sha256`, url: `https://example.test/${path.basename(archive.checksumFile)}` },
      ],
    };
  }

  /** Serves `releases` from GitHub, recording each archive downloaded */
  function serveReleases(releases: unknown[]): string[] {
    const downloaded: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/releases?')) return new Response(JSON.stringify(releases));
      if (url.endsWith('.tgz')) downloaded.push(path.basename(url));
      return new Response(fs.readFileSync(path.join(tmp, 'releases', path.basename(url))));
    }));
    return downloaded;
  }

  it('fetches the newly declared GitHub origin instead of reusing another repository’s cache', async () => {
    const downloaded = serveReleases([await publishedRelease('1.4.0', PACK_SNAPSHOT_FORMAT)]);
    const root = authorPack();
    const first = await resolveDepFiles(root, 'dep-pack', 'github:acme/dep-pack ^1.0.0');
    expect(first?.resolution?.origin).toMatchObject({ kind: 'github', repository: 'acme/dep-pack', tag: 'v1.4.0' });
    expect(await resolveDepFiles(root, 'dep-pack', 'github:other/dep-pack ^1.0.0', { readOnly: true })).toBeNull();
    const second = await resolveDepFiles(root, 'dep-pack', 'github:other/dep-pack ^1.0.0');
    expect(second?.resolution?.origin).toMatchObject({ kind: 'github', repository: 'other/dep-pack', tag: 'v1.4.0' });
    expect(second?.resolution?.spec).toBe('github:other/dep-pack ^1.0.0');
    expect(downloaded).toHaveLength(2);
  });

  it('reuses remote cache for builds but refreshes it for explicit fetching', async () => {
    const downloaded = serveReleases([await publishedRelease('1.4.0', PACK_SNAPSHOT_FORMAT)]);
    const root = authorPack();
    const spec = 'github:acme/dep-pack ^1.0.0';
    await resolveDepFiles(root, 'dep-pack', spec);
    await resolveDepFiles(root, 'dep-pack', spec);
    expect(downloaded).toHaveLength(1);
    await resolveDepFiles(root, 'dep-pack', spec, { refresh: true });
    expect(downloaded).toHaveLength(2);
  });

  it.each([{ id: 'other-pack' }, { version: '1.5.0' }])('refuses mismatched release snapshot identity before caching: %j', async identity => {
    serveReleases([await publishedRelease('1.4.0', PACK_SNAPSHOT_FORMAT + 1, identity)]);
    const root = authorPack();
    await expect(resolveDepFiles(root, 'dep-pack', 'github:acme/dep-pack ^1.0.0'))
      .rejects.toThrow(identity.id ? 'other-pack@1.4.0' : 'dep-pack@1.5.0');
    expect(fs.existsSync(path.join(root, '.apack/deps/dep-pack'))).toBe(false);
  });

  it('selects current type data from the newest release without granting execution', async () => {
    const releases = [await publishedRelease('1.4.0', PACK_SNAPSHOT_FORMAT + 1), await publishedRelease('1.3.0', PACK_SNAPSHOT_FORMAT)];
    const downloaded = serveReleases(releases);
    try {
      const found = await resolveDepFiles(authorPack(), 'dep-pack', 'github:acme/dep-pack ^1.0.0');
      expect(found?.snapshot.manifest.version).toBe('1.4.0');
      expect(found?.resolvedFrom).toBe('github:acme/dep-pack@1.4.0');
      expect(found?.executionProblem).toContain('its snapshot is format');
      expect(found?.runtimeEntry).toBeUndefined();
      expect(found?.buildDir).toBeUndefined();
      expect(downloaded).toEqual(['dep-pack-1.4.0.tgz']);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('retains unstamped release data as metadata without executing it', async () => {
    const releases = [await publishedRelease('1.4.0', undefined), await publishedRelease('1.3.0', undefined)];
    const downloaded = serveReleases(releases);
    try {
      const found = await resolveDepFiles(authorPack(), 'dep-pack', 'github:acme/dep-pack ^1.0.0');
      expect(found?.snapshot.manifest.version).toBe('1.4.0');
      expect(found?.snapshot.format).toBeUndefined();
      expect(found?.executionProblem).toContain('format (none)');
      expect(found?.runtimeEntry).toBeUndefined();
      expect(downloaded).toEqual(['dep-pack-1.4.0.tgz']);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("refuses a GitHub release without the dependency's own archive checksum", async () => {
    const requested: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      requested.push(url);
      if (url.includes('/releases?')) {
        return new Response(JSON.stringify([{
          tag_name: 'v1.2.0',
          assets: [
            { name: 'other-pack-1.2.0.tgz', url: 'https://example.test/other.tgz' },
            { name: 'other-pack-1.2.0.tgz.sha256', url: 'https://example.test/other.sha256' },
            { name: 'dep-pack-1.2.0.tgz', url: 'https://example.test/dep.tgz' },
          ],
        }]));
      }
      return new Response('unexpected download', { status: 500 });
    }));
    try {
      expect(await resolveDepFiles(authorPack(), 'dep-pack', 'github:acme/dep-pack')).toBeNull();
      expect(requested).toEqual([expect.stringContaining('/repos/acme/dep-pack/releases')]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('returns null when nothing provides the dependency', async () => {
    const packRoot = path.join(tmp, 'author-pack');
    fs.mkdirSync(packRoot, { recursive: true });
    expect(await resolveDepFiles(packRoot, 'missing-pack', '*')).toBeNull();
  });
});


describe('resolved host dependency ownership', () => {
  function sources() {
    const workspace = path.join(tmp, 'workspace');
    const selected = path.join(tmp, 'selected-host');
    const pack = path.join(workspace, 'author-pack');
    fs.mkdirSync(pack, { recursive: true });
    const source = builtInPack();
    for (const [root, version] of [[workspace, '2.0.0'], [selected, '1.0.0']]) {
      const dependency = path.join(root, 'packages', 'base-pack');
      fs.cpSync(source, dependency, { recursive: true });
      fs.writeFileSync(path.join(dependency, 'dist', PACK_LAYOUT.snapshot), JSON.stringify({ declarationRevision: _declarationRevision({ id: 'base-pack', name: 'Base Pack', version }), types: { entities: {}, relKinds: {}, roles: {} }, entityDestinations: {}, facades: {}, manifest: { id: 'base-pack', name: 'Base Pack', version }, format: PACK_SNAPSHOT_FORMAT }));
      const manifest = { id: 'base-pack', name: 'Base Pack', version };
      fs.writeFileSync(path.join(dependency, 'apack.json'), JSON.stringify(manifest));
      sealPackBuild(path.join(dependency, 'dist'), manifest);
    }
    vi.stubEnv('APACK_HOST_ROOT', selected);
    return { selected, workspace, pack };
  }

  it('uses the selected host before a nearby workspace', async () => {
    const { pack } = sources();
    expect((await resolveDepFiles(pack, 'base-pack', '*'))?.snapshot.manifest.version).toBe('1.0.0');
  });

  it('refuses an incompatible selected host instead of substituting the workspace', async () => {
    const { pack } = sources();
    await expect(resolveDepFiles(pack, 'base-pack', '>=2.0.0')).rejects.toThrow(/Selected host dependency.*base-pack.*1.0.0.*>=2.0.0/);
  });

  it('refuses an unbuilt dependency belonging to the selected host', async () => {
    const { selected, pack } = sources();
    fs.rmSync(path.join(selected, 'packages', 'base-pack', 'dist'), { recursive: true });
    await expect(resolveDepFiles(pack, 'base-pack', '*')).rejects.toThrow(/Selected host dependency.*no built snapshot/);
  });

  it('keeps an explicitly declared file dependency authoritative', async () => {
    const { workspace, pack } = sources();
    const dependency = `file:${path.join(workspace, 'packages', 'base-pack')}`;
    expect((await resolveDepFiles(pack, 'base-pack', dependency))?.snapshot.manifest.version).toBe('2.0.0');
  });
});
