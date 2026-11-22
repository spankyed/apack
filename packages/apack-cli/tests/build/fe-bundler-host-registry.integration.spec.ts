import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { packFixture } from '@apackdev/sdk/testing/pack-fixture';
import { population } from '@apackdev/sdk/testing';
import { bundlePackFE } from '../../src/build/fe-bundler';
import { bundleExternals } from '../_support/pack-builds';
import { PACKAGES_BUILT, REPO_ROOT, installPublishedPackages } from '@app/internal-publish-checks';

const SDK_SOURCE = path.join(REPO_ROOT, 'packages', 'apack-sdk');
const UI_SOURCE = path.join(REPO_ROOT, 'packages', 'apack-ui');
let installed: string | undefined;

const LAYOUTS = [
  // A pack resolves the packages' published dist whether they are linked from the workspace or installed
  { name: 'workspace install', sdkDir: () => SDK_SOURCE, uiDir: () => UI_SOURCE, ext: 'js' },
  ...(PACKAGES_BUILT ? [{
    name: 'published package',
    sdkDir: () => path.join(installed!, 'node_modules', '@apackdev', 'sdk'),
    uiDir: () => path.join(installed!, 'node_modules', '@apackdev', 'ui'),
    ext: 'js',
  }] : []),
];

beforeAll(() => {
  if (PACKAGES_BUILT) installed = installPublishedPackages();
});

afterAll(() => {
  if (installed) fs.rmSync(installed, { recursive: true, force: true });
});

const tmpDirs: string[] = [];

