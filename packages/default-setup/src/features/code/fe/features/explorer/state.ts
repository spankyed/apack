import { given } from '@apackdev/state';
import { state, type PackNet } from '#generated/state.ts';
import type { FileContent as BeFileContent, QuickOpenResult } from '#features/code/be/types.ts';

type CodeAsks = PackNet['systems']['code']['asks'];

// File types
export interface FileInfo {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  modifiedAt?: Date;
  extension?: string;
}

export interface DirectoryContent {
  path: string;
  files: FileInfo[];
}

export interface FileContent {
  path: string;
  content: string;
  encoding: string;
}

// File watching types
export interface FileChangeInfo {
  path: string;
  modifiedAt: Date;
  changeType: 'add' | 'change' | 'unlink';
}

export type { QuickOpenResult };

/** Derive parent directory path from a file/folder path */
function getParentDir(filePath: string): string {
  const parts = filePath.split('/');
  parts.pop();
  return parts.join('/') || '/';
}

export interface CodeExplorerData {
  baseDirectory: string;
  rootFiles: FileInfo[];
  expandedDirs: Set<string>;
  dirContents: Record<string, FileInfo[]>;
  loadingDirs: Set<string>;
  selectedPaths: string[];
  revealPath: string | null;
  pendingEditorMode: Record<string, 'richText' | 'plainText'>;
}

function emptyTreeState(baseDirectory: string): CodeExplorerData {
  return {
    baseDirectory,
    rootFiles: [],
    expandedDirs: new Set(),
    dirContents: {},
    loadingDirs: new Set(),
    selectedPaths: [],
    revealPath: null,
    pendingEditorMode: {},
  };
}

export type CodeExplorerReport =
  | { type: 'EXPLORER_LOADING' }
  | { type: 'EXPLORER_LISTED' }
  | { type: 'EXPLORER_FILE_READ'; file: BeFileContent; editorMode?: 'richText' | 'plainText' }
  | { type: 'EXPLORER_FILE_SAVED'; path: string }
  | { type: 'EXPLORER_FILE_DELETED'; path: string }
  | { type: 'EXPLORER_FILE_RENAMED'; oldPath: string; newPath: string }
  | { type: 'EXPLORER_ERROR'; message: string; notFoundPath?: string }
  | { type: 'EXPLORER_BASE_DIRECTORY_SET'; path: string }
  | { type: 'EXPLORER_QUICK_OPEN_RESULTS'; results: QuickOpenResult[] }
  | { type: 'EXPLORER_QUICK_OPEN_ERROR'; message: string };

export type CodeExplorerEvent =
  | { type: 'explorer.LIST_FILES'; path: string }
  | { type: 'explorer.CREATE_DIRECTORY'; path: string }
  | { type: 'explorer.DELETE_FILE'; path: string }
  | { type: 'explorer.RENAME_FILE'; oldPath: string; newPath: string }
  | { type: 'explorer.OPEN_FILE'; path: string; editorMode?: 'richText' | 'plainText' }
  | { type: 'explorer.OPEN_FILES'; paths: string[] }
  | { type: 'explorer.WRITE_FILE'; path: string; content: string }
  | { type: 'explorer.CLOSE_FILE'; path: string }
  | { type: 'explorer.SET_BASE_DIRECTORY'; path: string }
  // Tree view events
  | { type: 'explorer.EXPAND_DIRECTORY'; path: string }
  | { type: 'explorer.COLLAPSE_DIRECTORY'; path: string }
  | { type: 'explorer.SELECT_ITEMS'; paths: string[] }
  | { type: 'explorer.MOVE_ITEMS'; sourcePaths: string[]; targetDir: string }
  // Quick open events
  | { type: 'explorer.QUICK_OPEN_SEARCH'; baseDirectory: string }
  | { type: 'explorer.COPY_FILES'; sourcePaths: string[]; targetDir: string }
  // Reveal in tree
  | { type: 'explorer.REVEAL_IN_TREE'; path: string }
  | { type: 'explorer.CLEAR_REVEAL' }
  | { type: 'explorer.REFRESH_TREE' }
  // What the surface starts from, handed on by the surface
  | { type: 'CODE_STARTED'; data: { baseDirectory: string | null } };

