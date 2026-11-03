import fs from 'node:fs';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { createFrontendResourceFixture, readFrontendOutput } from '../_support/frontend-resources.ts';
import { bundlePackFE } from '../../src/build/fe-bundler.ts';
import { createFrontendWatcher } from '../../src/build/frontend-watch.ts';

const DELIVERY_CEILING_MS = 30_000;

const fixture = createFrontendResourceFixture();
const { consumer } = fixture;

it.each([
  ['import.meta.glob("../../pages/**/*.js", { eager: true })', 'pages'],
  ['import.meta.glob([`../../pages/**/*.js`, "!../../pages/excluded/**"], { eager: true })', 'pages'],
  ['import.meta.glob("./**/*.js", { eager: true, base: "../../pages" })', 'pages'],
  ['import.meta.glob("#pages/**/*.js", { eager: true })', 'pages'],
  ['name => import(`../../pages/nested/${name}.js`)', 'pages'],
  ['name => import(`../../pages/nested/new${name}.js`)', 'pages'],
])('watches an initially empty external glob: %s', async (expression, location) => {
  const { pack } = consumer();
  const packageFile = path.join(pack, 'package.json');
  const manifest = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
  manifest.imports = { ...manifest.imports, '#pages/*': './pages/*' };
  fs.writeFileSync(packageFile, JSON.stringify(manifest));
  const directory = path.join(fixture.root, location);
  fs.mkdirSync(directory);
  fs.symlinkSync(directory, path.join(pack, 'pages'), 'dir');
  const entryPoint = path.join(pack, expression.includes('#pages') ? 'canvas.vue' : 'src/canvas.vue');
  fs.writeFileSync(entryPoint, `<script setup>const pages = ${expression};</script><template><div>{{ pages }}</div></template>`);
  const changed = vi.fn();
  const failures: Error[] = [];
  const watcher = createFrontendWatcher(pack, undefined, changed, error => { failures.push(error); });
  let reported: readonly string[] = [];
  const compile = () => {
    const outputDir = path.join(pack, 'dist/runtime');
    fs.rmSync(outputDir, { recursive: true, force: true });
    return bundlePackFE({ packDir: pack, entryPoint, outputDir,
      onInputs: inputs => { reported = inputs.directories; return watcher.observe(inputs).then(() => {}); } });
  };
  try {
    const first = await compile();
    expect(first.success, first.error).toBe(true);
    const before = watcher.snapshot();
    const nested = path.join(directory, 'nested');
    fs.mkdirSync(nested);
    const page = path.join(nested, 'new.js');
    fs.writeFileSync(page, 'export const marker = "NEW_GLOB_PAGE";');
    // A ceiling for an event that never comes: on a loaded Mac one has taken over 1.7 s, and the wait ends when it arrives
    await vi.waitFor(() => expect(changed, JSON.stringify(reported)).toHaveBeenCalled(), { timeout: DELIVERY_CEILING_MS });
    expect(before.current()).toBe(false);
    const second = await compile();
    expect(second.success, second.error).toBe(true);
    expect(readFrontendOutput(pack, '.js')).toContain('NEW_GLOB_PAGE');
    changed.mockClear();
    fs.unlinkSync(page);
    await vi.waitFor(() => expect(changed).toHaveBeenCalled(), { timeout: DELIVERY_CEILING_MS });
    const third = await compile();
    expect(third.success, third.error).toBe(true);
    expect(readFrontendOutput(pack, '.js')).not.toContain('NEW_GLOB_PAGE');
  } finally { await watcher.close(); expect(failures).toEqual([]); }
});

it('leaves explicitly ignored variable imports outside compiler subscriptions', async () => {
  const { pack } = consumer();
  const entryPoint = path.join(pack, 'src/canvas.vue');
  fs.writeFileSync(entryPoint, '<script setup>const load = name => import(/* @vite-ignore */ `../../pages/${name}.js`);</script><template><div>{{ load }}</div></template>');
  let directories: readonly string[] = [];
  const result = await bundlePackFE({ packDir: pack, entryPoint, outputDir: path.join(pack, 'dist/runtime'),
    onInputs: async inputs => { directories = inputs.directories; } });
  expect(result.success, result.error).toBe(true);
  expect(directories).toEqual([]);
});

