// The link to the elmdb checkout `@apackdev/ears` builds against: `vendor/elmdb`, a gitignored symlink, beside the
// commit it is pinned to, `vendor/elmdb.rev`. Plain Node with no dependencies, since it runs before `npm ci`: npm
// resolves the `file:` dependency through the link. The checkout is `ELMDB_DIR`, or `~/Develop/Projects/apack/elmdb`.
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The elmdb checkout the link points at @param {NodeJS.ProcessEnv} [env] */
export function elmdbCheckout(env = process.env) {
  return path.resolve(env.ELMDB_DIR ?? path.join(os.homedir(), 'Develop', 'Projects', 'apack', 'elmdb'));
}

/**
 * Points `<root>/vendor/elmdb` at the checkout, refusing one that isn't an elmdb checkout, that doesn't hold the
 * pinned commit in its history, or whose binding isn't built for this platform. A link already there is replaced
 * @param {string} root @param {string} [checkout]
 */
export function linkElmdb(root, checkout = elmdbCheckout()) {
  const rev = fs.readFileSync(path.join(root, 'vendor', 'elmdb.rev'), 'utf8').trim();
  const binding = path.join(checkout, 'crates', 'elmdb-node');
  const manifest = path.join(binding, 'package.json');
  if (!fs.existsSync(manifest) || JSON.parse(fs.readFileSync(manifest, 'utf8')).name !== 'elmdb') {
    throw new Error(`${checkout} isn't an elmdb checkout (no crates/elmdb-node/package.json naming elmdb). Clone github.com/spankyed/elmdb there, or set ELMDB_DIR`);
  }
  try {
    execFileSync('git', ['-C', checkout, 'merge-base', '--is-ancestor', rev, 'HEAD'], { stdio: 'ignore' });
  } catch {
    throw new Error(`The elmdb checkout at ${checkout} doesn't hold the pinned commit ${rev} (vendor/elmdb.rev) in its history: fetch and check out a commit that does`);
  }
  if (!fs.readdirSync(binding).some((file) => file.endsWith('.node'))) {
    throw new Error(`elmdb's binding isn't built in ${binding}: run npm ci && npm run build there (Rust from rustup, the version rust-toolchain.toml pins)`);
  }
  const link = path.join(root, 'vendor', 'elmdb');
  const held = fs.lstatSync(link, { throwIfNoEntry: false });
  if (held?.isSymbolicLink()) fs.unlinkSync(link);
  else if (held) throw new Error(`${link} is a ${held.isDirectory() ? 'directory' : 'file'}, not the link to an elmdb checkout: move it away first`);
  // A junction on Windows, which needs neither elevation nor Developer Mode as a directory symlink does; Node reads
  // either as a symbolic link, so the replacement above holds for both
  fs.symlinkSync(checkout, link, process.platform === 'win32' ? 'junction' : 'dir');
  return { link, checkout, rev };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  try {
    const { link, checkout, rev } = linkElmdb(root);
    console.log(`${path.relative(root, link)} → ${checkout} (pinned ${rev.slice(0, 12)})`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
