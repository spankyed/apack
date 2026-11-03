import * as fs from 'node:fs';
import { packageName } from '@apackdev/host/build/specifiers';
import { SOURCE_CONDITION } from '@apackdev/host/build/source-resolution';
import { createRequire, isBuiltin } from 'node:module';
import * as path from 'node:path';
import ts from 'typescript';
import { errorMessage } from '@apackdev/sdk/utils/pure';
import { readPackCompilerConfiguration } from './compiler-configuration.ts';

/** Declaration extensions an import of the facade must resolve to; anything else reads as `any` */
const DECLARATION_EXTENSIONS: readonly string[] = [ts.Extension.Dts, ts.Extension.Dmts, ts.Extension.Dcts, ts.Extension.Ts, ts.Extension.Mts, ts.Extension.Cts, ts.Extension.Tsx];


/**
 * Packages a facade may import: every dependent has them. @apackdev/* packages, @apackdev/sdk's peer
 * dependencies (as the pack resolves the SDK) and Node's built-in modules.
 *
 * **"Every dependent has them" is checked, not assumed**, which is worth knowing before deriving it again: a
 * dependency's facade is inlined into the dependent's tree verbatim, at `src/__generated__/deps/<packId>.d.ts`,
 * so an import it carries has to resolve where the dependent is installed and not only where it was built.
 * `default-setup`'s facade carries `zod` today, from pack code rather than the SDK's own types, and
 * `tests/acceptance/packaged-authoring/test-packaged-authoring.sh` type-checks a pack that depends on it from packed tarballs outside
 * this monorepo — where that file's path is under neither prefix its tolerated-error list forgives, so an
 * unresolved peer fails the step. These are required peers (nothing in `peerDependenciesMeta`), which is why npm
 * installs them for a pack that never names one; `xstate` would travel the identical route if a contract derived
 * its state from a machine, which is what `contract-leaves` is there to stop.
 */
function allowedPackages(packDir: string): { allows: (name: string) => boolean; description: string } {
  const manifest = createRequire(path.join(packDir, 'package.json')).resolve('@apackdev/sdk/package.json');
  const { peerDependencies = {} } = JSON.parse(fs.readFileSync(manifest, 'utf-8')) as { peerDependencies?: Record<string, string> };
  const peers = Object.keys(peerDependencies);
  return {
    allows: (name) => name.startsWith('@apackdev/') || peers.includes(name) || isBuiltin(name),
    description: `@apackdev/* packages, @apackdev/sdk's peer dependencies (${peers.join(', ')}) and Node built-ins`,
  };
}

/** A package's package.json, found in the node_modules directories above dir */
function findPackageJson(dir: string, name: string): string | null {
  for (let current = dir; ; current = path.dirname(current)) {
    const candidate = path.join(current, 'node_modules', name, 'package.json');
    if (fs.existsSync(candidate)) return candidate;
    if (path.dirname(current) === current) return null;
  }
}

/** The exports map entry for a subpath: its exact key, or a `*` pattern key matching it */
function exportTarget(exportsMap: Record<string, unknown>, subpath: string): unknown {
  if (subpath in exportsMap) return exportsMap[subpath];
  const pattern = Object.keys(exportsMap).find((key) => {
    const [prefix, suffix, extra] = key.split('*');
    return suffix !== undefined && extra === undefined && subpath.startsWith(prefix!) && subpath.endsWith(suffix) && subpath.length >= prefix!.length + suffix.length;
  });
  return pattern === undefined ? undefined : exportsMap[pattern];
}

/** Whether an exports target resolves under some condition other than @apackdev/source */
function publishedTarget(target: unknown): boolean {
  if (typeof target === 'string') return true;
  if (Array.isArray(target)) return target.some(publishedTarget);
  if (target && typeof target === 'object') {
    return Object.entries(target).some(([condition, value]) => condition !== SOURCE_CONDITION && publishedTarget(value));
  }
  return false;
}

/**
 * Why an @apackdev/* import isn't part of the published package, or null. A linked checkout resolves
 * source-only exports (`@apackdev/sdk/runtime/internals`) and private packages (`@apackdev/host`); a
 * dependent installing from the registry resolves neither.
 *
 * This reads the exports map rather than trying to resolve: a source-only entry is one whose target
 * names no condition but `@apackdev/source`, and in the published manifest there is no entry at all
 * (`publishedManifest` drops one the condition was the whole of). Both read as unpublished here, which is
 * the point — that is why such an entry must not gain a `default`, even one pointing at a module that
 * throws a friendlier error than ERR_MODULE_NOT_FOUND: a published target makes it look resolvable here,
 * and the gate stops reporting it. A pack importing a host-only
 * entry should fail this build, not the user's app. `apack-sdk/tests/runtime/internals-entry.spec.ts`
 * pins the shape from the other side.
 */