type CodeExplorerShape = {
  data: CodeExplorerData;
  reports: CodeExplorerReport;
  calls: {
    list: { readonly each: CodeAsks['explorer.LIST_FILES']['args'] };
    read: { readonly many: CodeAsks['explorer.READ_FILE']['args'] };
    write: { readonly many: CodeAsks['explorer.WRITE_FILE']['args'] };
    delete: { readonly many: CodeAsks['explorer.DELETE_FILE']['args'] };
    rename: { readonly many: CodeAsks['explorer.RENAME_FILE']['args'] };
    mkdir: { readonly many: CodeAsks['explorer.CREATE_DIRECTORY']['args'] };
    move: { readonly many: CodeAsks['explorer.MOVE_FILES']['args'] };
    copy: { readonly many: CodeAsks['explorer.COPY_FILES']['args'] };
  };
  states: {
    idle: {};
    findingFiles: {
      data: { quickOpenDir: string };
      calls: {
        findFiles: 'one';
      };
    };
  };
};

function reportFailure(
  failure: { kind: string; message: string; code?: string; path?: string },
  report: (event: CodeExplorerReport) => void,
): void {
  const notFoundPath =
    failure.kind === 'file' && failure.code === 'NOT_FOUND' && failure.path ? failure.path : undefined;
  report({ type: 'EXPLORER_ERROR', message: failure.message, ...(notFoundPath ? { notFoundPath } : {}) });
}

