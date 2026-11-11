import { createHash } from 'node:crypto';
import { createWarmScenario } from './scenario.ts';
import type { PerformanceWindow } from './window.ts';

/** Characters typed a trial, each waited for before the next */
const KEYSTROKES = 40;
/**
 * `cat` puts the terminal's own echo between the key and the screen: the kernel answers each character, so
 * nothing a shell's line editor does is in the reading.
 */
const COMMAND = 'cat\n';

const echoFixture = (trials: number) => ({
  identity: {
    generator: 'terminal-echo-v1',
    seed: 0,
    sha256: createHash('sha256').update(`terminal-echo-v1:${COMMAND}:${KEYSTROKES}`).digest('hex'),
    distribution: { trials, keystrokes: KEYSTROKES, cols: 80, rows: 24 },
  },
  data: { keystrokes: KEYSTROKES, command: COMMAND },
});

/**
 * **How long a typed character takes to be on screen.**
 *
 * From the input event's dispatch to the frame that painted its echo, read from the count of painted output
 * a drawn terminal publishes (`data-terminal-drawn`): the whole round trip, window to pty and back,
 * and the paint. The terminal is quiet between keys, so each reading is one character's and none is
 * waiting behind another's output. A trial's duration is the sum; the distribution is in `work`, in
 * microseconds.
 *
 * Start is surface-event dispatch, not a physical key: what the keyboard and the emulator's key handling
 * add is not in it.
 */
export async function terminalEchoScenario({ app, appPage, electronApp }: Parameters<typeof createWarmScenario>[2]) {
  const run = await createWarmScenario('terminal-echo', echoFixture, { app, appPage, electronApp });
  const { fixture, schedule } = run;
  try {
    await app.waitForSurface('default-setup/code');
    await app.navigate('default-setup/code');

    for (const entry of schedule) {
      const { mode } = entry;
      await run.begin(entry);

      // A terminal running `cat` and gone quiet, outside the measured interval
      const terminalId = await appPage.evaluate(async ({ command }) => {
        const win = window as unknown as PerformanceWindow;
        const code = () => win.applicationState.system.get('default-setup/code');
        const before = code().getSnapshot().context.panelTerminalId ?? null;
        win.applicationState.send({ type: 'SEND_TO_SURFACE', surface: 'default-setup/code', events: [{ type: 'terminal.CREATE' }] });
        let terminalId: string | null = null;
        for (let i = 0; i < 200 && !terminalId; i++) {
          const now = code().getSnapshot().context.panelTerminalId ?? null;
          if (now && now !== before) terminalId = now;
          else await new Promise(r => setTimeout(r, 25));
        }
        if (!terminalId) return null;
        const drawn = () => document.querySelector<HTMLElement>(`[data-apack-terminal="${terminalId}"]`)?.dataset.terminalDrawn;
        const quiet = async () => {
          for (let still = 0, last = drawn(); still < 12;) {
            await new Promise(r => setTimeout(r, 25));
            const now = drawn();
            if (now !== undefined && now === last) still++; else { still = 0; last = now; }
          }
        };
        await quiet();
        win.applicationState.send({ type: 'SEND_TO_SURFACE', surface: 'default-setup/code',
          events: [{ type: 'terminal.INPUT', terminalId, data: command }] });
        await quiet();
        return terminalId;
      }, { command: COMMAND });
      if (!terminalId) throw new Error('No terminal to type into');

      const result = await appPage.evaluate(async ({ mode, fixtureId, terminalId, keystrokes }) => {
        const win = window as unknown as PerformanceWindow;
        const recording = win.__performance;
        const element = document.querySelector<HTMLElement>(`[data-apack-terminal="${terminalId}"]`);
        await recording.start(mode);

        const started = performance.now();
        const action = recording.begin('app.reply.stream', { 'app.scenario': 'terminal-echo', 'app.fixture': fixtureId })!;
        let completed = false;
        let durationMs: number | undefined;
        let failure: string | undefined;
        const echoes: number[] = [];
        try {
          if (!element) throw new Error('The terminal is not drawn');
          for (let key = 0; key < keystrokes; key++) {
            const painted = new Promise<void>((resolve, reject) => {
              const stalled = setTimeout(() => { observer.disconnect(); reject(new Error('no echo')); }, 5000);
              const observer = new MutationObserver(() => { clearTimeout(stalled); observer.disconnect(); resolve(); });
              observer.observe(element, { attributes: true, attributeFilter: ['data-terminal-drawn'] });
            });
            const typed = performance.now();
            action.within(() => {
              win.applicationState.send({ type: 'SEND_TO_SURFACE', surface: 'default-setup/code',
                events: [{ type: 'terminal.INPUT', terminalId, data: String.fromCharCode(97 + (key % 26)) }] });
            });
            await painted;
            echoes.push(performance.now() - typed);
          }
          const ready = action.within(() => recording.begin('app.view.ready', {
            'app.generation': 'feed', 'app.delivery': 0, 'app.commit': 0, 'app.result_count': keystrokes,
          }));
          ready?.end();
          durationMs = performance.now() - started;
          completed = true;
        } catch { failure = 'missing-view-ready'; }
        finally { action.end(completed ? 'ok' : 'error'); }
        const reports = await recording.stop();
        return { completed, durationMs, reports, failure, work: { keystrokes: echoes.length }, echoes };
      }, { mode, fixtureId: fixture.identity.generator, terminalId, keystrokes: KEYSTROKES });

      const sorted = [...result.echoes].sort((a, b) => a - b);
      const at = (fraction: number) => Math.round((sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0) * 1000);
      const work = {
        keystrokes: result.echoes.length,
        echoMedianMicros: at(0.5),
        echoP90Micros: at(0.9),
        echoMaxMicros: at(1),
      };
      await run.append(entry, result, { work });

      // The trial's terminal is closed outside the measured interval, so the next is not an Nth terminal
      await appPage.evaluate(({ terminalId }) => {
        (window as unknown as PerformanceWindow).applicationState.send({ type: 'SEND_TO_SURFACE', surface: 'default-setup/code',
          events: [{ type: 'terminal.CLOSE', terminalId }] });
      }, { terminalId });
    }
  } finally { run.close(); }
}
