import * as fs from 'node:fs';
import * as path from 'node:path';
import ts from 'typescript';
import { THROUGH_SDK } from '@apackdev/host/build/shared-deps';

/**
 * Every module specifier a declaration file names: imports, re-exports, `import x = require(…)` and `import("…")` types.
 * A `declare module "…"` name is not one: it declares a module rather than naming one to load.
 */
function specifierLiterals(file: ts.SourceFile): ts.StringLiteral[] {
  const found: ts.StringLiteral[] = [];
  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      found.push(node.moduleSpecifier);
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)
      && ts.isStringLiteral(node.moduleReference.expression)) {
      found.push(node.moduleReference.expression);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
      found.push(node.argument.literal);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

/**
 * Why the SDK entry `entry`, as `packDir` resolves its declarations, can't stand for `pkg`, or null when it can: its
 * declarations have to say `export * from '<pkg>'`. The pack's own resolution is the one that counts, since that is
 * the SDK its dependents get the facade alongside.
 */
export function reExportProblem(packDir: string, pkg: string, entry: string): string | null {
  const options: ts.CompilerOptions = { module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler };
  const resolved = ts.resolveModuleName(entry, path.join(packDir, 'package.json'), options, ts.sys).resolvedModule;
  if (!resolved) return `${entry} doesn't resolve from ${packDir}`;
  const declarations = ts.createSourceFile(resolved.resolvedFileName, fs.readFileSync(resolved.resolvedFileName, 'utf8'), ts.ScriptTarget.Latest, true);
  const whole = declarations.statements.some((statement) => ts.isExportDeclaration(statement) && !statement.exportClause
    && statement.moduleSpecifier !== undefined && ts.isStringLiteral(statement.moduleSpecifier) && statement.moduleSpecifier.text === pkg);
  return whole ? null : `${entry} (${resolved.resolvedFileName}) doesn't say export * from '${pkg}'`;
}

/** The refusal when `entry` can't stand for `pkg` in what `fileName` writes */
function refusal(fileName: string, pkg: string, problem: string): string {
  return `${fileName} names ${pkg}, which a pack's facade writes as ${THROUGH_SDK[pkg]}, but ${problem}: `
    + 'install an @apackdev/sdk whose entry re-exports it whole';
}

/**
 * Declarations a pack's dependents compile, with every package the pack reaches only through the SDK written as the SDK
 * entry that re-exports it (`THROUGH_SDK`).
 *
 * **Here and not in the pack's source**, because the source never names the package: TypeScript writes a type the pack
 * infers by where the type is declared, which is the package, and whether that comes out as `import("@elmdb/ears")`,
 * the SDK's entry or a "not portable" error depends on how npm laid the install out. So no way of re-exporting can keep
 * the package out of a facade, and the one place that can is the place the facade is written.
 *
 * @throws naming the entry, when an entry this would write doesn't re-export the whole package
 */
export function writeThroughSdk(code: string, packDir: string, fileName = 'bundle.d.ts'): string {
  const file = ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const edits = specifierLiterals(file).filter((literal) => Object.hasOwn(THROUGH_SDK, literal.text));
  for (const pkg of new Set(edits.map((literal) => literal.text))) {
    const problem = reExportProblem(packDir, pkg, THROUGH_SDK[pkg]!);
    if (problem !== null) throw new Error(refusal(fileName, pkg, problem));
  }
  // Right to left, so an earlier edit's offsets still refer to the text they were taken from
  return edits.reverse().reduce((text, literal) =>
    `${text.slice(0, literal.getStart(file) + 1)}${THROUGH_SDK[literal.text]}${text.slice(literal.end - 1)}`, code);
}

/** The name rollup-plugin-dts gives the namespace import it makes of an inline `import("<specifier>")` type */
const namespaceName = (specifier: string): string => specifier.replace(/[^a-zA-Z0-9_$]/g, '_');

/**
 * A bundle written through the SDK, with the namespace imports of each SDK entry named as the entry would have named
 * them. rollup-plugin-dts names the one it makes of an inline `import("<specifier>")` after the specifier, so a hoisted
 * install's `import("@elmdb/ears")` arrives as `_elmdb_ears` where a nested one's `import("@apackdev/sdk/ears")` is
 * `_apackdev_sdk_ears`: renamed here, the facade's text doesn't depend on the install's layout. A name already taken by
 * anything else is left alone, since the bundle is correct as it is.
 */
function entryNamespaces(code: string, fileName: string): string {
  let text = code;
  for (const [pkg, entry] of Object.entries(THROUGH_SDK)) {
    const file = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const declared = new Set<string>();
    const renamed = new Map<string, string>();
    for (const statement of file.statements) {
      const clause = ts.isImportDeclaration(statement) ? statement.importClause : undefined;
      const bindings = clause?.namedBindings;
      if (ts.isImportDeclaration(statement) && bindings && ts.isNamespaceImport(bindings) && ts.isStringLiteral(statement.moduleSpecifier)
        && statement.moduleSpecifier.text === entry && bindings.name.text.replace(/\$\d+$/, '') === namespaceName(pkg)) {
        renamed.set(bindings.name.text, `${namespaceName(entry)}${bindings.name.text.slice(namespaceName(pkg).length)}`);
      }
      collectNames(statement, declared);
    }
    const edits: Array<{ start: number; end: number; text: string }> = [];
    for (const [from, to] of renamed) {
      if (declared.has(to)) continue;
      const visit = (node: ts.Node): void => {
        if (ts.isIdentifier(node) && node.text === from) edits.push({ start: node.getStart(file), end: node.end, text: to });
        ts.forEachChild(node, visit);
      };
      visit(file);
    }
    text = edits.sort((a, b) => b.start - a.start).reduce((out, edit) => out.slice(0, edit.start) + edit.text + out.slice(edit.end), text);
  }
  return text;
}

/** Every name a top-level statement binds, into `names` */
function collectNames(statement: ts.Statement, names: Set<string>): void {
  const visit = (node: ts.Node): void => {
    const name = (node as { name?: ts.Node }).name;
    if (name && ts.isIdentifier(name)) names.add(name.text);
    ts.forEachChild(node, visit);
  };
  visit(statement);
}

/**
 * The bundle's leading import declarations in specifier order, a namespace import before named ones. Rollup orders them
 * by where each module was first reached, which is the order TypeScript happened to name them in, and that moves with
 * the install's layout; their order means nothing to a declaration file.
 */
function sortedImports(code: string, fileName: string): string {
  const file = ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const leading: ts.ImportDeclaration[] = [];
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement)) break;
    leading.push(statement);
  }
  if (leading.length < 2) return code;
  const key = (statement: ts.ImportDeclaration) => {
    const bindings = statement.importClause?.namedBindings;
    return [(statement.moduleSpecifier as ts.StringLiteral).text, bindings && ts.isNamespaceImport(bindings) ? 0 : 1, statement.getText(file)] as const;
  };
  const sorted = [...leading].sort((a, b) => {
    const [ka, kb] = [key(a), key(b)];
    return ka[0] < kb[0] ? -1 : ka[0] > kb[0] ? 1 : ka[1] - kb[1] || (ka[2] < kb[2] ? -1 : ka[2] > kb[2] ? 1 : 0);
  });
  const start = leading[0]!.getStart(file);
  const end = leading.at(-1)!.end;
  return code.slice(0, start) + sorted.map((statement) => statement.getText(file)).join('\n') + code.slice(end);
}

/**
 * What a pack's dependents get of a declaration bundle: written through the SDK (`writeThroughSdk`), with the SDK
 * entries' namespaces named as the entries name them and the imports in a fixed order, so a facade built in a hoisted
 * install and one built in a nested install are the same text.
 *
 * @throws as `writeThroughSdk` does
 */
export function forDependents(code: string, packDir: string, fileName = 'bundle.d.ts'): string {
  return sortedImports(entryNamespaces(writeThroughSdk(code, packDir, fileName), fileName), fileName);
}
