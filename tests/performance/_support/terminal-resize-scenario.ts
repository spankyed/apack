import { createHash } from 'node:crypto';
import { createWarmScenario } from './scenario.ts';
import type { PerformanceWindow } from './window.ts';

/** How many resizes one action sends: a panel drag produces a stream of them, one per observed frame */
const RESIZES = 24;
/** The column each step asks for, walking down from the default 80 so every step is a distinct size */
const colsAt = (step: number) => 80 - step;

const resizeFixture = (trials: number) => ({
  identity: {
    generator: 'terminal-resize-v1',
    seed: 0,
    sha256: createHash('sha256').update(`terminal-resize-v1:${RESIZES}:${colsAt(RESIZES - 1)}`).digest('hex'),
    distribution: { trials, resizesPerAction: RESIZES, firstCols: colsAt(0), lastCols: colsAt(RESIZES - 1), rows: 24 },
  },
  data: { resizes: RESIZES },
});

/**
 * **What a resize storm costs, which is F5's claim measured rather than read.**
 *
 * `services/terminal.ts`'s `resize()` writes an EARS row on every call with no coalescing, so a panel drag
 * — which produces one resize per observed frame — writes one row per frame. This sends `terminal.RESIZE`
 * at that shape and counts what reached the database, which is the number the finding is about.
 *
 * **Cite the write counts from this scenario, not its durations.** A span's `ears.request_bytes` and the
 * number of `ears.write` spans do not move with machine load, so this reading does not need `check:idle`;
 * its `durationMs` does, and nothing should quote it. The same split G1's pricing rests on.
 *
 * Completion is the surface's own record of the terminal's size reaching the last step — the child's
 * `terminals` entry, read to assert rather than to drive — so the action cannot be counted complete while
 * resizes are still in flight. `awaitsDelivery` is false because a terminal has no view, and `subscribe`
 * supplies the trigger, because a resize mutates no DOM either: the emulator draws to a canvas.
 *
 * **The action has to ask for the list to see its own terminal's size**, since nothing tells the surface a
 * resize happened. That round trip is inside the measured interval, so the duration here covers it — one
 * more reason to cite only the write counts.
 */
export async function terminalResizeScenario({ app, appPage, electronApp }: Parameters<typeof createWarmScenario>[2]) {
  const run = await createWarmScenario('terminal-resize', resizeFixture, { app, appPage, electronApp });
  const { fixture, schedule } = run;
  try {
    await app.waitForSurface('default-setup/code');
    await app.navigate('default-setup/code');

    // One terminal for the whole run: resizing is the measured action, opening one is not
    const terminalId = await appPage.evaluate(async () => {
      const win = window as unknown as PerformanceWindow;
      const code = () => win.applicationState.system.get('default-setup/code');
      win.applicationState.send({ type: 'SEND_TO_SURFACE', surface: 'default-setup/code', events: [{ type: 'terminal.CREATE' }] });
      for (let i = 0; i < 100 && !code().getSnapshot().context.panelTerminalId; i++) await new Promise(r => setTimeout(r, 50));
      return code().getSnapshot().context.panelTerminalId ?? null;
    });
    if (!terminalId) throw new Error('No terminal to resize');

    for (const entry of schedule) {
      const { mode } = entry;
      await run.begin(entry);
      const result = await appPage.evaluate(async ({ mode, fixtureId, terminalId, resizes }) => {
        const win = window as unknown as PerformanceWindow;
        const recording = win.__performance;
        const sizeOf = (id: string) => win.applicationState.system.get('default-setup/code')
          .getSnapshot().children?.terminal?.getSnapshot().context.terminals?.find(t => t.id === id)?.cols;
        await recording.start(mode);

        const started = performance.now();
        const action = recording.begin('app.terminal.resize', { 'app.scenario': 'terminal-resize', 'app.fixture': fixtureId })!;
        const lastCols = 80 - (resizes - 1);
        let completed = false;
        let durationMs: number | undefined;
        let failure: string | undefined;
        const work: Record<string, number> = { requestedResizes: resizes, lastCols };
        try {
          await win.__waitForPerformanceView({
            awaitsDelivery: false,
            accept: () => false,
            // A resize changes no view and mutates no DOM — the emulator draws to a canvas — so the surface that
            // records the new size is what says readiness may have changed
            subscribe: notify => {
              const subscription = win.applicationState.system.get('default-setup/code').subscribe(notify);
              return () => subscription.unsubscribe();
            },
            check: () => {
              const cols = sizeOf(terminalId);
              work.observedCols = cols ?? -1;
              if (cols !== lastCols) return false;
              const ready = action.within(() => recording.begin('app.view.ready', {
                'app.generation': 'feed', 'app.delivery': 0, 'app.commit': 0, 'app.result_count': resizes,
              }));
              ready?.end();
              durationMs = performance.now() - started;
              completed = true;
              return true;
            },
            dispatch: () => { action.within(() => {
              for (let step = 0; step < resizes; step++) {
                win.applicationState.send({ type: 'SEND_TO_SURFACE', surface: 'default-setup/code',
                  events: [{ type: 'terminal.RESIZE', terminalId, cols: 80 - step, rows: 24 }] });
              }
              // **The surface is never told a resize happened**: the backend answers and broadcasts nothing
              // for one, so the `terminals` entry keeps the size it was created with. Asking for the list
              // is the only way the window learns what size its own terminal is — which is why the action
              // ends with one, and is worth knowing before anything is built on that list's sizes.
              win.applicationState.send({ type: 'SEND_TO_SURFACE', surface: 'default-setup/code',
                events: [{ type: 'terminal.REFRESH_LIST' }] });
            }); },
            errors: [],
          });
        } catch { failure = 'missing-view-ready'; }
        finally { action.end(completed ? 'ok' : 'error'); }
        const reports = await recording.stop();
        return { completed, durationMs, reports, failure, work };
      }, { mode, fixtureId: fixture.identity.generator, terminalId, resizes: RESIZES });

      // What reached the database for those resizes, which is the reading
      const writes = (result.reports.backend?.observations ?? [])
        .map(encoded => JSON.parse(encoded) as { name: string; attributes: Record<string, unknown> })
        .filter(span => span.name === 'ears.write' && span.attributes['ears.database'] === 'app');
      const work = {
        ...result.work,
        appWrites: writes.length,
        appWriteBytes: writes.reduce((bytes, span) => bytes + Number(span.attributes['ears.request_bytes'] ?? 0), 0),
      };

      await run.append(entry, result, { work });

      // Back to the default for the next action, outside the measured interval. The list has to be asked
      // for again here too, for the same reason the action does it: a resize tells the surface nothing.
      await appPage.evaluate(id => {
        const win = window as unknown as PerformanceWindow;
        win.applicationState.send({ type: 'SEND_TO_SURFACE', surface: 'default-setup/code',
          events: [{ type: 'terminal.RESIZE', terminalId: id, cols: 80, rows: 24 }, { type: 'terminal.REFRESH_LIST' }] });
      }, terminalId);
      await appPage.waitForFunction(id => (window as unknown as PerformanceWindow).applicationState
        .system.get('default-setup/code').getSnapshot().children?.terminal?.getSnapshot()
        .context.terminals?.find(t => t.id === id)?.cols === 80, terminalId);
    }
  } finally { run.close(); }
}
