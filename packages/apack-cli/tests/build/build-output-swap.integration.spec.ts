// @slow: real `apack pack build`s, most cases one or two, a refused build each retaining the one before it
import * as content from '@apackdev/sdk/build';
import * as frontend from '../../src/build/fe-bundler.ts';
import { buildStagingDir } from '../../src/build/build-publication.ts';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FIXTURE_DATA, FIXTURE_ENTITY, packFixture } from '@apackdev/sdk/testing/pack-fixture';
import { build } from '../../src/commands/build';
import { PACK_LAYOUT, readPackBuild, stagePack, verifyPack } from '@apackdev/host/packs';
import { REPO_ROOT } from '@apackdev/host/build/packages-built';
import { generateEntries } from '../../src/commands/generate-entries';
import { PACK_TYPES_FACADE } from '@apackdev/sdk/build';
import * as replacement from '@apackdev/host/replace-dir';

/**
 * **`apack pack build` assembles `dist/` elsewhere and renames it into place**, so a reader finds the previous
 * build whole or this one whole. What that replaced is removing `dist` first, which published ~20s in which
 * every reader of a pack's output — all of which read a missing output as *not built* — had the wrong answer;
 * the fixture-pack race in `1e19b40d9` was exactly that, fixed then by removing one reader.
 *
 * So the cases here are the inverse of the ones they replace: a failed build leaves the **previous build
 * intact** rather than leaving nothing. What is not asked here is that the swap replaces the tree whole — that
 * is `replaceDir`'s, in `@apackdev/host`'s `tests/replace-dir.spec.ts`, and asking it again would cost a
 * successful build of a fixture pack to re-establish what one rename already guarantees.
 */
let dist: string;
afterEach(async () => {
  vi.restoreAllMocks();
  fs.rmSync(path.dirname(dist), { recursive: true, force: true });
  // Early refusals can finish synchronously; receive runner replies before the next scenario.
  await new Promise<void>(resolve => setImmediate(resolve));
});

function previousBuild(files: string[]): string {
  dist = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'apack-clear-output-')), 'dist');
  for (const file of files) {
    fs.mkdirSync(path.dirname(path.join(dist, file)), { recursive: true });
    fs.writeFileSync(path.join(dist, file), '');
  }
  return dist;
}

const list = (dir: string): string[] => fs.existsSync(dir)
  ? fs.readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => path.relative(dir, path.join(e.parentPath, e.name))).sort()
  : [];

