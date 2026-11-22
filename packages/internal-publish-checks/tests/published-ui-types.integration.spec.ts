import * as fs from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CONSUMER_MATRIX, PACKAGES_BUILT, compileConsumer, installPublishedPackages, type TscVersion } from '../src/published-packages.ts';

let consumer: string | undefined;
beforeAll(() => {
  if (PACKAGES_BUILT) consumer = installPublishedPackages();
});
afterAll(() => {
  if (consumer) fs.rmSync(consumer, { recursive: true, force: true });
});

function typecheck(dir: string, tsc: TscVersion, moduleResolution: 'node16' | 'bundler') {
  return compileConsumer(dir, tsc, moduleResolution, {
    // The scaffold's shim for the pack's own SFCs must not shadow the published component types
    'env.d.ts': [
      "declare module '*.vue' {",
      "  import type { DefineComponent } from 'vue';",
      '  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, any>;',
      '  export default component;',
      '}',
    ],
    'index.ts': [
      "import { h } from 'vue';",
      "import TiptapEditor from '@apackdev/ui/components/tiptap/TiptapEditor';",
      "import SimpleMonacoEditor from '@apackdev/ui/components/SimpleMonacoEditor';",
      "import { useDebounceFn } from '@apackdev/ui/composables/useDebounce';",
      "import { textEditorExtensionsRegistry } from '@apackdev/sdk/fe';",
      "export const editor = h(TiptapEditor, { mode: 'editor', modelValue: 'text' });",
      "export const code = h(SimpleMonacoEditor, { modelValue: 'const x = 1' });",
      "export const contributions = textEditorExtensionsRegistry.getAll();",
      "export const debounce = useDebounceFn(100);",
      'debounce(() => {});',
      '// @ts-expect-error modelValue is a string',
      "export const wrongProp = h(SimpleMonacoEditor, { modelValue: 42 });",
      '// @ts-expect-error debounce takes a callback',
      'debounce(42);',
    ],
  });
}

describe.skipIf(!PACKAGES_BUILT)('published @apackdev/ui declarations', () => {
  it.each(CONSUMER_MATRIX)('types component props and composables for TypeScript $tsc, moduleResolution $moduleResolution', async ({ tsc, moduleResolution }) => {
    const result = await typecheck(consumer!, tsc, moduleResolution);
    expect(result.code, result.output).toBe(0);
  });
});
