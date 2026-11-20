// An app under test is started by `@apackdev/testing`, never by a spec reaching Playwright's `_electron` itself: the
// worker's app is the fixture's, and a spec that needs one of its own asks `launchApp`.
//
// Starting one means closing one, and the close is where it went wrong. Each spec that launched its own copied the
// launch and closed with Playwright's `close()`, which waits on Chromium writing a profile; once the fixture's own
// close was bounded by the app's work (`closeApp`), the copies were left behind, and each failed under load one at a
// time, as its test ran out of clock after its work was done.
//
// Here rather than in `@apackdev/testing`'s suite, because its subject is every tracked file: a spec anywhere in the
// repo, or in a pack beside it.
import * as fs from 'node:fs';
import * as path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from '@apackdev/host/build/packages-built';
import { repoFiles } from './_support/repo-files.ts';

/** What reaches Playwright's Electron launcher, and why each one may */
const LAUNCHERS: Record<string, string> = {
  'packages/apack-testing/src/index.ts': 'the fixture, and `launchApp`, which start every app under test',
};

/** Source that could reach the launcher; prose about it is not a use */
const CODE = /\.(?:[cm]?[jt]s|tsx)$/;

/**
 * Whether `text` uses Playwright's `_electron`: imports it from `@playwright/test`, or reads it off an object
 * (`playwright._electron`). Read from the syntax rather than the text, since `_electron` is also a name for an unused
 * parameter, and a comment naming the launcher is not a launch.
 */
function usesLauncher(file: string, text: string): boolean {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false);
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)
      && node.moduleSpecifier.text === '@playwright/test' && node.importClause?.namedBindings
      && ts.isNamedImports(node.importClause.namedBindings)
      && node.importClause.namedBindings.elements.some((element) => (element.propertyName ?? element.name).text === '_electron')) {
      found = true;
    } else if (ts.isPropertyAccessExpression(node) && node.name.text === '_electron') {
      found = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/** The files among `files` that reach the launcher */
function launching(files: ReadonlyArray<{ readonly file: string; readonly text: string }>): string[] {
  return files.filter(({ file, text }) => usesLauncher(file, text)).map(({ file }) => file).sort();
}

describe("Playwright's Electron launcher", () => {
  it('is reached by the fixture and nothing else', () => {
    const files = repoFiles().filter((file) => CODE.test(file) && !file.startsWith('docs/archive/'))
      .map((file) => ({ file, text: fs.readFileSync(path.join(REPO_ROOT, file), 'utf8') }));
    // Equal rather than a subset, so the fixture moving its launch elsewhere fails here instead of leaving the check
    // comparing against a file that no longer launches anything
    expect(launching(files), 'a spec that needs an app of its own starts it with launchApp (@apackdev/testing), '
      + `whose close is the fixture's; only ${Object.keys(LAUNCHERS).join(', ')} reach _electron`)
      .toEqual(Object.keys(LAUNCHERS).sort());
  });

  it('reports a spec that launches by either road, and passes one that asks launchApp or only names the launcher', () => {
    expect(launching([
      { file: 'tests/e2e/imports.spec.ts', text: "import { _electron } from '@playwright/test';\nawait _electron.launch({ args: ['.'] });" },
      { file: 'tests/e2e/renamed.spec.ts', text: "import { _electron as electron } from '@playwright/test';\nawait electron.launch({ args: ['.'] });" },
      { file: 'tests/e2e/fixture.spec.ts', text: "test('x', async ({ playwright }) => { await playwright._electron.launch({ args: ['.'] }); });" },
      { file: 'tests/e2e/helper.spec.ts', text: "import { launchApp } from '@apackdev/testing';\nconst app = await launchApp({ userDataDir });" },
      { file: 'tests/e2e/prose.spec.ts', text: '// launched with `_electron.launch` once\nconst read = (_electron: boolean) => _electron;' },
    ])).toEqual(['tests/e2e/fixture.spec.ts', 'tests/e2e/imports.spec.ts', 'tests/e2e/renamed.spec.ts']);
  });
});
