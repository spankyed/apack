import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { createFrontendResourceFixture, readFrontendOutput } from '../_support/frontend-resources.ts';
import { readPackBuild } from '@apackdev/host/packs';
import { WATCH_REBUILD_BUDGET_MS, type TestPackBuildWatcher } from '../_support/watch-builds.ts';
import { shareCompilerInstallation } from '../_support/shared-compiler.ts';
import { cpuBudget } from '@apackdev/testing/vitest';
import { settles } from '@apackdev/sdk/testing/waiting';

const sharedCompiler = shareCompilerInstallation();

// The live-watcher half of the frontend resource cases: the same fixture as frontend-resources.integration.spec.ts
const fixture = createFrontendResourceFixture({ captureCompiler: sharedCompiler.capture });
const { consumer } = fixture;

describe('CSS dependency watching', () => {
  let pack: string;
  let stylesheet: string;
  let leaf: string;
  let publications: number;
  let errors: MockInstance<typeof console.error>;
  let watcher: TestPackBuildWatcher;

  beforeEach(async () => {
    ({ pack } = consumer());
    stylesheet = path.join(fixture.root, 'outside.css');
    leaf = path.join(fixture.root, 'theme.css');
    fs.writeFileSync(stylesheet, '@import "./theme.css";');
    fs.writeFileSync(leaf, '.theme { color: #123456; }');
    fs.appendFileSync(path.join(pack, 'src/canvas.vue'), '<style src="../../outside.css"></style>');
    errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    publications = 0;
    watcher = await fixture.startWatcher(pack, { place: { env: 'test', userDataDir: path.join(fixture.root, 'profile') },
      onBuilt: async () => { publications++; } });
  });

  it('recovers a missing nested stylesheet while retaining the accepted build', { meta: cpuBudget(3 * WATCH_REBUILD_BUDGET_MS + 20_000) }, async () => {
    const css = () => fs.readFileSync(path.join(pack, 'dist/runtime/fe.css'), 'utf8');
    const replacement = path.join(fixture.root, 'replacement.css');
    await watcher.rebuildAfter(() => {
      fs.writeFileSync(replacement, '.theme { color: #654321; }');
      fs.renameSync(replacement, leaf);
    });
    await settles(() => expect(publications > 0 || errors.mock.calls.length > 0).toBe(true));
    expect(errors.mock.calls).toEqual([]);
    expect(css()).toContain('#654321');
    const accepted = readPackBuild(path.join(pack, 'dist')).revision;
    const count = publications;
    await watcher.rebuildAfter(() => { fs.writeFileSync(stylesheet, '@import "./future/theme.css";'); });
    await settles(() => expect(errors).toHaveBeenCalledWith(expect.stringContaining('Build/reload failed')));
    expect(publications).toBe(count);
    expect(readPackBuild(path.join(pack, 'dist')).revision).toBe(accepted);
    await watcher.rebuildAfter(() => {
      fs.mkdirSync(path.join(fixture.root, 'future'));
      fs.writeFileSync(path.join(fixture.root, 'future/theme.css'), '.theme { color: #abcdef; }');
    });
    await settles(() => expect(publications).toBeGreaterThan(count));
    expect(css()).toContain('#abcdef');
  });
});

it.each(['css-url', 'template'] as const)('watches an external %s asset in a separate directory', { meta: cpuBudget(120_000 + WATCH_REBUILD_BUDGET_MS + 20_000) }, async kind => {
  if (kind === 'template') vi.stubEnv('APACK_NO_BUILD_READS', '1');
  const { pack } = consumer();
  const assets = path.join(fixture.root, 'assets');
  fs.mkdirSync(assets);
  const asset = path.join(assets, 'image.svg');
  fs.writeFileSync(asset, '<svg xmlns="http://www.w3.org/2000/svg"><text>BEFORE</text></svg>');
  const canvas = path.join(pack, 'src/canvas.vue');
  if (kind === 'template') fs.writeFileSync(canvas, '<template><img src="../../assets/image.svg?no-inline" /></template>');
  else {
    fs.mkdirSync(path.join(fixture.root, 'styles'));
    fs.writeFileSync(path.join(fixture.root, 'styles/main.css'), '.image { background: url("../assets/image.svg?no-inline"); }');
    fs.appendFileSync(canvas, '<style src="../../styles/main.css"></style>');
  }
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  let watcher: TestPackBuildWatcher | undefined;
  let publications = 0;
  try {
    watcher = await fixture.startWatcher(pack, { place: { env: 'test', userDataDir: path.join(fixture.root, 'profile') },
      onBuilt: async () => { publications++; } });
    expect(readFrontendOutput(pack, '.svg')).toContain('BEFORE');
    if (kind === 'template') expect(fs.existsSync(path.join(pack, '.apack/reads.json'))).toBe(false);
    await watcher.rebuildAfter(() => { fs.writeFileSync(asset, '<svg xmlns="http://www.w3.org/2000/svg"><text>AFTERX</text></svg>'); });
    await settles(() => expect(publications > 0 || errors.mock.calls.length > 0).toBe(true));
    expect(errors.mock.calls).toEqual([]);
    expect(readFrontendOutput(pack, '.svg')).toContain('AFTERX');
    expect(readFrontendOutput(pack, '.svg')).not.toContain('BEFORE');
  } finally { await watcher?.close(); }
});

it('watches initially empty external Tailwind content through nested directory links', { meta: cpuBudget(120_000 + 2 * WATCH_REBUILD_BUDGET_MS + 20_000) }, async () => {
  const { pack } = consumer();
  const content = path.join(fixture.root, 'content');
  const sources = path.join(fixture.root, 'sources');
  fs.mkdirSync(content);
  fs.mkdirSync(sources);
  fs.symlinkSync(sources, path.join(content, 'linked'), 'dir');
  const authored = path.join(pack, 'templates');
  fs.mkdirSync(authored);
  fs.writeFileSync(path.join(authored, 'page.html'), '<div class="text-indigo-500" />');
  fs.writeFileSync(path.join(pack, 'tailwind.config.js'), `export default { content: [${JSON.stringify(`${content}/**/*.html`)}] };`);
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  let watcher: TestPackBuildWatcher | undefined;
  let publications = 0;
  try {
    watcher = await fixture.startWatcher(pack, { place: { env: 'test', userDataDir: path.join(fixture.root, 'profile') },
      onBuilt: async () => { publications++; } });
    expect(readFrontendOutput(pack, '.css')).not.toContain('.text-orange-500');
    expect(readFrontendOutput(pack, '.css')).not.toContain('.text-indigo-500');
    await watcher.rebuildAfter(() => {
      fs.mkdirSync(path.join(sources, 'nested'));
      fs.writeFileSync(path.join(sources, 'nested/page.html'), '<div class="text-orange-500" />');
    });
    await settles(() => expect(publications > 0 || errors.mock.calls.length > 0).toBe(true));
    expect(errors.mock.calls).toEqual([]);
    expect(readFrontendOutput(pack, '.css')).toContain('.text-orange-500');
    const count = publications;
    const replacement = path.join(fixture.root, 'replacement');
    await watcher.rebuildAfter(() => {
      fs.symlinkSync(authored, replacement, 'dir');
      fs.renameSync(replacement, path.join(content, 'linked'));
    });
    await settles(() => {
      expect(publications).toBeGreaterThan(count);
      expect(readFrontendOutput(pack, '.css')).toContain('.text-indigo-500');
    });
    expect(errors.mock.calls).toEqual([]);
    expect(readFrontendOutput(pack, '.css')).not.toContain('.text-orange-500');
  } finally { await watcher?.close(); }
});
