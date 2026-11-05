/**
 * Whether the process that wrote a record on disk is still running: the database write lock, the instance
 * lock, staging dirs, the dev server's marker, and the API's own port file.
 *
 * A pid alone cannot answer it. Pids are recycled, so a record a crash left behind names whatever took its
 * number, and reads as live for as long as the file exists. Bounding the pid by when the record was written
 * clears that, at the cost of the opposite error.
 *
 * Which error to prefer isn't a property of the pid, it's a property of the question being asked, and two
 * different questions are asked here: may I take this lock, and is this recorded handle still worth using.
 * So there is a predicate per question rather than one predicate and a flag. Each owns its own reasoning,
 * `true` is the cautious answer in both, and the shapes differ enough that neither can be typed where the
 * other was meant.
 *
 * Neither is exact. A pid space of ~100k against a few thousand live processes recycles within one long
 * uptime, which the bound cannot see either. The exact answer is the holder's start time
 * (`/proc/<pid>/stat`, `ps -o lstart`), read per platform; the answer with no staleness at all is an OS
 * advisory lock (`flock`/`LockFileEx`), which the kernel releases on process death. Reach for those if a
 * record's staleness ever has to be settled rather than estimated. A cheaper half-step, for the records
 * this app writes itself, is to record the writer's own start time in the record and bound by that instead
 * of the file's mtime, as `@apackdev/host/build/packages-built` does with its lock's `startedAt`: an mtime is
 * whatever last touched the file, a recorded `startedAt` is the writer saying when it began. It doesn't
 * reach every caller — Chromium writes the instance lock, and a staging dir carries its pid in its name —
 * so it would shrink this problem rather than end it.
 *
 * `readApiEndpoint` is here too: it is the one reader outside this file that needs the bound, and what a
 * running process published belongs with whether that process is still there.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';

/** Whether a process with this id exists (one another user owns counts). */
function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

/** When this machine booted: a record written before it belongs to a previous boot, whatever pid it names. */
function bootTime(): number {
  return Date.now() - os.uptime() * 1000;
}

/**
 * When `file` was last written, or `null` when it isn't there.
 *
 * `lstat`, not `stat`, so a symlink answers for itself rather than for whatever it points at. No caller
 * passes one today, and a symlink whose target isn't a path would make `stat` throw on a record that is
 * genuinely there — which for a staleness check reads as "gone".
 */
function writtenAt(file: string): number | null {
  try {
    return fs.lstatSync(file).mtimeMs;
  } catch {
    return null;
  }
}

/**
 * Whether a mutual-exclusion lock naming `pid` is still held, so the caller must not proceed.
 *
 * The pid alone decides. A dead holder whose pid this boot reassigned reads as held until someone deletes
 * the lock, and no live holder is ever missed. Bounding the pid by when the lock was written would clear
 * the first and buy it with the second, and a lock is the wrong place for that trade: the database write
 * lock and the app's instance lock both guard against two writers, where missing a live holder is silent
 * data loss and inventing a dead one is an error naming the file to delete.
 *
 * Pass only a lock this machine wrote. A caller that can tell whose it is — the write lock's `machine`,
 * the instance lock's hostname — checks that first, since a foreign pid means nothing here.
 */
export function lockIsHeld(pid: number): boolean {
  return processExists(pid);
}

/**
 * Whether the record in `file`, naming `pid`, should be ignored: its writer has exited, or the record
 * predates this boot and so names a pid that has since been reused. A missing file is stale.
 *
 * Errs toward stale, the cheap direction for a recorded handle — the caller falls back, re-derives or
 * cleans up. It can call a live writer stale, because `bootTime()` is `Date.now() - os.uptime()` and so
 * moves with the wall clock: a forward step of `X` makes a record written at uptime `u` look pre-boot
 * whenever `X > u`. Never use it for a lock, where that would mean two writers; `_lockIsHeld` is that
 * question.
 *
 * Pass only a record this machine wrote: a foreign mtime is on another clock.
 */
export function recordIsStale(file: string, pid: number): boolean {
  if (!processExists(pid)) return true;
  const at = writtenAt(file);
  return at === null || at < bootTime();
}

/** What a running API publishes about itself in `AppEnvironment.apiPortFile`, so local tools find it */
export interface ApiEndpoint {
  port: number;
  /** The API process. A file whose process is gone is one a crash left behind, not a running app */
  pid: number;
  /** What a local tool shows to say it committed to the database beside this API, and good for nothing else */
  dataChangedToken?: string;
}

/** What a process writes about itself in a record: enough to tell its own leftover from a later holder's */
export interface WriterRecord {
  pid: number;
  machine: string;
  since: string;
}

/**
 * Whether two records name the same run, so a process removes the leftover it judged and not the one a
 * later holder put in its place. The pid alone isn't enough — the OS reuses it — and neither is the pid and
 * the machine.
 */
export const sameWriter = (a: WriterRecord | null, b: WriterRecord | null): boolean =>
  a !== null && b !== null && a.pid === b.pid && a.machine === b.machine && a.since === b.since;

/**
 * The API running on this data dir, from the file it published, or `null` when there is none: no file, one that
 * can't be read, or one a crashed run left behind. A process this user may not signal counts as running.
 * Whether the API answers is the caller's to check.
 *
 * "Left behind" is the pid *and* the boot it was written in: pids are recycled, so after a reboot a crashed
 * run's file names an unrelated live process and would otherwise report an API that isn't there.
 */
export function readApiEndpoint(apiPortFile: string): ApiEndpoint | null {
  let published: { port?: unknown; pid?: unknown; dataChangedToken?: unknown };
  try {
    published = JSON.parse(fs.readFileSync(apiPortFile, 'utf-8')) as typeof published;
  } catch {
    return null;
  }
  const { port, pid, dataChangedToken } = published;
  if (!Number.isInteger(port) || (port as number) <= 0 || (port as number) > 65535) return null;
  if (!Number.isInteger(pid) || (pid as number) <= 0) return null;
  if (recordIsStale(apiPortFile, pid as number)) return null;
  return {
    port: port as number,
    pid: pid as number,
    ...(typeof dataChangedToken === 'string' && { dataChangedToken }),
  };
}
