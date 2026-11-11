/**
 * The processes a spec file left running, read from one listing of every process on the machine.
 *
 * A process a spec starts and does not end runs on after the suite, on every machine the suite runs on, and
 * nothing reports it: the run was green. Two shapes are already out of the worker's reach when its file ends:
 *
 * - **detached**: a descendant of the worker in a process group of its own. It was started to outlive whoever
 *   started it, so the worker exiting ends nothing.
 * - **orphaned**: a process in the worker's process group whose parent is no longer in that group, created while
 *   the file ran. Its parent was something the file ran and has since exited (a git that started a hook), so no
 *   ancestry is left to say which worker it came from: a file running beside this one in the same run may have
 *   started it.
 *
 * A child still attached to the worker is not judged. One that holds the worker's pipes ends when the worker
 * does — a bundler's service process, a server spoken to over its stdin — and nothing read from outside tells
 * that one from a child that will run on. Nor is a process that left both the tree and the group: one that
 * started a session of its own and whose parent then exited.
 */
import { execFile } from 'node:child_process';
import * as fs from 'node:fs';

/** One process as the listing has it */
export interface ListedProcess {
  readonly pid: number; readonly ppid: number; readonly pgid: number;
  /** When it was created, to the second the listing gives */
  readonly startedAt: number;
  readonly command: string;
}

export interface Leftover {
  readonly process: ListedProcess;
  readonly how: 'detached' | 'orphaned';
}

const ROW = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\w{3}\s+\w{3}\s+\d+\s+[\d:]+\s+\d{4})\s+(.*)$/;

/** The rows of `ps -A -o pid=,ppid=,pgid=,lstart=,command=` taken in the C locale, whose dates every engine reads */
export function parseListing(listing: string): ListedProcess[] {
  return listing.split('\n').flatMap((line) => {
    const row = ROW.exec(line);
    if (!row) return [];
    return [{ pid: Number(row[1]), ppid: Number(row[2]), pgid: Number(row[3]), startedAt: Date.parse(row[4]!), command: row[5]! }];
  });
}

/**
 * Every process on the machine. Nothing where no listing can be taken: on Windows, which has no process groups to
 * read, or when `ps` could not run.
 */
export function listProcesses(): Promise<ListedProcess[] | undefined> {
  if (process.platform === 'win32') return Promise.resolve(undefined);
  return new Promise((resolve) => {
    execFile('ps', ['-A', '-o', 'pid=,ppid=,pgid=,lstart=,command='],
      { maxBuffer: 64 * 1024 * 1024, encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } },
      (error, stdout) => resolve(error ? undefined : parseListing(stdout)));
  });
}

/**
 * What `self` left running, from one listing: its descendants in another process group, and the processes in its
 * own group that lost their parent since `since`.
 */
export function leftoversIn(rows: readonly ListedProcess[], self: number, since: number): Leftover[] {
  const byPid = new Map(rows.map((row) => [row.pid, row]));
  const own = byPid.get(self);
  if (!own) return [];

  const ancestors = new Set<number>();
  for (let at = byPid.get(own.ppid); at && !ancestors.has(at.pid); at = byPid.get(at.ppid)) ancestors.add(at.pid);

  const tree = new Set([self]);
  for (let grew = true; grew;) {
    grew = false;
    for (const row of rows) {
      if (tree.has(row.pid) || !tree.has(row.ppid)) continue;
      tree.add(row.pid);
      grew = true;
    }
  }

  // A listing dates a process to the second, so one created in the second the file began counts as the file's
  const sinceSecond = Math.floor(since / 1000) * 1000;
  return rows.flatMap((row): Leftover[] => {
    if (row.pid === self) return [];
    if (tree.has(row.pid)) return row.pgid === own.pgid ? [] : [{ process: row, how: 'detached' }];
    const orphaned = row.pgid === own.pgid && !ancestors.has(row.pid) && byPid.get(row.ppid)?.pgid !== own.pgid;
    return orphaned && row.startedAt >= sinceSecond ? [{ process: row, how: 'orphaned' }] : [];
  });
}

/** The directory a process is running in, where the platform says */
async function workingDirectory(pid: number): Promise<string | undefined> {
  if (process.platform === 'linux') {
    try { return fs.readlinkSync(`/proc/${pid}/cwd`); } catch { return undefined; }
  }
  return new Promise((resolve) => {
    execFile('lsof', ['-a', '-d', 'cwd', '-Fn', '-p', String(pid)], { encoding: 'utf8' }, (_error, stdout) => {
      resolve(/^n(.+)$/m.exec(stdout ?? '')?.[1]);
    });
  });
}

/** What a file is told about the processes it left, each with its command and where it is running */
export async function describeLeftovers(file: string, leftovers: readonly Leftover[]): Promise<string> {
  const lines = await Promise.all(leftovers.map(async ({ process: left, how }) => {
    const where = await workingDirectory(left.pid);
    const why = how === 'detached'
      ? 'started by this file, detached from it'
      : 'lost its parent while this file ran: this file started it, or one running beside it did, and run alone only the one that did fails';
    return `  pid ${left.pid}: ${left.command}${where ? ` (in ${where})` : ''}, ${why}`;
  }));
  const count = leftovers.length === 1 ? 'a process' : `${leftovers.length} processes`;
  return `${file} left ${count} running:\n${lines.join('\n')}\n`
    + 'A process a spec starts is gone when its file ends: stop it and wait for it to exit, or give it an exit of its own '
    + 'that holds when its fixture is deleted. Nothing else ends it, so it runs on after the suite, on every machine the suite runs on.';
}
