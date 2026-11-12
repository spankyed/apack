import fs from 'node:fs';
import path from 'node:path';

/**
 * The path the kernel would watch for `file`: symlinks resolved, and a missing file placed under its parent's
 * physical directory. A dangling symlink is followed to its target, resolved from the link's physical directory.
 *
 * Known limit: `..` in a dangling link's own text is collapsed lexically, not through a symlink earlier in that
 * text. For `a -> sub/../b` with `sub` a symlink, the kernel looks beside `sub`'s target and this looks beside the
 * link. Nothing checks it; a link target that appears later there is not seen until something else changes.
 */
export function physicalWatchPath(file: string, cache = new Map<string, string>()): string {
  const known = cache.get(file);
  if (known) return known;
  let resolved: string;
  // Node drops the final separator for an extended drive root (nodejs/node#62446).
  // Only the root has an equivalent short spelling; retain native handling for other extended paths.
  const query = /^\\\\\?\\[a-z]:\\$/i.test(file) ? file.slice(4) : file;
  try { resolved = fs.realpathSync.native(query); }
  catch (error) {
    if (!['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) {
      throw new Error(`Cannot resolve compiler input path ${JSON.stringify(file)} using ${JSON.stringify(query)}`, { cause: error });
    }
    const parent = path.dirname(file);
    if (parent === file) throw error;
    let link: fs.Stats | undefined;
    try { link = fs.lstatSync(file, { throwIfNoEntry: false }); }
    catch (failure) { if ((failure as NodeJS.ErrnoException).code !== 'ENOTDIR') throw failure; }
    // The kernel resolves a relative target from the link's physical directory, not the path that reached it
    resolved = link?.isSymbolicLink() ? physicalWatchPath(path.resolve(physicalWatchPath(parent, cache), fs.readlinkSync(file)), cache)
      : path.join(physicalWatchPath(parent, cache), path.basename(file));
  }
  cache.set(file, resolved);
  return resolved;
}

/**
 * What each directory lists: the names it holds as a plain file or directory, and every name it holds folded to
 * one case. `null` while a directory has been asked of once.
 */
export type PhysicalListings = Map<string, { readonly plain: ReadonlySet<string>; readonly folded: ReadonlySet<string> } | null>;

/**
 * A name only its own spelling can reach: ASCII, so folding its case is all a filesystem does to it, and none of
 * the forms Windows reads as another name (a short `NAME~1`, a trailing dot or space).
 */
const plainlySpelled = (name: string) => /^[\x21-\x7d]+$/.test(name) && !/[. ]$/.test(name);

/**
 * `physicalWatchPath` for many files of the same directories, at one listing a directory where that is one
 * resolution a file. A name its directory lists exactly, and not as a link, is the directory's physical path and
 * that name, which is what resolving it answers. A plainly spelled name the directory holds in no spelling is
 * missing, and is placed under the directory as resolving it would. Everything else is resolved the long way: a
 * link, another spelling of a name on a filesystem that folds case, and a name outside ASCII. A directory is
 * listed only on the second file asked of it, so one input in a large directory costs no listing.
 *
 * `list` is the caller's, because a caller inside intercepted compiler reads must take its listing outside them.
 * A listing is as old as `listings`: a name that became a link after it was taken, or appeared as one, is
 * answered as it stood, which a caller comparing against a fresh map sees as a change.
 */
export function physicalWatchPathListed(file: string, cache: Map<string, string>, listings: PhysicalListings,
  list: (directory: string) => fs.Dirent[] = directory => fs.readdirSync(directory, { withFileTypes: true })): string {
  const known = cache.get(file);
  if (known) return known;
  const parent = path.dirname(file), name = path.basename(file);
  if (parent === file || !name || file.startsWith('\\\\?\\') || path.join(parent, name) !== file) return physicalWatchPath(file, cache);
  let listing = listings.get(parent);
  if (listing === undefined) {
    listings.set(parent, null);
    return physicalWatchPath(file, cache);
  }
  const directory = physicalWatchPath(parent, cache);
  if (listing === null) {
    let entries: fs.Dirent[] = [];
    try { entries = list(directory); }
    catch (error) { if (!['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error; }
    listing = { plain: new Set(entries.filter(entry => entry.isFile() || entry.isDirectory()).map(entry => entry.name)),
      folded: new Set(entries.map(entry => entry.name.toLowerCase())) };
    listings.set(parent, listing);
  }
  if (!listing.plain.has(name) && (!plainlySpelled(name) || listing.folded.has(name.toLowerCase()))) return physicalWatchPath(file, cache);
  const resolved = path.join(directory, name);
  cache.set(file, resolved);
  return resolved;
}
