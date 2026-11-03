// Runs below tsx in Node's loader thread: tsx sees logical source URLs, native reads see owned bytes.
import fs from 'node:fs';
import { findPackageJSON } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

let directory, namespace, closed;
export function initialize(data) {
  ({ directory, namespace } = data);
  closed = new Int32Array(data.closed);
}

/**
 * The canonical storage projection shared by the input owner and loader thread.
 *
 * One location per file, whichever spelling reaches it: Node passes the extended form (`\\?\C:\…`) to native
 * loading, so keying storage on the literal root would put a loaded addon in another directory from the
 * side-by-side manifests and configuration Windows probes for beside it, and activation would fail.
 */
export function compilerReadMapping(directory, file) {
  const ordinary = /^\\\\\?\\[a-z]:\\/i.test(file) ? file.slice(4) : file;
  const sourceRoot = path.parse(ordinary).root;
  const readRoot = path.join(directory, Buffer.from(sourceRoot).toString('hex'));
  return { sourceRoot, readRoot, readPath: path.join(readRoot, path.relative(sourceRoot, ordinary)) };
}

export async function load(url, context, next) {
  if (!url.startsWith('file:')) return next(url, context);
  const logical = new URL(url);
  if (logical.searchParams.get('tsx-namespace') !== namespace) return next(url, context);
  if (Atomics.load(closed, 0)) throw new Error('Compiler module load outlived its build');
  const file = fileURLToPath(logical);
  const relative = path.relative(directory, file);
  if (relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) {
    return next(url, context);
  }
  const owned = pathToFileURL(compilerReadMapping(directory, file).readPath);
  owned.search = logical.search;
  owned.hash = logical.hash;
  return next(owned.href, { ...context, format: capturedFormat(owned, context.format) });
}

/** Node derives a module's format from the live `package.json` beside its logical URL, so a captured scope overrides it. */
function capturedFormat(owned, format) {
  if (!/\.[jt]sx?$/.test(owned.pathname)) return format;
  const scope = findPackageJSON(owned);
  if (!scope || path.relative(directory, scope).startsWith('..')) return format;
  return JSON.parse(fs.readFileSync(scope, 'utf8')).type === 'module' ? 'module' : 'commonjs';
}
