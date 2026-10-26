// @slow: seven `npm pack --dry-run` spawns at ~0.3s each, which is the subject and not a detail of how it works
// `stagePublishTree` exists because reading `files` ourselves lost npm's force-included files, so asking
// npm what it would publish is the thing under test. Re-measured on an idle machine and it came back
// slightly slower rather than faster, so the cost is not an artefact of load.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  manifestPaths, missingPublishedPaths, packTree, publishedManifest, registryDependencies, stagePublishTree, workspacePackList,
} from '../../src/build/published-manifest.ts';

// What a published tarball may say, and what the build stages for npm to publish.
//
// `published-sdk-types.integration.spec.ts` compares an installed manifest against `publishedManifest(workspace)`,
// which proves the staging applied this function — both sides move together, so it cannot prove the function is
// right. This is where that is established.
let dir: string;
beforeEach(() => { dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'published-manifest-'))); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

/** A package on disk: `files: ["dist"]`, one built module, and whatever else the case adds */
function pkg(extra: Record<string, string> = {}, manifest: Record<string, unknown> = {}): Record<string, unknown> {
  const full = { name: '@fake/pkg', version: '1.0.0', type: 'module', files: ['dist'], ...manifest };
  fs.mkdirSync(path.join(dir, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'dist', 'index.js'), 'export const version = 1;\n');
  fs.writeFileSync(path.join(dir, 'dist', 'index.d.ts'), 'export declare const version: number;\n');
  fs.writeFileSync(path.join(dir, 'package.json'), `${JSON.stringify(full, null, 2)}\n`);
  for (const [file, contents] of Object.entries(extra)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), contents);
  }
  return full;
}

describe('publishedManifest', () => {
  it('drops the source branch and keeps what a consumer resolves', () => {
    expect(publishedManifest({
      exports: { '.': { '@apackdev/source': './src/index.ts', types: './dist/index.d.ts', default: './dist/index.js' } },
    })).toEqual({ exports: { '.': { types: './dist/index.d.ts', default: './dist/index.js' } } });
  });

  it('drops it at any depth', () => {
    expect(publishedManifest({
      exports: { './x': { types: { '@apackdev/source': './src/x.ts', default: './dist/x.d.ts' }, default: './dist/x.js' } },
    })).toEqual({ exports: { './x': { types: { default: './dist/x.d.ts' }, default: './dist/x.js' } } });
  });

  /**
   * `@apackdev/sdk`'s `./runtime/internals` is this entry. It must not gain a published target and must not be left
   * as an empty object either: `facade-gate.ts` reports a pack whose facade imports what installed dependents
   * cannot resolve, and it decides that by asking whether the entry has a published target. Dropping the entry
   * keeps that answer "no" — an absent subpath is not resolvable — and it is what lets the SDK's
   * `attw --exclude-entrypoints ./runtime/internals` be gone.
   */
  it('drops an entry the source branch was the whole of, rather than emptying it', () => {
    const published = publishedManifest({
      exports: { '.': { '@apackdev/source': './src/index.ts', default: './dist/index.js' }, './internals': { '@apackdev/source': './src/internals.ts' } },
    });
    expect(published.exports).toEqual({ '.': { default: './dist/index.js' } });
    expect(Object.keys(published.exports as object)).not.toContain('./internals');
  });

  /**
   * With no scripts there is no lifecycle hook to add, so a published manifest cannot become something that runs
   * on install or rewrites itself at pack time. `@app/publish-checks` asserts the absence rather than a list of
   * hook names, which npm is free to grow.
   */
  it('drops scripts and devDependencies', () => {
    const published = publishedManifest({ name: '@fake/pkg', scripts: { build: 'tsc', prepack: 'x' }, devDependencies: { vitest: '^3' } });
    expect(published).toEqual({ name: '@fake/pkg' });
  });

  it('leaves every other field exactly as it was', () => {
    const manifest = {
      name: '@fake/pkg', version: '1.0.0', type: 'module', files: ['dist', 'schema.json'],
      publishConfig: { access: 'public', provenance: true }, peerDependencies: { lmdb: '^3' },
      peerDependenciesMeta: { lmdb: { optional: true } }, sideEffects: false,
    };
    expect(publishedManifest(manifest)).toEqual(manifest);
  });

  it('publishes a dependency on a linked directory as the version of the package there, and refuses one it cannot resolve', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'published-manifest-link-'));
    try {
      fs.mkdirSync(path.join(dir, 'linked'));
      fs.writeFileSync(path.join(dir, 'linked', 'package.json'), JSON.stringify({ name: 'linked', version: '2.3.4' }));
      const manifest = { name: '@fake/pkg', dependencies: { linked: 'file:linked', msgpackr: '^1.11.9' } };
      expect(publishedManifest(manifest, dir).dependencies).toEqual({ linked: '2.3.4', msgpackr: '^1.11.9' });
      expect(() => publishedManifest(manifest)).toThrow('dependency linked is file:linked: publishing it needs the directory the path is relative to');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('registryDependencies', () => {
  it('asks the registry for every dependency but one the same publish puts there, a linked one as its version', () => {
    const linkedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'published-manifest-link-'));
    try {
      fs.mkdirSync(path.join(linkedDir, 'linked'));
      fs.writeFileSync(path.join(linkedDir, 'linked', 'package.json'), JSON.stringify({ name: 'linked', version: '0.0.0', private: true }));
      const engine = publishedManifest({ name: '@fake/engine', dependencies: { linked: 'file:linked', msgpackr: '^1' } }, linkedDir);
      const sdk = { name: '@fake/sdk', dependencies: { '@fake/engine': '^1' }, peerDependencies: { vue: '^3' }, optionalDependencies: { fsevents: '^2' } };
      const byName = (deps: Array<{ name: string }>) => [...deps].sort((a, b) => a.name.localeCompare(b.name));
      expect(byName(registryDependencies([engine, sdk]))).toEqual([
        { dependent: '@fake/sdk', name: 'fsevents', spec: '^2' },
        { dependent: '@fake/engine', name: 'linked', spec: '0.0.0' },
        { dependent: '@fake/engine', name: 'msgpackr', spec: '^1' },
        { dependent: '@fake/sdk', name: 'vue', spec: '^3' },
      ]);
    } finally {
      fs.rmSync(linkedDir, { recursive: true, force: true });
    }
  });
});

