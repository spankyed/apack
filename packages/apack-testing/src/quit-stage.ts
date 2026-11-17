// How far an app asked to quit had got, for the failure that says it never closed.
//
// "Did not answer, and did no work" fits two faults whose fixes are nowhere near each other: an app whose quit is
// still held in `before-quit`, which is the app's own code, and an app that has quit while a process it started
// keeps its output open, which is Chromium's or a child's. Electron's `will-quit` and its exit tell them apart,
// and both are seen from outside the app, so the failure says which it was.

/** What the fixture had seen of an app's quit when it gave up waiting for the app to close */
export interface QuitProgress {
  /** Electron emitted `will-quit`, which it does once every `before-quit` handler has let the quit through */
  readonly willQuit: boolean;
  readonly exitCode: number | null;
  readonly signalCode: NodeJS.Signals | null;
}

/** The end of a sentence about an app that never closed: where its quit had stopped */
export function describeQuitStage({ willQuit, exitCode, signalCode }: QuitProgress): string {
  if (exitCode !== null || signalCode !== null) {
    return `its main process had exited (${signalCode ?? `code ${exitCode}`}), and a process it started still held its output open`;
  }
  if (willQuit) return 'it had passed will-quit, so its own quit was done, and its main process had not exited';
  return "it never reached will-quit: a before-quit handler was still holding the quit (the API server's holds it until the API has gone)";
}
