// The code index's rows. A row's id is derived from what it names, so a save finds the row it had without a lookup, and
// a symbol that still exists keeps its id, which is what will keep other files' edges into it.
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { findRelations, removeRelation } from '@apackdev/sdk/ears';
import { EARS, create, query, transact, upsert, write } from '#generated/ears.ts';
import { extractFile, type CodeLanguage, type Definition, type SymbolKind } from './extract.ts';
import type { Reexport } from './sites.ts';

export type SkipReason = 'too-large' | 'not-utf8' | 'parse-error';

/** Where a project's index stands: what the status line shows, written while a sync runs */
export interface CodeIndexProgress {
  state: 'syncing' | 'idle' | 'not-git' | 'removing' | 'error';
  files: number;
  symbols: number;
  pending: number;
  skipped: Partial<Record<SkipReason, number>>;
  error?: string;
}

export interface CodeProjectEntity {
  id: EARS.EntityId;
  entityType: EARS.Entity.CodeProject;
  root: string;
  enabled: boolean;
  /** What the extractor answered when this project was last wholly in sync (`extractorStamp`) */
  extractorStamp?: string;
  progress: CodeIndexProgress;
  createdAt: number;
  updatedAt: number;
}

export interface CodeFileEntity {
  id: EARS.EntityId;
  entityType: EARS.Entity.CodeFile;
  project: string;
  path: string;
  oid: string;
  language: CodeLanguage;
  test: boolean;
  skipped?: SkipReason;
  /** What it re-exports, which a resolver follows without parsing it */
  reexports?: Reexport[];
  /** The local name of what its default export is */
  defaultExport?: string;
  /** The names it asks other files for: a change to one is what makes this file's edges out of date */
  wantedNames?: string[];
  /** Its edges may be out of date: the work queue, written in the unit that makes it so, so a crash loses nothing */
  dirty?: boolean;
  /** Whether an import of a file in the project found none, so that a new file may be what it wants */
  importsMissing?: boolean;
  /** How many of its sites syntax can't take further */
  unresolvedSites?: number;
  /** The last name of each of those, once: `f` for `x.f()`, what any definition named `f` must count against "no callers" */
  unresolvedNames?: string[];
  createdAt: number;
  updatedAt: number;
}

export interface CodeSymbolEntity {
  id: EARS.EntityId;
  entityType: EARS.Entity.CodeSymbol;
  project: string;
  file: string;
  kind: SymbolKind;
  name: string;
  qualifiedName: string;
  exported: boolean;
  signature: string;
  signatureHash: string;
  bodyHash: string;
  createdAt: number;
  updatedAt: number;
}

const hashId = (...parts: readonly (string | number)[]) =>
  createHash('sha1').update(parts.join('\0')).digest('base64url').slice(0, 22).replaceAll('-', '_');

export const projectIdOf = (root: string) => `CodeProject-${hashId(root)}` as EARS.EntityId<'CodeProject'>;
export const fileIdOf = (project: string, path: string) => `CodeFile-${hashId(project, path)}` as EARS.EntityId<'CodeFile'>;
export const symbolIdOf = (project: string, path: string, definition: Pick<Definition, 'local' | 'ordinal'>) =>
  `CodeSymbol-${hashId(project, path, definition.local, definition.ordinal)}` as EARS.EntityId<'CodeSymbol'>;

/** What an edge says about itself: how it was found, and how many sites it stands for */
export interface CodeEdgeInfo {
  layer: 'extracted' | 'inferred' | 'compiler';
  sites: number;
}

/** An edge that should exist from a file's definitions */
export interface WantedEdge {
  kind: 'code_calls' | 'code_references' | 'code_inherits';
  source: EARS.EntityId<'CodeSymbol'>;
  target: EARS.EntityId<'CodeSymbol'>;
  info: CodeEdgeInfo;
  weight: number;
}

const EDGE_KINDS = [EARS.RelKind.CODE_CALLS, EARS.RelKind.CODE_REFERENCES, EARS.RelKind.CODE_INHERITS] as const;