describe('workspacePackList', () => {
  /**
   * The reason this asks npm instead of reading `files`. npm-packlist force-includes `/readme*`, `/copying*`,
   * `/license*` and `/licence*` — and `package.json` — whatever `files` says, so a staged tree built by walking
   * `files` would drop a README the day one is added, with nothing to notice.
   */
  it('holds what npm force-includes, not only what files names', () => {
    pkg({ 'README.md': '# fake\n', 'LICENSE': 'MIT\n', 'notes.txt': 'not published\n' });
    const packed = workspacePackList(dir);
    expect([...packed].sort()).toEqual(['LICENSE', 'README.md', 'dist/index.d.ts', 'dist/index.js', 'package.json']);
  });
});

describe('packTree', () => {
  /**
   * The whole of why it exists. `attw --pack <dir>` packs a tarball *inside* the tree it is checking and
   * deletes it afterwards, so every other reader of that tree sees a file appear and vanish — the recorded
   * `ENOENT: open 'publish/apack-ui-0.1.0.tgz'`, and the reason keeping other steps away from these trees was
   * a mutex against 29 of the chain's 30 steps. Given a destination it writes nowhere else.
   */
  it('writes the tarball where it is told and leaves the packed tree alone', () => {
    const original = dir;
    dir = `${dir} & spaces`;
    fs.renameSync(original, dir);
    pkg({ 'README.md': '# fake\n' });
    const dest = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'packed & spaces-')));
    const before = fs.readdirSync(dir, { recursive: true, encoding: 'utf-8' }).sort();
    try {
      const tarball = packTree(dir, dest);
      expect(path.dirname(tarball)).toBe(dest);
      expect(fs.existsSync(tarball), 'the path it reports is the file it wrote').toBe(true);
      expect(fs.readdirSync(dest)).toEqual([path.basename(tarball)]);
      expect(fs.readdirSync(dir, { recursive: true, encoding: 'utf-8' }).sort(),
        'nothing new in the tree it packed').toEqual(before);
    } finally {
      fs.rmSync(dest, { recursive: true, force: true });
    }
  });

  /** Named for the package and version it holds, which is what `npm pack` would have called it in place */
  it('names the tarball as npm does', () => {
    const dest = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'packed-')));
    pkg({}, { name: '@fake/pkg', version: '2.3.4' });
    try {
      expect(path.basename(packTree(dir, dest))).toBe('fake-pkg-2.3.4.tgz');
    } finally {
      fs.rmSync(dest, { recursive: true, force: true });
    }
  });
});

