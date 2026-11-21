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
    if (problem !== null) {
      throw new Error(`${fileName} names ${pkg}, which a pack's facade writes as ${THROUGH_SDK[pkg]}, but ${problem}: `
        + 'install an @apackdev/sdk whose entry re-exports it whole');
    }
  }
  // Right to left, so an earlier edit's offsets still refer to the text they were taken from
  return edits.reverse().reduce((text, literal) =>
    `${text.slice(0, literal.getStart(file) + 1)}${THROUGH_SDK[literal.text]}${text.slice(literal.end - 1)}`, code);
}