export const explorerState = state<CodeExplorerShape, CodeExplorerEvent>()({
  initial: 'idle',
  data: emptyTreeState(''),
  calls: ({ each, many }) => ({
    list: each('code', 'explorer.LIST_FILES', {
      args: (_key, input) => input,
      done: (outcome, { key, data, report }) => {
        const loadingDirs = new Set(data.loadingDirs);
        loadingDirs.delete(key);

        if (!outcome.ok) {
          reportFailure(outcome.failure, report);
          return { data: { loadingDirs } };
        }

        const listed = outcome.value;
        report({ type: 'EXPLORER_LISTED' });

        if (listed.path === data.baseDirectory) {
          return {
            data: {
              rootFiles: listed.files,
              dirContents: { ...data.dirContents, [listed.path]: listed.files },
              loadingDirs,
            },
          };
        }
        return {
          data: {
            dirContents: { ...data.dirContents, [listed.path]: listed.files },
            loadingDirs,
          },
        };
      },
    }),
    read: many('code', 'explorer.READ_FILE', {
      done: (outcome, { data, report, send }) => {
        if (!outcome.ok) {
          reportFailure(outcome.failure, report);
          return;
        }
        const file = outcome.value;
        const editorMode = data.pendingEditorMode[file.path];
        report({ type: 'EXPLORER_FILE_READ', file, ...(editorMode ? { editorMode } : {}) });
        send({ type: 'explorer.REVEAL_IN_TREE', path: file.path });

        if (!editorMode) return;
        const { [file.path]: _consumed, ...pendingEditorMode } = data.pendingEditorMode;
        return { data: { pendingEditorMode } };
      },
    }),
    write: many('code', 'explorer.WRITE_FILE', {
      done: (outcome, { report }) => {
        if (!outcome.ok) {
          reportFailure(outcome.failure, report);
          return;
        }
        report({ type: 'EXPLORER_FILE_SAVED', path: outcome.value.path });
      },
    }),
    delete: many('code', 'explorer.DELETE_FILE', {
      done: (outcome, { cancel, call, report }) => {
        if (!outcome.ok) {
          reportFailure(outcome.failure, report);
          return;
        }
        const parentDir = getParentDir(outcome.value.path);
        cancel('list', parentDir);
        call('list', parentDir, { path: parentDir });
        report({ type: 'EXPLORER_FILE_DELETED', path: outcome.value.path });
      },
    }),
    rename: many('code', 'explorer.RENAME_FILE', {
      done: (outcome, { cancel, call, report }) => {
        if (!outcome.ok) {
          reportFailure(outcome.failure, report);
          return;
        }
        const { oldPath, newPath } = outcome.value;
        const parentDir = getParentDir(oldPath);
        cancel('list', parentDir);
        call('list', parentDir, { path: parentDir });
        const newParentDir = getParentDir(newPath);
        if (newParentDir !== parentDir) {
          cancel('list', newParentDir);
          call('list', newParentDir, { path: newParentDir });
        }
        report({ type: 'EXPLORER_FILE_RENAMED', oldPath, newPath });
      },
    }),
    mkdir: many('code', 'explorer.CREATE_DIRECTORY', {
      done: (outcome, { data, cancel, call, report }) => {
        if (!outcome.ok) {
          reportFailure(outcome.failure, report);
          return;
        }
        const parentDir = getParentDir(outcome.value.path);
        cancel('list', parentDir);
        call('list', parentDir, { path: parentDir });
        const expandedDirs = new Set(data.expandedDirs);
        expandedDirs.add(parentDir);
        return {
          data: {
            expandedDirs,
            selectedPaths: [outcome.value.path],
          },
        };
      },
    }),
    move: many('code', 'explorer.MOVE_FILES', {
      done: (outcome, { cancel, call, report }) => {
        if (!outcome.ok) {
          reportFailure(outcome.failure, report);
          return;
        }
        const moved = outcome.value;
        cancel('list', moved.targetDir);
        call('list', moved.targetDir, { path: moved.targetDir });
        const sourceParentDirs = new Set(moved.sourcePaths.map(getParentDir));
        for (const dir of sourceParentDirs) {
          cancel('list', dir);
          call('list', dir, { path: dir });
        }
        return { data: { selectedPaths: [] } };
      },
    }),
    copy: many('code', 'explorer.COPY_FILES', {
      done: (outcome, { cancel, call, report }) => {
        if (!outcome.ok) {
          reportFailure(outcome.failure, report);
          return;
        }
        const targetDir = outcome.value.targetDir;
        cancel('list', targetDir);
        call('list', targetDir, { path: targetDir });
        return { data: { selectedPaths: [] } };
      },
    }),
  }),
  on: {
    CODE_STARTED: ({ data: started }, { cancel, call }) => {
      const baseDirectory = started.baseDirectory ?? '';
      if (baseDirectory) {
        cancel('list', baseDirectory);
        call('list', baseDirectory, { path: baseDirectory });
      }
      return { data: emptyTreeState(baseDirectory) };
    },
    'explorer.REFRESH_TREE': (_event, { data, cancel, call }) => {
      const baseDirectory = data.baseDirectory;
      if (!baseDirectory) return;

      cancel('list', baseDirectory);
      call('list', baseDirectory, { path: baseDirectory });

      for (const dir of data.expandedDirs) {
        if (dir !== baseDirectory) {
          cancel('list', dir);
          call('list', dir, { path: dir });
        }
      }

      const loadingDirs = new Set(data.expandedDirs);
      loadingDirs.add(baseDirectory);

      return {
        data: {
          dirContents: {},
          loadingDirs,
        },
      };
    },
    'explorer.LIST_FILES': ({ path }, { cancel, call, report }) => {
      report({ type: 'EXPLORER_LOADING' });
      cancel('list', path);
      call('list', path, { path });
    },
    'explorer.DELETE_FILE': ({ path }, { call }) => {
      call('delete', { path });
    },
    'explorer.CREATE_DIRECTORY': ({ path }, { call }) => {
      call('mkdir', { path });
    },
    'explorer.RENAME_FILE': ({ oldPath, newPath }, { call }) => {
      call('rename', { oldPath, newPath });
    },
    'explorer.OPEN_FILE': ({ path, editorMode }, { data, call }) => {
      call('read', { path });
      if (editorMode) {
        return { data: { pendingEditorMode: { ...data.pendingEditorMode, [path]: editorMode } } };
      }
    },
    'explorer.OPEN_FILES': ({ paths }, { call }) => {
      for (const path of paths) {
        call('read', { path });
      }
    },
    'explorer.SET_BASE_DIRECTORY': ({ path }, { tell, report }) => {
      tell('code', { type: 'SET_BASE_DIRECTORY', path });
      report({ type: 'EXPLORER_BASE_DIRECTORY_SET', path });
      return { data: emptyTreeState(path) };
    },
    'explorer.EXPAND_DIRECTORY': ({ path }, { data, cancel, call }) => {
      const expandedDirs = new Set(data.expandedDirs);
      expandedDirs.add(path);

      if (data.dirContents[path]) {
        return { data: { expandedDirs } };
      }

      const loadingDirs = new Set(data.loadingDirs);
      loadingDirs.add(path);
      cancel('list', path);
      call('list', path, { path });

      return { data: { expandedDirs, loadingDirs } };
    },
    'explorer.COLLAPSE_DIRECTORY': ({ path }, { data }) => {
      const expandedDirs = new Set(data.expandedDirs);
      expandedDirs.delete(path);
      return { data: { expandedDirs } };
    },
    'explorer.SELECT_ITEMS': ({ paths }) => ({ data: { selectedPaths: paths } }),
    'explorer.MOVE_ITEMS': ({ sourcePaths, targetDir }, { call }) => {
      call('move', { sourcePaths, targetDir });
    },
    'explorer.COPY_FILES': ({ sourcePaths, targetDir }, { call }) => {
      call('copy', { sourcePaths, targetDir });
    },
    'explorer.WRITE_FILE': ({ path, content }, { call }) => {
      call('write', { path, content });
    },
    'explorer.CLOSE_FILE': ({ path }, { tell }) => {
      tell('code', { type: 'explorer.CLOSE_FILE', path });
    },
    // Entering `findingFiles` again stops the listing under way and starts this one
    'explorer.QUICK_OPEN_SEARCH': ({ baseDirectory }) => ({
      at: 'findingFiles',
      data: { quickOpenDir: baseDirectory },
    }),
    'explorer.REVEAL_IN_TREE': ({ path }, { data, cancel, call }) => {
      const baseDirectory = data.baseDirectory;

      const ancestors: string[] = [];
      let current = getParentDir(path);
      while (current.length >= baseDirectory.length && current !== '') {
        ancestors.push(current);
        if (current === baseDirectory) break;
        current = getParentDir(current);
      }

      const expandedDirs = new Set(data.expandedDirs);
      const loadingDirs = new Set(data.loadingDirs);

      for (const dir of ancestors) {
        expandedDirs.add(dir);
        if (!data.dirContents[dir]) {
          loadingDirs.add(dir);
          cancel('list', dir);
          call('list', dir, { path: dir });
        }
      }

      return {
        data: {
          expandedDirs,
          loadingDirs,
          selectedPaths: [path],
          revealPath: path,
        },
      };
    },
    'explorer.CLEAR_REVEAL': () => ({ data: { revealPath: null } }),
  },
  states: {
    idle: {},
    // Every file under a folder is being listed for quick open, for exactly as long as this state is
    findingFiles: {
      data: { quickOpenDir: given },
      calls: ({ one }) => ({
        findFiles: one('code', 'explorer.QUICK_OPEN_SEARCH', {
          args: (data) => ({ baseDirectory: data.quickOpenDir }),
          done: (outcome, { report }) => {
            if (outcome.ok) {
              report({ type: 'EXPLORER_QUICK_OPEN_RESULTS', results: outcome.value });
            } else {
              report({ type: 'EXPLORER_QUICK_OPEN_ERROR', message: outcome.failure.message });
            }
            return { at: 'idle' };
          },
        }),
      }),
      run: ({ call }) => {
        call('findFiles');
      },
    },
  },
});
