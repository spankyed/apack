import * as fs from 'node:fs';
import * as path from 'node:path';
import ts from 'typescript';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { population } from '@apackdev/sdk/testing';
import { PACKAGES_BUILT, installPublishedPackages } from '../src/published-packages.ts';

/**
 * The published declarations, checked with `skipLibCheck` off.
 *
 * Every other consumer check compiles with `skipLibCheck: true`, as a real consumer does — which is
 * the point of those specs, but it means nothing ever looks inside the `.d.ts` files we ship. An
 * error in there is invisible: a type that fails to resolve becomes `any`, and a consumer sees no
 * error at all, just a member that silently stops being checked. That is the failure this catches.
 *
 * `skipLibCheck: false` alone would also check every third-party declaration (vue, ai and
 * their trees), whose errors are not ours to fix and would make this fail for unrelated reasons. So
 * the program is built with checking on and the diagnostics are then filtered to the files under
 * `node_modules/@apackdev/`, the same way `facade-typing.spec.ts` scopes a pack's own facades.
 */

let consumer: string | undefined;
beforeAll(() => {
  if (PACKAGES_BUILT) consumer = installPublishedPackages();
});
afterAll(() => {
  if (consumer) fs.rmSync(consumer, { recursive: true, force: true });
});

/**
 * Every declaration file the two published packages ship, each package confirmed to have contributed.
 *
 * Guarded per package rather than over their sum, because a sum cannot see one of them go missing: there are
 * hundreds of declarations between the two, so `ui` failing to install still clears any floor worth
 * setting, and the check would compile the other and report green having never read that package's types.
 * A `dist` that is not there throws naming the path, where skipping it quietly made the check smaller.
 */
function publishedDeclarations(root: string): string[] {
  const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.name.endsWith('.d.ts') || entry.name.endsWith('.d.vue.ts') ? [full] : [];
  });
  return ['sdk', 'ui'].flatMap((pkg) =>
    [...population(`@apackdev/${pkg}'s published declarations`, walk(path.join(root, 'node_modules', '@apackdev', pkg, 'dist')))]);
}

describe.skipIf(!PACKAGES_BUILT)('the published declarations', () => {
  it('type-check on their own, so no shipped type silently resolves to any', () => {
    const declarations = publishedDeclarations(consumer!);

    const program = ts.createProgram({
      rootNames: declarations,
      options: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.NodeNext,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
        strict: true,
        skipLibCheck: false,
        noEmit: true,
        lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
        // @apackdev/sdk/utils is Node-only by contract and its declarations name Node globals, so a
        // consumer of those modules has @types/node; without this every one reads as a missing name
        types: ['node'],
      },
    });

    // Ours only: a third-party package's own declaration errors are not this repo's to fix
    const ours = new Set(declarations.map((f) => fs.realpathSync(f)));
    const problems = program.getSourceFiles()
      .filter((file) => ours.has(fs.realpathSync(file.fileName)))
      .flatMap((file) => program.getSemanticDiagnostics(file))
      .map((d) => `${path.relative(consumer!, d.file?.fileName ?? '')}: TS${d.code} ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`);

    expect(problems).toEqual([]);
  });
});
