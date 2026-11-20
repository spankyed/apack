/**
 * **What a pack's frontend bundle leaves to the host, which is how the two share one instance of a module.**
 *
 * A pack must use *this app's* Vue, SDK and UI kit: two copies of Vue are two reactivity systems and a
 * component that never updates, two copies of the SDK a second, empty registry. The bundle achieves that by
 * *not* resolving those specifiers — it emits the bare name, and the document's import map resolves it to
 * the host's module (`hostSharedModulesPlugin`, `packages/renderer/vite.config.ts`).
 *
 * So the claim here is about resolution, and it is the one the mechanism rests on. It replaces 69 cases that
 * compared a generated proxy's export names against the module's real ones: those policed one mechanism
 * against the other, and with the proxies gone there is no second list to disagree.
 *
 * The case that would catch this going wrong is the third — every specifier the bundle leaves bare is one
 * the host's map names. A specifier left bare that the host does not serve is a frontend that does not load.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { packFixture } from '@apackdev/sdk/testing/pack-fixture';
import { sharedFeModules } from '@apackdev/host/build/shared-deps';
import { bundlePackFE } from '../../src/build/fe-bundler';
import { REPO_ROOT } from '@apackdev/host/build/packages-built';
import { bundleExternals } from '../_support/pack-builds';

const tmpDirs: string[] = [];
afterEach(() => { for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

/** One specifier from each population the host shares, and one it deliberately does not */
const ENTRY = [
  "export { ref } from 'vue';",                                              // a third-party dep
  "export { useSurface } from '@apackdev/sdk/fe';",                             // an SDK frontend module
  "export { useDebounce } from '@apackdev/ui/composables/useDebounce';",       // a UI kit module
  "export { b64Encode } from '@elmdb/ears';",                               // NOT shared: the renderer keeps no EARS data
].join('\n');

async function buildFE(manifest: Record<string, unknown> = {}, entrySource = ENTRY): Promise<string[]> {
  const packDir = packFixture({
    manifest: { id: 'externals-pack', name: 'Externals', ...manifest },
    nodeModules: path.join(REPO_ROOT, 'node_modules'),
  });
  tmpDirs.push(packDir);
  const entry = path.join(packDir, 'src', 'entry.ts');
  fs.writeFileSync(entry, `${entrySource}\n`);

  const result = await bundlePackFE({ packDir, outputDir: path.join(packDir, 'dist'), entryPoint: entry });
  expect(result.error, 'the fixture pack did not build, so nothing below is about externals').toBeUndefined();
  return bundleExternals(path.join(packDir, 'dist', 'fe.js'));
}

it('leaves a specifier from every population the host shares', async () => {
  const externals = await buildFE();

  expect(externals).toContain('vue');
  expect(externals).toContain('@apackdev/sdk/fe');
  expect(externals).toContain('@apackdev/ui/composables/useDebounce');
});

// The mutation on the same bundle: a specifier the host does *not* share must be inlined, or the three
// cases above would pass over a bundler that externalised everything and loaded none of it.
it('inlines what the host does not share', async () => {
  const externals = await buildFE();

  expect(externals, '@elmdb/ears is inlined on the frontend: the renderer keeps no EARS data to share')
    .not.toContain('@elmdb/ears');
  expect(fs.existsSync(path.join(REPO_ROOT, 'node_modules', '@elmdb', 'ears', 'package.json'))).toBe(true);
});

// The one that catches this going wrong. A specifier left bare that the host's map does not name is a pack
// frontend that fails to load, and nothing between here and a running app would say so.
it('leaves bare only specifiers the host publishes a module for', async () => {
  const served = sharedFeModules(path.join(REPO_ROOT, 'packages', 'renderer'));
  const externals = await buildFE();

  expect(externals.length).toBeGreaterThan(0);
  for (const specifier of externals) {
    expect(served, `the bundle leaves ${specifier} to the host, which serves no module for it`).toHaveProperty([specifier]);
  }
});

// build.bundleUi is the opt-out, and it opts out of @apackdev/ui alone: a pack carrying its own UI kit still has
// to share ProseMirror and tiptap's Vue menus, which is where "two ProseMirror instances" actually comes from.
it('inlines @apackdev/ui with build.bundleUi, and still shares what @apackdev/ui depends on', async () => {
  const externals = await buildFE({ build: { bundleUi: true } }, [
    "export { useDebounce } from '@apackdev/ui/composables/useDebounce';",
    "export { EditorState } from '@tiptap/pm/state';",
  ].join('\n'));

  expect(externals).not.toContain('@apackdev/ui/composables/useDebounce');
  expect(externals).toContain('@tiptap/pm/state');
});
