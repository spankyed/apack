// What TypeScript's compiler says each site names: the layer that follows `x.f()` through the type of `x`, which syntax
// alone can't. It runs in the code index's worker (`compiler-worker.ts`), off the API's event loop, and in
// `scripts/code-index-evaluate.ts`, which measures the syntax layer against it — so what ships is what is measured.
import * as path from 'node:path';
import ts from 'typescript';
import { languageOf, type Definition } from './extract.ts';
import { extractGraph, type FileGraph, type Site } from './sites.ts';

/** A site's target as the compiler sees it: a definition in the checkout, something outside it, or nothing it can say */
export type CompilerAnswer = 'silent' | 'outside' | { path: string; local: string };

/** The files the compiler reads: `.vue` is outside what it parses, so those stay on the syntax layer */
export const compilerReads = (file: string): boolean => /\.(ts|tsx|mts|cts)$/.test(file) && !file.endsWith('.d.ts');

/** The checkout's own compiler options, loosened to what reading needs: nothing is emitted or checked for errors */
function optionsOf(root: string): ts.CompilerOptions {
  const configPath = ts.findConfigFile(root, ts.sys.fileExists);
  const configured = configPath ? ts.parseJsonConfigFileContent(ts.readConfigFile(configPath, ts.sys.readFile).config, ts.sys, root).options : {};
  return {
    ...configured, noEmit: true, skipLibCheck: true, allowJs: false, composite: false, incremental: false, declaration: false,
    allowImportingTsExtensions: true, resolveJsonModule: true,
    moduleResolution: ts.ModuleResolutionKind.Bundler, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext,
    customConditions: [...(configured.customConditions ?? []), '@apackdev/source'], jsx: ts.JsxEmit.Preserve,
  };
}

/**
 * One checkout as the compiler holds it, kept between asks: a language service whose files are versioned, so a changed
 * file re-checks only what depends on it
 */
export function createCompilerProject(root: string, files: readonly string[]) {
  const versions = new Map<string, number>(files.filter(compilerReads).map(file => [path.join(root, file), 0]));
  const graphs = new Map<string, { version: number; graph: FileGraph | null }>();
  const options = optionsOf(root);
  const host: ts.LanguageServiceHost = {
    getCompilationSettings: () => options,
    getScriptFileNames: () => [...versions.keys()],
    getScriptVersion: file => String(versions.get(file) ?? 0),
    getScriptSnapshot: (file) => {
      const text = ts.sys.readFile(file);
      return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text);
    },
    getCurrentDirectory: () => root,
    getDefaultLibFileName: ts.getDefaultLibFilePath,
    fileExists: ts.sys.fileExists,
    readFile: ts.sys.readFile,
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
  };
  const service = ts.createLanguageService(host, ts.createDocumentRegistry());

  /** A checkout file's syntax graph, parsed once per version: what a declaration is matched to */
  const graphOf = (file: string): FileGraph | null => {
    const absolute = path.join(root, file);
    const version = versions.get(absolute) ?? 0;
    const held = graphs.get(file);
    if (held && held.version === version) return held.graph;
    const text = languageOf(file) ? ts.sys.readFile(absolute) : undefined;
    const parsed = text === undefined ? null : extractGraph(file, text);
    const graph = parsed?.ok ? parsed : null;
    graphs.set(file, { version, graph });
    return graph;
  };

  const owner = (declaration: ts.Declaration) => {
    const relative = path.relative(root, declaration.getSourceFile().fileName);
    if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
    const file = relative.split(path.sep).join('/');
    const graph = graphOf(file);
    return graph && ownerIn(file, graph, declaration);
  };

  return {
    /** Files that moved since the last ask, added, changed or gone */
    changed(changes: readonly { path: string; gone?: boolean }[]): void {
      for (const change of changes) {
        if (!compilerReads(change.path)) continue;
        const absolute = path.join(root, change.path);
        if (change.gone) versions.delete(absolute);
        else versions.set(absolute, (versions.get(absolute) ?? 0) + 1);
        graphs.delete(change.path);
      }
    },
    /** What the compiler says each of a file's sites names, in the order its syntax graph lists them */
    answers(file: string): CompilerAnswer[] | null {
      if (!compilerReads(file)) return null;
      const graph = graphOf(file);
      const program = service.getProgram();
      const source = program?.getSourceFile(path.join(root, file));
      if (!graph || !program || !source) return null;
      const checker = program.getTypeChecker();
      return graph.sites.map(site => compilerTarget(checker, source, site, owner));
    },
  };
}

/** The innermost of a file's definitions that holds a declaration's name */
export function ownerIn(file: string, graph: FileGraph, declaration: ts.Declaration): { path: string; definition: Definition } | null {
  // The name, since a declaration's own start is its `export`, which a syntax tree's definition starts after
  const at = (ts.getNameOfDeclaration(declaration) ?? declaration).getStart();
  let best: Definition | null = null;
  for (const definition of graph.definitions) {
    if (definition.start <= at && at < definition.end && (!best || definition.end - definition.start <= best.end - best.start)) best = definition;
  }
  return best && { path: file, definition: best };
}

/** What the compiler says a site's last name is */
export function compilerTarget(
  checker: ts.TypeChecker, source: ts.SourceFile, site: Site,
  owner: (declaration: ts.Declaration) => { path: string; definition: Definition } | null,
): CompilerAnswer {
  const start = source.getPositionOfLineAndCharacter(site.line - 1, site.column);
  let node: ts.Node | undefined = findToken(source, start);
  if (!node) return 'silent';
  const last = site.path[site.path.length - 1]!;
  // A site's position is its whole expression's start, so walk the chain out to the name the path ends in
  while (node && !(ts.isIdentifier(node) && node.text === last) && !(ts.isPrivateIdentifier(node) && node.text === last)) {
    const parent: ts.Node | undefined = node.parent;
    if (parent && ts.isPropertyAccessExpression(parent) && parent.expression === node) node = parent.name;
    else return 'silent';
  }
  // `{ name }` is a property holding a variable: the site is the variable
  const shorthand = node.parent && ts.isShorthandPropertyAssignment(node.parent) ? checker.getShorthandAssignmentValueSymbol(node.parent) : undefined;
  let symbol = shorthand ?? checker.getSymbolAtLocation(node);
  if (!symbol) return 'silent';
  if (symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
  const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0];
  if (!declaration) return 'silent';
  const found = owner(declaration);
  return found ? { path: found.path, local: found.definition.local } : 'outside';
}

function findToken(source: ts.SourceFile, position: number): ts.Node | undefined {
  const visit = (node: ts.Node): ts.Node | undefined => {
    if (position < node.getFullStart() || position >= node.getEnd()) return undefined;
    return ts.forEachChild(node, visit) ?? node;
  };
  return visit(source);
}
