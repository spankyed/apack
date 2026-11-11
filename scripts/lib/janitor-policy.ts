// What `scripts/janitor.ts` removes, decided over what it found, so the decisions can be checked without a disk.
//
// Everything it may remove is a build cache that a build makes again: a Rust checkout's incremental compilation
// sessions, its stale artifacts and — when the disk is low — the whole build output of a checkout nothing has
// compiled in for a while, and the temporary directories an elmdb checkout's tests leave in its `tmp/`.
// Nothing else is in reach — not Docker volumes, whose data may be another session's evidence
// (docs/references/guides/docker-storage.md), and not logs.

const GB = 1024 ** 3;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/**
 * Free space below which every limit tightens. Above it the janitor keeps the caches warm, since each eviction is a
 * slower next build; below it the disk is the problem, which a slower build is not.
 */
export const LOW_FREE_BYTES = 30 * GB;

/** Free space below which the disk is about to stop builds altogether, and only what is being built now is kept */
export const CRITICAL_FREE_BYTES = 10 * GB;

export interface JanitorLimits {
  /** Incremental sessions kept across every Rust target, least recently used evicted first */
  incrementalBudgetBytes: number;
  /** `cargo sweep --time`: artifacts unused this many days go */
  sweepDays: number;
  /**
   * How long a profile's build output is kept after anything was last compiled into it, or nothing where an idle
   * one is left to `sweepDays` (`planIdleProfileClearing`)
   */
  idleProfileMs: number | undefined;
}

export const limitsFor = (freeBytes: number): JanitorLimits => freeBytes < CRITICAL_FREE_BYTES
  ? { incrementalBudgetBytes: 2 * GB, sweepDays: 2, idleProfileMs: IN_USE_WINDOW_MS }
  : freeBytes < LOW_FREE_BYTES
    ? { incrementalBudgetBytes: 2 * GB, sweepDays: 2, idleProfileMs: 12 * HOUR }
    : { incrementalBudgetBytes: 6 * GB, sweepDays: 7, idleProfileMs: undefined };

/**
 * A compilation unit's incremental directory, `target/<profile>/incremental/<crate>-<hash>`. rustc starts a new
 * session in it on every build of that unit, so its mtime is when the unit was last compiled; a unit whose hash
 * changes (other features, flags or profile) gets a new directory and the old one is never touched again.
 */
export interface IncrementalUnit {
  path: string;
  /** The profile directory, whose `.cargo-lock` cargo holds while it builds */
  profileDir: string;
  bytes: number;
  mtimeMs: number;
}

/**
 * Within this of now a unit may belong to a build in progress, so it is never evicted, whatever the budget says:
 * longer than any one build's compile of it.
 */
export const IN_USE_WINDOW_MS = HOUR;

/** The least recently compiled units, until the rest fit the budget, leaving any compiled within the hour */
export function planIncrementalEviction(units: readonly IncrementalUnit[], budgetBytes: number, now: number): IncrementalUnit[] {
  let total = units.reduce((sum, unit) => sum + unit.bytes, 0);
  const evicted: IncrementalUnit[] = [];
  for (const unit of [...units].sort((a, b) => a.mtimeMs - b.mtimeMs)) {
    if (total <= budgetBytes) break;
    if (now - unit.mtimeMs < IN_USE_WINDOW_MS) continue;
    evicted.push(unit);
    total -= unit.bytes;
  }
  return evicted;
}

/**
 * One profile of a Rust target, `target/debug` or `target/<triple>/release`: everything a build of that profile
 * wrote, and when anything was last compiled into it.
 */
export interface ProfileOutput {
  /** The profile directory, whose `.cargo-lock` cargo holds while it builds */
  profileDir: string;
  bytes: number;
  /** When an artifact was last added to it: a build that found everything fresh adds none */
  builtMs: number;
}

/**
 * The profiles whose whole output goes: those nothing has compiled into for `idleMs`.
 *
 * **Because every worktree builds into a target of its own, and unused-for-days is the wrong test for one.** Five
 * worktrees of one checkout held 25 GB beside the 17 GB of the checkout itself, every byte of it used within two
 * days, so a sweep by age removed nothing while the disk ran out (2026-11-11). What bounds that is not a size —
 * a full build of a profile has the size it has, and a cap below it is a rebuild every hour — but which checkouts
 * are being worked in: when the disk is low, one that has sat for half a day gives its output back, and builds it
 * again when it is next built. Never one compiled into within the hour, which may be building now.
 */
export function planIdleProfileClearing(profiles: readonly ProfileOutput[], idleMs: number | undefined, now: number): ProfileOutput[] {
  if (idleMs === undefined) return [];
  return profiles.filter((profile) => now - profile.builtMs > Math.max(idleMs, IN_USE_WINDOW_MS));
}

/**
 * An elmdb checkout's `tmp/` holds every temporary directory its tests make, and one a killed test left behind stays.
 * A day is past any test's deadline, so an entry that old belongs to no running test.
 */
export const TEST_TMP_AGE_MS = DAY;

export interface TmpEntry { name: string; mtimeMs: number }

/** The entries of an elmdb `tmp/` old enough to be leftovers; its committed `.gitignore` stays */
export const planTmpRemoval = (entries: readonly TmpEntry[], now: number): TmpEntry[] =>
  entries.filter((entry) => entry.name !== '.gitignore' && now - entry.mtimeMs > TEST_TMP_AGE_MS);