const TEST_PATH = /(^|\/)(tests?|__tests__|e2e|fixtures?)\/|\.(spec|test)\.[^/]+$/;

/**
 * Marks dirty whatever asks for one of these names, and through a file that re-exports one under another name, whatever
 * asks for that. By name rather than by importer, because a file with hundreds of importers gaining an export changes
 * almost none of them; only a default, which every file has, goes by who imports this one.
 */
function markWantedDirty(project: string, fileId: EARS.EntityId<'CodeFile'>, changed: Iterable<string>): void {
  const seen = new Set<string>();
  const queue = [...changed];
  while (queue.length > 0) {
    const name = queue.pop()!;
    if (seen.has(name)) continue;
    seen.add(name);
    const wanting = name === 'default'
      ? query(EARS.Entity.CodeFile).linkedTo(EARS.RelKind.CODE_IMPORTS, fileId).pick(['reexports', 'dirty'])
      : query(EARS.Entity.CodeFile).where('wantedNames', name).where('project', project).pick(['reexports', 'dirty']);
    for (const file of wanting) {
      if (!file.dirty) write(file.id).set('dirty', true);
      for (const reexport of file.reexports ?? []) if (reexport.imported === name && reexport.exported !== '*') queue.push(reexport.exported);
    }
  }
}

const headOf = (local: string) => (local.startsWith('<') ? local : local.split('.', 1)[0]!);

/** A hit of a symbol search, as the panel lists it */
export interface SymbolResult {
  id: EARS.EntityId;
  name: string;
  kind: SymbolKind;
  signature: string;
  path: string;
  test: boolean;
}

/** What an answer couldn't see, which "no callers" is only ever said beside */
export interface CodeIndexCoverage {
  /** Files whose edges may be out of date right now */
  pendingFiles: number;
  /** Files holding a call or reference to this name on something syntax can't type, any of which may be this */
  unresolvedFiles: number;
}

/** One end of an edge, as a list shows it */
export interface SymbolEdgeResult extends SymbolResult {
  edge: string;
  sites: number;
  layer: CodeEdgeInfo['layer'];
}

export interface SymbolEdges {
  results: SymbolEdgeResult[];
  coverage: CodeIndexCoverage;
}

/** What the status line shows: a project with no row is simply off */
export interface CodeIndexStatus {
  enabled: boolean;
  progress: CodeIndexProgress | null;
}

const dirtyCount = (project: string) => query(EARS.Entity.CodeFile).where('dirty', true).where('project', project).count();

