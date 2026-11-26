import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { facadeProblems } from '../../src/build/facade-gate';
import { bundlePackTypes } from '../../src/build/types-bundler';

/**
 * apack pack build bundles a pack's facade types and refuses a bundle its dependents couldn't use:
 * one that doesn't type-check on its own, or that imports a package a dependent doesn't have.
 */
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'facade-gate-'));
afterAll(() => fs.rmSync(parent, { recursive: true, force: true }));

/** A pack with `files` (its facade input at src/__generated__/pack-types.ts), bundled; the gate's problems */
async function gate(name: string, files: Record<string, string>): Promise<{ problems: string[]; bundle: string }> {
  const dir = path.join(parent, name);
  const all = { 'package.json': JSON.stringify({ name, type: 'module' }), ...files };
  for (const [rel, content] of Object.entries(all)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  }
  fs.symlinkSync(path.join(REPO_ROOT, 'node_modules'), path.join(dir, 'node_modules'), 'dir');
  const outFile = path.join(dir, 'dist', 'types', 'pack-types.d.ts');
  const bundled = await bundlePackTypes(dir, outFile);
  if (!bundled.success) throw new Error(bundled.error);
  return { problems: facadeProblems(dir, outFile), bundle: bundled.content };
}

describe('facade gate', () => {
  it('passes a facade that imports only @apackdev/* and @apackdev/sdk peers', async () => {
    const { problems } = await gate('clean', {
      'src/search.ts': [
        "import type { EARS } from '@apackdev/sdk';",
        "import type { Ref } from 'vue';",
        "import { z } from 'zod';",
        'export const Query = z.object({ text: z.string() });',
        'export const searchService = {',
        '  parse: (input: unknown) => Query.parse(input),',
        '  byId: (id: EARS.EntityId): EARS.EntityId => id,',
        '  ref: (ref: Ref<string>): Ref<string> => ref,',
        '};',
      ].join('\n'),
      'src/__generated__/pack-types.ts': "import type { searchService } from '../search.ts';\nexport type Services = { search: typeof searchService };\n",
    });
    expect(problems).toEqual([]);
  });

  // rollup-plugin-dts turns a namespace's type-only re-export into `declare const x: typeof Type`
  it('fails a facade that does not type-check: a type-only re-export through a namespace', async () => {
    const { problems, bundle } = await gate('namespace-reexport', {
      'src/types.ts': "export type { Ref } from 'vue';\n",
      'src/search.ts': "import * as types from './types.ts';\nexport { types };\n",
      'src/__generated__/pack-types.ts': "import * as search from '../search.ts';\nexport type Services = { search: typeof search };\n",
    });
    expect(bundle).toMatch(/declare const \w+: typeof Ref;/);
    expect(problems).toEqual([
      expect.stringMatching(/^dist\/types\/pack-types\.d\.ts:\d+:\d+ error TS2693: 'Ref' only refers to a type, but is being used as a value here\. \(in types_Ref; reached from: Services\)$/),
    ]);
  });

  it('fails a facade that imports a package outside the allowlist', async () => {
    const { problems } = await gate('undeclared-package', {
      'src/browser.ts': "import type { Browser } from 'playwright';\nexport const browserService = { current: (): Browser | null => null };\n",
      'src/__generated__/pack-types.ts': "import type { browserService } from '../browser.ts';\nexport type Services = { browser: typeof browserService };\n",
    });
    expect(problems).toEqual([
      expect.stringMatching(/^dist\/types\/pack-types\.d\.ts:1:1 imports "playwright", which dependents don't have: facades may import only @apackdev\/\* packages, @apackdev\/sdk's peer dependencies \([^)]*\bvue\b[^)]*\) and Node built-ins \(reached from: Services\)$/),
    ]);
  });

  // The SDK brings EARS, but a dependent depends on the SDK alone: a facade naming EARS itself fails where npm nests
  // it. The bundler writes the root as `@apackdev/sdk/ears`; a subpath with no SDK entry stays, and is refused here
  it('fails a facade that imports a package the SDK brings rather than the SDK', async () => {
    const { problems } = await gate('ears-subpath', {
      'src/data.ts': "import type { openDatabase } from '@elmdb/ears/database';\nexport const dataService = { open: (): typeof openDatabase | null => null };\n",
      'src/__generated__/pack-types.ts': "import type { dataService } from '../data.ts';\nexport type Services = { data: typeof dataService };\n",
    });
    expect(problems).toEqual([
      expect.stringMatching(/^dist\/types\/pack-types\.d\.ts:1:1 imports "@elmdb\/ears\/database", which dependents don't have: facades may import only @apackdev\/\* packages, @apackdev\/sdk's peer dependencies \([^)]*\) and Node built-ins \(reached from: Services\)$/),
    ]);
  });

  // Nothing resolves these now: a pack build compiles the published packages, so a source-only export
  // fails the rule and fails to compile, and the rule's message is what names the reason
  it('fails a facade that imports an @apackdev/* module no pack resolves', async () => {
    const { problems } = await gate('source-only-export', {
      'src/internals.ts': [
        "import type { unbindHost } from '@apackdev/sdk/runtime/internals';",
        "import type { InstalledPackSummary } from '@apackdev/host/packs';",
        'export const internalsService = { unbind: (): typeof unbindHost | null => null, pack: (): InstalledPackSummary | null => null };',
      ].join('\n'),
      'src/__generated__/pack-types.ts': "import type { internalsService } from '../internals.ts';\nexport type Services = { internals: typeof internalsService };\n",
    });
    expect(problems).toEqual([
      // A facade's imports are in specifier order (`forDependents`)
      expect.stringMatching(/imports "@apackdev\/host\/packs", a private package dependents can't install \(reached from: Services\)$/),
      expect.stringMatching(/imports "@apackdev\/sdk\/runtime\/internals", which @apackdev\/sdk doesn't export to installed dependents: in a checkout it resolves only under the @apackdev\/source condition, and the published manifest drops the entry \(reached from: Services\)$/),
      expect.stringContaining("error TS2307: Cannot find module '@apackdev/sdk/runtime/internals'"),
    ]);
  });

  it('fails a facade whose import does not resolve', async () => {
    const { problems } = await gate('unresolved', {
      'src/thing.ts': "import type { Thing } from 'not-an-installed-package';\nexport const thingService = { get: (): Thing => null! };\n",
      'src/__generated__/pack-types.ts': "import type { thingService } from '../thing.ts';\nexport type Services = { thing: typeof thingService };\n",
    });
    expect(problems).toEqual([
      expect.stringContaining('imports "not-an-installed-package", which dependents don\'t have'),
      expect.stringMatching(/error TS2307: Cannot find module 'not-an-installed-package'/),
    ]);
  });
});
