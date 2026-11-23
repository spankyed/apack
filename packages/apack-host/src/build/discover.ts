import * as fs from 'node:fs';
import * as path from 'node:path';

/** A pack directory on this machine whose frontend a dev server can serve from source */
export interface DevPackFrontend {
  id: string;
  /** Its `src/__generated__/pack-entry-fe.ts`, which codegen writes and the pack's own typecheck reads */
  feEntry: string;
}

/**
 * The pack directories a dev server serves frontends from source for: every pack under `packagesRoot` whose
 * codegen has written a frontend entry, plus every directory named in `APACK_DEV_PACK_DIRS` (separated
 * by the platform path delimiter or commas, relative to `cwd`) — which is how a pack outside the workspace, `tests/packs/*` among
 * them, joins the same loop.
 *
 * It grants no manifest shipping privilege. A pack is eligible here because its source is on this disk, which is
 * the only thing a dev server can act on.
 */
export function discoverDevPackFrontends(
  packagesRoot: string | undefined,
  extraDirs: string | undefined,
  cwd: string,
  warn: (message: string) => void = (message) => console.warn(message),
): DevPackFrontend[] {
  const scanned = packagesRoot && fs.existsSync(packagesRoot)
    ? fs.readdirSync(packagesRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.resolve(packagesRoot, entry.name))
    : [];
  const named = (extraDirs ?? '').split(path.delimiter === ';' ? /[;,]/ : /[:,]/).filter(Boolean).map((dir) => path.resolve(cwd, dir));
  const found: DevPackFrontend[] = [];
  for (const dir of [...scanned, ...named]) {
    // A scanned directory that is not a pack is ordinary; one the caller named by hand and that yields
    // nothing is a typo they would otherwise find by wondering why their edits do nothing
    const reject = (why: string) => { if (named.includes(dir)) warn(`[dev-pack-frontends] APACK_DEV_PACK_DIRS names ${dir}, which ${why}`); };
    const manifestPath = path.join(dir, 'apack.json');
    if (!fs.existsSync(manifestPath)) { reject('has no apack.json'); continue; }
    let id: unknown;
    try {
      ({ id } = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as { id?: unknown });
    } catch {
      reject('has an apack.json this cannot read');
      continue;
    }
    if (typeof id !== 'string' || !id) { reject('has no id in its apack.json'); continue; }
    const feEntry = path.join(dir, 'src', '__generated__', 'pack-entry-fe.ts');
    if (!fs.existsSync(feEntry)) { reject(`has no ${path.relative(dir, feEntry)} — run apack pack generate-entries in it`); continue; }
    if (found.some((pack) => pack.id === id)) continue;
    found.push({ id, feEntry });
  }
  return found;
}

/**
 * The module a dev server's renderer imports to get those frontends: one loader per pack, each a dynamic
 * import of a literal path so the bundler traces it and serves the pack's own `.vue` files through its
 * module graph — which is what makes a component edit a patch rather than a reload.
 *
 * It is empty in a production build, where there is no source to serve and every pack's frontend is
 * fetched over `pack://` from the bundle its own `apack pack build` wrote.
 */
export function devPackFrontendsModule(packs: readonly DevPackFrontend[]): string {
  const lines = packs.map((pack) => `  ${JSON.stringify(pack.id)}: () => import(${JSON.stringify(pack.feEntry)}),`);
  return `export default {\n${lines.join('\n')}\n};\n`;
}