export const codeIndexQueries = {
  project: (root: string): CodeProjectEntity | undefined => query.ids(projectIdOf(root)).ofType(EARS.Entity.CodeProject).pickOne() ?? undefined,

  projectOf: (id: string): CodeProjectEntity | undefined => query.ids(id as EARS.EntityId).ofType(EARS.Entity.CodeProject).pickOne() ?? undefined,

  status: (root: string): CodeIndexStatus => {
    const project = codeIndexQueries.project(root);
    return { enabled: project?.enabled ?? false, progress: project?.progress ?? null };
  },

  /** The next page of a project's file rows after `after`, in id order: a project's rows are too many for one read to hold the event loop */
  filesPage: (project: string, after: EARS.EntityId | undefined, limit: number) => {
    const rows = query(EARS.Entity.CodeFile).where('project', project);
    return (after ? rows.after(after) : rows).limit(limit).pick(['path', 'oid', 'skipped']);
  },

  fileSymbols: (file: string): CodeSymbolEntity[] => query(EARS.Entity.CodeSymbol).where('file', file).pickAll(),

  /** The next files whose edges are out of date */
  dirtyFiles: (project: string, limit: number) => query(EARS.Entity.CodeFile).where('dirty', true).where('project', project).limit(limit).pick(['path', 'skipped']),

  dirtyCount,

  /** What a file re-exports */
  reexportsOf: (file: EARS.EntityId<'CodeFile'>): readonly Reexport[] => query.ids(file).ofType(EARS.Entity.CodeFile).pickOne()?.reexports ?? [],

  /** The local name of what a file's default export is */
  defaultOf: (file: EARS.EntityId<'CodeFile'>): string | null => query.ids(file).ofType(EARS.Entity.CodeFile).pickOne()?.defaultExport ?? null,

  exists: (id: EARS.EntityId): boolean => query.ids(id).exists(),

  symbolCount: (project: string): number => query(EARS.Entity.CodeSymbol).where('project', project).count(),

  symbol: (id: EARS.EntityId): CodeSymbolEntity | undefined => query.ids(id).ofType(EARS.Entity.CodeSymbol).pickOne() ?? undefined,

  file: (id: string): CodeFileEntity | undefined => query.ids(id as EARS.EntityId).ofType(EARS.Entity.CodeFile).pickOne() ?? undefined,

  /** The symbols a text finds in a checkout, or in every indexed one, most relevant first, with test files after the rest */
  searchSymbols: (root: string | null, text: string, limit: number): SymbolResult[] => {
    if (!text.trim()) return [];
    const symbols = query(EARS.Entity.CodeSymbol);
    // Without a checkout, every indexed one: turning a checkout off deletes its rows, so there is nothing else to exclude
    const hits = (root ? symbols.where('project', projectIdOf(root)) : symbols)
      .search(text, { prefix: true })
      .limit(limit)
      .hits({ fields: ['name', 'kind', 'signature', 'file'] });
    const files = new Map<string, CodeFileEntity>();
    const fileOf = (id: string) => {
      let file = files.get(id);
      if (!file) { file = codeIndexQueries.file(id); if (file) files.set(id, file); }
      return file;
    };
    const results = hits.flatMap((hit): SymbolResult[] => {
      const file = fileOf(hit.row.file);
      return file ? [{ id: hit.id, name: hit.row.name, kind: hit.row.kind, signature: hit.row.signature, path: file.path, test: file.test }] : [];
    });
    return [...results.filter(result => !result.test), ...results.filter(result => result.test)];
  },
};

function edgeEnds(rows: readonly { kind: string; other: string; info: unknown }[]): SymbolEdgeResult[] {
  const results = rows.flatMap((row): SymbolEdgeResult[] => {
    const symbol = codeIndexQueries.symbol(row.other as EARS.EntityId);
    const file = symbol && codeIndexQueries.file(symbol.file);
    const info = row.info as CodeEdgeInfo;
    return symbol && file ? [{ id: symbol.id, name: symbol.name, kind: symbol.kind, signature: symbol.signature, path: file.path, test: file.test, edge: row.kind, sites: info.sites, layer: info.layer }] : [];
  });
  return results.sort((a, b) => Number(a.test) - Number(b.test) || b.sites - a.sites || a.path.localeCompare(b.path));
}

const isEdgeKind = (kind: string) => (EDGE_KINDS as readonly string[]).includes(kind);

const MAP_FRONTIER = 30;
const MAP_SECOND_STEP = 0.25;

/** What a symbol is joined to either way, and how strongly */
function neighbours(id: string): { other: string; weight: number }[] {
  const entity = id as EARS.EntityId;
  return [
    ...findRelations({ source: entity }).filter(edge => isEdgeKind(edge.kind)).map(edge => ({ other: edge.target as string, weight: edge.weight ?? 1 })),
    ...findRelations({ target: entity }).filter(edge => isEdgeKind(edge.kind)).map(edge => ({ other: edge.source as string, weight: edge.weight ?? 1 })),
  ];
}

