// How far an app asked to quit had got, for the failure that says it never closed.
//
// "Did not answer, and did no work" fits two faults whose fixes are nowhere near each other: an app whose quit is
// still held in `before-quit`, which is the app's own code, and an app that has quit while a process it started
// keeps its output open, which is Chromium's or a child's. Electron's `will-quit` and its exit tell them apart,
// and both are seen from outside the app, so the failure says which it was.

/** Marker Electron main prints once `will-quit` fires, followed by JSON-encoded Chromium helper PIDs. */
export const WILL_QUIT_MARKER = '[e2e] will-quit';

/** What the fixture had seen of an app's quit when it gave up waiting for the app to close */
export interface QuitProgress {
  /** Electron emitted `will-quit`, which it does once every `before-quit` handler has let the quit through */
  readonly willQuit: boolean;
  readonly exitCode: number | null;
  readonly signalCode: NodeJS.Signals | null;
}

/**
 * Parses the Chromium helper PIDs carried on Electron's `will-quit` marker line, or `undefined` when `line` is not
 * that marker. A bare marker (no JSON suffix) still matches and yields `[]`.
 */
export function parseWillQuitLine(line: string): readonly number[] | undefined {
  const index = line.indexOf(WILL_QUIT_MARKER);
  if (index === -1) return undefined;
  const rest = line.slice(index + WILL_QUIT_MARKER.length).trim();
  if (!rest) return [];
  try {
    const parsed: unknown = JSON.parse(rest);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((pid): pid is number => typeof pid === 'number' && Number.isInteger(pid) && pid > 0);
  } catch {
    return [];
  }
}

/**
 * Deduplicates Chromium helper PIDs reported by `app.getAppMetrics()` while excluding Electron's main process (killed
 * explicitly first so it cannot respawn helpers), the API child (asserted dead on its own so a leaked API fails
 * loudly), and the current test runner process.
 */
export function chromiumHelperPidsToKill(
  reportedPids: Iterable<number>,
  exclude: { readonly mainPid?: number; readonly apiPid?: number; readonly selfPid?: number },
): number[] {
  const skip = new Set<number>();
  if (exclude.mainPid !== undefined) skip.add(exclude.mainPid);
  if (exclude.apiPid !== undefined) skip.add(exclude.apiPid);
  skip.add(exclude.selfPid ?? process.pid);

  const unique = new Set<number>();
  for (const pid of reportedPids) {
    if (!Number.isInteger(pid) || pid <= 0 || skip.has(pid)) continue;
    unique.add(pid);
  }
  return [...unique];
}

/**
 * Sends `SIGKILL` to each Chromium helper PID left behind when Electron main is `SIGKILL`'d to skip profile writes.
 * Helpers that already exited (`ESRCH`) or cannot be signaled (`EPERM`) are ignored.
 */
export function terminateHelperPids(
  pids: Iterable<number>,
  kill: (pid: number, signal: 'SIGKILL') => void = (pid, signal) => process.kill(pid, signal),
): number[] {
  const killed: number[] = [];
  for (const pid of pids) {
    try {
      kill(pid, 'SIGKILL');
      killed.push(pid);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ESRCH' && code !== 'EPERM') throw error;
    }
  }
  return killed;
}

/** The end of a sentence about an app that never closed: where its quit had stopped */
export function describeQuitStage({ willQuit, exitCode, signalCode }: QuitProgress): string {
  if (exitCode !== null || signalCode !== null) {
    return `its main process had exited (${signalCode ?? `code ${exitCode}`}), and a process it started still held its output open`;
  }
  if (willQuit) return 'it had passed will-quit, so its own quit was done, and its main process had not exited';
  return "it never reached will-quit: a before-quit handler was still holding the quit (the API server's holds it until the API has gone)";
}
