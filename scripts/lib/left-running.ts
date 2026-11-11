/**
 * What a command left running when it exited: the processes still alive in the group it was started in.
 *
 * A bounded command runs in a process group of its own, and the group is killed when the command exits, so
 * nothing it started outlives it. That kill was silent: a step whose spec forgot a child it had started passed,
 * and the child was cleaned up behind it without anyone being told. This is the listing taken before that kill.
 *
 * It is the one place a child still attached to its test worker can be judged. Inside the worker such a child
 * cannot be told from a helper that ends when the worker does (`leftover-processes.ts`, `@apackdev/testing`);
 * here the worker is gone, and whatever is still running is running on.
 *
 * A process on its way out is given a couple of seconds to go (`SETTLE_LOOKS_MS`): a worker finishing after its
 * pool, a service process reading the pipe that has just closed. What it cannot see is a process that left the
 * group for a session of its own, and a command not run through `boundedSpawn` at all.
 *
 * **Nothing is read on Windows**, which has no process groups. A process there keeps its parent's id after the
 * parent exits, so what a command started could be found by walking parents, but every console program starts a
 * host process of its own that outlives it for a moment, and nothing here has been run there to say what else
 * does: a check that failed a step for one of those would be worse than none.
 */
import { execFile } from 'node:child_process';

/** One process as a listing has it */
export interface GroupProcess {
  readonly pid: number;
  readonly pgid: number;
  /** Whether it has exited and only waits to be collected by its parent */
  readonly exited: boolean;
  readonly command: string;
}

/** How long what a command left gets to go by itself before it is reported, in looks further and further apart */
const SETTLE_LOOKS_MS = [100, 200, 400, 600, 700];

/** The processes of `leader`'s group that are still running, from one listing: its members other than the leader */
export function leftIn(rows: readonly GroupProcess[], leader: number): GroupProcess[] {
  return rows.filter(row => row.pgid === leader && row.pid !== leader && !row.exited);
}

/** The rows of `ps -A -o pid=,pgid=,stat=,command=` */
export function parsePs(listing: string): GroupProcess[] {
  return listing.split('\n').flatMap((line) => {
    const row = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line);
    return row ? [{ pid: Number(row[1]), pgid: Number(row[2]), exited: row[3]!.startsWith('Z'), command: row[4]! }] : [];
  });
}

/** Every process on the machine, or nothing when no listing could be taken */
function listProcesses(): Promise<GroupProcess[] | undefined> {
  return new Promise((resolve) => {
    execFile('ps', ['-A', '-o', 'pid=,pgid=,stat=,command='], { maxBuffer: 64 * 1024 * 1024, encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } },
      (error, stdout) => resolve(error ? undefined : parsePs(stdout)));
  });
}

/**
 * What the command that led group `leader` left running, once it has had the time to go. Nothing when no listing
 * could be taken: a listing that fails says nothing either way.
 */
export async function leftRunning(leader: number): Promise<GroupProcess[]> {
  if (process.platform === 'win32') return [];
  for (const waitMs of [0, ...SETTLE_LOOKS_MS]) {
    if (waitMs > 0) await new Promise((resolve) => { setTimeout(resolve, waitMs); });
    const rows = await listProcesses();
    if (!rows) return [];
    const left = leftIn(rows, leader);
    if (left.length === 0 || waitMs === SETTLE_LOOKS_MS.at(-1)) return left;
  }
  return [];
}

/** What a run is told of the processes its command left, each with what it was running */
export function describeLeft(left: readonly GroupProcess[]): string {
  const count = left.length === 1 ? 'a process' : `${left.length} processes`;
  return `\n[bounded] it exited and left ${count} running, which ${left.length === 1 ? 'was' : 'were'} then killed:\n`
    + left.map(row => `  pid ${row.pid}: ${row.command.slice(0, 300)}\n`).join('')
    + 'Whatever started one is to stop it and wait for it to exit: a run that passes with one still running passes only where something kills it afterwards.\n';
}