describe('a build that fails', () => {
  const PREVIOUS = ['flows.content.json', 'content.json', 'runtime/index.cjs', 'defs/monaco/actions.d.ts'];

  it('refuses missing producer output before sealing and retains the incumbent', async () => {
    const dir = previousBuild(PREVIOUS);
    const root = path.dirname(dir);
    packFixture({ at: root, nodeModules: path.join(REPO_ROOT, 'node_modules'), manifest: {
      id: 'incomplete-output', name: 'Incomplete output', features: { view: {
        description: 'Output verification.', surface: { label: 'View', state: 'src/view.ts' },
      } },
    }, files: { 'src/view.ts': "import { createMachine } from 'xstate'; export default createMachine({});" } });
    vi.spyOn(frontend, 'bundlePackFE').mockImplementation(async options => {
      fs.writeFileSync(path.join(options.outputDir, 'fe.js'), 'export {};');
      options.recordOutput!(path.join(options.outputDir, 'required.css'), 'EXPECTED');
      return { success: true };
    });
    await expect(build([], root)).rejects.toThrow('Required build output is missing or changed: runtime/required.css');
    expect(list(dir)).toEqual([...PREVIOUS].sort());
    expect(fs.existsSync(buildStagingDir(root))).toBe(false);
  });

  it('refuses copied media removed after compilation and retains the incumbent', async () => {
    const dir = previousBuild(PREVIOUS);
    const root = path.dirname(dir);
    packFixture({ at: root, nodeModules: path.join(REPO_ROOT, 'node_modules'), manifest: {
      id: 'incomplete-media', name: 'Incomplete media', features: {}, data: FIXTURE_DATA, content: {
        formats: { rows: { compiler: 'src/compiler.ts', entity: FIXTURE_ENTITY, media: 'media' } },
        sources: { rows: { path: 'content/rows', format: 'rows' } },
      },
    }, files: { 'src/compiler.ts': 'export default () => [];', 'content/rows/media/proof.txt': 'MEDIA' } });
    const compile = content.compilePack;
    vi.spyOn(content, 'compilePack').mockImplementation(async options => {
      const result = await compile(options);
      fs.unlinkSync(path.join(options.outputDir, 'media/rows/proof.txt'));
      return result;
    });
    await expect(build(['--skip-fe'], root)).rejects.toThrow('Required build output is missing or changed: runtime/content/media/rows/proof.txt');
    expect(list(dir)).toEqual([...PREVIOUS].sort());
    expect(fs.existsSync(buildStagingDir(root))).toBe(false);
  });

  it('refuses publication when an authored input changes during a real build', async () => {
    const dir = previousBuild(PREVIOUS);
    const root = path.dirname(dir);
    packFixture({ at: root, manifest: { id: 'changing-inputs', name: 'Changing', features: {}, data: FIXTURE_DATA, content: { formats: { tags: { compiler: 'src/compiler.ts', entity: FIXTURE_ENTITY } }, sources: { tags: { path: 'src/data.ts', format: 'tags' } } } }, files: {
      'src/compiler.ts': "import { writeFileSync } from 'node:fs'; writeFileSync(new URL('../changed.json', import.meta.url), '{}'); export default function compile() { return []; }",
      'src/data.ts': 'export default [];',
    } });
    await expect(build(['--skip-fe'], root)).rejects.toThrow('Pack inputs changed during the build');
    expect(fs.existsSync(path.join(root, 'changed.json'))).toBe(true);
    expect(list(dir)).toEqual([...PREVIOUS].sort());
    expect(fs.existsSync(buildStagingDir(root))).toBe(false);
  });

  it('retains the previous build when a missing external resolution directory appears during compilation', async () => {
    const dir = previousBuild(PREVIOUS);
    const root = path.dirname(dir);
    const external = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-resolution-namespace-'));
    const missing = path.join(external, 'missing');
    try {
      packFixture({ at: root, nodeModules: path.join(REPO_ROOT, 'node_modules'), manifest: { features: {}, data: FIXTURE_DATA, content: {
        formats: { tags: { compiler: 'src/compiler.ts', entity: FIXTURE_ENTITY } },
        sources: { tags: { path: 'src/data.ts', format: 'tags' } },
      } }, files: {
        'src/consumer.ts': `import ${JSON.stringify(path.join(missing, 'index'))};`,
        'src/compiler.ts': `import { mkdirSync } from 'node:fs'; mkdirSync(${JSON.stringify(missing)}); export default function compile() { return []; }`,
        'src/data.ts': 'export default [];',
      } });
      await expect(build(['--skip-fe'], root)).rejects.toThrow('Compiler or installed package inputs changed');
      expect(fs.existsSync(missing)).toBe(true);
      expect(list(dir)).toEqual([...PREVIOUS].sort());
      expect(fs.existsSync(buildStagingDir(root))).toBe(false);
    } finally { fs.rmSync(external, { recursive: true, force: true }); }
  });

  it('does not reuse facade files from an incumbent with stamps from a refused replacement', async () => {
    const dir = previousBuild([]);
    const root = path.dirname(dir);
    packFixture({ at: root, nodeModules: path.join(REPO_ROOT, 'node_modules'), manifest: {
      features: { notes: { description: 'Store notes.', entities: { Note: { shape: 'src/shape.ts#NoteShape' } } } },
    }, files: { 'src/shape.ts': 'export interface NoteShape { title: string }' } });
    const facade = () => readPackBuild(dir).snapshot.facades[PACK_TYPES_FACADE];
    await build(['--skip-fe'], root);
    expect(facade()).toMatch(/title:\s*string/);
    const accepted = readPackBuild(dir).revision;
    const cache = path.join(dir, 'phase-cache.json');
    const acceptedCache = fs.readFileSync(cache);
    expect(verifyPack(dir).files['phase-cache.json']).toMatch(/^[a-f0-9]{64}$/);
    const staged = path.join(root, '.apack', 'installed-layout');
    stagePack(root, staged);
    expect(fs.existsSync(path.join(staged, 'phase-cache.json'))).toBe(false);
    expect(verifyPack(staged).files).not.toHaveProperty('phase-cache.json');
    fs.writeFileSync(path.join(root, 'src/shape.ts'), 'export interface NoteShape { title: number }');
    const refuse = vi.spyOn(replacement, 'replaceDir').mockImplementationOnce(() => { throw new Error('Simulated output placement failure'); });
    await expect(build(['--skip-fe'], root)).rejects.toThrow('Simulated output placement failure');
    refuse.mockRestore();
    expect(readPackBuild(dir).revision).toBe(accepted);
    expect(fs.readFileSync(cache)).toEqual(acceptedCache);
    expect(facade()).toMatch(/title:\s*string/);
    await build(['--skip-fe'], root);
    expect(facade()).toMatch(/title:\s*number/);
  }, 3 * 60_000 + 20_000);

  it('refuses stale generated declarations and retains the previous build', async () => {
    const dir = previousBuild(PREVIOUS);
    const root = path.dirname(dir);
    packFixture({ at: root, manifest: { id: 'stale-codegen', name: 'Before', features: {} } });
    const manifestFile = path.join(root, 'apack.json');
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    await generateEntries([], root);
    fs.writeFileSync(manifestFile, JSON.stringify({ ...manifest, name: 'After' }));
    await expect(build(['--skip-generate', '--skip-fe'], root)).rejects.toThrow('Generated pack files are stale: inputs changed');
    expect(list(dir)).toEqual([...PREVIOUS].sort());
    expect(fs.existsSync(buildStagingDir(root))).toBe(false);
  });

  it.each(['missing', 'modified'])('refuses %s generated code before replacing the previous build', async (change) => {
    const dir = previousBuild(PREVIOUS);
    const root = path.dirname(dir);
    packFixture({ at: root, manifest: { id: 'damaged-codegen', name: 'Test', features: {},
      data: FIXTURE_DATA, content: { formats: { tags: { compiler: 'src/compiler.ts', entity: FIXTURE_ENTITY } }, sources: { tags: { path: 'src/data.ts', format: 'tags' } } },
    }, files: {
      'src/compiler.ts': "import { writeFileSync } from 'node:fs'; writeFileSync(new URL('../compiler-executed', import.meta.url), 'yes'); export default function compile() { return []; }",
      'src/data.ts': 'export default [];',
    } });
    await generateEntries([], root);
    const entry = path.join(root, 'src/__generated__/pack-entry.ts');
    if (change === 'missing') fs.rmSync(entry);
    else fs.appendFileSync(entry, '\nthrow new Error("edited entry executed");\n');
    await expect(build(['--skip-generate', '--skip-fe'], root)).rejects.toThrow(`${change} src/__generated__/pack-entry.ts`);
    expect(fs.existsSync(path.join(root, 'compiler-executed'))).toBe(false);
    expect(list(dir)).toEqual([...PREVIOUS].sort());
    expect(fs.existsSync(buildStagingDir(root))).toBe(false);
  });

  it('publishes help as snapshot data and retains accepted articles after an invalid edit', async () => {
    const dir = previousBuild(PREVIOUS);
    const root = path.dirname(dir);
    packFixture({ at: root, nodeModules: path.join(REPO_ROOT, 'node_modules'), manifest: {
      features: {}, extensions: { help: { path: 'docs/help' } },
    }, files: { 'docs/help/start.md': '# Start\nFirst article' } });
    const file = path.join(root, 'docs/help/start.md');
    await build(['--skip-fe'], root);
    expect(readPackBuild(dir).snapshot.help).toEqual([{ id: 'start', title: 'Start', body: 'First article' }]);
    fs.writeFileSync(file, '# Updated\nChanged article');
    await build(['--skip-fe'], root);
    expect(readPackBuild(dir).snapshot.help![0]).toMatchObject({ title: 'Updated', body: expect.stringContaining('Changed article') });
    const accepted = fs.readFileSync(path.join(dir, PACK_LAYOUT.snapshot), 'utf8');
    fs.writeFileSync(file, 'Missing title');
    await expect(build(['--skip-fe'], root)).rejects.toThrow('first H1');
    expect(fs.readFileSync(path.join(dir, PACK_LAYOUT.snapshot), 'utf8')).toBe(accepted);
    expect(readPackBuild(dir).snapshot.help![0].title).toBe('Updated');
  }, 3 * 60_000 + 20_000);

  it('leaves the whole of the previous build in place, and no staging tree', async () => {
    const dir = previousBuild(PREVIOUS);
    const root = path.dirname(dir);
    packFixture({ at: root, manifest: {
      id: 'built-in-pack', name: 'Built-in',
      features: { memos: { description: 'Feature declaration fixture.', settings: { schema: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } }, defaults: {} } } },
      content: { sources: { flows: 'src/content/flows' } },
    } });
    // Invalid declared defaults fail before content compilation.
    await expect(build(['--skip-generate'], root)).rejects.toThrow('features.memos.settings.defaults.name');
    expect(list(dir)).toEqual([...PREVIOUS].sort());
    expect(fs.existsSync(buildStagingDir(root)), 'the staged tree goes with the failure').toBe(false);
  });
});

