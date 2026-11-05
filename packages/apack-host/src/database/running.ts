// Whether an apack app is running on a data dir: the app process said so, or its API's port file
// names a port whose process is running
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { _appDirOf, type AppEnvironment } from '@apackdev/sdk/env';
import { lockIsHeld, readApiEndpoint, sameWriter, type WriterRecord } from '../process-liveness.ts';

/** What the app process publishes in the data dir for as long as it runs */
const APP_LOCK = 'app.lock';

type AppLock = WriterRecord;

/** Why an app is thought to be using a data dir, and the file that says so when there is one to remove */
export interface RunningApp {
  /** For the message: what is running, and how we know */
  why: string;
  /**
   * The process to signal to end it, where the answer came from a record that names one.
   *
   * Absent for a holder this machine cannot signal — a record naming another machine, or one that cannot be
   * read at all — so a caller that wants to stop an app asks for a pid and gets nothing rather than a
   * number it would signal locally. The pid is already parsed to decide `why`; exposing it is what keeps a
   * caller from re-reading the lock and forming a second opinion about its format.
   */
  pid?: number;
  /**
   * The file the answer came from, when it is one a user can delete if no app is really running. The app
   * marker survives a crash, and its pid can be one the OS has since given to something else, so a refusal
   * that named no way out would leave a data dir no tool could ever write to again. The API's port file
   * carries none: it is bound by the boot that wrote it, so a leftover clears itself.
   */
  marker?: string;
}

/** Where the app publishes that it is using a data dir */
export const appLockFile = (userDataDir: string): string => path.join(_appDirOf(userDataDir), APP_LOCK);

/**
 * Publishes that this process is using `userDataDir`, and returns the way to take it back.
 *
 * The Electron main process calls this before it starts anything: it is using the data dir from that
 * moment, and its API — which is what actually opens the database — publishes its port only once it has
 * booted. Between those two moments, and again while a crashed API is being restarted, the port file says
 * no app is here and this is the only thing that says otherwise.
 *
 * Read by `apack db`, never by the app itself; a tool that finds it tells the app what it commits, or refuses a change
 * that replaces what the app is using. It is not a mutual-exclusion lock — `requestSingleInstanceLock()` is what keeps one app per
 * data dir — so it does not need an atomic create.
 */
export function publishRunningApp(userDataDir: string): () => void {
  const file = appLockFile(userDataDir);
  const mine: AppLock = { pid: process.pid, machine: os.hostname(), since: new Date().toISOString() };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(mine));
  return () => {
    // Only this run's: an app that crashed and was restarted has already replaced it, and a pid alone can't
    // tell the two apart because the OS reuses them
    try {
      const held = JSON.parse(fs.readFileSync(file, 'utf-8')) as AppLock;
      if (sameWriter(held, mine)) fs.rmSync(file, { force: true });
    } catch { /* gone, or unreadable: nothing of ours to remove */ }
  };
}

/** The API this data dir's port file names, while its process is running */
function liveApi(apiPortFile: string): RunningApp | null {
  const endpoint = readApiEndpoint(apiPortFile);
  return endpoint && { why: `its API is running on port ${endpoint.port} (pid ${endpoint.pid})`, pid: endpoint.pid };
}

/**
 * The app process that published itself here, when it is still running.
 *
 * A file this app wrote, not another product's: this read Chromium's `SingletonLock` before, which is a
 * symlink it only writes on POSIX, and which failed *open* — a format change, or Windows, and the answer
 * was silently "no app".
 */
function liveApp(userDataDir: string): RunningApp | null {
  const file = appLockFile(userDataDir);
  const unresolved = { why: `${file} is there and can't be read`, marker: file };
  let held: Partial<AppLock>;
  try {
    held = JSON.parse(fs.readFileSync(file, 'utf-8')) as Partial<AppLock>;
  } catch (err) {
    // Unreadable is not absent: a file that is there and makes no sense is one we can't resolve, and the
    // safe answer for something guarding a database is that an app may be using it
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    return unresolved;
  }
  if (typeof held.pid !== 'number' || typeof held.machine !== 'string') return unresolved;
  if (held.machine !== os.hostname()) return { why: `its process is running on ${held.machine}`, marker: file };
  return lockIsHeld(held.pid) ? { why: `its process is running (pid ${held.pid})`, marker: file, pid: held.pid } : null;
}

/**
 * Why an app is running on the data dir, or `null` when none is: a file or a port file left behind by a
 * process that has exited doesn't count
 */
export function findRunningApp(context: Pick<AppEnvironment, 'userDataDir' | 'apiPortFile'>): RunningApp | null {
  return liveApp(context.userDataDir) ?? liveApi(context.apiPortFile);
}
