import { createHash } from 'node:crypto';
import { createWarmScenario } from './scenario.ts';
import type { PerformanceWindow } from './window.ts';

/**
 * The corpus: this many bytes of one repeated character, then the shell exits. 64 KiB prices a burst;
 * `APACK_PERFORMANCE_TERMINAL_BYTES` sets a size that prices sustained throughput instead.
 */
const CORPUS_BYTES = Number(process.env.APACK_PERFORMANCE_TERMINAL_BYTES ?? 64 * 1024);
if (!Number.isInteger(CORPUS_BYTES) || CORPUS_BYTES < 1) throw new Error('APACK_PERFORMANCE_TERMINAL_BYTES is not a byte count');
/**
 * Deterministic, shell-agnostic, and ends by exiting, which is what the action can observe. `\n` is what
 * the pack's own command-running path sends (`handleTerminalOpened`), so it is what this sends.
 */
const COMMAND = `head -c ${CORPUS_BYTES} /dev/zero | tr '\\0' x; exit\n`;

const outputFixture = (trials: number) => ({
  identity: {
    generator: 'terminal-output-v1',
    seed: 0,
    sha256: createHash('sha256').update(`terminal-output-v1:${COMMAND}`).digest('hex'),
    distribution: { trials, corpusBytes: CORPUS_BYTES, cols: 80, rows: 24 },
  },
  data: { corpusBytes: CORPUS_BYTES, command: COMMAND },
});

/**
 * **What a terminal's output costs to draw, and how many frames it becomes.**
 *
 * Phase G's "sustained output responsiveness". A terminal's output is not an event: the broker interprets
 * it and sends the window the rows that changed, one frame at a time, the next only once the last was
 * drawn. So what a corpus costs is read where it lands — how long until the shell has exited, how many
 * frames the view painted on the way, and what the window's process spent — and the count of messages on
 * the app's event bus is recorded to show it carried none of it. The corpus is a fixed 64 KiB of one
 * character, so what a run has to deliver is known and the only variable is how it is carried.
 *
 * **Completion is the shell exiting**, which is the one end-of-output signal the surface's state holds: the
 * command ends with `exit`, the backend broadcasts `terminal.CLOSED`, and the surface drops the terminal
 * from its list. `subscribe` supplies the trigger, since none of that mutates the DOM.
 *
 * Each trial opens its own terminal, so the one it kills is its own.
 */
export async function terminalOutputScenario({ app, appPage, electronApp }: Parameters<typeof createWarmScenario>[2]) {
  const run = await createWarmScenario('terminal-output', outputFixture, { app, appPage, electronApp });
  const { fixture, schedule } = run;
  try {
    await app.waitForSurface('default-setup/code');
    await app.navigate('default-setup/code');

    for (const entry of schedule) {
      const { mode } = entry;
      await run.begin(entry);

      // Opening is not the measured action; this trial's terminal exists before the recording starts
      const terminalId = await appPage.evaluate(async () => {
        const win = window as unknown as PerformanceWindow;
        const code = () => win.applicationState.system.get('default-setup/code');
        const before = code().getSnapshot().context.panelTerminalId ?? null;
        win.applicationState.send({ type: 'SEND_TO_SURFACE', surface: 'default-setup/code', events: [{ type: 'terminal.CREATE' }] });
        for (let i = 0; i < 200; i++) {
          const now = code().getSnapshot().context.panelTerminalId ?? null;
          if (now && now !== before) return now;
          await new Promise(r => setTimeout(r, 25));
        }
        return null;
      });
      if (!terminalId) throw new Error('No terminal to run the corpus in');

      const result = await appPage.evaluate(async ({ mode, fixtureId, terminalId, command, corpusBytes }) => {
        const win = window as unknown as PerformanceWindow;
        const recording = win.__performance;
        const code = () => win.applicationState.system.get('default-setup/code');
        const alive = (id: string) => !!code().getSnapshot().children?.terminal?.getSnapshot()
          .context.terminals?.find(t => t.id === id);
        await recording.start(mode);

        const started = performance.now();
        const action = recording.begin('app.reply.stream', { 'app.scenario': 'terminal-output', 'app.fixture': fixtureId })!;
        let completed = false;
        let durationMs: number | undefined;
        let failure: string | undefined;
        const work: Record<string, number> = { corpusBytes };
        // The view says on its element which frame it last painted, so each change of that is a paint
        let painted = 0;
        const drawing = document.querySelector(`[data-apack-terminal="${terminalId}"]`);
        const paints = new MutationObserver(records => { painted += records.length; });
        if (drawing) paints.observe(drawing, { attributes: true, attributeFilter: ['data-terminal-drawn'] });
        try {
          await win.__waitForPerformanceView({
            awaitsDelivery: false,
            accept: () => false,
            subscribe: notify => {
              const subscription = code().subscribe(notify);
              return () => subscription.unsubscribe();
            },
            check: () => {
              // The shell exited, so every byte it wrote has been sent
              if (alive(terminalId)) return false;
              const ready = action.within(() => recording.begin('app.view.ready', {
                'app.generation': 'feed', 'app.delivery': 0, 'app.commit': 0, 'app.result_count': corpusBytes,
              }));
              ready?.end();
              durationMs = performance.now() - started;
              completed = true;
              return true;
            },
            dispatch: () => { action.within(() => {
              win.applicationState.send({ type: 'SEND_TO_SURFACE', surface: 'default-setup/code',
                events: [{ type: 'terminal.INPUT', terminalId, data: command }] }); }); },
            errors: [],
          });
        } catch { failure = 'missing-view-ready'; }
        finally {
          painted += paints.takeRecords().length;
          paints.disconnect();
          work.framesPainted = painted;
          action.end(completed ? 'ok' : 'error');
        }
        const reports = await recording.stop();
        return { completed, durationMs, reports, failure, work };
      }, { mode, fixtureId: fixture.identity.generator, terminalId, command: COMMAND, corpusBytes: CORPUS_BYTES });

      // What crossed the app's event bus while the corpus was drawn, which is none of the corpus
      const sends = (result.reports.backend?.observations ?? [])
        .map(encoded => JSON.parse(encoded) as { name: string; attributes: Record<string, unknown> })
        .filter(span => span.name === 'app.surface.send');
      const renderer = result.reports.renderer?.rendererStatistics?.metrics ?? [];
      const metric = (name: string) => renderer.find(m => m.name === name);
      const task = metric('TaskDuration');
      const script = metric('ScriptDuration');
      const work = {
        ...result.work,
        surfaceMessages: sends.length,
        surfaceBytes: sends.reduce((bytes, span) => bytes + Number(span.attributes['app.bytes'] ?? 0), 0),
        ...(task && { rendererTaskMicros: Math.round((task.after - task.before) * 1e6) }),
        ...(script && { rendererScriptMicros: Math.round((script.after - script.before) * 1e6) }),
      };
      await run.append(entry, result, { work });
    }
  } finally { run.close(); }
}
