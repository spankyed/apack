/**
 * What `apack pack build` says it read, per pack.
 *
 * The companion to `dep-files.ts` and the same kind of evidence: a tool reporting its own input set after
 * the fact, which is the only check in this repo that can catch a step declaring *too little*. The
 * typecheck legs are observed through TypeScript's `tsBuildInfoFile`; the two steps that run `apack pack build`
 * were observed by nothing until that command started recording its bundlers' module graphs
 * (`@apackdev/cli`'s `build/build-reads.ts`, which writes the file this reads).
 *
 * **A separate module rather than a shape inside `dep-files.ts`**, because that one is tsc-shaped
 * throughout: one hard-coded cache directory, a `.tsbuildinfo` suffix, a TypeScript version resolved per
 * workspace for the trust check, and a dep file traced back to the tsconfig that named it. A bundler's
 * record answers none of those questions, and dropping it in there would have failed three of its cases.
 * What the two share is the discipline, not the code: `undefined` means no evidence and never `[]`, and the
 * self-check runs inside the reader so no caller has to remember it.
 *
 * **It covers the bundling phases and not the step.** Codegen, the tsx-loaded content compilation, the feature
 * settings load and the static pack rules have no tool to ask, so they are absent from the record rather
 * than reported empty, and the step stays on `dep-files.integration.spec.ts`' list of what nothing verifies
 * per-step. A step reading as verified over part of its work is worse than one honestly listed.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { REPO_ROOT } from '@apackdev/host/build/packages-built';
import { PACK_READS_FILE } from '@apackdev/host/build/pack-workdir';

/** What a pack's record holds. Paths are relative to the pack directory. */
export interface BuildReads {
  /** Repo-relative, as it was asked for */
  readonly packDir: string;
  /** Bundler package name to the version that wrote this record */
  readonly bundlers: Readonly<Record<string, string>>;
  /** Phase name to the files it read, pack-relative. A phase that did not run is absent. */
  readonly phases: Readonly<Record<string, readonly string[]>>;
}

const read = (packDir: string): BuildReads | undefined => {
  const file = path.join(REPO_ROOT, packDir, PACK_READS_FILE);
  if (!fs.existsSync(file)) return undefined;
  try {
    const { bundlers, phases } = JSON.parse(fs.readFileSync(file, 'utf-8')) as Partial<BuildReads>;
    if (bundlers === undefined || phases === undefined) return undefined;
    return { packDir, bundlers, phases };
  } catch {
    // A half-written or truncated file is a missing one: both mean "no evidence about what was read"
    return undefined;
  }
};

/**
 * The version of a bundler that `apack pack build` would resolve — **the CLI's**, not the pack's.
 *
 * The pack declares none of these; the command that builds it does, and that is the copy that wrote the
 * record. Resolved rather than read out of a manifest, so a hoisted install and a nested one give the same
 * answer, and memoised because nothing rewrites `node_modules` mid-run.
 */
const versions = new Map<string, string | undefined>();
const installedVersion = (bundler: string): string | undefined => {
  if (versions.has(bundler)) return versions.get(bundler);
  let version: string | undefined;
  try {
    const manifest = createRequire(path.join(REPO_ROOT, 'packages', 'apack-cli', 'package.json'))
      .resolve(`${bundler}/package.json`);
    version = (JSON.parse(fs.readFileSync(manifest, 'utf-8')) as { version: string }).version;
  } catch {
    version = undefined;
  }
  versions.set(bundler, version);
  return version;
};

/** Where this repo keeps packs: its workspaces and the fixture packs the external-pack step builds */
const PACK_HOMES = ['packages', 'tests/packs'];

/**
 * Every pack that has been built in this checkout, repo-relative — the population a check asks about.
 *
 * Derived from the packs themselves (an `apack.json` beside a record), never from a list: a third pack
 * directory arrives covered, and one that has not been built is simply absent, which is the state a fresh
 * clone is in and the state a check has to report rather than pass over.
 */
export function packsWithReads(): string[] {
  return PACK_HOMES
    .flatMap((home) => {
      const dir = path.join(REPO_ROOT, home);
      if (!fs.existsSync(dir)) return [];
      return fs.readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(home, entry.name));
    })
    .filter((packDir) => fs.existsSync(path.join(REPO_ROOT, packDir, 'apack.json'))
      && fs.existsSync(path.join(REPO_ROOT, packDir, PACK_READS_FILE)))
    .sort();
}

/**
 * What a pack's build read, or `undefined` when there is no evidence.
 *
 * **`undefined` means no evidence; it is never an empty record.** A pack that has not been built here has
 * no file, a record from other bundlers describes other module graphs, and a record with no phase at all is
 * a build that reported nothing — all three are "nothing is known", and returning an empty set for any of
 * them would let a check pass over a step it learned nothing about.
 */
export function readsOf(packDir: string): BuildReads | undefined {
  // The self-check runs here, not at the call site: a caller comparing against a record it would not trust
  // is comparing against the wrong thing quietly, which is the hole this repo's other proxy left open
  if (untrustworthy(packDir) !== null) return undefined;
  return read(packDir);
}

/**
 * The command that rebuilds a pack's record, so every refusal below can say what to do about it.
 *
 * A bundler bump invalidates every record at once, and a message naming the two versions alone would be
 * silent about the one action that resolves it.
 *
 * `apack pack build` for anything this cannot place, which is the honest answer and the general one: a refusal
 * is asked about a directory the caller named, which may hold no pack at all — the spec asks about
 * `packages/server` — so this cannot be the place that requires a manifest to be there.
 */
export function rebuildCommand(packDir: string): string {
  if (packDir.startsWith('tests/packs/')) return 'npm run test:external-pack:contract';
  return 'apack pack build';
}

/** Every file a pack's build read, across its phases, pack-relative and deduplicated */
export function filesRead(reads: BuildReads): string[] {
  return [...new Set(Object.values(reads.phases).flat())].sort();
}

/**
 * Why a pack's record cannot be believed, or `null` when it can — the proxy's self-check.
 *
 * A record of what was read *last* time can be stale about a read nobody has made yet, which is the known
 * unsoundness of dep files and the reason the API report stamp needed a check against itself before it was
 * deleted. Three causes, named
 * apart because they call for different fixes: never built here, built by bundlers that have since moved,
 * or built with nothing reporting.
 */
export function untrustworthy(packDir: string, installed: (bundler: string) => string | undefined = installedVersion): string | null {
  const record = read(packDir);
  if (record === undefined) {
    return `no record: ${packDir} has not been built in this checkout, so nothing is recorded about what its build reads — ${rebuildCommand(packDir)}`;
  }
  for (const [bundler, version] of Object.entries(record.bundlers)) {
    const now = installed(bundler);
    if (now !== version) {
      return `bundled by ${bundler} ${version}, and ${now ?? 'nothing'} is installed: the recorded module graphs are another bundler's — ${rebuildCommand(packDir)}`;
    }
  }
  if (Object.keys(record.phases).length === 0) {
    return `recorded no phase, so the build reported nothing about what it read — ${rebuildCommand(packDir)}`;
  }
  return null;
}
