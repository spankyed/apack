import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { expect, it, vi } from 'vitest';
import { createFrontendResourceFixture, readFrontendOutput } from '../_support/frontend-resources.ts';
import { callCli } from '../_support/pack-builds.ts';
import { bundlePackFE } from '../../src/build/fe-bundler.ts';
import { createBuildOutputs } from '../../src/build/build-outputs.ts';
import { captureCompilationInputs } from '../../src/build/compilation-inputs.ts';
import { cpuBudget } from '@apackdev/testing/vitest';

const fixture = createFrontendResourceFixture();
const { consumer } = fixture;
let inputWorkspace: string | undefined;

it.each(['unchanged', 'edited'] as const)('uses one input view across frontend compiler paths with %s originals', async mode => {
  const { pack, helper } = consumer();
  const require = createRequire(import.meta.url);
  const vite = createRequire(require.resolve('vite/package.json'));
  fs.symlinkSync(path.dirname(vite.resolve('sass')), path.join(fixture.root, 'node_modules/sass'), 'dir');
  const files: Record<string, string> = {
    'src/frontend-entry.ts': `export {default} from './canvas.vue';`,
    'src/canvas.vue': `<script setup lang="ts">
      import {marker} from 'borrowed';
      const source = 'SOURCE_CAPTURED';
      const lazy = () => import('./lazy.ts');
      const worker = () => new Worker(new URL('./worker.ts', import.meta.url), {type: 'module'});
      const gathered = import.meta.glob('./items/*.ts', {eager: true});
      </script><template><div class="text-proof" @click="lazy">{{marker}}{{source}}{{gathered}}
      <button @click="worker">Launch</button><img src="./image.svg?no-inline" /></div></template>
      <style src="./style.css"></style><style lang="scss">@use './values.scss'; .sass-proof {content: values.$label;}</style>`,
    'src/lazy.ts': `export const marker = 'LAZY_CAPTURED';`,
    'src/worker.ts': `self.postMessage('WORKER_CAPTURED');`,
    'src/items/first.ts': `export const marker = 'GLOB_CAPTURED';`,
    'src/image.svg': '<svg xmlns="http://www.w3.org/2000/svg"><text>SVG_CAPTURED</text></svg>',
    'src/style.css': `@import './leaf.css'; .proof {background: url('./image.svg?no-inline');}`,
    'src/leaf.css': `.proof::after {content: 'STYLE_CAPTURED';}`,
    'src/values.scss': `$label: 'SASS_CAPTURED';`,
    'tailwind.config.ts': `import colors from './config-origin.cjs'; export default {content: [${JSON.stringify(path.join(pack, 'src/**/*.vue'))}], theme: {extend: {colors: {proof: colors.value}}}};`,
    'config-origin.cjs': `if (__dirname !== ${JSON.stringify(fs.realpathSync(pack))}) throw new Error('Expected original config source directory: ' + __dirname); module.exports = {value: '#123456'};`,
  };
  const write = (file: string, body: string) => {
    fs.mkdirSync(path.dirname(path.join(pack, file)), { recursive: true });
    fs.writeFileSync(path.join(pack, file), body);
  };
  for (const [file, body] of Object.entries(files)) write(file, body);
  fs.writeFileSync(helper, `export const marker = 'DEPENDENCY_CAPTURED';`);
  const outputDir = path.join(pack, 'dist/runtime');
  // Tailwind's Jiti instance retains this cache path across files in the same worker, so the run removes it
  const workspace = inputWorkspace ??= fs.realpathSync(fs.mkdtempSync(path.join(process.env.APACK_TEST_RUN_DIRECTORY ?? os.tmpdir(), 'apack-frontend-inputs-')));
  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(path.join(workspace, 'tmp'), { recursive: true });
  vi.stubEnv('APACK_BUILD_INPUTS_DIRECTORY', workspace);
  vi.stubEnv('TMPDIR', path.join(workspace, 'tmp'));
  const compilation = captureCompilationInputs(pack);
  try {
    if (mode === 'edited') {
      for (const [file, body] of Object.entries(files)) write(file, body.replaceAll('_CAPTURED', '_LIVE').replace('#123456', '#654321'));
      fs.writeFileSync(helper, `export const marker = 'DEPENDENCY_LIVE';`);
    }
    const result = await bundlePackFE({ packDir: pack, outputDir, entryPoint: path.join(pack, 'src/frontend-entry.ts'), compilation });
    expect(result.success, result.error).toBe(true);
    const output = ['.js', '.css', '.svg'].map(extension => readFrontendOutput(pack, extension)).join('\n');
    for (const marker of ['SOURCE', 'STYLE', 'SVG', 'LAZY', 'WORKER', 'GLOB', 'SASS']) {
      expect(output, marker).toContain(`${marker}_CAPTURED`);
      expect(output, marker).not.toContain(`${marker}_LIVE`);
    }
    // A dependency file becomes an input at its first read, which here follows the edit: the bytes on disk compile
    const dependency = mode === 'edited' ? 'DEPENDENCY_LIVE' : 'DEPENDENCY_CAPTURED';
    expect(output, 'DEPENDENCY').toContain(dependency);
    expect(readFrontendOutput(pack, '.css')).toContain('18 52 86');
    expect(output).not.toContain('apack-inputs-');
    if (mode === 'unchanged') expect(() => compilation.assertCurrent()).not.toThrow();
    else expect(() => compilation.assertCurrent()).toThrow('Compiler or installed package inputs changed');
  } finally { compilation.dispose(); }
});