function makePack(layout: { sdkDir: () => string; uiDir: () => string }, entrySource: string, manifest: Record<string, unknown> = {}): { packDir: string; entry: string } {
  // Its own `node_modules/@apackdev/*` link tree, so the fixture writes the pack and this links the packages. A pack
  // names the SDK and not EARS, which it reaches as its SDK's dependency
  const packDir = packFixture({ manifest: { id: 'fixture-pack', name: 'Fixture', ...manifest } });
  tmpDirs.push(packDir);
  fs.mkdirSync(path.join(packDir, 'node_modules', '@apackdev'), { recursive: true });
  fs.symlinkSync(layout.sdkDir(), path.join(packDir, 'node_modules', '@apackdev', 'sdk'), 'dir');
  fs.symlinkSync(layout.uiDir(), path.join(packDir, 'node_modules', '@apackdev', 'ui'), 'dir');
  const entry = path.join(packDir, 'src', 'entry.ts');
  fs.writeFileSync(entry, entrySource);
  return { packDir, entry };
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe.each(LAYOUTS)('bundlePackFE host binding guard ($name)', (layout) => {
  it('fails when pack FE code inlines an SDK module that needs the host binding', async () => {
    const { packDir, entry } = makePack(layout,
      // onLog needs the bound app (createLogger alone doesn't: unbound, it writes to the console)
      `import { onLog } from '@apackdev/sdk/logger';\nexport const subscribe = onLog;\n`,
    );

    const result = await bundlePackFE({ packDir, outputDir: path.join(packDir, 'dist'), entryPoint: entry });

    expect(result.success).toBe(false);
    expect(result.error).toContain('No host is bound');
    expect(result.error).toContain('Import chain: src/entry.ts → @apackdev/sdk/logger');
  });

  it('records release bundle origins without embedding source text or a map reference', async () => {
    const { packDir, entry } = makePack(layout, 'export const value = 42;');
    const outputDir = path.join(packDir, 'dist');
    const result = await bundlePackFE({ packDir, outputDir, entryPoint: entry, release: true });

    expect(result.success, result.error).toBe(true);
    const map = JSON.parse(fs.readFileSync(path.join(outputDir, 'fe.js.map'), 'utf8'));
    expect(map.sources).toEqual(expect.arrayContaining([expect.stringMatching(/entry\.ts$/)]));
    expect(map.sourcesContent?.some(Boolean) ?? false).toBe(false);
    expect(fs.readFileSync(path.join(outputDir, 'fe.js'), 'utf8')).not.toContain('sourceMappingURL');
  });

  it('uses the host\'s @apackdev/ui instead of bundling it', async () => {
    const { packDir, entry } = makePack(layout, [
      "import TiptapEditor from '@apackdev/ui/components/tiptap/TiptapEditor';",
      "import { useDebounce } from '@apackdev/ui/composables/useDebounce';",
      'export const ui = { TiptapEditor, useDebounce };',
    ].join('\n'));

    const result = await bundlePackFE({ packDir, outputDir: path.join(packDir, 'dist'), entryPoint: entry });

    expect(result.error).toBeUndefined();
    const output = fs.readFileSync(path.join(packDir, 'dist', 'fe.js'), 'utf-8');
    // Left for the host to resolve, which is what gives the pack the app's instance
    expect(await bundleExternals(path.join(packDir, 'dist', 'fe.js'))).toEqual(
      expect.arrayContaining(['@apackdev/ui/components/tiptap/TiptapEditor', '@apackdev/ui/composables/useDebounce']));
    // No UI code: the editor's extensions, its styles or the debounce implementation
    expect(output).not.toMatch(/createExtensions|ProseMirror|clearTimeout/);
  });

  it('bundles @apackdev/ui with build.bundleUi and still leaves the shared SDK modules it imports to the host', async () => {
    const { packDir, entry } = makePack(layout,
      `import { createEditorClickHandler } from '@apackdev/ui/components/tiptap/composables/createEditorClickHandler';\n` +
      `export const handler = createEditorClickHandler({ noteLinkClick() {}, imageClick() {} });\n`,
      { build: { bundleUi: true } },
    );

    const result = await bundlePackFE({ packDir, outputDir: path.join(packDir, 'dist'), entryPoint: entry });

    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
    const output = fs.readFileSync(path.join(packDir, 'dist', 'fe.js'), 'utf-8');
    expect(await bundleExternals(path.join(packDir, 'dist', 'fe.js'))).toContain('@apackdev/sdk/fe');
    expect(output).toContain('createEditorClickHandler');
  });

  it("uses the host's ProseMirror and tiptap menus when a pack bundles @apackdev/ui", async () => {
    const { packDir, entry } = makePack(layout,
      "import TiptapEditor from '@apackdev/ui/components/tiptap/TiptapEditor';\nexport default TiptapEditor;\n",
      { build: { bundleUi: true } },
    );

    const result = await bundlePackFE({ packDir, outputDir: path.join(packDir, 'dist'), entryPoint: entry });

    expect(result.error).toBeUndefined();
    const output = fs.readFileSync(path.join(packDir, 'dist', 'fe.js'), 'utf-8');
    expect(await bundleExternals(path.join(packDir, 'dist', 'fe.js'))).toEqual(
      expect.arrayContaining(['@tiptap/pm/state', '@tiptap/vue-3/menus']));
    // prosemirror-model's own code (its content-expression error) isn't inlined
    expect(output).not.toContain('Invalid content for node');
  });

  it.each([
    { bundleUi: true, packConfig: false, generated: true },
    { bundleUi: true, packConfig: true, generated: true },
    { bundleUi: false, packConfig: false, generated: false },
  ])('generates the Tailwind classes @apackdev/ui components use (bundleUi: $bundleUi, own tailwind config: $packConfig)', async ({ bundleUi, packConfig, generated }) => {
    const { packDir, entry } = makePack(layout,
      "import TiptapEditor from '@apackdev/ui/components/tiptap/TiptapEditor';\nexport default TiptapEditor;\n",
      { build: { bundleUi } },
    );
    if (packConfig) {
      fs.writeFileSync(path.join(packDir, 'tailwind.config.js'), `export default { content: ['${packDir}/src/**/*.ts'] };\n`);
    }

    const result = await bundlePackFE({ packDir, outputDir: path.join(packDir, 'dist'), entryPoint: entry });

    expect(result.error).toBeUndefined();
    const css = fs.readdirSync(path.join(packDir, 'dist')).filter((f) => f.endsWith('.css'))
      .map((f) => fs.readFileSync(path.join(packDir, 'dist', f), 'utf-8')).join('\n');
    // A class only @apackdev/ui templates use (TiptapSearchBar's input), not the pack's
    expect(css.includes('.placeholder-neutral-500::')).toBe(generated);
  });

  it('compiles no @apackdev/ui SFC when a pack bundles @apackdev/ui', async () => {
    const { packDir, entry } = makePack(layout,
      "import TiptapEditor from '@apackdev/ui/components/tiptap/TiptapEditor';\nexport default TiptapEditor;\n",
      { build: { bundleUi: true } },
    );

    const result = await bundlePackFE({ packDir, outputDir: path.join(packDir, 'dist'), entryPoint: entry });

    expect(result.error).toBeUndefined();
    const { sources } = JSON.parse(fs.readFileSync(path.join(packDir, 'dist', 'fe.js.map'), 'utf-8')) as { sources: string[] };
    const uiSources = sources.filter((source) => source.includes('@apackdev/ui/') || source.includes('apack-ui/'));
    population('@apackdev/ui sources in the pack bundle', uiSources);
    // @apackdev/ui ships compiled components, and a pack reads those whichever way it has the package
    expect(uiSources.filter((source) => /\.vue(\?|$)/.test(source))).toEqual([]);
  });

  it('drops the generated EARS facade from FE code that only uses the EARS constants', async () => {
    const { packDir, entry } = makePack(layout, `import { EARS } from './ears';\nexport const kind = EARS.Entity.Memo;\n`);
    // Shape of #generated/ears: the EARS namespace plus the pure typed-helpers factory call
    fs.writeFileSync(path.join(packDir, 'src', 'ears.ts'), [
      "export namespace EARS { export namespace Entity { export const Memo = 'Memo'; } }",
      "import { defineEars, type UntypedSchema } from '@apackdev/sdk/ears';",
      "export const { query, newId } = /*#__PURE__*/ defineEars<UntypedSchema & { shapes: { Memo: { text: string } } }>();",
    ].join('\n'));

    const result = await bundlePackFE({ packDir, outputDir: path.join(packDir, 'dist'), entryPoint: entry });

    expect(result.error, result.error).toBeUndefined();
    const output = fs.readFileSync(path.join(packDir, 'dist', 'fe.js'), 'utf-8');
    expect(output).not.toContain('defineEars');
    expect(output).toContain('Memo');
  });

  it('builds when SDK imports are left to the host', async () => {
    const { packDir, entry } = makePack(layout,
      `import { bindFeHost } from '@apackdev/sdk/runtime';\nimport { compareVersions } from '@apackdev/sdk/utils/pure';\n` +
      // What #generated/events imports: a pack's frontend sends through the host's transport
      `import { defineEvents } from '@apackdev/sdk/events';\n` +
      `export const x = [bindFeHost, compareVersions, defineEvents({})];\n`,
    );

    const result = await bundlePackFE({ packDir, outputDir: path.join(packDir, 'dist'), entryPoint: entry });

    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
    expect(await bundleExternals(path.join(packDir, 'dist', 'fe.js'))).toEqual(
      expect.arrayContaining(['@apackdev/sdk/runtime', '@apackdev/sdk/events']));
  });
});
