#!/usr/bin/env node
/**
 * How far the code index's syntax resolver can be trusted, measured against TypeScript's own compiler over a real
 * repository: for each call or reference site in a `.ts` or `.tsx` file, what the compiler says it means against what
 * the resolver says, by strategy and by how the site is written.
 *
 *     npx tsx scripts/code-index-evaluate.ts <repository> [<repository> ...]
 *
 * Reads the repository's tracked files and writes nothing. Run it when the resolver changes; its figures size the
 * confidence table in `resolve.ts`'s callers and what `docs/plans/code-index.md` says the syntax layer may claim.
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import ts from 'typescript';
import { languageOf, type Definition } from '../src/features/code/be/code-index/extract.ts';
import { extractGraph, type FileGraph, type ImportBinding, type Site } from '../src/features/code/be/code-index/sites.ts';
import { resolveSite, type FileScope, type PackageInfo, type ProjectTable } from '../src/features/code/be/code-index/resolve.ts';

function evaluate(root: string): void {
  const startedAt = Date.now();
  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 30 }).split('\0').filter(Boolean);
  const files = tracked.filter(file => languageOf(file) && !file.endsWith('.d.ts') && fs.statSync(path.join(root, file), { throwIfNoEntry: false })?.isFile());
  const graphs = new Map<string, FileGraph>();
  for (const file of files) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    if (source.length > 512 * 1024) continue;
    const graph = extractGraph(file, source);
    if (graph.ok) graphs.set(file, graph);
  }

  const packages = new Map<string, PackageInfo>();
  const packagesByName = new Map<string, PackageInfo>();
  for (const file of tracked.filter(entry => path.posix.basename(entry) === 'package.json')) {
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')) as PackageInfo & { name?: string };
      const info: PackageInfo = { directory: path.posix.dirname(file), name: manifest.name, imports: manifest.imports, exports: manifest.exports };
      packages.set(info.directory, info);
      if (info.name) packagesByName.set(info.name, info);
    } catch { /* A manifest that doesn't parse names no package */ }
  }
  const locals = new Map<string, Set<string>>();
  for (const [file, graph] of graphs) locals.set(file, new Set(graph.definitions.map(definition => definition.local)));
  const table: ProjectTable = {
    hasFile: file => graphs.has(file),
    defines: (file, local) => locals.get(file)?.has(local) ?? false,
    reexports: file => graphs.get(file)?.reexports ?? [],
    defaultOf: file => graphs.get(file)?.defaultLocal ?? null,
    packageAt: (directory) => {
      for (let at = directory; ; at = path.posix.dirname(at)) {
        const found = packages.get(at);
        if (found) return found;
        if (at === '.' || at === '/') return null;
      }
    },
    packageNamed: name => packagesByName.get(name) ?? null,
  };

  // The compiler, over the same files. A `.vue` file is outside what it reads, so only `.ts` and `.tsx` are compared
  const configPath = ts.findConfigFile(root, ts.sys.fileExists);
  const configured = configPath ? ts.parseJsonConfigFileContent(ts.readConfigFile(configPath, ts.sys.readFile).config, ts.sys, root).options : {};
  const roots = [...graphs.keys()].filter(file => /\.(ts|tsx|mts|cts)$/.test(file)).map(file => path.join(root, file));
  const program = ts.createProgram(roots, {
    ...configured, noEmit: true, skipLibCheck: true, allowJs: false, composite: false, incremental: false, declaration: false,
    allowImportingTsExtensions: true, resolveJsonModule: true,
    moduleResolution: ts.ModuleResolutionKind.Bundler, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext,
    customConditions: [...(configured.customConditions ?? []), '@apackdev/source'], jsx: ts.JsxEmit.Preserve,
  });
  const checker = program.getTypeChecker();

  const owner = (declaration: ts.Declaration): { path: string; definition: Definition } | null => {
    const file = path.relative(root, declaration.getSourceFile().fileName).split(path.sep).join('/');
    const graph = graphs.get(file);
    if (!graph) return null;
    // The name, since a declaration's own start is its `export`, which a syntax tree's definition starts after
    const at = (ts.getNameOfDeclaration(declaration) ?? declaration).getStart();
    let best: Definition | null = null;
    for (const definition of graph.definitions) {
      if (definition.start <= at && at < definition.end && (!best || definition.end - definition.start <= best.end - best.start)) best = definition;
    }
    return best && { path: file, definition: best };
  };

  type Counts = { sites: number; compilerFound: number; resolved: number; correct: number; wrong: number; missed: number; external: number; compilerSilent: number };
  const empty = (): Counts => ({ sites: 0, compilerFound: 0, resolved: 0, correct: 0, wrong: 0, missed: 0, external: 0, compilerSilent: 0 });
  const byStrategy = new Map<string, Counts>();
  const byForm = new Map<string, Counts>();
  const bump = (map: Map<string, Counts>, key: string) => { let counts = map.get(key); if (!counts) map.set(key, counts = empty()); return counts; };
  const wrongSamples: string[] = [];

  for (const [file, graph] of graphs) {
    if (!/\.(ts|tsx|mts|cts)$/.test(file)) continue;
    const source = program.getSourceFile(path.join(root, file));
    if (!source) continue;
    const imports = new Map<string, ImportBinding>(graph.imports.map(binding => [binding.local, binding]));
    const scope: FileScope = {
      path: file, imports,
      callerLocal: site => (site.caller === null ? null : graph.definitions[site.caller]!.local),
    };
    for (const site of graph.sites) {
      const compiler = compilerTarget(checker, source, site, owner);
      const resolution = resolveSite(table, scope, site);
      const strategy = resolution.status === 'resolved' ? resolution.strategy : resolution.status;
      for (const counts of [bump(byStrategy, strategy), bump(byForm, `${site.kind} ${site.form}`)]) {
        counts.sites++;
        if (compiler === 'silent') counts.compilerSilent++;
        else if (compiler === 'outside') {
          if (resolution.status === 'resolved') {
            counts.resolved++; counts.wrong++;
            if (counts === byStrategy.get(strategy) && Math.random() < 0.05 && wrongSamples.length < 14) wrongSamples.push(`${strategy}: ${file}:${site.line} ${site.path.join('.')} -> ${resolution.target.path}#${resolution.target.local}, compiler outside the project`);
          } else counts.external++;
        } else {
          counts.compilerFound++;
          if (resolution.status !== 'resolved') counts.missed++;
          else {
            counts.resolved++;
            if (resolution.target.path === compiler.path && resolution.target.local === compiler.definition.local) counts.correct++;
            else {
              counts.wrong++;
              if (counts === byStrategy.get(strategy) && Math.random() < 0.02 && wrongSamples.length < 14) wrongSamples.push(`${strategy}: ${file}:${site.line} ${site.path.join('.')} -> ${resolution.target.path}#${resolution.target.local}, compiler ${compiler.path}#${compiler.definition.local}`);
            }
          }
        }
      }
    }
  }

  const row = (name: string, c: Counts) => {
    const precision = c.resolved ? (100 * c.correct / c.resolved).toFixed(1) : '-';
    const recall = c.compilerFound ? (100 * c.correct / c.compilerFound).toFixed(1) : '-';
    return `| ${name} | ${c.sites} | ${c.resolved} | ${c.correct} | ${c.wrong} | ${c.missed} | ${precision}% | ${recall}% |`;
  };
  const report = (title: string, map: Map<string, Counts>) => {
    console.log(`\n### ${title}\n\n| | Sites | Resolved | Correct | Wrong | Missed | Precision | Recall |\n|---|---|---|---|---|---|---|---|`);
    for (const key of [...map.keys()].sort()) console.log(row(key, map.get(key)!));
  };
  console.log(`\n## ${path.basename(root)}: ${graphs.size} files, ${roots.length} compared, ${Math.round((Date.now() - startedAt) / 1000)} s`);
  report('By strategy', byStrategy);
  report('By how the site is written', byForm);
  if (wrongSamples.length) console.log(`\nWrong, a sample:\n${wrongSamples.map(sample => `- ${sample}`).join('\n')}`);
}

/** What the compiler says a site's last name is: a definition in the project, something outside it, or nothing it can say */
function compilerTarget(
  checker: ts.TypeChecker, source: ts.SourceFile, site: Site,
  owner: (declaration: ts.Declaration) => { path: string; definition: Definition } | null,
): 'silent' | 'outside' | { path: string; definition: Definition } {
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
  return found ?? 'outside';
}

function findToken(source: ts.SourceFile, position: number): ts.Node | undefined {
  const visit = (node: ts.Node): ts.Node | undefined => {
    if (position < node.getFullStart() || position >= node.getEnd()) return undefined;
    return ts.forEachChild(node, visit) ?? node;
  };
  return visit(source);
}

const repositories = process.argv.slice(2);
if (repositories.length === 0) { console.error('Usage: code-index-evaluate <repository> [...]'); process.exitCode = 2; }
for (const repository of repositories) evaluate(path.resolve(repository));