describe('a pack whose content compiler modules fail to bundle', () => {
  it('fails the build before it writes the snapshot', async () => {
    const dir = previousBuild(['snapshot.json']);
    const root = path.dirname(dir);
    packFixture({
      at: root,
      files: { 'src/tags.ts': 'import "./missing-compiler.ts"; export default () => [];\n' },
      manifest: {
        id: 'built-in-pack', name: 'Built-in', features: {},
        // Not used by an entry here, so only the bundle for dependents compiles it
        data: FIXTURE_DATA, content: { formats: { tags: { compiler: 'src/tags.ts', entity: FIXTURE_ENTITY } } },
      },
    });
    const exitCode = process.exitCode;
    try {
      // Nothing here concerns the frontend, and the build goes on to every phase after a failed bundle
      await expect(build(['--skip-fe'], root)).rejects.toThrow(/Content compiler bundle failed/);
    } finally {
      process.exitCode = exitCode;
    }
    expect(list(dir), 'the previous build is what a reader still finds').toEqual(['snapshot.json']);
  });
});

describe('a pack whose runtime fails to bundle', () => {
  it('reports it and fails the build without writing the snapshot', async () => {
    dist = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'apack-clear-output-')), 'dist');
    const root = path.dirname(dist);
    packFixture({
      at: root,
      files: { 'src/lifecycle.ts': 'import "./missing-runtime.ts"; export function apply() {}' },
      manifest: { id: 'broken-runtime', name: 'Broken', features: {}, lifecycle: { onInit: 'src/lifecycle.ts#apply' } },
    });
    await expect(build(['--skip-fe'], root)).rejects.toThrow(/Build failed, so no snapshot was written:\n[\s\S]*Runtime bundle failed/);
    expect(list(dist)).not.toContain(PACK_LAYOUT.snapshot);
    expect(fs.existsSync(buildStagingDir(root))).toBe(false);
  });
});


