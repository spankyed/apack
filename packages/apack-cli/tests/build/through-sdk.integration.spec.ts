import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { facadeProblems } from '../../src/build/facade-gate';
import { bundlePackTypes } from '../../src/build/types-bundler';
import { THROUGH_SDK } from '@apackdev/host/build/shared-deps';
import { reExportProblem, writeThroughSdk } from '../../src/build/through-sdk';

/**
 * A pack names only the SDK, but TypeScript writes a type it infers from EARS by where EARS declares it: as
 * `import("@elmdb/ears")` when npm hoists EARS beside the SDK, and through the SDK's entry when npm nests it. The
 * facade a dependent compiles names `@apackdev/sdk/ears` either way, because the declaration bundler writes it so.
 *
 * The packages here are stand-ins with the shape that matters, a `./ears` entry over a dependency, so the two layouts
 * are both a file tree this spec writes rather than whatever the workspace's install happens to be.
 */
const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'through-sdk-'));
afterAll(() => fs.rmSync(parent, { recursive: true, force: true }));

const EARS_FILES = {
  'package.json': JSON.stringify({ name: '@elmdb/ears', version: '0.0.0', exports: { '.': { types: './index.d.ts' } } }),
  'index.d.ts': 'export interface Thing { readonly id: string }\nexport declare function openThing(): Thing;\n',
};

const sdkFiles = (ears: string) => ({
  'package.json': JSON.stringify({
    name: '@apackdev/sdk', version: '0.1.0', exports: { './ears': { types: './ears.d.ts' } }, dependencies: { '@elmdb/ears': '0.0.0' },
  }),
  'ears.d.ts': `${ears}\nexport declare function boundThing(): void;\n`,
});

const PACK_FILES = {
  'package.json': JSON.stringify({ name: 'through-pack', type: 'module', dependencies: { '@apackdev/sdk': '0.1.0' } }),
  'tsconfig.json': JSON.stringify({ compilerOptions: { target: 'es2022', module: 'esnext', moduleResolution: 'bundler', strict: true } }),
  // The return type is inferred: the pack's source names no EARS type, and nothing but the SDK
  'src/thing.ts': "import { openThing } from '@apackdev/sdk/ears';\nexport const thingService = { open: () => openThing() };\n",
  'src/__generated__/pack-types.ts': "import type { thingService } from '../thing.ts';\nexport type Services = { thing: typeof thingService };\n",
};

function write(dir: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  }
}

/** The pack in `layout`, with an SDK whose `./ears` entry is `ears`: its facade, bundled, and the gate's problems */
async function facade(name: string, layout: 'hoisted' | 'nested', ears = "export * from '@elmdb/ears';") {
  const dir = path.join(parent, name);
  write(dir, PACK_FILES);
  const sdk = path.join(dir, 'node_modules', '@apackdev', 'sdk');
  write(sdk, sdkFiles(ears));
  write(layout === 'hoisted' ? path.join(dir, 'node_modules', '@elmdb', 'ears') : path.join(sdk, 'node_modules', '@elmdb', 'ears'), EARS_FILES);
  const outFile = path.join(dir, 'dist', 'types', 'pack-types.d.ts');
  const bundled = await bundlePackTypes(dir, outFile);
  return { bundled, problems: bundled.success ? facadeProblems(dir, outFile) : [] };
}

describe('a facade whose type comes from EARS', () => {
  for (const layout of ['hoisted', 'nested'] as const) {
    it(`names the SDK's entry in a ${layout} install, and passes the gate`, async () => {
      const { bundled, problems } = await facade(`export-all-${layout}`, layout);
      if (!bundled.success) throw new Error(bundled.error);
      expect(bundled.content).toContain("'@apackdev/sdk/ears'");
      expect(bundled.content).not.toContain('@elmdb/ears');
      expect(problems).toEqual([]);
    });
  }

  // TypeScript names the type differently in the two (`import("@elmdb/ears")`, or the entry), and rollup-plugin-dts
  // names its namespace import after that: the facade a dependent gets is the same text either way
  it('is the same text from a hoisted and a nested install', async () => {
    const [hoisted, nested] = [await facade('same-hoisted', 'hoisted'), await facade('same-nested', 'nested')];
    if (!hoisted.bundled.success || !nested.bundled.success) throw new Error('bundle failed');
    expect(hoisted.bundled.content).toBe(nested.bundled.content);
  });

  // Written as the entry, the facade would name a type the entry doesn't export: refused, naming the entry
  it("refuses the rewrite when the SDK's entry re-exports EARS by name", async () => {
    const { bundled } = await facade('named', 'hoisted', "export { openThing } from '@elmdb/ears';");
    expect(bundled).toEqual({ success: false, error: expect.stringContaining(
      "names @elmdb/ears, which a pack's facade writes as @apackdev/sdk/ears, but @apackdev/sdk/ears (") });
    expect(bundled.success === false && bundled.error).toContain("doesn't say export * from '@elmdb/ears'");
  });

  // Every form a declaration names a module in; a subpath with no SDK entry and a declared module name stay as written
  it('rewrites every form of specifier, and only the listed ones', async () => {
    await facade('forms', 'hoisted');
    const text = [
      "import { Thing } from '@elmdb/ears';",
      "export { openThing } from '@elmdb/ears';",
      "export * from '@elmdb/ears';",
      "import ears = require('@elmdb/ears');",
      "export type Opened = import('@elmdb/ears').Thing;",
      "import type { Database } from '@elmdb/ears/database';",
      "declare module '@elmdb/ears' {}",
    ].join('\n');
    expect(writeThroughSdk(text, path.join(parent, 'forms')).split('\n')).toEqual([
      "import { Thing } from '@apackdev/sdk/ears';",
      "export { openThing } from '@apackdev/sdk/ears';",
      "export * from '@apackdev/sdk/ears';",
      "import ears = require('@apackdev/sdk/ears');",
      "export type Opened = import('@apackdev/sdk/ears').Thing;",
      "import type { Database } from '@elmdb/ears/database';",
      "declare module '@elmdb/ears' {}",
    ]);
  });

  // The table's other half: what this repository's SDK declares, as a pack in it resolves the SDK
  it("holds for this repository's SDK: each entry re-exports its package whole", () => {
    const pack = path.resolve(import.meta.dirname, '..', '..', '..', 'default-setup');
    for (const [pkg, entry] of Object.entries(THROUGH_SDK)) expect(reExportProblem(pack, pkg, entry)).toBeNull();
  });
});
