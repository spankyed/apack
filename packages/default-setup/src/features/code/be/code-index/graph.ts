// Turns a file's sites into edges. It runs after every changed file's definitions are stored, so a site resolves against
// the whole project as it now is, whatever order the files came in; a crash leaves `dirty` set and the next sync drains it.
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { EARS } from '#generated/ears.ts';
import { codeIndexCommands, codeIndexQueries, fileIdOf, projectIdOf, symbolIdOf, type WantedEdge } from './repository.ts';
import { resolveModule, resolveSite, STRATEGY_CONFIDENCE, type FileScope, type PackageInfo, type ProjectTable } from './resolve.ts';
import { extractGraph, type FileGraph, type SiteKind } from './sites.ts';
import type { CompilerAnswer } from './compiler.ts';

const PAGE = 100;

const EDGE_KIND: Readonly<Record<SiteKind, WantedEdge['kind']>> = { call: 'code_calls', reference: 'code_references', inherit: 'code_inherits' };

/** The project as a resolver asks about it, reading the rows the sync just wrote */
export function createProjectTable(project: string, packages: readonly PackageInfo[]): ProjectTable {
  const byDirectory = new Map(packages.map(info => [info.directory, info]));
  const byName = new Map(packages.flatMap((info): [string, PackageInfo][] => (info.name ? [[info.name, info]] : [])));
  return {
    hasFile: file => codeIndexQueries.exists(fileIdOf(project, file)),
    defines: (file, local) => codeIndexQueries.exists(symbolIdOf(project, file, { local, ordinal: 0 })),
    reexports: file => codeIndexQueries.reexportsOf(fileIdOf(project, file)),
    defaultOf: file => codeIndexQueries.defaultOf(fileIdOf(project, file)),
    packageAt: (directory) => {
      for (let at = directory; ; at = path.posix.dirname(at)) {
        const found = byDirectory.get(at);
        if (found) return found;
        if (at === '.' || at === '/') return null;
      }
    },
    packageNamed: name => byName.get(name) ?? null,
  };
}

/** Whether a specifier names something this project should hold, rather than a package from outside it */
function namesProjectFile(table: ProjectTable, specifier: string): boolean {
  if (specifier.startsWith('.') || specifier.startsWith('#')) return true;
  const parts = specifier.split('/');
  return table.packageNamed(specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!) !== null;
}

/**
 * The edges one file's sites make, pair by pair, and what they couldn't follow. `compiler` is what the compiler says
 * each site names, in site order, where it has answered: it outranks syntax, and a site it places outside the checkout
 * has no edge
 */
export function edgesOf(project: string, file: string, graph: FileGraph, table: ProjectTable, compiler?: readonly (CompilerAnswer | undefined)[] | null) {
  const scope: FileScope = {
    path: file,
    imports: new Map(graph.imports.map(binding => [binding.local, binding])),
    callerLocal: site => (site.caller === null ? null : graph.definitions[site.caller]!.local),
  };
  const edges = new Map<string, WantedEdge>();
  const unresolvedNames = new Set<string>();
  let unresolvedSites = 0;
  for (const [index, site] of graph.sites.entries()) {
    const answer = compiler?.[index];
    if (answer === 'outside') continue;
    const resolution = answer && answer !== 'silent'
      ? { status: 'resolved' as const, strategy: 'compiler' as const, target: answer }
      : resolveSite(table, scope, site);
    if (resolution.status === 'unresolved') {
      unresolvedSites++;
      unresolvedNames.add(site.path[site.path.length - 1]!);
      continue;
    }
    if (resolution.status !== 'resolved' || site.caller === null) continue;
    const caller = graph.definitions[site.caller]!;
    const source = symbolIdOf(project, file, caller);
    const target = symbolIdOf(project, resolution.target.path, { local: resolution.target.local, ordinal: 0 });
    if (source === target) continue;
    const kind = EDGE_KIND[site.kind];
    const key = `${kind}\0${source}\0${target}`;
    const edge = edges.get(key);
    const layer = resolution.strategy === 'compiler' ? 'compiler' : resolution.strategy === 'same-module' ? 'extracted' : 'inferred';
    const confidence = resolution.strategy === 'compiler' ? 1 : STRATEGY_CONFIDENCE[resolution.strategy];
    if (edge) { edge.info.sites++; edge.weight += confidence; }
    else edges.set(key, { kind, source, target, info: { layer, sites: 1 }, weight: confidence });
  }
  const imports = new Set<EARS.EntityId<'CodeFile'>>();
  let importsMissing = false;
  for (const specifier of graph.sources) {
    const target = resolveModule(table, file, specifier);
    if (target && target !== file) imports.add(fileIdOf(project, target));
    else if (!target && namesProjectFile(table, specifier)) importsMissing = true;
  }
  return { edges: [...edges.values()], imports: [...imports], importsMissing, unresolvedSites, unresolvedNames: [...unresolvedNames].sort() };
}

/** Resolves every dirty file of a project, a slice at a time, answering which it resolved. A file that can't be read has no edges */
export async function drainDirtyFiles(root: string, packages: readonly PackageInfo[], parsed: Map<string, FileGraph>, signal: AbortSignal, pause: () => Promise<void>, onLeft: (left: number) => void): Promise<string[]> {
  const project = projectIdOf(root);
  const table = createProjectTable(project, packages);
  const drained: string[] = [];
  for (;;) {
    const page = codeIndexQueries.dirtyFiles(project, PAGE);
    if (page.length === 0) return drained;
    for (const file of page) {
      // A file this sync just parsed is held from then, so the parse isn't paid twice
      let graph = parsed.get(file.path);
      parsed.delete(file.path);
      if (!graph && !file.skipped) {
        const source = await fs.readFile(path.join(root, file.path), 'utf8').catch(() => null);
        signal.throwIfAborted();
        const extraction = source === null ? null : extractGraph(file.path, source);
        if (extraction?.ok) graph = extraction;
      }
      const wanted = graph
        ? edgesOf(project, file.path, graph, table)
        : { edges: [], imports: [], importsMissing: false, unresolvedSites: 0, unresolvedNames: [] };
      codeIndexCommands.applyEdges(fileIdOf(project, file.path), wanted);
      if (graph) drained.push(file.path);
      await pause();
    }
    onLeft(codeIndexQueries.dirtyCount(project));
  }
}

/**
 * Lays the compiler's answers over the syntax edges of files just resolved. Without answers (the worker couldn't, or
 * a file it doesn't read) a file keeps the syntax edges the drain wrote
 */
export async function applyCompilerAnswers(root: string, packages: readonly PackageInfo[], answers: ReadonlyMap<string, CompilerAnswer[] | null>, signal: AbortSignal, pause: () => Promise<void>): Promise<void> {
  const project = projectIdOf(root);
  const table = createProjectTable(project, packages);
  for (const [file, answered] of answers) {
    if (!answered) continue;
    const source = await fs.readFile(path.join(root, file), 'utf8').catch(() => null);
    signal.throwIfAborted();
    const graph = source === null ? null : extractGraph(file, source);
    // Answers are in the order of the graph the worker parsed; a file changed since then is re-read by the next sync
    if (!graph?.ok || graph.sites.length !== answered.length) continue;
    codeIndexCommands.applyEdges(fileIdOf(project, file), edgesOf(project, file, graph, table, answered));
    await pause();
  }
}