it('copies public assets from the accepted input view instead of changed live files', async () => {
  const { pack } = consumer();
  const asset = path.join(pack, 'public', 'proof.txt');
  fs.mkdirSync(path.dirname(asset), { recursive: true });
  fs.writeFileSync(asset, 'CAPTURED');
  fs.chmodSync(asset, 0o666);
  fs.writeFileSync(path.join(pack, 'public/fe.js'), '// public placeholder overwritten by the bundle');
  const compilation = captureCompilationInputs(pack);
  try {
    fs.writeFileSync(asset, 'LIVE');
    const outputDir = path.join(pack, 'dist/runtime');
    const outputs = createBuildOutputs(outputDir);
    const result = await bundlePackFE({ packDir: pack, outputDir, entryPoint: path.join(pack, 'src/canvas.vue'), compilation, recordOutput: outputs.record });
    expect(() => outputs.assertCurrent()).not.toThrow();
    expect(result.success, result.error).toBe(true);
    expect(fs.readFileSync(path.join(outputDir, 'proof.txt'), 'utf8')).toBe('CAPTURED');
    if (process.platform !== 'win32') expect(fs.statSync(path.join(outputDir, 'proof.txt')).mode & 0o777).toBe(0o666);
    expect(fs.readFileSync(path.join(outputDir, 'fe.js'), 'utf8')).not.toContain('public placeholder');
    expect(() => compilation.assertCurrent()).toThrow('Compiler or installed package inputs changed');
  } finally { compilation.dispose(); }
});

it('rebuilds Vue styles after only an external stylesheet changes', { meta: cpuBudget(2 * 60_000 + 20_000) }, async () => {
  const { pack } = consumer();
  const stylesheet = path.join(fixture.root, 'outside.css');
  fs.writeFileSync(stylesheet, '.outside { color: #123456; }');
  const canvas = path.join(pack, 'src/canvas.vue');
  fs.appendFileSync(canvas, '<style src="../../outside.css"></style>');
  const first = await callCli(pack, 'build');
  expect(first.code, first.output).toBe(0);
  const css = path.join(pack, 'dist/runtime/fe.css');
  expect(fs.readFileSync(css, 'utf8')).toContain('#123456');
  fs.writeFileSync(stylesheet, '.outside { color: #654321; }');
  const second = await callCli(pack, 'build');
  expect(second.code, second.output).toBe(0);
  expect(fs.readFileSync(css, 'utf8')).toContain('#654321');
  expect(fs.readFileSync(css, 'utf8')).not.toContain('#123456');
});

it.each(['css-import', 'css-url', 'template'] as const)('compiles changed external %s resources with unchanged authored sources', async kind => {
  const { pack } = consumer();
  const resource = path.join(fixture.root, kind === 'css-import' ? 'theme.css' : 'image.svg');
  const before = kind === 'css-import' ? '.theme { color: #123456; }'
    : '<svg xmlns="http://www.w3.org/2000/svg"><text>BEFORE</text></svg>';
  const after = kind === 'css-import' ? '.theme { color: #654321; }'
    : '<svg xmlns="http://www.w3.org/2000/svg"><text>AFTERX</text></svg>';
  fs.writeFileSync(resource, before);
  const canvas = path.join(pack, 'src/canvas.vue');
  if (kind === 'template') fs.writeFileSync(canvas, '<template><img src="../../image.svg?no-inline" /></template>');
  else {
    const stylesheet = path.join(fixture.root, 'outside.css');
    fs.writeFileSync(stylesheet, kind === 'css-import' ? '@import "./theme.css";'
      : '.image { background: url("./image.svg?no-inline"); }');
    fs.appendFileSync(canvas, '<style src="../../outside.css"></style>');
  }
  const compile = async () => {
    const outputDir = path.join(pack, 'dist/runtime');
    fs.rmSync(outputDir, { recursive: true, force: true });
    const result = await bundlePackFE({ packDir: pack, outputDir, entryPoint: canvas });
    expect(result.success, result.error).toBe(true);
  };
  await compile();
  expect(readFrontendOutput(pack, kind === 'css-import' ? '.css' : '.svg')).toContain(kind === 'css-import' ? '#123456' : 'BEFORE');
  fs.writeFileSync(resource, after);
  await compile();
  expect(readFrontendOutput(pack, kind === 'css-import' ? '.css' : '.svg')).toContain(kind === 'css-import' ? '#654321' : 'AFTERX');
  expect(readFrontendOutput(pack, kind === 'css-import' ? '.css' : '.svg')).not.toContain(kind === 'css-import' ? '#123456' : 'BEFORE');
});
