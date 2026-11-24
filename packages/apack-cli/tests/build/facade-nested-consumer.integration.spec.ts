import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PACKAGES_BUILT, REPO_ROOT, compileConsumer, installPublishedPackages } from '@app/internal-publish-checks';
import { bundlePackTypes } from '../../src/build/types-bundler';

/**
 * A facade built where this repository builds its packs — the workspace's hoisted install, where TypeScript writes an
 * EARS type it infers as `import("@elmdb/ears")` — compiles for a dependent that installed the published SDK the
 * strictest way npm does, nested, where `@elmdb/ears` is the SDK's and not the dependent's to resolve. It does because
 * the facade names it as `@apackdev/sdk/ears` (`forDependents`).
 */
let parent: string | undefined;
let consumer: string | undefined;
beforeAll(() => {
  if (!PACKAGES_BUILT) return;
  parent = fs.mkdtempSync(path.join(os.tmpdir(), 'facade-nested-'));
  consumer = installPublishedPackages();
});
afterAll(() => {
  for (const dir of [parent, consumer]) if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

const PACK: Record<string, string> = {
  'package.json': JSON.stringify({ name: 'engine-pack', type: 'module', dependencies: { '@apackdev/sdk': '*' } }),
  'tsconfig.json': JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'esnext', moduleResolution: 'bundler', strict: true } }),
  // `boundEars()` returns the engine's `Ears`, which EARS declares: inferred, so the pack's source names no EARS type
  'src/engine.ts': "import { boundEars } from '@apackdev/sdk/ears';\nexport const engineService = { engine: () => boundEars() };\n",
  'src/__generated__/pack-types.ts': "import type { engineService } from '../engine.ts';\nexport type Services = { engine: typeof engineService };\n",
};

describe.skipIf(!PACKAGES_BUILT)('a facade built in the workspace, for a nested install', () => {
  it('names EARS through the SDK, and compiles where only the SDK is the dependent\'s', async () => {
    const pack = path.join(parent!, 'engine-pack');
    for (const [rel, content] of Object.entries(PACK)) {
      fs.mkdirSync(path.dirname(path.join(pack, rel)), { recursive: true });
      fs.writeFileSync(path.join(pack, rel), content);
    }
    fs.symlinkSync(path.join(REPO_ROOT, 'node_modules'), path.join(pack, 'node_modules'), 'dir');
    const bundled = await bundlePackTypes(pack, path.join(pack, 'dist', 'types', 'pack-types.d.ts'));
    if (!bundled.success) throw new Error(bundled.error);
    expect(bundled.content).toContain("from '@apackdev/sdk/ears'");

    // The facade as a dependent holds it (a `.ts` beside the code, so it is checked and not skipped as a library)
    const result = await compileConsumer(path.join(consumer!, 'dependent'), 'current', 'bundler', {
      'engine-facade.ts': [bundled.content],
      'use.ts': [
        "import type { Services } from './engine-facade.js';",
        "export type Engine = ReturnType<Services['engine']['engine']>;",
        "export const transacts = (engine: Engine): typeof engine.transact => engine.transact;",
      ],
    });
    expect(result.code, result.output).toBe(0);
  });
});
