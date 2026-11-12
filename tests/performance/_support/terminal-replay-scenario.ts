import { createHash } from 'node:crypto';
import { createWarmScenario } from './scenario.ts';
import type { PerformanceWindow } from './window.ts';

/** The scrollback a terminal is carrying when the action reattaches it */
const HISTORY_BYTES = 256 * 1024;
const FILL = `head -c ${HISTORY_BYTES} /dev/zero | tr '\\0' x\n`;

const replayFixture = (trials: number) => ({
  identity: {
    generator: 'terminal-replay-v1',
    seed: 0,
    sha256: createHash('sha256').update(`terminal-replay-v1:${HISTORY_BYTES}`).digest('hex'),
    distribution: { trials, historyBytes: HISTORY_BYTES, cols: 80, rows: 24 },
  },
  data: { historyBytes: HISTORY_BYTES },
});

/**
 * **What it costs to look at a terminal again after looking away, with a large history behind it.**
 *
 * Phase G's "large-history replay". The action navigates off the code surface and back, so the terminal's
 * host is torn down and rebuilt around a session that has 256 KiB of scrollback — which is the moment the
 * presentation rewrite changes, and the one a user feels as the tab taking a moment to come back.
 *
 * **It also records where the history comes from.** The history is the broker's: a window holds the rows
 * it has been shown and nothing else, so coming back attaches a view to the session again and is sent its
 * screen over the window's own connection. `app.surface.send` counts what crossed the app's event bus
 * during the action, which is none of it.
 *
 * Completion is the view attached and laid out again, as `terminal-open`'s is.
 */
export async function terminalReplayScenario({ app, appPage, electronApp }: Parameters<typeof createWarmScenario>[2]) {
  const run = await createWarmScenario('terminal-replay', replayFixture, { app, appPage, electronApp });
  const { fixture, schedule } = run;
  try {
    await app.waitForSurface('default-setup/code');
    await app.waitForSurface('default-setup/notes');
    await app.navigate('default-setup/code');

    // One terminal carrying a large history, built before anything is measured
    await appPage.evaluate(async fill => {
      const win = window as unknown as PerformanceWindow;
      const code = () => win.applicationState.system.get('default-setup/code');
      win.applicationState.send({ type: 'SEND_TO_SURFACE', surface: 'default-setup/code', events: [{ type: 'terminal.CREATE' }] });
      let id: string | null = null;
      for (let i = 0; i < 200 && !id; i++) {
        id = code().getSnapshot().context.panelTerminalId ?? null;
        if (!id) await new Promise(r => setTimeout(r, 25));
      }
      if (!id) throw new Error('No terminal to fill');
      win.applicationState.send({ type: 'SEND_TO_SURFACE', surface: 'default-setup/code',
        events: [{ type: 'terminal.INPUT', terminalId: id, data: fill }] });
      // The fill is not measured; give it room to finish before the first action
      await new Promise(r => setTimeout(r, 6000));
    }, FILL);

    for (const entry of schedule) {
      const { mode } = entry;
      await run.begin(entry);
      const result = await appPage.evaluate(async ({ mode, fixtureId, historyBytes }) => {
        const win = window as unknown as PerformanceWindow;
        const recording = win.__performance;
        const shown = () => !!document.querySelector('[data-active-surface="default-setup/code"]');
        await recording.start(mode);

        // Away first, outside the measured interval: the action is coming back
        win.applicationState.send({ type: 'SELECT_SURFACE', surface: 'default-setup/notes' });
        for (let i = 0; i < 200 && shown(); i++) await new Promise(r => setTimeout(r, 25));

        const started = performance.now();
        const action = recording.begin('app.terminal.open', { 'app.scenario': 'terminal-replay', 'app.fixture': fixtureId })!;
        let completed = false;
        let durationMs: number | undefined;
        let failure: string | undefined;
        const work: Record<string, number> = { historyBytes };
        try {
          await win.__waitForPerformanceView({
            awaitsDelivery: false,
            accept: () => false,
            check: () => {
              if (!shown()) return false;
              const terminal = document.querySelector('[data-apack-terminal]');
              if (!terminal || terminal.getClientRects().length === 0) return false;
              work.renderCanvases = terminal.querySelectorAll('canvas').length;
              if (work.renderCanvases === 0) return false;
              const ready = action.within(() => recording.begin('app.view.ready', {
                'app.generation': 'feed', 'app.delivery': 0, 'app.commit': 0, 'app.result_count': historyBytes,
              }));
              ready?.end();
              durationMs = performance.now() - started;
              completed = true;
              return true;
            },
            dispatch: () => { action.within(() => {
              win.applicationState.send({ type: 'SELECT_SURFACE', surface: 'default-setup/code' }); }); },
            errors: [],
          });
        } catch { failure = 'missing-view-ready'; }
        finally { action.end(completed ? 'ok' : 'error'); }
        const reports = await recording.stop();
        return { completed, durationMs, reports, failure, work };
      }, { mode, fixtureId: fixture.identity.generator, historyBytes: HISTORY_BYTES });

      const sends = (result.reports.backend?.observations ?? [])
        .map(encoded => JSON.parse(encoded) as { name: string; attributes: Record<string, unknown> })
        .filter(span => span.name === 'app.surface.send');
      const work = {
        ...result.work,
        // Zero means the window replayed from a copy it was already holding
        backendSendsDuringReattach: sends.length,
        backendBytesDuringReattach: sends.reduce((bytes, span) => bytes + Number(span.attributes['app.bytes'] ?? 0), 0),
      };
      await run.append(entry, result, { work });
    }
  } finally { run.close(); }
}
