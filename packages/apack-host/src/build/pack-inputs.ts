import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';

export type BuildInputKind = 'file' | 'directory' | 'entries';
export type BuildInputObserver = (file: string, kind: BuildInputKind) => void;

/**
 * Names that are never an authored input, wherever in the pack they sit. Each is something a tool writes into a
 * folder without the pack having been touched, so counting it would make a build stale for having been looked at
 * and a watcher rebuild for a file nobody wrote.
 */
const NEVER_AUTHORED = new Set([
  // Version control's own folders
  '.git', '.hg', '.svn', '.jj',
  'node_modules',
  // What macOS and Windows write into a folder shown in a file browser
  '.DS_Store', 'Thumbs.db', 'desktop.ini',
  // Vim's test of whether it can write beside the file being saved
  '4913',
  // Tool caches
  '.eslintcache', '.turbo', '.vite',
]);

/**
 * The same, for names that vary: what an editor or the system leaves beside a file while it is open or being
 * saved, and caches named after what they cache. Each is matched against one name, never a path.
 */
const NEVER_AUTHORED_PATTERNS: readonly RegExp[] = [
  /^\._/, // macOS, beside each file on a volume that cannot hold its metadata
  /\.sw[op]$/, // Vim's swap files
  /~$/, // an editor's backup of the file before a save
  /^\.#/, // Emacs, while a file has unsaved changes
  /^#.*#$/, // Emacs autosave
  /\.tsbuildinfo$/, // TypeScript's incremental build
  /^npm-debug\.log/,
  /^\.nfs[0-9a-f]+$/i, // a file deleted while open, on a network volume
];

/**
 * Folders at the pack's root that hold what a build, the tooling or a test run wrote. Only at the root: a source
 * folder of the same name further in is the author's.
 */
const BUILT_AT_ROOT = new Set(['dist', '.apack', 'coverage', 'test-results', 'playwright-report']);

const neverAuthored = (name: string) => NEVER_AUTHORED.has(name) || NEVER_AUTHORED_PATTERNS.some(pattern => pattern.test(name));

/** Whether a pack-relative path belongs to authored inputs, shared by builds and watchers. */
export function isPackInputPath(relative: string, generated = false): boolean {
  const parts = relative.split(/[\\/]/);
  if (parts.some(neverAuthored)) return false;
  if (BUILT_AT_ROOT.has(parts[0]!)) return false;
  return generated || parts[0] !== 'src' || parts[1] !== '__generated__';
}

/** Authored files, regardless of extension or source folder; build/dependency trees are separate inputs. */
export function packInputFiles(root: string, { generated = false, modulesOnly = false, onLink }: { generated?: boolean; modulesOnly?: boolean; onLink?: (file: string, directory: boolean) => void } = {}): string[] {
  const files: string[] = [];
  const ancestors = new Set<string>();
  function walk(dir: string): void {
    const real = fs.realpathSync.native(dir);
    if (ancestors.has(real)) throw new Error(`Cyclic source directory: ${dir}`);
    ancestors.add(real);
    for (const name of fs.readdirSync(dir).sort()) {
      const file = path.join(dir, name);
      const relative = path.relative(root, file).split(path.sep).join('/');
      if (!isPackInputPath(relative, generated)) continue;
      const stat = fs.statSync(file, { throwIfNoEntry: false });
      if (!stat) throw new Error(`Broken symbolic link in pack source: ${relative} -> ${fs.readlinkSync(file)}`);
      if (onLink && fs.lstatSync(file).isSymbolicLink()) onLink(file, stat.isDirectory());
      if (stat.isDirectory()) walk(file);
      else if (stat.isFile() && (!modulesOnly || /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|vue|json)$/.test(name))) files.push(relative);
    }
    ancestors.delete(real);
  }
  if (fs.existsSync(root)) walk(root);
  return files;
}

export interface PackInputWatchTarget {
  directory: string;
  /** A linked file or directory whose replacement must be observed in its parent. */
  child?: string;
  relative: string;
}

/** Linked sources use the same traversal and exclusions as input hashing. */
export function packInputWatchTargets(root: string): PackInputWatchTarget[] {
  const targets: PackInputWatchTarget[] = [{ directory: root, relative: '' }];
  packInputFiles(root, { onLink(file, directory) {
    const target = fs.realpathSync.native(file);
    const relative = path.relative(root, file);
    targets.push({ directory: path.dirname(target), child: path.basename(target), relative });
    if (directory) targets.push({ directory: target, relative });
  } });
  return targets;
}

/** Content identity includes filenames and additions/removals, with no timestamp or checkout-path dependence. */
export function packInputsHash(root: string, options?: { generated?: boolean; modulesOnly?: boolean }): string {
  const hash = createHash('sha256');
  for (const file of packInputFiles(root, options)) {
    const content = fs.readFileSync(path.join(root, file));
    hash.update(`${file.length}:${file}:${content.length}:`);
    hash.update(content);
  }
  return hash.digest('hex');
}