describe('a completed build', () => {
  it.each(['facade', 'cache'] as const)('rebuilds damaged %s data instead of renewing its checksums', async damage => {
    const dir = previousBuild([]);
    const root = path.dirname(dir);
    packFixture({ at: root, manifest: { id: 'sealed-build', name: 'Sealed', features: {} }, nodeModules: path.join(REPO_ROOT, 'node_modules') });
    await build(['--skip-fe'], root);
    const first = readPackBuild(dir);
    expect(first.integrity.files[PACK_LAYOUT.runtimeEntry]).toMatch(/^[a-f0-9]{64}$/);
    const reusable = path.join(dir, 'types/pack-types.d.ts');
    const original = fs.readFileSync(reusable, 'utf8');
    const damaged = damage === 'facade' ? reusable : path.join(dir, 'phase-cache.json');
    if (damage === 'facade') fs.appendFileSync(damaged, '\nexport type Damaged = never;');
    else {
      const cache = JSON.parse(fs.readFileSync(damaged, 'utf8'));
      cache.types.unverified = 'must not be carried into a new build';
      fs.writeFileSync(damaged, JSON.stringify(cache));
    }
    expect(() => verifyPack(dir)).toThrow(`checksum mismatch ${path.relative(dir, damaged).split(path.sep).join('/')}`);
    await build(['--skip-fe'], root);
    expect(fs.readFileSync(reusable, 'utf8')).toBe(original);
    expect(readPackBuild(dir).revision).toBe(first.revision);
    const stage = path.join(root, 'stage');
    stagePack(root, stage);
    expect(verifyPack(stage).id).toBe('sealed-build');
  }, 2 * 60_000 + 20_000);
});
