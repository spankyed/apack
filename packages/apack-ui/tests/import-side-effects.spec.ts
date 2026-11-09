import * as fs from 'node:fs';
import * as path from 'node:path';
import ts from 'typescript';
import { parse } from '@vue/compiler-sfc';
import { describe, expect, it } from 'vitest';
import { population } from '@apackdev/sdk/testing';


/**
 * The app imports every @apackdev/ui module at startup to share it with packs (virtual:host-shared-modules),
 * so a module must not act when imported: no top-level statements that run code (listeners,
 * registrations). Declarations, including objects built from calls, are fine; `<script setup>`
 * runs per component instance and isn't checked.
 */
// Its subject is this package's own source, which is why it lives here now rather than in @apackdev/cli.
// One level up, not a repo root: @apackdev/ui is a leaf package and importing @apackdev/host for a path
// would be an upward dependency (`check:specifiers`, findUpwardImports).
const UI_SRC = path.resolve(import.meta.dirname, '..', 'src');

/**
 * **Refuses an empty walk.** Every case here filters this for offenders and asserts the result is empty,
 * which passes for nothing when the walk itself found no files — a moved package or a renamed source
 * directory would read as the rule holding.
 */
function modules(dir: string): string[] {
  return [...population(`ui source modules under ${dir}`, _modules(dir))];
}

function _modules(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return _modules(full);
    return /(?<!\.d|\.spec|\.test)\.ts$|\.vue$/.test(entry.name) ? [full] : [];
  });
}

/** `file:line: statement` for each top-level statement that runs when the module is imported */
function importTimeStatements(file: string): string[] {
  let code = fs.readFileSync(file, 'utf-8');
  let lineOffset = 0;
  if (file.endsWith('.vue')) {
    const script = parse(code, { filename: file }).descriptor.script;
    if (!script) return [];
    code = script.content;
    lineOffset = script.loc.start.line - 1;
  }
  const source = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true);
  return source.statements
    .filter((statement) => ts.isExpressionStatement(statement) || ts.isIfStatement(statement) || ts.isForStatement(statement)
      || ts.isForOfStatement(statement) || ts.isTryStatement(statement) || ts.isBlock(statement))
    .map((statement) => {
      const line = source.getLineAndCharacterOfPosition(statement.getStart(source)).line + 1 + lineOffset;
      return `${path.relative(UI_SRC, file)}:${line}: ${statement.getText(source).split('\n')[0]}`;
    });
}

/**
 * A stylesheet from another package is global: its selectors are written for whoever installs it,
 * not namespaced to a component. @apackdev/ui ships inside every pack that sets `build.bundleUi`, so such
 * an import would inject a second copy of those rules into the running app and restyle it. The app
 * imports those stylesheets itself (`packages/renderer/src/main.ts`), which keeps one copy, owned by
 * the host. A component's own `./x.css` is fine: it is namespaced by the component's root class.
 */
function foreignStylesheetImports(file: string): string[] {
  const code = fs.readFileSync(file, 'utf-8');
  const lines = code.split('\n');
  const bare = (specifier: string): boolean => !specifier.startsWith('.') && !specifier.startsWith('/');
  return lines.flatMap((line, index) => {
    const esm = /^\s*import\s+['"]([^'"]+\.css)['"]/.exec(line);
    const css = /^\s*@import\s+['"]([^'"]+)['"]/.exec(line);
    const specifier = esm?.[1] ?? css?.[1];
    return specifier && bare(specifier) ? [`${path.relative(UI_SRC, file)}:${index + 1}: ${specifier}`] : [];
  });
}

describe('@apackdev/ui modules', () => {
  it('do nothing when imported', () => {
    expect(modules(UI_SRC).flatMap(importTimeStatements)).toEqual([]);
  });

  it('import no stylesheet from another package, so nothing global ships inside a pack', () => {
    expect(modules(UI_SRC).flatMap(foreignStylesheetImports)).toEqual([]);
  });
});