describe('stagePublishTree', () => {
  it('stages exactly what npm would pack, with the derived manifest over it', () => {
    const manifest = pkg({ 'README.md': '# fake\n' }, {
      scripts: { build: 'tsc' },
      exports: { '.': { '@apackdev/source': './src/index.ts', types: './dist/index.d.ts', default: './dist/index.js' } },
    });
    const tree = stagePublishTree(dir, manifest);

    expect([...workspacePackList(tree)].sort()).toEqual([...workspacePackList(dir)].sort());
    expect(fs.readFileSync(path.join(tree, 'README.md'), 'utf-8')).toBe('# fake\n');
    const staged = JSON.parse(fs.readFileSync(path.join(tree, 'package.json'), 'utf-8')) as Record<string, unknown>;
    expect(staged).toEqual(publishedManifest(manifest));
    expect(JSON.stringify(staged)).not.toContain('@apackdev/source');
    expect(staged.scripts).toBeUndefined();
  });

  it('refuses a manifest naming no files, which would stage the whole working directory', () => {
    const manifest = pkg();
    delete manifest.files;
    expect(() => stagePublishTree(dir, manifest)).toThrow(/names no "files"/);
  });

  /** The build's own check: the staged manifest may not name a file the staged tree does not hold */
  it('refuses a manifest naming something files does not cover', () => {
    const manifest = pkg({}, { exports: { '.': './lib/index.js' } });
    expect(() => stagePublishTree(dir, manifest)).toThrow(/does not hold/);
  });

  it('replaces a tree an earlier build staged', () => {
    const manifest = pkg();
    const tree = stagePublishTree(dir, manifest);
    fs.writeFileSync(path.join(tree, 'stale.txt'), 'from a previous build\n');
    stagePublishTree(dir, manifest);
    expect(fs.existsSync(path.join(tree, 'stale.txt'))).toBe(false);
  });
});

describe('missingPublishedPaths', () => {
  it('reports what a manifest names and the tarball lacks, bracketing the keys', () => {
    const files = new Set(['dist/index.js']);
    expect(missingPublishedPaths({ exports: { '.': { types: './dist/index.d.ts', default: './dist/index.js' } } }, files))
      .toEqual(['exports["."]["types"] -> ./dist/index.d.ts']);
  });

  /** A `*` target is a pattern, so something has to match it — a pattern matching nothing passed every check */
  it('treats a pattern as met only when a packed file matches it', () => {
    expect(missingPublishedPaths({ exports: { './*': './dist/*.js' } }, new Set(['dist/x.js']))).toEqual([]);
    expect(missingPublishedPaths({ exports: { './*': './dist/*.js' } }, new Set(['other/x.js'])))
      .toEqual(['exports["./*"] -> ./dist/*.js']);
  });

  it('reads bin, which is the only path a manifest with no exports map names', () => {
    expect(manifestPaths({ bin: { apack: 'bin/apack.mjs' } })).toEqual([['bin["apack"]', 'bin/apack.mjs']]);
    expect(missingPublishedPaths({ bin: { apack: 'bin/apack.mjs' } }, new Set(['bin/apack.mjs']))).toEqual([]);
  });
});