function unpublishedReason(packDir: string, name: string, specifier: string): string | null {
  const manifestFile = findPackageJson(packDir, name);
  if (!manifestFile) return null; // Unresolved: reported by the type check (TS2307)
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf-8')) as { private?: boolean; exports?: unknown };
  if (manifest.private) return `a private package dependents can't install`;
  const subpath = `.${specifier.slice(name.length)}`;
  const exportsMap = manifest.exports;
  const target = typeof exportsMap === 'string' || Array.isArray(exportsMap)
    ? (subpath === '.' ? exportsMap : undefined)
    : exportsMap && typeof exportsMap === 'object' ? exportTarget(exportsMap as Record<string, unknown>, subpath) : undefined;
  if (exportsMap !== undefined && !publishedTarget(target)) {
    return `which ${name} doesn't export to installed dependents: in a checkout it resolves only under the `
      + `${SOURCE_CONDITION} condition, and the published manifest drops the entry`;
  }
  return null;
}

/** The pack's compiler options for checking the bundle: its tsconfig, resolving as the bundler did, with the bundle's own declarations checked */
function checkOptions(packDir: string): ts.CompilerOptions {
  const base = readPackCompilerConfiguration(packDir)?.options
    ?? { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, strict: true };
  // No customConditions: the gate compiles the facade the way an installed dependent does, against the
  // packages' published declarations
  return { ...base, noEmit: true, skipLibCheck: false, customConditions: undefined, allowImportingTsExtensions: true };
}

/** Names a top-level statement declares */
function declaredNames(statement: ts.Statement): string[] {
  if (ts.isVariableStatement(statement)) {
    return statement.declarationList.declarations.flatMap((d) => (ts.isIdentifier(d.name) ? [d.name.text] : []));
  }
  if (ts.isImportDeclaration(statement)) {
    const clause = statement.importClause;
    if (!clause) return [];
    const bindings = clause.namedBindings;
    return [
      ...(clause.name ? [clause.name.text] : []),
      ...(bindings && ts.isNamespaceImport(bindings) ? [bindings.name.text] : []),
      ...(bindings && ts.isNamedImports(bindings) ? bindings.elements.map((e) => e.name.text) : []),
    ];
  }
  const name = (statement as { name?: ts.Node }).name;
  return name && ts.isIdentifier(name) ? [name.text] : [];
}

/** Identifiers a statement references, leaving out property names and the right side of qualified names */
function referencedNames(node: ts.Node, into: Set<string> = new Set()): Set<string> {
  if (ts.isIdentifier(node)) {
    const parent = node.parent;
    const isMemberName = parent && (
      ((ts.isPropertySignature(parent) || ts.isPropertyDeclaration(parent) || ts.isMethodSignature(parent) || ts.isMethodDeclaration(parent)
        || ts.isPropertyAssignment(parent) || ts.isParameter(parent)) && parent.name === node)
      || (ts.isQualifiedName(parent) && parent.right === node)
      || (ts.isPropertyAccessExpression(parent) && parent.name === node)
    );
    if (!isMemberName) into.add(node.text);
  }
  ts.forEachChild(node, (child) => { referencedNames(child, into); });
  return into;
}

/** For each top-level name, the facade exports whose declarations reach it */
function exportsReaching(file: ts.SourceFile): (name: string) => string[] {
  const references = new Map<string, Set<string>>();
  const exported: Array<{ local: string; as: string }> = [];
  for (const statement of file.statements) {
    if (ts.isExportDeclaration(statement) && !statement.moduleSpecifier && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      for (const element of statement.exportClause.elements) {
        exported.push({ local: (element.propertyName ?? element.name).getText(file), as: element.name.getText(file) });
      }
      continue;
    }
    const isExported = ts.canHaveModifiers(statement) && ts.getModifiers(statement)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    for (const name of declaredNames(statement)) {
      const refs = references.get(name) ?? new Set<string>();
      if (!ts.isImportDeclaration(statement)) referencedNames(statement, refs);
      refs.delete(name);
      references.set(name, refs);
      if (isExported) exported.push({ local: name, as: name });
    }
  }
  const reaches = (from: string, target: string, seen = new Set<string>()): boolean => {
    if (from === target) return true;
    if (seen.has(from)) return false;
    seen.add(from);
    return [...(references.get(from) ?? [])].some((next) => references.has(next) && reaches(next, target, seen));
  };
  return (name) => exported.filter((e) => reaches(e.local, name)).map((e) => e.as);
}

