import { chmodSync, copyFileSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@apackdev/testing';
import { performanceSchedule, streamingBacklog } from '@apackdev/testing/performance';
import { streamingFixture } from './fixture.ts';
import { createWarmScenario } from './scenario.ts';
import type { PerformanceWindow } from './window.ts';

const source = fileURLToPath(new URL('./fixtures/claude-stream.mjs', import.meta.url));
const schedule = performanceSchedule(process.env.APACK_PERFORMANCE_MODE ?? 'lightweight',
  Number(process.env.APACK_PERFORMANCE_TRIALS ?? 20), process.env.APACK_PERFORMANCE_COMPARE_MODE);
function createStreamingRun(target: Parameters<typeof createWarmScenario>[2]) {
  return createWarmScenario('streaming', count => {
    const fixture = streamingFixture(count);
    fixture.identity.sha256 = createHash('sha256').update(fixture.identity.sha256).update(readFileSync(source)).digest('hex');
    return fixture;
  }, target);
}

// One warm process and one journal; each scheduled action owns the existing per-test deadline.
test.describe('stream a deterministic reply through the real CLI flow and persist the visible result', () => {
  test.describe.configure({ mode: 'serial' });
  let run: Awaited<ReturnType<typeof createStreamingRun>> | undefined;
  test.afterAll(() => run?.close());
  for (const entry of schedule) {
    test(`${entry.mode} ${entry.warmup ? 'warmup' : 'trial'} ${entry.index}`, async ({ app, appPage, electronApp }) => {
      if (!run) {
        run = await createStreamingRun({ app, appPage, electronApp });
        const { fixture, directory } = run;
        const executable = path.join(directory, 'claude-fixture.mjs');
        copyFileSync(source, executable);
        chmodSync(executable, 0o700);
        writeFileSync(path.join(directory, 'stream.json'), JSON.stringify(fixture.script));
        await app.waitForSurface('default-setup/threads');
        await app.navigate('default-setup/threads');
        await app.waitForSurface('default-setup/code');
        await app.navigate('host/settings');
        await appPage.evaluate(() => {
          const actor = (window as unknown as PerformanceWindow).applicationState.system.get('host/settings');
          actor.send({ type: 'TAB.SELECT', tab: 'general' });
          actor.send({ type: 'GENERAL_NAV.SELECT', item: 'secrets' });
        });
        const inputs = appPage.getByPlaceholder('Path override (auto-detected if empty)');
        const cli = appPage.locator('div').filter({ has: appPage.getByText('Claude Code CLI', { exact: true }) })
          .filter({ has: inputs }).last().getByPlaceholder('Path override (auto-detected if empty)');
        await cli.fill(executable);
        await expect.poll(() => appPage.evaluate(() => {
          const context = (window as unknown as PerformanceWindow).applicationState.system.get('default-setup/code').getSnapshot().context as unknown as { settings: { cliPaths?: Record<string, string> } };
          return context.settings.cliPaths?.['claude-code'];
        })).toBe(executable);
        await appPage.evaluate(directory => (window as unknown as PerformanceWindow).__sendToSystem('default-setup/code', { type: 'SET_BASE_DIRECTORY', path: directory }), directory);
        await expect.poll(() => appPage.evaluate(() => {
          const context = (window as unknown as PerformanceWindow).applicationState.system.get('default-setup/code').getSnapshot().context as unknown as { baseDirectory?: string };
          return context.baseDirectory;
        })).toBe(directory);
        await run.importThreads(`Thread-stream-${run.schedule.length - 1}`);
      }
      const { fixture, directory } = run;
      const { mode } = entry;
      await run.begin(entry);
      const thread = entry.ordinal;
      await appPage.evaluate(thread => (window as unknown as PerformanceWindow).applicationState.send({ type: 'SEND_TO_SURFACE', surface: 'default-setup/threads', events: [{ type: 'OPEN_THREAD_CHAT', threadId: `Thread-stream-${thread}` }, { type: 'SET_MODE', mode: 'Claude Code' }] }), thread);
      await appPage.waitForFunction(thread => {
        const context = (window as unknown as PerformanceWindow).applicationState.system.get('default-setup/threads').getSnapshot().context;
        return context.currentThread?.id === `Thread-stream-${thread}` && context.chatMessageIds.length === 20
          && context.chatMessageIds.every(id => document.querySelector(`[data-message-id="${id}"]`));
      }, thread);
      const production = new RegExp(`^production-${thread}-[0-9]+\\.jsonl$`);
      const productionBefore = new Set(readdirSync(directory).filter(file => production.test(file)));
      const result = await appPage.evaluate(async ({ mode, thread, expected, scriptedChunks }) => {
        const win = window as unknown as PerformanceWindow;
        const recording = win.__performance;
        const context = () => win.applicationState.system.get('default-setup/threads').getSnapshot().context;
        const before = new Set(context().chatMessageIds);
        await recording.start(mode);
        const started = performance.now();
        const action = recording.begin('app.reply.stream', { 'app.scenario': 'streaming', 'app.fixture': 'streaming-conversations-v1' })!;
        let durationMs: number | undefined;
        let firstVisibleMs: number | undefined;
        let lastVisibleMs = 0;
        let lastLength = 0;
        let maxVisibleGapMs = 0;
        let completed = false;
        let failure: string | undefined;
        const work: Record<string, number> = { scriptedChunks, visibleUpdates: 0 };
        const viewProgress: Array<{ epochMs: number; chars: number }> = [];
        let persisted: { id: string; text: string; responseTimestamp?: number; commit: number; subscription?: string; delivery?: number } | undefined;
        try {
          await win.__waitForPerformanceView({
            check: () => {
              if (!persisted) return false;
              const state = context();
              if (state.currentThread?.id !== `Thread-stream-${thread}` || !state.chatMessageIds.includes(persisted.id)) return false;
              const message = state.messageContents[persisted.id];
              if (!message || message.text !== persisted.text || !expected.startsWith(message.text)) return false;
              const element = document.querySelector(`[data-message-id="${persisted.id}"]`);
              if (!element || !element.getClientRects().length || !element.textContent?.includes(message.text.trimEnd())) return false;
              const now = performance.now() - started;
              if (message.text.length > lastLength) {
                if (firstVisibleMs === undefined) firstVisibleMs = now;
                else maxVisibleGapMs = Math.max(maxVisibleGapMs, now - lastVisibleMs);
                lastLength = message.text.length;
                lastVisibleMs = now;
                work.visibleUpdates!++;
              }
              if (message.text !== expected || persisted.responseTimestamp === undefined || message.responseTimestamp !== persisted.responseTimestamp) return false;
              if (work.visibleUpdates! < 2 || firstVisibleMs === undefined || firstVisibleMs >= now) throw Error('missing-intermediate-progress');
              if (state.chatMessageIds.length !== before.size + 2) throw Error('message-bound');
              const ready = action.within(() => recording.begin('app.view.ready', {
                'app.generation': persisted!.subscription ?? 'disabled', 'app.delivery': persisted!.delivery ?? 0,
                'app.commit': persisted!.commit, 'app.result_count': state.chatMessageIds.length,
              }));
              ready?.end();
              durationMs = performance.now() - started;
              completed = true;
              return true;
            },
            accept: ({ request, update }) => {
              const args = request.args as { id?: string } | undefined;
              if (request.ref !== 'default-setup/threads' || request.view !== 'message' || !args?.id || before.has(args.id) || !update.ok) return false;
              if (context().currentThread?.id !== `Thread-stream-${thread}` || !context().chatMessageIds.includes(args.id)) return false;
              const value = update.value as { sender?: string; text?: string; responseTimestamp?: number } | null;
              if (value?.sender !== 'assistant' || !value.text || !expected.startsWith(value.text)) return false;
              if (value.text.length > (viewProgress.at(-1)?.chars ?? 0)) {
                if (viewProgress.length < 64) viewProgress.push({ epochMs: Date.now(), chars: value.text.length });
                else work.droppedProgress = (work.droppedProgress ?? 0) + 1;
              }
              persisted = { id: args.id, text: value.text, responseTimestamp: value.responseTimestamp, commit: update.commit,
                subscription: update.diagnostics?.subscription, delivery: update.diagnostics?.delivery };
              return true;
            },
            dispatch: () => { action.within(() => win.applicationState.send({ type: 'SEND_TO_SURFACE', surface: 'default-setup/threads', events: [{ type: 'SEND_MESSAGE', text: `Performance trial ${thread}` }] })); },
            errors: ['missing-intermediate-progress', 'message-bound'],
          });
        } catch (error) { failure = error instanceof Error && ['missing-intermediate-progress', 'message-bound'].includes(error.message) ? error.message : 'missing-view-ready'; }
        finally { action.end(completed ? 'ok' : 'error'); }
        const reports = await recording.stop();
        return { completed, durationMs, reports, failure, work, viewProgress, timings: firstVisibleMs === undefined ? undefined : { firstVisibleMs, maxVisibleGapMs } };
      }, { mode, thread, expected: fixture.script.chunks.join(''), scriptedChunks: fixture.script.chunks.length });
      let backlog: ReturnType<typeof streamingBacklog> | undefined;
      let backlogFailure: string | undefined;
      let backlogPhase = 'production-file';
      result.work.receivedProgress = result.viewProgress.length;
      result.work.receivedFinalChars = result.viewProgress.at(-1)?.chars ?? 0;
      if (result.completed) try {
        const files = readdirSync(directory).filter(file => production.test(file) && !productionBefore.has(file));
        result.work.productionFiles = files.length;
        if (files.length > 64 || result.work.droppedProgress) throw Error('Progress capture exceeded its bound');
        const completed = files.flatMap(file => {
          const absolute = path.join(directory, file);
          if (statSync(absolute).size > 16 * 1024) throw Error('Production file exceeded its bound');
          const text = readFileSync(absolute, 'utf8');
          if (!text.endsWith('\n')) return [];
          const points = text.trim().split('\n').map(line => JSON.parse(line));
          return points.length === fixture.script.chunks.length ? [points] : [];
        });
        backlogPhase = 'production-count';
        result.work.completedProductions = completed.length;
        if (completed.length !== 1) throw Error('Missing or ambiguous completed production');
        const produced = completed[0]!;
        result.work.producedProgress = produced.length;
        result.work.producedFinalChars = produced.at(-1)?.chars ?? 0;
        backlogPhase = 'progress-data';
        backlog = streamingBacklog(produced, result.viewProgress, fixture.script.chunks.join('').length);
      } catch { backlogFailure = `backlog-${backlogPhase}`; }
      await run.append(entry, result, { backlog, failure: backlogFailure });
    });
  }
});
