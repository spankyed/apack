import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { packFixture } from '@apackdev/sdk/testing/pack-fixture';
import { bundlePackRuntime, bundlePackContentCompilers, bundlePackStepBuild } from '../../src/build/be-bundler';
import { bundlePackFE } from '../../src/build/fe-bundler';
import { REPO_ROOT } from '@apackdev/host/build/packages-built';

/** Pack code that imports the app's private @apackdev/host fails `apack pack build`, not the app at load */
const tmpDirs: string[] = [];
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function pack(files: Record<string, string>): string {
  const dir = packFixture({ manifest: { id: 'guard-pack', name: 'Guard' }, files, nodeModules: path.join(REPO_ROOT, 'node_modules') });
  tmpDirs.push(dir);
  return dir;
}

const HOST_IMPORT = "import { edgeStore } from '@apackdev/host/ears';\nexport const registration = { edgeStore };\n";
const HOST_ERROR = /@apackdev\/host\/ears is the app's private host package; packs import @apackdev\/sdk instead/;

describe('apack pack build rejects @apackdev/host imports', () => {
  it('in the backend runtime', async () => {
    const dir = pack({ 'src/__generated__/pack-entry.ts': HOST_IMPORT });
    const result = await bundlePackRuntime(dir, path.join(dir, 'dist'));
    expect(result.success).toBe(false);
    expect(result.error).toMatch(HOST_ERROR);
  });

  it('in step build code and content compiler modules', async () => {
    const dir = pack({ 'src/__generated__/steps-build.ts': HOST_IMPORT, 'src/content/compilers/memos.ts': `${HOST_IMPORT}export default () => [];\n` });
    expect((await bundlePackStepBuild(dir, path.join(dir, 'dist'))).error).toMatch(HOST_ERROR);
    expect((await bundlePackContentCompilers(dir, path.join(dir, 'dist'), { memos: 'src/content/compilers/memos.ts' })).error).toMatch(HOST_ERROR);
  });

  it('in the frontend bundle', async () => {
    const dir = pack({ 'src/entry.ts': "import { registerPackFE } from '@apackdev/host/fe';\nexport default registerPackFE;\n" });
    const result = await bundlePackFE({ packDir: dir, outputDir: path.join(dir, 'dist'), entryPoint: path.join(dir, 'src', 'entry.ts') });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/@apackdev\/host\/fe is the app's private host package/);
  });

  it('rejects an export only the app loads, the elmdb databases', async () => {
    const dir = pack({ 'src/__generated__/pack-entry.ts': "import { openDatabase } from '@elmdb/ears/database';\nexport const registration = { openDatabase };\n" });
    const result = await bundlePackRuntime(dir, path.join(dir, 'dist'));
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/@elmdb\/ears\/database is only for the app[\s\S]*packs can't import it/);
  });

  it('rejects private @apackdev/pack-format and @apackdev/pack-build imports in backend and frontend bundles', async () => {
    const beFormatDir = pack({ 'src/__generated__/pack-entry.ts': "import { parseManifest } from '@apackdev/pack-format';\nexport const registration = { parseManifest };\n" });
    expect((await bundlePackRuntime(beFormatDir, path.join(beFormatDir, 'dist'))).error)
      .toMatch(/@apackdev\/pack-format is a private apack tooling package/);

    const beBuildDir = pack({ 'src/__generated__/pack-entry.ts': "import { compilePack } from '@apackdev/pack-build';\nexport const registration = { compilePack };\n" });
    expect((await bundlePackRuntime(beBuildDir, path.join(beBuildDir, 'dist'))).error)
      .toMatch(/@apackdev\/pack-build is a private apack tooling package/);

    const feFormatDir = pack({ 'src/entry.ts': "import { parseManifest } from '@apackdev/pack-format';\nexport default parseManifest;\n" });
    expect((await bundlePackFE({ packDir: feFormatDir, outputDir: path.join(feFormatDir, 'dist'), entryPoint: path.join(feFormatDir, 'src', 'entry.ts') })).error)
      .toMatch(/@apackdev\/pack-format is a private apack tooling package/);
  });

  it('still bundles pack code that imports @apackdev/sdk', async () => {
    const dir = pack({ 'src/__generated__/pack-entry.ts': "import { findRelations } from '@apackdev/sdk/ears';\nexport const registration = { findRelations };\n" });
    expect(await bundlePackRuntime(dir, path.join(dir, 'dist'))).toEqual({ success: true });
  });
});

/**
 * A package the host shares with pack frontends only is left external, so a backend import of one would build and then
 * fail as the backend loader, which provides none of them, loads the pack. A component imported by path is not that:
 * a definition names one for the renderer, and the backend gets an empty module.
 */
describe('apack pack build rejects frontend-only packages in backend code', () => {
  it('fails the backend runtime that imports one, naming it', async () => {
    const dir = pack({ 'src/__generated__/pack-entry.ts': "import { ref } from 'vue';\nexport const registration = { ref };\n" });
    const result = await bundlePackRuntime(dir, path.join(dir, 'dist'));
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/vue is only for a pack's frontend; backend code can't import it/);
  });

  it('fails a subpath of one too', async () => {
    const dir = pack({ 'src/__generated__/steps-build.ts': "import * as icons from 'lucide-vue-next/dist/esm/icons';\nexport default icons;\n" });
    expect((await bundlePackStepBuild(dir, path.join(dir, 'dist'))).error).toMatch(/lucide-vue-next\/dist\/esm\/icons is only for a pack's frontend/);
  });

  it('still stubs a component a definition names by path', async () => {
    const dir = pack({
      'src/form.vue': '<template><div /></template>\n',
      'src/__generated__/pack-entry.ts': "import form from '../form.vue';\nexport const registration = { form };\n",
    });
    expect(await bundlePackRuntime(dir, path.join(dir, 'dist'))).toEqual({ success: true });
  });
});
