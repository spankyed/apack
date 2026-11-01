import { threadFixture, richThreadFixture } from './fixture.ts';
import { createWarmScenario } from './scenario.ts';
import type { PerformanceWindow } from './window.ts';

/** Own profile per worker/run; interactive trials deliberately share a warmed process and filesystem cache. */
export async function threadOpenScenario({ app, appPage, electronApp }: Parameters<typeof createWarmScenario>[2], fault?: 'full-read' | 'missing-completion') {
  const corpus = process.env.APACK_PERFORMANCE_CORPUS ?? 'plain';
  if (!['plain', 'rich'].includes(corpus)) throw Error('Invalid thread corpus');
  const run = await createWarmScenario('thread-open', corpus === 'rich' ? richThreadFixture : threadFixture, { app, appPage, electronApp });
  const { fixture, schedule } = run;
  try {
    await run.importThreads('Thread-performance-1');
    if (fault === 'full-read') {
      await app.waitForSurface('default-setup/database');
      await app.navigate('default-setup/database');
      await app.navigate('default-setup/threads');
    }
    // Every action switches threads, including the first action in a reused window.
    const firstThread = await appPage.evaluate(() =>
      (window as unknown as PerformanceWindow).applicationState.system.get('default-setup/threads').getSnapshot().context.currentThread?.id === 'Thread-performance-0' ? 1 : 0);
    for (const entry of schedule) {
      const { mode } = entry;
      await run.begin(entry);
      const thread = (entry.ordinal + firstThread) % 2;
      const result = await appPage.evaluate(async ({ mode, thread, expectedBodies, rich, fixtureId, fault }) => {
        const win = window as unknown as PerformanceWindow;
        const recording = win.__performance;
        await recording.start(mode);
        const started = performance.now();
        const action = recording.begin('app.thread.open', { 'app.scenario': 'thread-open', 'app.fixture': fixtureId })!;
        const target = `Thread-performance-${thread}`;
        let completed = false;
        let durationMs: number | undefined;
        let lastDelivery: { subscription: string; delivery: number; commit: number } | undefined;
        let failure: string | undefined;
        const work: Record<string, number> = {};
        try {
          await win.__waitForPerformanceView({
            check: () => {
              const context = win.applicationState.system.get('default-setup/threads').getSnapshot().context;
              if (context.currentThread?.id !== target) return false;
              work.requestedMessages = context.chatLimit;
              work.observedMessages = context.chatMessageIds.length;
              if (context.chatMessageIds.length > 50 || context.chatLimit !== 50) throw Error('page-bound');
              const elements = new Map(Array.from(document.querySelectorAll('[data-message-id]'))
                .map(element => [element.getAttribute('data-message-id'), element]));
              const shown = context.chatMessageIds.map(id => elements.get(id));
              const pattern = new RegExp(`Fixture thread ${thread} message ([0-9]+)[.]`);
              const indices = shown.map(element => Number(element?.textContent?.match(pattern)?.[1]));
              const readyPage = shown.length === 50 && new Set(context.chatMessageIds).size === 50
                && shown.every(element => element && element.getClientRects().length > 0)
                && new Set(indices).size === 50 && indices.every(value => value >= 50 && value < 100)
                && shown.every((element, at) => element!.textContent?.includes(expectedBodies[indices[at]! - 50]!));
              if (rich && shown.some((element, at) => !element?.textContent?.includes(`Rich end ${thread}/${indices[at]}.`)
                || ['h2', 'strong', 'em', 'blockquote', 'ul', 'ol', 'table', 'pre code'].some(selector => !element?.querySelector(selector)))) return false;
              work.expectedTruncatedMessages = 25;
              work.truncatedMessages = shown.filter((element, at) => indices[at]! % 2 === 0
                && element?.textContent?.includes('Click to view')).length;
              // These fixture users all overflow: the first usable page includes their collapse controls.
              if (!readyPage || work.truncatedMessages !== work.expectedTruncatedMessages || fault === 'missing-completion') return false;
              const ready = action.within(() => recording.begin('app.view.ready', {
                'app.generation': lastDelivery?.subscription ?? 'disabled', 'app.delivery': lastDelivery?.delivery ?? 0,
                'app.commit': lastDelivery?.commit ?? 0, 'app.result_count': context.chatMessageIds.length,
              }));
              ready?.end();
              durationMs = performance.now() - started;
              completed = true;
              return true;
            },
            accept: ({ request, update }) => {
              const args = request.args as { threadId?: string } | undefined;
              if (request.ref !== 'default-setup/threads' || request.view !== 'chat' || args?.threadId !== target || !update.ok) return false;
              const metadata = update.diagnostics;
              if (mode !== 'disabled' && (!metadata || metadata.carrier.traceparent?.split('-')[1] !== action.carrier().traceparent?.split('-')[1])) return false;
              lastDelivery = metadata ? { subscription: metadata.subscription, delivery: metadata.delivery, commit: update.commit } : undefined;
              return true;
            },
            dispatch: () => { action.within(() => {
              if (fault === 'full-read') win.applicationState.send({ type: 'SEND_TO_SURFACE', surface: 'default-setup/database', events: [{ type: 'QUERY.EXECUTE', code: 'return query(EARS.Entity.Message).pickAll()' }] });
              win.applicationState.send({ type: 'SEND_TO_SURFACE', surface: 'default-setup/threads', events: [{ type: 'OPEN_THREAD_CHAT', threadId: target }] }); }); },
            errors: ['page-bound'],
          });
        } catch (error) { failure = error instanceof Error && ['view-correctness', 'page-bound'].includes(error.message) ? error.message : 'missing-view-ready'; }
        finally { action.end(completed ? 'ok' : 'error'); }
        const reports = await recording.stop();
        return { completed, durationMs, reports, failure, lastDelivery, work };
      }, { mode, thread, fault, fixtureId: fixture.identity.generator, rich: corpus === 'rich', expectedBodies: threadFixture().data.threads[thread]!.messages.slice(50).map(message => message.text.trimEnd()) });
      // A page may return its bodies, scalar metadata/framing (50% headroom), and 16 KiB of headers.
      // This is a declared work budget; a full-history read must not pass just because the UI shows fifty rows.
      const maxAppResponseBytes = Math.ceil(fixture.data.threads[thread]!.messages.slice(50)
        .reduce((bytes, message) => bytes + Buffer.byteLength(message.text), 0) * 1.5) + 16 * 1024;
      const appResponseBytes = mode === 'disabled' ? undefined : result.reports.backend?.observations
        .map(encoded => JSON.parse(encoded) as { name: string; attributes: Record<string, unknown> })
        .filter(span => span.name === 'ears.read' && span.attributes['ears.database'] === 'app')
        .reduce((bytes, span) => bytes + Number(span.attributes['ears.response_bytes'] ?? 0), 0);
      const excessReadWork = appResponseBytes !== undefined && appResponseBytes > maxAppResponseBytes;
      const work = { ...result.work, maxAppResponseBytes, ...(appResponseBytes !== undefined && { windowAppResponseBytes: appResponseBytes }) };
      await run.append(entry, result, { work, failure: excessReadWork ? 'app-read-work-bound' : undefined,
        expectedFailure: fault === 'full-read' ? 'app-read-work-bound' : fault === 'missing-completion' ? 'missing-view-ready' : undefined });
      if (fault) break;
    }
  } finally { run.close(); }
}
