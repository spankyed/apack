import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { REPO_ROOT } from '@apackdev/host/build/packages-built';
import { componentContracts } from '../../../scripts/component-contracts.ts';
import { execFileWhileWorking } from '@apackdev/sdk/progress';

const execFileAsync = execFileWhileWorking;

/**
 * scripts/component-contracts.ts: the contract report behind etc/<entry>.component.md. The fixture
 * goes through vue-tsc, so this also pins what the script assumes of vue-tsc's emitted shape — the
 * assumption that would otherwise break silently, reporting a component as having no props.
 */

let root: string;
let typesDir: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'component-contracts-'));
  typesDir = path.join(root, '.temp', 'api-types');
  fs.mkdirSync(typesDir, { recursive: true });
  // vue, typescript and vue-tsc resolve from the repo's install
  fs.symlinkSync(path.join(REPO_ROOT, 'node_modules'), path.join(root, 'node_modules'), 'dir');
  write('package.json', JSON.stringify({ name: '@fixture/ui', version: '0.0.0', type: 'module' }));
  write('tsconfig.json', JSON.stringify({
    compilerOptions: {
      target: 'ES2022', module: 'esnext', moduleResolution: 'bundler', strict: true,
      skipLibCheck: true, declaration: true, emitDeclarationOnly: true,
      lib: ['ES2022', 'DOM'], types: [],
    },
    include: ['src/**/*.ts', 'src/**/*.vue'],
  }));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function write(file: string, content: string): void {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), content);
}

/** The contract of `src/<name>.vue`, as `src/<name>.ts` publishes it, after vue-tsc emits it. */
async function contractOf(name: string): Promise<string> {
  write(`src/${name}.ts`, `export { default } from './${name}.vue';\n`);
  await execFileAsync(path.join(REPO_ROOT, 'node_modules/.bin/vue-tsc'), ['-p', 'tsconfig.json', '--outDir', '.temp/api-types'], {
    cwd: root, encoding: 'utf8', timeout: 60_000, maxBuffer: 64 * 1024 * 1024,
  });
  return componentContracts({
    packageName: '@fixture/ui',
    projectDir: root,
    typesDir,
    tsconfigPath: path.join(root, 'tsconfig.json'),
    components: [{
      key: `./${name}`,
      declaration: path.join(typesDir, `${name}.d.ts`),
      componentDeclaration: path.join(typesDir, `${name}.vue.d.ts`),
    }],
  }).get(`./${name}`)!;
}

describe('componentContracts', () => {
  it("reports a component's props, emits, slots and exposed members", async () => {
    write('src/types.ts', 'export interface WidgetItem { id: string; label: string }\n');
    write('src/Widget.vue', `<script setup lang="ts">
import type { WidgetItem } from './types.ts';
defineProps<{ item: WidgetItem; title?: string; count: number }>();
defineEmits<{ pick: [item: WidgetItem]; close: [] }>();
defineSlots<{ header(props: { title: string }): unknown }>();
defineExpose({ focus: () => {}, isOpen: true });
</script>
<template><div><slot name="header" :title="'x'" /></div></template>
`);

    const contract = await contractOf('Widget');
    expect(contract).toContain('## Component contract for "@fixture/ui/Widget"');
    // A type the component's own declaration imports prints by name, not as a path into .temp
    expect(contract).toContain('item: WidgetItem;');
    expect(contract).toContain('title?: string | undefined;');
    expect(contract).toContain('count: number;');
    expect(contract).toContain('(event: "pick", item: WidgetItem) => void;');
    expect(contract).toContain('(event: "close") => void;');
    expect(contract).toContain('header: (props: { title: string; }) => unknown;');
    expect(contract).toContain('focus: () => void;');
    expect(contract).toContain('isOpen: boolean;');
    // Vue's own instance and VNode members stay out
    expect(contract).not.toContain('$attrs');
    expect(contract).not.toContain('key?:');
    expect(contract).not.toMatch(/import\("[./]/);
  });

  it('reports a component with no props as having none, rather than failing', async () => {
    write('src/Bare.vue', `<script setup lang="ts">
defineExpose({ ping: () => 'pong' });
</script>
<template><div /></template>
`);

    const contract = await contractOf('Bare');
    expect(contract).toContain('props {\n}');
    expect(contract).toContain("ping: () => string;");
  });

  it("fails when the declaration isn't the shape vue-tsc emits, instead of reporting no props", () => {
    // A component type with construct signatures but no $props: what a changed vue-tsc emit looks
    // like to this script, and what used to produce an empty, wrong-looking-but-plausible contract
    fs.writeFileSync(path.join(typesDir, 'Odd.d.ts'), 'declare const _default: { new (): { $emit: (event: string) => void } };\nexport default _default;\n');
    fs.writeFileSync(path.join(typesDir, 'Odd.vue.d.ts'), 'export {};\n');

    expect(() => componentContracts({
      packageName: '@fixture/ui',
      projectDir: root,
      typesDir,
      tsconfigPath: path.join(root, 'tsconfig.json'),
      components: [{
        key: './Odd',
        declaration: path.join(typesDir, 'Odd.d.ts'),
        componentDeclaration: path.join(typesDir, 'Odd.vue.d.ts'),
      }],
    })).toThrow(/no \$props to read the contract from.*vue-tsc's emitted shape has changed/s);
  });
});
