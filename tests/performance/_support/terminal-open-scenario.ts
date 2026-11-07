import { createHash } from 'node:crypto';
import { createWarmScenario } from './scenario.ts';
import type { PerformanceWindow } from './window.ts';

/** What the backend gives a terminal asked for with no dimensions (`services/terminal.ts`) */
const COLS = 80;
const ROWS = 24;

/**
 * This scenario's whole fixture, since it seeds no data: a terminal is a process, and what decides the
 * reading is the shell, the dimensions and how many are opened. Recorded so a later reading over a different
 * shape cannot be mistaken for the same one.
 */
const terminalFixture = (trials: number) => {
  const shell = process.env.SHELL ?? '/bin/bash';
  return {
    identity: {
      generator: 'terminal-open-v1',
      seed: 0,
      sha256: createHash('sha256').update(`terminal-open-v1:${shell}:${COLS}x${ROWS}`).digest('hex'),
      distribution: { terminals: trials, cols: COLS, rows: ROWS },
    },
    data: { shell, cols: COLS, rows: ROWS },
  };
};

/**
 * **First-open latency: from asking for a terminal to one the user can type into.**
 *
 * The reading Phase G of [the terminal ownership goal](../../../docs/goals/goal-terminal-ownership.md) needs
 * a *before* for, and the one its own Constraints single out — "a pty spawns in-process today; a broker has
 * to start first" — so a regression here is the result that has to be investigated rather than absorbed.
 *
 * **Completion is what the window drew, because a terminal has no view.** Its output is broadcast news
 * (`terminal.OUTPUT`) and the code feature declares no `views` module at all, so there is no delivery to
 * correlate a trial against and `awaitsDelivery` is false. What stands in its place is the surface's own
 * record that the terminal is the panel's, and xterm having laid out a screen with something on it — a
 * freshly spawned shell writes its prompt, so non-empty rows mean the pty is alive and its first bytes have
 * reached the screen. That is the thing a user waits for; an attached-but-blank terminal is not open yet.
 *
 * Each trial opens its own terminal and closes it again outside the measured interval, so twenty-five
 * trials do not leave twenty-five shells running and change what the later ones measure.
 */
export async function terminalOpenScenario({ app, appPage, electronApp }: Parameters<typeof createWarmScenario>[2]) {
  const run = await createWarmScenario('terminal-open', terminalFixture, { app, appPage, electronApp });
  const { fixture, schedule } = run;
  try {
    await app.waitForSurface('default-setup/code');
    await app.navigate('default-setup/code');

    for (const entry of schedule) {
      const { mode } = entry;
      await run.begin(entry);
      const result = await appPage.evaluate(async ({ mode, fixtureId }) => {
        const win = window as unknown as PerformanceWindow;
        const recording = win.__performance;
        const code = () => win.applicationState.system.get('default-setup/code').getSnapshot().context;
        await recording.start(mode);

        const before = code().panelTerminalId ?? null;
        const started = performance.now();
        const action = recording.begin('app.terminal.open', { 'app.scenario': 'terminal-open', 'app.fixture': fixtureId })!;
        let completed = false;
        let durationMs: number | undefined;
        let failure: string | undefined;
        let opened: string | null = null;
        const work: Record<string, number> = {};
        try {
          await win.__waitForPerformanceView({
            awaitsDelivery: false,
            accept: () => false,
            check: () => {
              const context = code();
              const panelTerminalId = context.panelTerminalId ?? null;
              if (!panelTerminalId || panelTerminalId === before) return false;
              if (context.panelTerminalExpanded !== true) throw Error('terminal-not-shown');
              const screen = document.querySelector('.xterm-rows');
              const viewport = document.querySelector('.xterm-viewport');
              if (!screen || !viewport || viewport.getClientRects().length === 0) return false;
              const drawn = (screen.textContent ?? '').replace(/ /g, ' ').trim();
              work.drawnCharacters = drawn.length;
              if (drawn.length === 0) return false;
              const ready = action.within(() => recording.begin('app.view.ready', {
                'app.generation': 'feed', 'app.delivery': 0, 'app.commit': 0, 'app.result_count': drawn.length,
              }));
              ready?.end();
              durationMs = performance.now() - started;
              opened = panelTerminalId;
              completed = true;
              return true;
            },
            dispatch: () => { action.within(() => {
              win.applicationState.send({ type: 'SEND_TO_SURFACE', surface: 'default-setup/code', events: [{ type: 'terminal.CREATE' }] }); }); },
            errors: ['terminal-not-shown'],
          });
        } catch (error) { failure = error instanceof Error && error.message === 'terminal-not-shown' ? 'terminal-not-shown' : 'missing-view-ready'; }
        finally { action.end(completed ? 'ok' : 'error'); }
        const reports = await recording.stop();
        return { completed, durationMs, reports, failure, work, opened };
      }, { mode, fixtureId: fixture.identity.generator });

      await run.append(entry, result);

      // Outside the measured interval: the next trial measures a fresh open, not an Nth one
      if (result.opened) {
        await appPage.evaluate(terminalId => {
          const win = window as unknown as PerformanceWindow;
          win.applicationState.send({ type: 'SEND_TO_SURFACE', surface: 'default-setup/code', events: [{ type: 'terminal.CLOSE', terminalId }] });
        }, result.opened);
        await appPage.waitForFunction(terminalId =>
          ((window as unknown as PerformanceWindow).applicationState.system.get('default-setup/code')
            .getSnapshot().context.panelTerminalId ?? null) !== terminalId, result.opened);
      }
    }
  } finally { run.close(); }
}
