// What git says a checkout's files are, by blob id: tracked files at the id git holds, modified and untracked ones at
// the id their bytes on disk would have. Ignored files, symlinks and submodules aren't in it.
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { languageOf } from './extract.ts';

const execFileAsync = promisify(execFile);

const SYMLINK_MODE = '120000';
const SUBMODULE_MODE = '160000';
const MAX_LISTING = 256 * 1024 * 1024;

const git = async (root: string, args: string[]): Promise<string> =>
  (await execFileAsync('git', args, { cwd: root, maxBuffer: MAX_LISTING, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' } })).stdout;

const nulSeparated = (text: string) => text.split('\0').filter(Boolean);

/** Whether `root` is inside a git work tree */
export async function isGitWorkTree(root: string): Promise<boolean> {
  try { return (await git(root, ['rev-parse', '--is-inside-work-tree'])).trim() === 'true'; }
  catch { return false; }
}

/** The blob ids of `paths` as they are on disk, in order, through git's own filters */
function hashObjects(root: string, paths: readonly string[]): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['hash-object', '--stdin-paths'], { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => { out += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => { err += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(out.split('\n').filter(Boolean));
      else reject(new Error(`git hash-object failed: ${err.trim()}`));
    });
    // A failure surfaces through `close`; the write's own error is the same pipe closing
    child.stdin.on('error', () => {});
    child.stdin.end(paths.join('\n') + '\n');
  });
}

/** Every file the index can read, path to blob id, or `null` when `root` isn't a git work tree */
export async function readGitView(root: string): Promise<Map<string, string> | null> {
  let listings: [string, string, string];
  try {
    // At once, since each is a process of its own and a save waits on the slowest rather than the sum
    listings = await Promise.all([
      git(root, ['ls-files', '--stage', '-z']),
      git(root, ['ls-files', '--deleted', '-z']),
      git(root, ['ls-files', '--modified', '--others', '--exclude-standard', '-z']),
    ]);
  } catch (error) {
    if (await isGitWorkTree(root)) throw error;
    return null;
  }
  const [stage, deletedListing, changedListing] = listings;
  const view = new Map<string, string>();
  const tracked = new Set<string>();
  for (const entry of nulSeparated(stage)) {
    const tab = entry.indexOf('\t');
    const [mode, oid] = entry.slice(0, tab).split(' ');
    const path = entry.slice(tab + 1);
    tracked.add(path);
    if (mode === SYMLINK_MODE || mode === SUBMODULE_MODE || !oid || !languageOf(path)) continue;
    view.set(path, oid);
  }
  const deleted = new Set(nulSeparated(deletedListing));
  for (const path of deleted) view.delete(path);
  // `--modified` also lists a changed symlink or submodule, which is tracked and which `view` skipped
  const readable = [...new Set(nulSeparated(changedListing))]
    .filter(path => !deleted.has(path) && languageOf(path) && (view.has(path) || !tracked.has(path)));
  if (readable.length === 0) return view;
  const oids = await hashObjects(root, readable);
  readable.forEach((path, index) => { const oid = oids[index]; if (oid) view.set(path, oid); });
  return view;
}

/** Which files a staged change or a range touches, each with its status letter */
export async function readChangedPaths(root: string, range: { staged: true } | { base: string; head: string }): Promise<{ status: string; path: string }[]> {
  const args = ['diff', '--name-status', '--no-renames', '-z', ...('staged' in range ? ['--cached'] : [`${range.base}..${range.head}`])];
  const fields = nulSeparated(await git(root, args));
  const changes: { status: string; path: string }[] = [];
  for (let i = 0; i + 1 < fields.length; i += 2) changes.push({ status: fields[i]!, path: fields[i + 1]! });
  return changes;
}

/**
 * The contents of many git objects through one process, by spec (`HEAD:path`, `:path`), `null` for one that doesn't
 * exist. One `cat-file --batch` costs a fraction of a `git show` per object, which is what holds a semantic diff of a
 * hundred files to its budget.
 */
export function readObjects(root: string, specs: readonly string[]): Promise<(string | null)[]> {
  if (specs.length === 0) return Promise.resolve([]);
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['cat-file', '--batch'], { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] });
    const chunks: Buffer[] = [];
    let err = '';
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => { err += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) { reject(new Error(`git cat-file failed: ${err.trim()}`)); return; }
      const all = Buffer.concat(chunks);
      const results: (string | null)[] = [];
      let at = 0;
      for (let i = 0; i < specs.length; i++) {
        const lineEnd = all.indexOf(0x0a, at);
        const header = all.toString('utf8', at, lineEnd);
        at = lineEnd + 1;
        const match = /^[0-9a-f]+ blob (\d+)$/.exec(header);
        if (!match) { results.push(null); continue; }
        const size = Number(match[1]);
        results.push(all.toString('utf8', at, at + size));
        at += size + 1;
      }
      resolve(results);
    });
    child.stdin.on('error', () => {});
    child.stdin.end(specs.join('\n') + '\n');
  });
}
