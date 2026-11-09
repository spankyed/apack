// What `vendor/` links to, which is the subject two pieces of tooling resolve: the janitor's budget
// (`janitor.ts`) and the Linux container's Rust toolchain (`linux-runner.ts`). Both named `vendor/elmdb`
// and only that, so a second Rust checkout was invisible to one and silently built under the other's
// toolchain by the second. One derivation, and each caller makes the ambiguous case loud.
//
// Imports nothing outside `node:`, because `janitor.ts` runs under launchd with no npm and no workspace
// resolution.
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

/** A `vendor/` entry as it is on disk */
export interface VendoredCheckout {
  /** The link's name under `vendor/`, which a diagnostic names */
  name: string;
  /** Where it resolves to */
  path: string;
  /** Whether that directory holds a `Cargo.toml`, which is what makes it a Rust checkout */
  isRustCheckout: boolean;
}

/**
 * The Rust checkouts linked under `vendor/`, from everything that is.
 *
 * **Derived rather than named, because the cost of missing one is the whole of it.** This resolved
 * `vendor/elmdb` and nothing else, so a second Rust checkout was outside the budget entirely: one
 * dependency and one `cargo build` at a sibling path is 48 MB, and the janitor runs hourly saying nothing
 * about it. A third sibling is covered the day it is linked rather than the day someone remembers this file.
 *
 * **It throws on an empty set rather than answering one.** A janitor that resolves nothing reports a budget
 * it is holding nothing to, every hour, which is this repo's own *a check that reports nothing may have
 * looked at nothing* — here, inside the tooling that enforces it. A checkout with no linked Rust tree is not
 * a state this repo has: `npm run link:elmdb` is a prerequisite of every Rust path.
 */
export function rustCheckoutsIn(vendored: readonly VendoredCheckout[]): string[] {
  const rust = vendored.filter((entry) => entry.isRustCheckout);
  if (rust.length === 0) {
    const found = vendored.length === 0
      ? 'nothing is linked there'
      : `${vendored.map((entry) => entry.name).join(', ')} are, none holding a Cargo.toml`;
    throw new Error(`No Rust checkout is linked under vendor/: ${found}. Run \`npm run link:elmdb\`.`);
  }
  return rust.map((entry) => entry.path);
}

/** What `vendor/` holds: every link that resolves to a directory, and whether that directory is a Rust checkout */
export function vendoredCheckouts(repoRoot: string): VendoredCheckout[] {
  const vendor = path.join(repoRoot, 'vendor');
  if (!fs.existsSync(vendor)) return [];
  return fs.readdirSync(vendor).flatMap((name) => {
    let resolved: string;
    // A `.rev` file is not a checkout, and a link whose target is gone resolves to nothing
    try { resolved = fs.realpathSync(path.join(vendor, name)); } catch { return []; }
    if (!fs.statSync(resolved).isDirectory()) return [];
    return [{ name, path: resolved, isRustCheckout: fs.existsSync(path.join(resolved, 'Cargo.toml')) }];
  });
}

/** A vendored checkout against the commit `vendor/<name>.rev` pins it to */
export interface VendoredState {
  name: string;
  /** The commit the committed `.rev` names, which is the shared fact CI clones at */
  pinned: string | undefined;
  /** What the linked checkout is actually at, which is what a local build compiled against */
  head: string | undefined;
  /** Whether that checkout has uncommitted changes, so `head` does not describe it fully */
  dirty: boolean;
}

/**
 * What each `vendor/` link is at, beside the commit its `.rev` pins.
 *
 * **A local build compiles against the sibling's working tree; CI clones the pin.** The two diverge
 * routinely and nothing reported it, so a failure naming a symbol the pinned code does not have reads as a
 * defect in the branch under test. Worse, a checkout can move *while* a run is going: a chain run has hit
 * both a type error from a field added upstream and the pack compiler's own
 * `Compiler resolution namespace changed during discovery` on a vendored file, neither of which described
 * the tree by the time anyone looked.
 *
 * So a run records this where its evidence is read. `head` absent means the link resolves to no git
 * checkout; `pinned` absent means no `.rev` is committed for it.
 */
export function vendoredStates(repoRoot: string): VendoredState[] {
  return vendoredCheckouts(repoRoot).map((entry) => {
    let pinned: string | undefined;
    try { pinned = fs.readFileSync(path.join(repoRoot, 'vendor', `${entry.name}.rev`), 'utf8').trim() || undefined; }
    catch { pinned = undefined; }
    return { name: entry.name, pinned, ...gitStateOf(entry.path) };
  });
}

/** A checkout's HEAD and whether it is dirty, or absences when it is not a git checkout */
function gitStateOf(checkout: string): { head: string | undefined; dirty: boolean } {
  const git = (args: readonly string[]): string | undefined => {
    try {
      return execFileSync('git', ['-C', checkout, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch { return undefined; }
  };
  const head = git(['rev-parse', 'HEAD']);
  if (head === undefined) return { head: undefined, dirty: false };
  return { head, dirty: (git(['status', '--porcelain']) ?? '') !== '' };
}

/** A Rust checkout and the toolchain channel its `rust-toolchain.toml` pins, if it pins one */
export interface PinnedToolchain {
  path: string;
  channel: string | undefined;
}

/** The channel a checkout's `rust-toolchain.toml` names, or `undefined` when there is no file or no channel */
export function pinnedChannel(checkout: string): string | undefined {
  let file: string;
  try { file = fs.readFileSync(path.join(checkout, 'rust-toolchain.toml'), 'utf8'); } catch { return undefined; }
  return /^channel\s*=\s*"([^"]+)"/m.exec(file)?.[1];
}

/**
 * The one Rust toolchain an image must install to build every checkout given.
 *
 * **It refuses a disagreement rather than picking one.** The container's image was keyed on elmdb's channel
 * alone, so a second Rust checkout pinning another was built with elmdb's — not as a failure, which is the
 * part that costs: edition and lint differences show up as compile errors in code that is correct against
 * its own pin. Both pin 1.99.1 today and nothing held them together. Naming both paths and both channels is
 * the whole remedy: whoever reads it knows which pin to move, where a chosen winner leaves them guessing.
 */
export function oneRustToolchain(pinned: readonly PinnedToolchain[]): string {
  if (pinned.length === 0) throw new Error('No Rust checkout to take a toolchain from. Run `npm run link:elmdb`.');

  const unpinned = pinned.filter((entry) => entry.channel === undefined);
  if (unpinned.length > 0) {
    throw new Error(`No Rust toolchain channel in ${unpinned.map((entry) => `${entry.path}/rust-toolchain.toml`).join(', ')}`);
  }

  const channels = [...new Set(pinned.map((entry) => entry.channel!))];
  if (channels.length > 1) {
    const disagreement = pinned.map((entry) => `${entry.path} pins ${entry.channel}`).join('; ');
    throw new Error(
      `The linked Rust checkouts pin different toolchains, so one image cannot build them all: ${disagreement}. `
      + 'Move one pin so they agree.',
    );
  }
  return channels[0];
}
