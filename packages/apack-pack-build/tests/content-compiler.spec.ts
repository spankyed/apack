import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compilePack, CONTENT_INDEX_FILE } from '../src/content-compiler.ts';
import type { CompilePackOptions } from '../src/types.ts';
import type { PackManifest } from '@apackdev/pack-format';
import { buildPackConfigFromManifest } from '../src/manifest-bridge.ts';
import type { ContentDependency } from '../src/content/resolve.ts';

let root: string;
let out: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-content-compiler-'));
  out = path.join(root, 'dist');
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function write(file: string, content: string): void {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), content);
}

const read = (file: string) => JSON.parse(fs.readFileSync(path.join(out, file), 'utf-8'));

it.each(['actions', 'prompts', 'flows', 'documents', 'commands'])('refuses a declared %s source that is missing instead of indexing nothing', async key => {
  await expect(compile({}, { [key]: 'missing' })).rejects.toThrow(`Content "${key}": source path does not exist`);
  expect(fs.existsSync(path.join(out, CONTENT_INDEX_FILE))).toBe(false);
});

/** Compiles a pack whose apack.json has these content.formats and content.sources, as apack pack build does */
async function compile(
  formats: Record<string, unknown>,
  sources: Record<string, unknown>,
  options: { recordOutput?: CompilePackOptions['recordOutput']; dependencies?: ReadonlyMap<string, ContentDependency>; importModule?: CompilePackOptions['importModule']; manifest?: Record<string, unknown>; asDatasets?: boolean } = {},
) {
  const manifest = { id: 'demo', name: 'Demo', version: '1.0.0', content: { formats, ...(options.asDatasets ? { datasets: sources } : { sources }) }, ...options.manifest } as unknown as PackManifest;
  return compilePack({
    packDir: root,
    outputDir: out,
    importModule: options.importModule,
    recordOutput: options.recordOutput,
    packConfig: await buildPackConfigFromManifest(manifest, root, { dependencies: options.dependencies }),
  });
}

/** The same, declaring the entries under `content.datasets` */
const compileDatasets = (
  formats: Record<string, unknown>,
  sources: Record<string, unknown>,
  options: Parameters<typeof compile>[2] = {},
) => compile(formats, sources, { ...options, asDatasets: true });

const memosFormat = {
  format: 'markdown-tree', entity: 'Memo', identity: ['title', 'parent'], tree: { branch: 'index.md' }, media: 'media',
  fields: { title: { from: 'frontmatter.title', default: 'filename', type: 'string' }, pinned: { from: 'frontmatter.pinned', default: false }, body: { from: 'body' } },
};