/** Queries an answer reads, beside the ones the sync does */
export const codeIndexAnswers = {
  /**
   * A symbol, its name within its file (`Class.method`), and where it is now, read by parsing its file: no row holds a
   * position, so a line moving writes nothing
   */
  locate: async (id: EARS.EntityId): Promise<{ symbol: CodeSymbolEntity; local: string; location: { path: string; line: number; column: number } } | null> => {
    const symbol = codeIndexQueries.symbol(id);
    const file = symbol && codeIndexQueries.file(symbol.file);
    const project = symbol && codeIndexQueries.projectOf(symbol.project);
    if (!symbol || !file || !project) return null;
    const absolute = path.join(project.root, file.path);
    // A file can go from disk before the index notices: that is a symbol not found, not a failure
    const source = await fs.readFile(absolute, 'utf8').catch(() => null);
    const extraction = source === null ? null : extractFile(file.path, source);
    if (!extraction?.ok) return null;
    // A file edited since the index last read it may no longer hold the symbol, which is then not found either
    const definition = extraction.definitions.find(candidate => symbolIdOf(symbol.project, file.path, candidate) === symbol.id);
    if (!definition) return null;
    // An editor's columns count from 1, a syntax tree's from 0
    return { symbol, local: symbol.qualifiedName.slice(file.path.length + 1), location: { path: absolute, line: definition.line, column: definition.column + 1 } };
  },

  /** What calls, refers to or extends a symbol, tests after the rest, beside what that can't see */
  callers: (id: EARS.EntityId): SymbolEdges | null => {
    const symbol = codeIndexQueries.symbol(id);
    if (!symbol) return null;
    const rows = findRelations({ target: id }).filter(row => isEdgeKind(row.kind)).map(row => ({ kind: row.kind, other: row.source, info: row.info }));
    return {
      results: edgeEnds(rows),
      coverage: {
        pendingFiles: dirtyCount(symbol.project),
        unresolvedFiles: query(EARS.Entity.CodeFile).where('unresolvedNames', symbol.name).where('project', symbol.project).count(),
      },
    };
  },

  /** What a symbol calls, refers to or extends, beside how much of its own file syntax couldn't follow */
  callees: (id: EARS.EntityId): SymbolEdges | null => {
    const symbol = codeIndexQueries.symbol(id);
    if (!symbol) return null;
    const rows = findRelations({ source: id }).filter(row => isEdgeKind(row.kind)).map(row => ({ kind: row.kind, other: row.target, info: row.info }));
    const file = codeIndexQueries.file(symbol.file);
    return { results: edgeEnds(rows), coverage: { pendingFiles: dirtyCount(symbol.project), unresolvedFiles: file?.unresolvedSites ? 1 : 0 } };
  },

  /**
   * The definitions most relevant to a file: what its own touch, weighted by how much, and then, more faintly, what
   * those touch, each share divided among its edges so that a hub doesn't pull in everything it knows. A walk rather
   * than a seeded `rank`, which read 110 ms over this repository's whole graph on the event loop and again after every
   * commit to any edge, where this reads only the edges near the file.
   */
  codeMap: (root: string, path: string, limit: number): SymbolResult[] => {
    const project = projectIdOf(root);
    const seeds = codeIndexQueries.fileSymbols(fileIdOf(project, path)).map(symbol => symbol.id as string);
    const own = new Set(seeds);
    const scores = new Map<string, number>();
    const spread = (from: readonly string[], share: (edges: number) => number) => {
      for (const id of from) {
        const edges = neighbours(id);
        const each = share(edges.length);
        for (const { other, weight } of edges) if (!own.has(other)) scores.set(other, (scores.get(other) ?? 0) + weight * each);
      }
    };
    spread(seeds, () => 1);
    const nearest = [...scores].sort((a, b) => b[1] - a[1]).slice(0, MAP_FRONTIER).map(([id]) => id);
    spread(nearest, edges => MAP_SECOND_STEP / edges);
    const results: SymbolResult[] = [];
    for (const [id] of [...scores].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
      if (results.length === limit) break;
      const symbol = codeIndexQueries.symbol(id as EARS.EntityId);
      const file = symbol && codeIndexQueries.file(symbol.file);
      if (symbol && file && !file.test) results.push({ id: symbol.id, name: symbol.name, kind: symbol.kind, signature: symbol.signature, path: file.path, test: false });
    }
    return results;
  },
};

