import { createHash } from 'node:crypto';
import { createWarmScenario } from './scenario.ts';
import type { PerformanceWindow } from './window.ts';

const hiddenFixture = (trials: number) => ({
  identity: {
    generator: 'terminal-hidden-v1',
    seed: 0,
    sha256: createHash('sha256').update(`terminal-hidden-v1:${process.env.SHELL ?? '/bin/bash'}`).digest('hex'),
    distribution: { trials, terminalsAtEnd: trials, cols: 80, rows: 24 },
  },
  data: { shell: process.env.SHELL ?? '/bin/bash' },
});

/**
 * **What several sessions cost while nobody is looking at them.**
 *
 * The reading Phase G asks for as "memory with several hidden sessions", and the one the broker changes most
 * directly: today every session's pty, its reader and its xterm live in the API and renderer processes, so N
 * sessions are N sets of in-process state. A broker owns the processes instead.
 *
 * **It accumulates rather than resetting**, which is the whole difference from `terminal-open`: trial N runs
 * with N terminals alive and only the newest visible, so the recorded RSS is a curve against session count
 * rather than one number. Each trial records both processes' sampled maximum beside the count, and the
 * action is the open that takes the count to N — so a trial's duration is also the Nth open, which is worth
 * having beside the first-open reading and is not the same thing.
 *
 * Nothing here closes a terminal. The app's own data directory is thrown away with the run.
 */
export async function terminalHiddenScenario({ app, appPage, electronApp }: Parameters<typeof createWarmScenario>[2]) {
  const run = await createWarmScenario('terminal-hidden', hiddenFixture, { app, appPage, electronApp });
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
        const code = () => win.applicationState.system.get('default-setup/code');
        const living = () => code().getSnapshot().children?.terminal?.getSnapshot().context.terminals?.length ?? 0;
        await recording.start(mode);

        const before = code().getSnapshot().context.panelTerminalId ?? null;
        const started = performance.now();
        const action = recording.begin('app.terminal.open', { 'app.scenario': 'terminal-hidden', 'app.fixture': fixtureId })!;
        let completed = false;
        let durationMs: number | undefined;
        let failure: string | undefined;
        const work: Record<string, number> = {};
        try {
          await win.__waitForPerformanceView({
            awaitsDelivery: false,
            accept: () => false,
            subscribe: notify => {
              const subscription = code().subscribe(notify);
              return () => subscription.unsubscribe();
            },
            check: () => {
              const context = code().getSnapshot().context;
              const panelTerminalId = context.panelTerminalId ?? null;
              if (!panelTerminalId || panelTerminalId === before) return false;
              const terminal = document.querySelector('.xterm');
              const viewport = document.querySelector('.xterm-viewport');
              if (!terminal || !viewport || viewport.getClientRects().length === 0) return false;
              work.renderCanvases = terminal.querySelectorAll('canvas').length;
              if (work.renderCanvases === 0) return false;
              // Only the newest is shown; every earlier one is a hidden session
              work.terminalsAlive = living();
              work.xtermElements = document.querySelectorAll('[class*="xterm"]').length;
              const ready = action.within(() => recording.begin('app.view.ready', {
                'app.generation': 'feed', 'app.delivery': 0, 'app.commit': 0, 'app.result_count': work.terminalsAlive,
              }));
              ready?.end();
              durationMs = performance.now() - started;
              completed = true;
              return true;
            },
            dispatch: () => { action.within(() => {
              win.applicationState.send({ type: 'SEND_TO_SURFACE', surface: 'default-setup/code', events: [{ type: 'terminal.CREATE' }] }); }); },
            errors: [],
          });
        } catch { failure = 'missing-view-ready'; }
        finally { action.end(completed ? 'ok' : 'error'); }
        const reports = await recording.stop();
        return { completed, durationMs, reports, failure, work };
      }, { mode, fixtureId: fixture.identity.generator });

      // The processes' own sampled maxima, beside the session count that produced them
      const backend = result.reports.backend?.processStatistics;
      const renderer = result.reports.renderer?.rendererStatistics?.metrics ?? [];
      const heap = renderer.find(metric => metric.name === 'JSHeapUsedSize');
      const work = {
        ...result.work,
        ...(backend && { backendRssMaxBytes: backend.rssSampledMaxBytes, backendHeapMaxBytes: backend.heapSampledMaxBytes }),
        ...(heap && { rendererHeapAfterBytes: Math.round(heap.after) }),
      };
      await run.append(entry, result, { work });
    }
  } finally { run.close(); }
}