/** Module specifiers the facade imports, with the local names each binds */
function importsOf(file: ts.SourceFile): Array<{ specifier: string; node: ts.Node; locals: string[] }> {
  const imports: Array<{ specifier: string; node: ts.Node; locals: string[] }> = [];
  const visit = (node: ts.Node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      imports.push({ specifier: node.moduleSpecifier.text, node, locals: ts.isImportDeclaration(node) ? declaredNames(node) : [] });
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) && ts.isStringLiteral(node.moduleReference.expression)) {
      imports.push({ specifier: node.moduleReference.expression.text, node, locals: [node.name.text] });
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
      imports.push({ specifier: node.argument.literal.text, node, locals: [] });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return imports;
}

/** The top-level statement containing a node, for a location dependents' authors recognize */
function topLevelNames(file: ts.SourceFile, position: number): string[] {
  const statement = file.statements.find((s) => s.getStart(file) <= position && position < s.end);
  return statement ? declaredNames(statement) : [];
}

/**
 * Problems that make a pack's bundled facade types (dist/types/pack-types.d.ts) unusable by the
 * packs that depend on it. Dependents compile the bundle with skipLibCheck, so an invalid
 * declaration or an import they can't resolve silently turns into `any` there; the build catches
 * them instead:
 * - the bundle must type-check on its own, resolving its imports from the pack as the bundler did.
 *   Only the bundle's own diagnostics count: errors inside installed packages' declarations aren't
 *   the pack's.
 * - it may import only packages every dependent has (see allowedPackages), and of @apackdev/* only
 *   what the published packages export (see unpublishedReason).
 */
export function facadeProblems(packDir: string, bundleFile: string): string[] {
  const rel = path.relative(packDir, bundleFile);
  let allowed: ReturnType<typeof allowedPackages>;
  try {
    allowed = allowedPackages(packDir);
  } catch (err) {
    return [`${rel} can't be checked: @apackdev/sdk doesn't resolve from ${packDir} (install the pack's dependencies). ${errorMessage(err)}`];
  }

  const options = checkOptions(packDir);
  const program = ts.createProgram({ rootNames: [bundleFile], options });
  const file = program.getSourceFile(bundleFile);
  if (!file) return [`${rel} doesn't exist`];

  const problems: string[] = [];
  const at = (node: ts.Node | number) => {
    const { line, character } = file.getLineAndCharacterOfPosition(typeof node === 'number' ? node : node.getStart(file));
    return `${rel}:${line + 1}:${character + 1}`;
  };
  const exportsFor = exportsReaching(file);

  const reported = new Set<string>();
  for (const { specifier, node, locals } of importsOf(file)) {
    if (specifier.startsWith('.') || path.isAbsolute(specifier)) {
      problems.push(`${at(node)} imports "${specifier}", a path dependents don't have: facade bundles import only packages`);
      continue;
    }
    const name = packageName(specifier);
    const reason = !allowed.allows(name)
      ? `which dependents don't have: facades may import only ${allowed.description}`
      : name.startsWith('@apackdev/') ? unpublishedReason(packDir, name, specifier) : null;
    if (reason && !reported.has(specifier)) {
      reported.add(specifier);
      const via = [...new Set(locals.flatMap(exportsFor))];
      problems.push(`${at(node)} imports "${specifier}", ${reason}${via.length > 0 ? ` (reached from: ${via.join(', ')})` : ''}`);
    }
    const resolved = ts.resolveModuleName(specifier, bundleFile, options, ts.sys).resolvedModule;
    if (resolved && !DECLARATION_EXTENSIONS.includes(resolved.extension)) {
      problems.push(`${at(node)} imports "${specifier}", which has no type declarations (resolved to ${path.relative(packDir, resolved.resolvedFileName)}): dependents read it as any`);
    }
  }

  // Unresolved imports are among these (TS2307)
  for (const diagnostic of [...program.getSyntacticDiagnostics(file), ...program.getSemanticDiagnostics(file)]) {
    const where = diagnostic.start === undefined ? rel : at(diagnostic.start);
    const names = diagnostic.start === undefined ? [] : topLevelNames(file, diagnostic.start);
    const via = [...new Set(names.flatMap(exportsFor))];
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ');
    const context = [...(names.length > 0 ? [`in ${names.join(', ')}`] : []), ...(via.length > 0 ? [`reached from: ${via.join(', ')}`] : [])];
    problems.push(`${where} error TS${diagnostic.code}: ${message}${context.length > 0 ? ` (${context.join('; ')})` : ''}`);
  }
  return problems;
}