export const codeIndexCommands = {
  /** Turns a project on, or marks it for removal; the sync does the rest */
  setEnabled: (root: string, enabled: boolean): void => {
    const id = projectIdOf(root);
    const project = codeIndexQueries.project(root);
    if (project) { write(id).set('enabled', enabled); return; }
    if (enabled) create(EARS.Entity.CodeProject, { id, root, enabled, progress: { state: 'syncing', files: 0, symbols: 0, pending: 0, skipped: {} } });
  },

  setProgress: (root: string, progress: CodeIndexProgress): void => { write(projectIdOf(root)).set('progress', progress); },

  setStamp: (root: string, stamp: string): void => { write(projectIdOf(root)).set('extractorStamp', stamp); },

  /**
   * One file's state in one unit, so a crash leaves it wholly before or wholly after. `definitions` is what the file
   * holds now; a symbol whose fields didn't move writes nothing, and one that still exists is never replaced. Answers
   * how many rows the symbols changed by.
   */
  applyFile: (
    project: string,
    file: { path: string; oid: string; language: CodeLanguage; skipped?: SkipReason; reexports: readonly Reexport[]; defaultLocal: string | null; wantedNames: readonly string[] },
    definitions: readonly Definition[],
    /** Nothing has edges yet, so nothing can depend on this */
    firstIndex = false,
  ): { written: number; removed: number; added: number } => {
    const fileId = fileIdOf(project, file.path);
    return transact(() => {
      const before = query.ids(fileId).ofType(EARS.Entity.CodeFile).pickOne();
      upsert(EARS.Entity.CodeFile, {
        id: fileId, project, path: file.path, oid: file.oid, language: file.language, test: TEST_PATH.test(file.path), dirty: true,
        ...(file.skipped && { skipped: file.skipped }),
        ...(file.reexports.length > 0 && { reexports: [...file.reexports] }),
        ...(file.defaultLocal && { defaultExport: file.defaultLocal }),
        ...(file.wantedNames.length > 0 && { wantedNames: [...file.wantedNames] }),
      });
      // An upsert keeps a field it isn't given
      if (!file.skipped && before?.skipped) write(fileId).delete('skipped');
      if (file.reexports.length === 0 && before?.reexports) write(fileId).delete('reexports');
      if (!file.defaultLocal && before?.defaultExport) write(fileId).delete('defaultExport');
      if (file.wantedNames.length === 0 && before?.wantedNames) write(fileId).delete('wantedNames');
      const held = new Map(codeIndexQueries.fileSymbols(fileId).map(row => [row.id as string, row]));
      const headsBefore = new Set([...held.values()].map(row => headOf(row.qualifiedName.slice(file.path.length + 1))));
      let written = 0;
      let added = 0;
      for (const definition of definitions) {
        const id = symbolIdOf(project, file.path, definition);
        const row = {
          kind: definition.kind, name: definition.name, qualifiedName: `${file.path}#${definition.local}`, exported: definition.exported,
          signature: definition.signature, signatureHash: definition.signatureHash, bodyHash: definition.bodyHash,
        };
        const current = held.get(id);
        held.delete(id);
        if (!current) {
          create(EARS.Entity.CodeSymbol, { id, project, file: fileId, ...row });
          written++;
          added++;
        } else if ((Object.keys(row) as (keyof typeof row)[]).some(key => current[key] !== row[key])) {
          write(id).setMany(row);
          written++;
        }
      }
      for (const id of held.keys()) write(id as EARS.EntityId<'CodeSymbol'>).destroy();
      if (!firstIndex) {
        // What others can resolve here moved, so what they resolved may have. A new file may be what an import wanted
        const headsNow = new Set(definitions.map(definition => headOf(definition.local)));
        const changed = new Set([...headsNow].filter(head => !headsBefore.has(head)));
        for (const head of headsBefore) if (!headsNow.has(head)) changed.add(head);
        if ((before?.defaultExport ?? null) !== file.defaultLocal) changed.add('default');
        const reexportsBefore = before?.reexports ?? [];
        const reexportKey = (reexport: Reexport) => `${reexport.exported}\0${reexport.imported}\0${reexport.source}`;
        const keysNow = new Set(file.reexports.map(reexportKey));
        const keysBefore = new Set(reexportsBefore.map(reexportKey));
        const movedReexports = [...file.reexports.filter(reexport => !keysBefore.has(reexportKey(reexport))), ...reexportsBefore.filter(reexport => !keysNow.has(reexportKey(reexport)))];
        for (const reexport of movedReexports) changed.add(reexport.exported);
        // `export *` passes on names nobody can list here, so whoever imports this file looks again
        if (changed.delete('*')) for (const importer of query(EARS.Entity.CodeFile).linkedTo(EARS.RelKind.CODE_IMPORTS, fileId).pick(['path'])) write(importer.id).set('dirty', true);
        markWantedDirty(project, fileId, changed);
        if (!before) for (const waiting of query(EARS.Entity.CodeFile).where('importsMissing', true).where('project', project).pick(['path'])) write(waiting.id).set('dirty', true);
      }
      return { written, removed: held.size, added };
    });
  },

  /** A file that is gone, and its symbols. Answers how many symbols went */
  removeFile: (project: string, path: string): number => {
    const fileId = fileIdOf(project, path);
    return transact(() => {
      const symbols = codeIndexQueries.fileSymbols(fileId);
      const row = query.ids(fileId).ofType(EARS.Entity.CodeFile).pickOne();
      for (const importer of query(EARS.Entity.CodeFile).linkedTo(EARS.RelKind.CODE_IMPORTS, fileId).pick(['path'])) write(importer.id).set('dirty', true);
      markWantedDirty(project, fileId, [
        ...symbols.map(symbol => headOf(symbol.qualifiedName.slice(path.length + 1))),
        ...(row?.reexports ?? []).map(reexport => reexport.exported).filter(name => name !== '*'),
      ]);
      for (const symbol of symbols) write(symbol.id as EARS.EntityId<'CodeSymbol'>).destroy();
      if (query.ids(fileId).exists()) write(fileId).destroy();
      return symbols.length;
    });
  },

  removeProject: (root: string): void => { write(projectIdOf(root)).destroy(); },

  /**
   * A file's edges as they should now be, in one unit that clears `dirty`. An edge that hasn't moved writes nothing, so
   * a save that changes nothing another file can see writes only its own row.
   */
  applyEdges: (fileId: EARS.EntityId<'CodeFile'>, wanted: { edges: readonly WantedEdge[]; imports: readonly EARS.EntityId<'CodeFile'>[]; importsMissing: boolean; unresolvedSites: number; unresolvedNames: readonly string[] }): void => {
    transact(() => {
      const desired = new Map(wanted.edges.map(edge => [`${edge.kind}\0${edge.source}\0${edge.target}`, edge]));
      for (const symbol of codeIndexQueries.fileSymbols(fileId)) {
        for (const relation of findRelations({ source: symbol.id })) {
          if (!isEdgeKind(relation.kind)) continue;
          const key = `${relation.kind}\0${relation.source}\0${relation.target}`;
          const edge = desired.get(key);
          if (!edge) removeRelation(relation.id);
          else if (relation.weight === edge.weight || edge.kind === 'code_inherits') {
            const info = relation.info as CodeEdgeInfo | undefined;
            if (info?.layer === edge.info.layer && info.sites === edge.info.sites) desired.delete(key);
          }
        }
      }
      for (const edge of desired.values()) {
        if (edge.kind === 'code_inherits') write(edge.source).link(EARS.RelKind.CODE_INHERITS, edge.target, { info: { ...edge.info } });
        else write(edge.source).link(edge.kind === 'code_calls' ? EARS.RelKind.CODE_CALLS : EARS.RelKind.CODE_REFERENCES, edge.target, { info: { ...edge.info }, weight: edge.weight });
      }
      const importing = new Set<string>(wanted.imports);
      for (const relation of findRelations({ source: fileId, kind: EARS.RelKind.CODE_IMPORTS })) {
        if (!importing.delete(relation.target)) removeRelation(relation.id);
      }
      for (const target of importing) write(fileId).link(EARS.RelKind.CODE_IMPORTS, target as EARS.EntityId, { info: { layer: 'inferred' } });
      const file = write(fileId).delete('dirty').set('unresolvedSites', wanted.unresolvedSites);
      file.set('importsMissing', wanted.importsMissing);
      if (wanted.unresolvedNames.length > 0) file.set('unresolvedNames', [...wanted.unresolvedNames]); else file.delete('unresolvedNames');
    });
  },
};
