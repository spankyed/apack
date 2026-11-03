import fs from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import { createFrontendResourceFixture, externalGlobConsumer, readFrontendOutput } from '../_support/frontend-resources.ts';
import { bundlePackFE } from '../../src/build/fe-bundler.ts';

const fixture = createFrontendResourceFixture();
const { consumer } = fixture;

// What the compiler reports and builds. Delivering a change to a watcher is `frontend-globs.native.spec.ts`.
it.each([
  'import.meta.glob("../../pages/**/*.js", { eager: true })',
  'import.meta.glob([`../../pages/**/*.js`, "!../../pages/excluded/**"], { eager: true })',
  'import.meta.glob("./**/*.js", { eager: true, base: "../../pages" })',
  'import.meta.glob("#pages/**/*.js", { eager: true })',
  'name => import(`../../pages/nested/${name}.js`)',
  'name => import(`../../pages/nested/new${name}.js`)',
])('reports an initially empty external glob as an input, and builds what appears in it: %s', async expression => {
  const { pack, entryPoint, page } = externalGlobConsumer(fixture, expression);
  let reported: readonly string[] = [];
  const compile = () => {
    const outputDir = path.join(pack, 'dist/runtime');
    fs.rmSync(outputDir, { recursive: true, force: true });
    return bundlePackFE({ packDir: pack, entryPoint, outputDir, onInputs: async inputs => { reported = inputs.directories; } });
  };
  const first = await compile();
  expect(first.success, first.error).toBe(true);
  const watched = reported;
  fs.mkdirSync(path.dirname(page));
  fs.writeFileSync(page, 'export const marker = "NEW_GLOB_PAGE";');
  const holdsPage = (directory: string) => !path.relative(fs.realpathSync(directory), fs.realpathSync(page)).startsWith('..');
  expect(watched.some(holdsPage), JSON.stringify(watched)).toBe(true);
  const second = await compile();
  expect(second.success, second.error).toBe(true);
  expect(readFrontendOutput(pack, '.js')).toContain('NEW_GLOB_PAGE');
  fs.unlinkSync(page);
  const third = await compile();
  expect(third.success, third.error).toBe(true);
  expect(readFrontendOutput(pack, '.js')).not.toContain('NEW_GLOB_PAGE');
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

