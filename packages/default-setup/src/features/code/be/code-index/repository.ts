// The code index's rows. A row's id is derived from what it names, so a save finds the row it had without a lookup, and
// a symbol that still exists keeps its id, which is what will keep other files' edges into it.
import { createHash } from 'node:crypto';
import { EARS, create, query, transact, upsert, write } from '#generated/ears.ts';
import type { CodeLanguage, Definition, SymbolKind } from './extract.ts';

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

const TEST_PATH = /(^|\/)(tests?|__tests__|e2e|fixtures?)\/|\.(spec|test)\.[^/]+$/;

/** A hit of a symbol search, as the panel lists it */
export interface SymbolResult {
  id: EARS.EntityId;
  name: string;
  kind: SymbolKind;
  signature: string;
  path: string;
  test: boolean;
}

/** What the status line shows: a project with no row is simply off */
export interface CodeIndexStatus {
  enabled: boolean;
  progress: CodeIndexProgress | null;
}

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

  symbolCount: (project: string): number => query(EARS.Entity.CodeSymbol).where('project', project).count(),

  symbol: (id: EARS.EntityId): CodeSymbolEntity | undefined => query.ids(id).ofType(EARS.Entity.CodeSymbol).pickOne() ?? undefined,

  file: (id: string): CodeFileEntity | undefined => query.ids(id as EARS.EntityId).ofType(EARS.Entity.CodeFile).pickOne() ?? undefined,

  /** The symbols a text finds in a project, most relevant first, with test files after the rest */
  searchSymbols: (root: string, text: string, limit: number): SymbolResult[] => {
    if (!text.trim()) return [];
    const project = projectIdOf(root);
    const hits = query(EARS.Entity.CodeSymbol)
      .where('project', project)
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
  applyFile: (project: string, file: { path: string; oid: string; language: CodeLanguage; skipped?: SkipReason }, definitions: readonly Definition[]): { written: number; removed: number; added: number } => {
    const fileId = fileIdOf(project, file.path);
    return transact(() => {
      upsert(EARS.Entity.CodeFile, {
        id: fileId, project, path: file.path, oid: file.oid, language: file.language, test: TEST_PATH.test(file.path),
        ...(file.skipped && { skipped: file.skipped }),
      });
      const held = new Map(codeIndexQueries.fileSymbols(fileId).map(row => [row.id as string, row]));
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
      return { written, removed: held.size, added };
    });
  },

  /** A file that is gone, and its symbols. Answers how many symbols went */
  removeFile: (project: string, path: string): number => {
    const fileId = fileIdOf(project, path);
    return transact(() => {
      const symbols = codeIndexQueries.fileSymbols(fileId);
      for (const symbol of symbols) write(symbol.id as EARS.EntityId<'CodeSymbol'>).destroy();
      if (query.ids(fileId).exists()) write(fileId).destroy();
      return symbols.length;
    });
  },

  removeProject: (root: string): void => { write(projectIdOf(root)).destroy(); },
};
