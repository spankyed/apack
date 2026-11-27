import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '@apackdev/host/build/packages-built';
import { preparePack, packageJson, tsconfig } from './pack-builds.ts';

export function runtimePack(root: string) {
  const modules = path.join(root, 'node_modules');
  fs.mkdirSync(modules);
  for (const name of ['@apackdev']) {
    fs.symlinkSync(path.join(REPO_ROOT, 'node_modules', name), path.join(modules, name), 'dir');
  }
  const library = path.join(modules, 'borrowed');
  fs.mkdirSync(library);
  fs.writeFileSync(path.join(library, 'package.json'), JSON.stringify({ name: 'borrowed', version: '1.0.0',
    type: 'module', exports: { '.': { types: './index.d.ts', default: './index.js' } } }));
  fs.writeFileSync(path.join(library, 'index.d.ts'), 'export declare const marker: string;');
  fs.writeFileSync(path.join(library, 'index.js'), "export { marker } from './helper.js';");
  const helper = path.join(library, 'helper.js');
  fs.writeFileSync(helper, "export const marker = 'BEFORE';");
  const pack = preparePack(root, 'runtime-consumer', {
    'apack.json': JSON.stringify({ id: 'runtime-consumer', name: 'Runtime Consumer', version: '1.0.0',
      features: { view: { description: 'Imported runtime value.', surface: { label: 'View', state: 'src/surface.ts' } } } }),
    'package.json': packageJson('runtime-consumer'), 'tsconfig.json': tsconfig,
    'src/surface.ts': "import { state } from '@apackdev/state'; import { marker } from 'borrowed'; export default state<{ data: { marker: typeof marker } }>()({ data: { marker } });",
  }, modules);
  return { pack, helper, frontend: path.join(pack, 'dist/runtime/fe.js') };
}

export function vueRuntimePack(root: string, kind: 'inline' | 'external' | 'linked' = 'inline') {
  const consumer = runtimePack(root);
  const { pack } = consumer;
  fs.writeFileSync(path.join(pack, 'src/surface.ts'), "import { state } from '@apackdev/state'; export default state()({});");
  const script = kind === 'external' ? '<script src="../../outside.ts" lang="ts"></script>'
    : '<script setup lang="ts">import { marker } from "borrowed";</script>';
  if (kind === 'external') fs.writeFileSync(path.join(root, 'outside.ts'), "import { marker } from 'borrowed'; export default { data: () => ({ marker }) };");
  const canvas = path.join(pack, 'src/canvas.vue');
  if (kind === 'linked') {
    const component = path.join(root, 'canvas.vue');
    consumer.helper = path.join(root, 'outside-value.ts');
    fs.writeFileSync(consumer.helper, "export const marker = 'BEFORE';");
    fs.writeFileSync(component, '<script setup lang="ts">import { marker } from "./outside-value.ts";</script><template><div>{{ marker }}</div></template>');
    fs.symlinkSync(component, path.join(pack, 'src/linked.vue'));
    fs.writeFileSync(canvas, '<script setup lang="ts">import Linked from "./linked.vue";</script><template><Linked /></template>');
  } else fs.writeFileSync(canvas, `${script}<template><div>{{ marker }}</div></template>`);
  const manifestFile = path.join(pack, 'apack.json');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  manifest.features.view.surface.canvas = 'src/canvas.vue';
  fs.writeFileSync(manifestFile, JSON.stringify(manifest));
  return consumer;
}