describe('compilePack', () => {
  it('publishes flow references without changing compiled flow records or their hashes', async () => {
    write('content/flows/demo.ts', 'export default {}');
    const flow = { Demo: [{ event: 'manual', initial: 'Greeting', exits: [[]] }] };
    const step = { type: 'start', kind: 'trigger' as const,
      trigger: { trackField: 'event', compile: () => ({}), decompile: () => ({}) },
    };
    const options: CompilePackOptions = {
      packDir: root, outputDir: out,
      packConfig: { name: 'demo', sources: { flows: { kind: 'specialty', path: 'content/flows' } } },
      importModule: async () => ({ default: flow }),
      definitions: { steps: [step], artifacts: [], blocks: [] },
    };
    await compilePack(options);
    const before = fs.readFileSync(path.join(out, 'flows.content.json'), 'utf8');
    await compilePack({ ...options, definitions: { steps: [{ ...step, dsl: { references: { initial: 'prompts' } } }], artifacts: [], blocks: [] } });
    expect(fs.readFileSync(path.join(out, 'flows.content.json'), 'utf8')).toBe(before);
    expect(read(CONTENT_INDEX_FILE).entries[0].references).toEqual([
      { item: 'Demo', path: 'Demo[0].initial', kind: 'static', target: { key: 'prompts', item: 'Greeting' } },
    ]);
  });

  it("compiles an entry with its format's settings, copies media and indexes it", async () => {
    write('content/memos/first.md', '---\ntitle: 2024\npinned: true\n---\nHello ![pic](media/pic.png)\n');
    write('content/memos/group/index.md', '---\ntitle: Group\n---\nGroup body\n');
    write('content/memos/group/child-memo.md', 'Child body\n');
    write('content/memos/media/pic.png', 'PNG');
    const expected = new Map<string, Buffer>();
    const result = await compile({ memos: memosFormat }, { memos: { path: 'content/memos', format: 'memos' } }, {
      recordOutput(file, bytes) { expected.set(path.relative(out, file), Buffer.from(bytes)); },
    });
    expect([...expected.keys()].sort()).toEqual(['content.json', 'media/memos/pic.png', 'memos.content.json']);
    for (const [file, bytes] of expected) expect(fs.readFileSync(path.join(out, file))).toEqual(bytes);

    const { records } = read('memos.content.json');
    expect(records.map((r: { title: string }) => r.title)).toEqual(['2024', 'Group']);
    expect(records[0]).toMatchObject({ entity: 'Memo', title: '2024', pinned: true, body: 'Hello ![pic](media/pic.png)\n', contentHash: expect.stringMatching(/^[0-9a-f]{16}$/) });
    expect(records[1].children).toEqual([expect.objectContaining({ entity: 'Memo', title: 'child memo', pinned: false })]);
    expect(fs.readFileSync(path.join(out, 'media/memos/pic.png'), 'utf-8')).toBe('PNG');
    expect(read(CONTENT_INDEX_FILE)).toEqual({ version: 1, packId: 'demo', entries: [{ key: 'memos', written: true, identity: ['title', 'parent'], count: 3, items: [{ key: '2024' }, { key: 'Group', childCount: 1 }] }] });
    expect(result.counts).toEqual({ memos: 3 });
  });

  it('gives empty frontmatter values the default', async () => {
    write('content/memos/blank.md', '---\ntitle:\npinned:\n---\nBlank\n');
    write('content/memos/empty-string.md', '---\ntitle: ""\n---\nEmpty\n');
    await compile({ memos: memosFormat }, { memos: { path: 'content/memos', format: 'memos' } });
    const { records } = read('memos.content.json');
    expect(records.map((r: { title: string; pinned: boolean }) => [r.title, r.pinned])).toEqual([['blank', false], ['empty string', false]]);
  });

  it("skips only the format's media directory: a notes folder named media is written", async () => {
    write('content/memos/media/index.md', '---\ntitle: Media notes\n---\n');
    write('content/memos/media/clip.md', 'Clip\n');
    write('content/memos/assets/pic.png', 'PNG');
    write('content/memos/assets/stray.md', 'Not a memo\n');
    await compile({ memos: { ...memosFormat, media: 'assets' } }, { memos: { path: 'content/memos', format: 'memos' } });
    const { records } = read('memos.content.json');
    expect(records.map((r: { title: string; children?: Array<{ title: string }> }) => [r.title, r.children?.map((c) => c.title)]))
      .toEqual([['Media notes', ['clip']]]);
    expect(fs.readdirSync(path.join(out, 'media/memos'))).toEqual(['pic.png', 'stray.md']);

    // Without a media directory, nothing is skipped
    await compile({ memos: { ...memosFormat, media: undefined } }, { memos: { path: 'content/memos', format: 'memos' } });
    expect(read('memos.content.json').records.map((r: { title: string }) => r.title)).toEqual(['assets', 'Media notes']);
  });

  it('reads frontmatter with CRLF line endings or a byte order mark', async () => {
    write('content/memos/crlf.md', '---\r\ntitle: Windows\r\npinned: true\r\n---\r\nBody\r\n');
    write('content/memos/bom.md', '\uFEFF---\ntitle: Marked\n---\nBody\n');
    await compile({ memos: memosFormat }, { memos: { path: 'content/memos', format: 'memos' } });
    expect(read('memos.content.json').records.map((r: { title: string; pinned: boolean; body: string }) => [r.title, r.pinned, r.body]))
      .toEqual([['Marked', false, 'Body\n'], ['Windows', true, 'Body\r\n']]);
  });

  it("replaces its earlier output: a dropped key or media doesn't linger, other files in the dir stay", async () => {
    write('content/memos/first.md', 'Hello\n');
    write('content/memos/media/pic.png', 'PNG');
    await compile({ memos: memosFormat }, { memos: { path: 'content/memos', format: 'memos' } });
    fs.mkdirSync(path.join(out, 'runtime'));
    fs.writeFileSync(path.join(out, 'runtime/index.cjs'), '');
    fs.writeFileSync(path.join(out, 'notes.json'), '{}');

    fs.rmSync(path.join(root, 'content/memos/media'), { recursive: true });
    await compile({ memos: memosFormat }, { notes: { path: 'content/memos', format: 'memos' } });
    expect(fs.readdirSync(out).sort()).toEqual([CONTENT_INDEX_FILE, 'notes.content.json', 'notes.json', 'runtime']);

    // A failed compile leaves no content from the previous one
    write('content/items.json', JSON.stringify([{ entity: 'Other', name: 'x' }]));
    await expect(compile({ items: { format: 'json', entity: 'Item' } }, { items: { path: 'content/items.json', format: 'items' } })).rejects.toThrow(/isn't one of Item/);
    expect(fs.readdirSync(out).sort()).toEqual(['notes.json', 'runtime']);
  });

  it("compiles with the pack's own compiler module, which may leave contentHash to the default", async () => {
    write('content/tags.txt', 'red\nblue\n');
    write('compile-tags.mjs', `import * as fs from 'node:fs';
export default ({ path, key }) => fs.readFileSync(path, 'utf-8').trim().split('\\n').map((name) => ({ entity: 'Tag', name, key }));`);
    const importModule = vi.fn((file: string) => import(file));
    await compile({ tags: { compiler: 'compile-tags.mjs', entity: 'Tag', identity: ['name'] } }, { tags: { path: 'content/tags.txt', format: 'tags' } }, { importModule });
    expect(importModule).toHaveBeenCalledWith(path.join(root, 'compile-tags.mjs'));
    expect(read('tags.content.json').records).toEqual([
      { entity: 'Tag', name: 'red', key: 'tags', contentHash: expect.stringMatching(/^[0-9a-f]{16}$/) },
      { entity: 'Tag', name: 'blue', key: 'tags', contentHash: expect.stringMatching(/^[0-9a-f]{16}$/) },
    ]);
  });

  it("compiles this pack's sources with a dependency's format and its bundled compiler export", async () => {
    write('content/team/plan.md', '---\ntitle: Plan\n---\nShip\n');
    write('content/team.txt', 'red\n');
    write('deps/base-pack/build/content-compilers.mjs', `import * as fs from 'node:fs';
export const tags = ({ path }) => fs.readFileSync(path, 'utf-8').trim().split('\\n').map((name) => ({ entity: 'Tag', name }));`);
    const base = { id: 'base-pack', name: 'Base', version: '1.0.0', content: { formats: { memos: memosFormat, tags: { compiler: 'src/content/compilers/tags.ts', entity: 'Tag', identity: ['name'] } } } } as unknown as PackManifest;
    const dependencies = new Map([['base-pack', { manifest: base, buildDir: path.join(root, 'deps/base-pack/build') }]]);
    const importModule = vi.fn((file: string) => import(file));
    await compile({}, {
      team: { path: 'content/team', format: 'base-pack:memos' },
      colors: { path: 'content/team.txt', format: 'base-pack:tags' },
    }, { dependencies, importModule, manifest: { dependencies: { 'base-pack': '*' } } });

    expect(read('team.content.json').records).toEqual([expect.objectContaining({ entity: 'Memo', title: 'Plan', body: 'Ship\n' })]);
    expect(importModule).toHaveBeenCalledWith(path.join(root, 'deps/base-pack/build/content-compilers.mjs'));
    expect(read('colors.content.json').records).toEqual([{ entity: 'Tag', name: 'red', contentHash: expect.any(String) }]);
  });

  it("fails clearly when a dependency's compiler export or build dir is missing", async () => {
    write('content/team.txt', 'red\n');
    write('deps/base-pack/build/content-compilers.mjs', 'export const other = () => [];');
    const base = { id: 'base-pack', name: 'Base', version: '1.0.0', content: { formats: { tags: { compiler: 'src/tags.ts', entity: 'Tag' } } } } as unknown as PackManifest;
    const content = { colors: { path: 'content/team.txt', format: 'base-pack:tags' } };
    const manifest = { dependencies: { 'base-pack': '*' } };
    await expect(compile({}, content, { manifest, dependencies: new Map([['base-pack', { manifest: base, buildDir: path.join(root, 'deps/base-pack/build') }]]) }))
      .rejects.toThrow(/format "base-pack:tags" has no compiler export "tags"/);
    await expect(compile({}, content, { manifest, dependencies: new Map([['base-pack', { manifest: base }]]) }))
      .rejects.toThrow(/format "base-pack:tags" compiles with a module, but its pack's build dir wasn't resolved/);
    // Built before it bundled its content compilers (or the bundle failed)
    await expect(compile({}, content, { manifest, dependencies: new Map([['base-pack', { manifest: base, buildDir: path.join(root, 'deps/unbuilt/build') }]]) }))
      .rejects.toThrow(/format "base-pack:tags" compiles with base-pack's content compilers, but .*deps\/unbuilt\/build\/content-compilers\.mjs doesn't exist: build base-pack first/);
  });

  it("fails, naming the record, when a compiler module's output isn't an array of records", async () => {
    write('content/tags.txt', 'red\n');
    const tags = (body: string) => {
      write('compile-tags.mjs', `export default () => (${body});`);
      return compile({ tags: { compiler: 'compile-tags.mjs', entity: 'Tag' } }, { tags: { path: 'content/tags.txt', format: 'tags' } }, {
        // A fresh module each time: the import cache would return the first
        importModule: (file: string) => import(`${file}?v=${Math.random()}`),
      });
    };
    await expect(tags(`{ records: [] }`)).rejects.toThrow(/tags: compiler "tags" \(.*compile-tags\.mjs\) returned bad records: output is object, not an array of records/);
    await expect(tags(`[{ entity: 'Tag', name: 'a' }, 'b', null]`)).rejects.toThrow(/output\[1\] is string, not a record object[\s\S]*output\[2\] is null, not a record object/);
    await expect(tags(`[{ entity: 1, contentHash: 2, children: [{ entity: 'Tag' }, 3] }]`))
      .rejects.toThrow(/output\[0\]\.entity isn't a string[\s\S]*output\[0\]\.contentHash isn't a string[\s\S]*output\[0\]\.children\[1\] is number, not a record object/);
    await expect(tags(`[{ entity: 'Tag', name: 'a', children: [] }]`)).resolves.toBeDefined();
  });

  it("fails when a compiled record's entity isn't one the format declares", async () => {
    write('content/items.json', JSON.stringify([{ entity: 'Other', name: 'x' }]));
    await expect(compile({ items: { format: 'json', entity: 'Item' } }, { items: { path: 'content/items.json', format: 'items' } }))
      .rejects.toThrow(/Content "items" records\[0\]: entity "Other" isn't one of Item/);
  });

  /**
   * **A dataset is compiled and indexed as unwritten**, which is the whole of what `content.datasets`
   * buys: the same compilation, and no applier to find nothing to do.
   */
  it('compiles a dataset and indexes it as unwritten', async () => {
    write('content/glossary.json', JSON.stringify([{ question: 'Why?' }]));
    await compileDatasets({ glossary: { format: 'json' } }, { glossary: { path: 'content/glossary.json', format: 'glossary' } });
    expect(read('glossary.content.json').records).toEqual([{ question: 'Why?', contentHash: expect.any(String) }]);
    expect(read(CONTENT_INDEX_FILE).entries).toEqual([{ key: 'glossary', written: false, count: 1, items: [] }]);
  });

  /** And the two sections are not interchangeable: each refuses the other's shape rather than compiling it */
  it('refuses a source whose format writes nothing, and a dataset whose format writes something', async () => {
    write('content/glossary.json', JSON.stringify([{ question: 'Why?' }]));
    await expect(compile({ glossary: { format: 'json' } }, { glossary: { path: 'content/glossary.json', format: 'glossary' } }))
      .rejects.toThrow(/declares no entity, so nothing is written — declare it under content\.datasets instead/);
    await expect(compileDatasets({ items: { format: 'json', entity: 'Item' } }, { items: { path: 'content/glossary.json', format: 'items' } }))
      .rejects.toThrow(/declares an entity, so it is content — declare it under content\.sources instead/);
  });

  it('compiles content keys named like PackConfig fields as content', async () => {
    write('content/name.json', JSON.stringify([{ entity: 'Item', label: 'a' }]));
    write('content/setup.json', JSON.stringify([{ entity: 'Item', label: 'b' }]));
    // Through apack.json alone, as compilePack reads it without a packConfig
    write('apack.json', JSON.stringify({ id: 'demo', name: 'Demo', version: '1.0.0', content: { formats: { items: { format: 'json', entity: 'Item', identity: ['label'] } }, sources: {
      name: { path: 'content/name.json', format: 'items' },
      setup: { path: 'content/setup.json', format: 'items' },
    } } }));
    const result = await compilePack({ packDir: root, outputDir: out });
    expect(result.counts).toEqual({ name: 1, setup: 1 });
    expect(read('name.content.json').records[0].label).toBe('a');
    expect(read('setup.content.json').records[0].label).toBe('b');
  });

  it('routes specialty keys to their SDK compilers', async () => {
    write('content/prompts/greet.ts', `export const meta = { label: 'Greet', description: 'Says hello' };\nexport function template() { return 'Hello'; }\n`);
    await compile({}, { prompts: 'content/prompts' });
    expect(read('prompts.content.json').records).toEqual([expect.objectContaining({ label: 'Greet' })]);
    expect(read(CONTENT_INDEX_FILE).entries).toEqual([{ key: 'prompts', written: true, identity: ['label'], count: 1, items: [{ key: 'Greet', description: 'Says hello' }] }]);
  });

  it("indexes a source with a pack applier as written, whatever its format writes", async () => {
    write('content/theme.json', JSON.stringify([{ name: 'defaults', description: 'Theme defaults', theme: 'dark' }]));
    const formats = { theme: { format: 'json', entity: 'Theme' } };
    await compile(formats, { theme: { path: 'content/theme.json', format: 'theme', applier: 'src/content/theme.ts' } });
    expect(read('theme.content.json').records).toEqual([expect.objectContaining({ name: 'defaults', theme: 'dark' })]);
    expect(read(CONTENT_INDEX_FILE).entries).toEqual([{ key: 'theme', written: true, count: 1, items: [{ key: 'defaults', description: 'Theme defaults' }] }]);
  });
});

/**
 * `contentHash` is what a re-apply compares to decide whether a row changed, so it has to depend on the record's
 * content and nothing else. The content-parity goldens used to pin its literal value, which made every cosmetic edit
 * and every bundler change move them; they now record that a hash is present and this is where the property itself
 * is checked. Both directions matter: equality alone would still pass if the hash became a constant.
 *
 * The fixture's action imports a `_helpers/` module, because an action's hash covers its bundle — that is why
 * editing one helper re-hashes every action importing it, which is the behaviour the last case pins.
 */
describe('contentHash is content-addressed', () => {
  const HELPER = "export function shout(s: string) { return s.toUpperCase(); }\n";
  const ACTION = "import { shout } from './_helpers/shout';\n"
    + "export const meta = { label: 'Greet', description: 'hi' };\n"
    + "export async function action() { return shout('hello'); }\n";

  /** Compiles one action in its own source root, to its own output dir, and returns its hash */
  async function hashOf(action = ACTION, helper = HELPER): Promise<string> {
    const src = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-hash-src-'));
    const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-hash-out-'));
    fs.mkdirSync(path.join(src, 'content/actions/_helpers'), { recursive: true });
    fs.writeFileSync(path.join(src, 'content/actions/greet.ts'), action);
    fs.writeFileSync(path.join(src, 'content/actions/_helpers/shout.ts'), helper);
    const manifest = { id: 'demo', name: 'Demo', version: '1.0.0', content: { formats: {}, sources: { actions: 'content/actions' } } } as unknown as PackManifest;
    try {
      await compilePack({ packDir: src, outputDir: dist, packConfig: await buildPackConfigFromManifest(manifest, src) });
      const { records } = JSON.parse(fs.readFileSync(path.join(dist, 'actions.content.json'), 'utf-8')) as { records: Array<{ contentHash: string }> };
      return records[0].contentHash;
    } finally {
      fs.rmSync(src, { recursive: true, force: true });
      fs.rmSync(dist, { recursive: true, force: true });
    }
  }

  it('gives the same source the same hash from a different source root and output directory', async () => {
    expect(await hashOf()).toBe(await hashOf());
  });

  it("changes when the action's own body changes", async () => {
    expect(await hashOf(ACTION.replace("'hello'", "'goodbye'"))).not.toBe(await hashOf());
  });

  it('changes when an inlined helper changes, since the hash covers the bundle', async () => {
    expect(await hashOf(ACTION, HELPER.replace('toUpperCase', 'toLowerCase'))).not.toBe(await hashOf());
  });
});
