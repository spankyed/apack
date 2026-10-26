/**
 * Stress tests for `CC: Handle Fork` — validates session state resolution
 * and cliUuid lookup across nested forks, post-compaction scenarios, and
 * edge cases.
 *
 * These tests run handle-fork.ts on the harness's services (real thread and message rows, the CLI
 * mocked), verifying:
 * - Correct sessionId + cliUuid persisted on the new thread
 * - The viewSession validation guard (post-compaction safety)
 * - Graceful degradation when viewSession throws
 */

import { vi, describe, expect, it } from 'vitest';
import { mockService } from '@apackdev/testing/harness';
import { services, type Services, type EntityId } from '#generated/services.ts';
import { repository } from '#generated/repository.ts';
import { action as handleFork } from '../../../../src/content/actions/claude-code/handle-fork.ts';

// ─── Helpers ──────────────────────────────────────────────────────────────────

interface MockThread {
  id: string;
  context?: { claudeCode?: Record<string, unknown> };
  tags?: string[];
}

interface MockMessage {
  id: string;
  sender: 'user' | 'assistant' | 'system';
  text?: string;
  context?: Record<string, unknown>;
}

/**
 * Content the threads and messages as rows in the harness's in-memory database and mocks the services
 * the action drives (the Claude Code CLI, settings, logger). `t` and `m` map the fixture keys to row ids.
 */
function createServices(opts: {
  threads: Map<string, MockThread>;
  messages: Map<string, MockMessage[]>;
  /** viewSession return value or error. Default: empty array. */
  viewSessionResult?: unknown[] | Error;
}) {
  const threadIds = new Map<string, EntityId>();
  const messageIds = new Map<string, EntityId>();
  for (const [key, thread] of opts.threads) {
    const { id } = repository.threadCommands.create({ id: `Thread-${key}`, topic: key, instructions: '', tags: thread.tags ?? [] });
    if (thread.context) repository.threadCommands.update(id, { context: thread.context });
    threadIds.set(key, id);
  }
  for (const [threadKey, list] of opts.messages) {
    for (const message of list) {
      const added = repository.chatCommands.addMessage({
        threadId: threadIds.get(threadKey)!, sender: message.sender, text: message.text ?? '', ...(message.context && { context: message.context }),
      });
      messageIds.set(message.id, added.id);
    }
  }

  const viewSessionMock = vi.fn(async () => {
    if (opts.viewSessionResult instanceof Error) throw opts.viewSessionResult;
    return opts.viewSessionResult ?? [];
  });
  mockService<Services, 'cli'>('cli', { claudeCode: { viewSession: viewSessionMock } as never });
  const warn = vi.fn();
  mockService<Services, 'logger'>('logger', { debug: vi.fn(), info: vi.fn(), warn, error: vi.fn() });

  return {
    t: (key: string) => threadIds.get(key) ?? (`Thread-${key}` as EntityId),
    m: (key: string) => messageIds.get(key) ?? (key as EntityId),
    viewSessionMock,
    warn,
  };
}

/** Shorthand: get the claudeCode state persisted on a thread. */
function getState(threadId: EntityId) {
  return (repository.threadQueries.byId(threadId)?.context as { claudeCode?: Record<string, unknown> } | undefined)?.claudeCode;
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeMessages(...specs: Array<{ id: string; sender: 'user' | 'assistant'; cliUuid?: string }>): MockMessage[] {
  return specs.map(s => ({
    id: s.id,
    sender: s.sender,
    text: `msg ${s.id}`,
    ...(s.cliUuid ? { context: { cliUuid: s.cliUuid } } : {}),
  }));
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('CC: Handle Fork — stress tests', () => {
  // ── 1. Baseline fork ────────────────────────────────────────────────────────

  it('copies sessionId, cliUuid, and cwd from source thread', async () => {
    const threads = new Map<string, MockThread>([
      ['source', { id: 'source', context: { claudeCode: { sessionId: 'S1', cwd: '/project' } }, tags: [] }],
      ['new', { id: 'new', context: {}, tags: [] }],
    ]);
    const messages = new Map([
      ['source', makeMessages(
        { id: 'M1', sender: 'user' },
        { id: 'M2', sender: 'assistant', cliUuid: 'U1' },
        { id: 'M3', sender: 'user' },
        { id: 'M4', sender: 'assistant', cliUuid: 'U2' },
        { id: 'M5', sender: 'user' },
      )],
    ]);

    // viewSession confirms U2 exists in session S1
    const { t, m } = createServices({
      threads, messages,
      viewSessionResult: [
        { type: 'assistant', uuid: 'U1' },
        { type: 'assistant', uuid: 'U2' },
      ],
    });

    const result = await handleFork(
      { sourceThreadId: t('source'), newThreadId: t('new'), sourceMessageId: m('M5') },
      services,
    );

    expect(result).toMatchObject({ success: true, copied: true, sessionId: 'S1', cliUuid: 'U2' });

    const state = getState(t('new'));
    expect(state).toMatchObject({
      sessionId: 'S1',
      cwd: '/project',
      forkFrom: { sessionId: 'S1', cliUuid: 'U2' },
    });
  });

  // ── 2. Fork at assistant message with cliUuid ───────────────────────────────

  it('uses the fork-point message cliUuid when it is an assistant message', async () => {
    const threads = new Map<string, MockThread>([
      ['source', { id: 'source', context: { claudeCode: { sessionId: 'S1', cwd: '/p' } }, tags: [] }],
      ['new', { id: 'new', context: {}, tags: [] }],
    ]);
    const messages = new Map([
      ['source', makeMessages(
        { id: 'M1', sender: 'user' },
        { id: 'M2', sender: 'assistant', cliUuid: 'U1' },
        { id: 'M3', sender: 'assistant', cliUuid: 'U2' },
      )],
    ]);

    const { t, m } = createServices({
      threads, messages,
      viewSessionResult: [{ type: 'assistant', uuid: 'U1' }, { type: 'assistant', uuid: 'U2' }],
    });

    const result = await handleFork(
      { sourceThreadId: t('source'), newThreadId: t('new'), sourceMessageId: m('M2') },
      services,
    );

    expect(result).toMatchObject({ cliUuid: 'U1' });
  });

  // ── 3. Fork at first user message — no prior assistant ──────────────────────

  it('sets cliUuid to undefined when no assistant message precedes fork point', async () => {
    const threads = new Map<string, MockThread>([
      ['source', { id: 'source', context: { claudeCode: { sessionId: 'S1' } }, tags: [] }],
      ['new', { id: 'new', context: {}, tags: [] }],
    ]);
    const messages = new Map([
      ['source', makeMessages(
        { id: 'M1', sender: 'user' },
        { id: 'M2', sender: 'user' },
      )],
    ]);

    const { t, m } = createServices({ threads, messages });

    const result = await handleFork(
      { sourceThreadId: t('source'), newThreadId: t('new'), sourceMessageId: m('M1') },
      services,
    );

    expect(result).toMatchObject({ success: true, copied: true, cliUuid: undefined });

    const state = getState(t('new'));
    // A field holding undefined is absent once stored
    expect(state?.forkFrom).toEqual({ sessionId: 'S1' });
  });

  // ── 4. Nested fork at pre-fork message ──────────────────────────────────────

  it('resolves cliUuid from copied message context on a nested fork', async () => {
    // Thread B was forked from A. B now has sessionId S2.
    // B's messages include copies from A with cliUuids from S1 era.
    // Forking B at a pre-fork message (M2') should use the cliUuid from M2'.
    // viewSession(S2) should confirm the UUID exists (S2 inherits S1 history).
    const threads = new Map<string, MockThread>([
      ['threadB', { id: 'threadB', context: { claudeCode: { sessionId: 'S2', cwd: '/p', previousSessionIds: ['S1'] } }, tags: ['claude-code'] }],
      ['threadC', { id: 'threadC', context: {}, tags: [] }],
    ]);
    const messages = new Map([
      ['threadB', makeMessages(
        { id: 'M1p', sender: 'user' },                         // copied from A
        { id: 'M2p', sender: 'assistant', cliUuid: 'U1' },     // copied from A, cliUuid from session S1
        { id: 'M3p', sender: 'user' },                         // copied from A
        { id: 'M4p', sender: 'assistant', cliUuid: 'U2' },     // copied from A (fork point of A→B)
        { id: 'M5', sender: 'user' },                           // new in B
        { id: 'M6', sender: 'assistant', cliUuid: 'U4' },       // new in B, cliUuid from S2
      )],
    ]);

    // S2 was forked from S1 at U2, so S2 contains U1 and U2
    const { t, m } = createServices({
      threads, messages,
      viewSessionResult: [
        { type: 'assistant', uuid: 'U1' },
        { type: 'assistant', uuid: 'U2' },
        { type: 'assistant', uuid: 'U4' },
      ],
    });

    const result = await handleFork(
      { sourceThreadId: t('threadB'), newThreadId: t('threadC'), sourceMessageId: m('M2p') },
      services,
    );

    expect(result).toMatchObject({ success: true, copied: true, sessionId: 'S2', cliUuid: 'U1' });

    const state = getState(t('threadC'));
    expect(state).toMatchObject({
      sessionId: 'S2',
      forkFrom: { sessionId: 'S2', cliUuid: 'U1' },
    });
  });

  // ── 5. Nested fork after compaction (guard fires) ───────────────────────────

  it('clears cliUuid when viewSession shows UUID not in compacted session', async () => {
    // Thread B was compacted: sessionId changed from S2 to S3.
    // Pre-fork messages still carry cliUuids from S1/S2 era.
    // viewSession(S3) does NOT contain those old UUIDs.
    const threads = new Map<string, MockThread>([
      ['threadB', { id: 'threadB', context: { claudeCode: { sessionId: 'S3', cwd: '/p', previousSessionIds: ['S1', 'S2'] } }, tags: ['claude-code'] }],
      ['threadC', { id: 'threadC', context: {}, tags: [] }],
    ]);
    const messages = new Map([
      ['threadB', makeMessages(
        { id: 'M1p', sender: 'user' },
        { id: 'M2p', sender: 'assistant', cliUuid: 'U1' },     // stale UUID from S1
        { id: 'M3p', sender: 'user' },
        { id: 'M4p', sender: 'assistant', cliUuid: 'U2' },     // stale UUID from S1
        { id: 'M5', sender: 'assistant', cliUuid: 'U5' },       // from S3
      )],
    ]);

    // S3 (compacted) only contains U5, not U1 or U2
    const { t, m } = createServices({
      threads, messages,
      viewSessionResult: [{ type: 'assistant', uuid: 'U5' }],
    });

    const result = await handleFork(
      { sourceThreadId: t('threadB'), newThreadId: t('threadC'), sourceMessageId: m('M2p') },
      services,
    );

    // cliUuid should be cleared — fork from session end
    expect(result).toMatchObject({ success: true, copied: true, cliUuid: undefined });

    const state = getState(t('threadC'));
    expect(state).toMatchObject({ sessionId: 'S3' });
    // A field holding undefined is absent once stored
    expect(state?.forkFrom).toEqual({ sessionId: 'S3' });
  });

  // ── 6. viewSession throws — graceful degradation ───────────────────────────

  it('clears cliUuid when viewSession throws', async () => {
    const threads = new Map<string, MockThread>([
      ['source', { id: 'source', context: { claudeCode: { sessionId: 'S1', cwd: '/p' } }, tags: [] }],
      ['new', { id: 'new', context: {}, tags: [] }],
    ]);
    const messages = new Map([
      ['source', makeMessages(
        { id: 'M1', sender: 'user' },
        { id: 'M2', sender: 'assistant', cliUuid: 'U1' },
      )],
    ]);

    const { t, m, warn } = createServices({
      threads, messages,
      viewSessionResult: new Error('JSONL not found'),
    });

    const result = await handleFork(
      { sourceThreadId: t('source'), newThreadId: t('new'), sourceMessageId: m('M2') },
      services,
    );

    expect(result).toMatchObject({ success: true, copied: true, cliUuid: undefined });
    expect(warn).toHaveBeenCalledWith(
      '[fork] could not validate cliUuid against session JSONL',
      expect.objectContaining({ cliUuid: 'U1' }),
    );
  });

  // ── 7. Triple nested fork (A→B→C→D) ────────────────────────────────────────

  it('resolves correct sessionId and cliUuid on a triple-nested fork', async () => {
    // Thread D was forked from C, which was forked from B, which was forked from A.
    // D has sessionId S4. Messages include copies from the A era with cliUuid U1.
    const threads = new Map<string, MockThread>([
      ['threadD', { id: 'threadD', context: { claudeCode: { sessionId: 'S4', cwd: '/deep', previousSessionIds: ['S1', 'S2', 'S3'] } }, tags: ['claude-code'] }],
      ['threadE', { id: 'threadE', context: {}, tags: [] }],
    ]);
    const messages = new Map([
      ['threadD', makeMessages(
        { id: 'M1ppp', sender: 'user' },
        { id: 'M2ppp', sender: 'assistant', cliUuid: 'U1' },   // from A's session S1
        { id: 'M3', sender: 'user' },
        { id: 'M4', sender: 'assistant', cliUuid: 'U8' },       // from D's session S4
      )],
    ]);

    // S4 (fork chain) still contains U1 from the original session
    const { t, m } = createServices({
      threads, messages,
      viewSessionResult: [
        { type: 'assistant', uuid: 'U1' },
        { type: 'assistant', uuid: 'U8' },
      ],
    });

    const result = await handleFork(
      { sourceThreadId: t('threadD'), newThreadId: t('threadE'), sourceMessageId: m('M2ppp') },
      services,
    );

    expect(result).toMatchObject({ success: true, copied: true, sessionId: 'S4', cliUuid: 'U1' });

    const state = getState(t('threadE'));
    expect(state).toMatchObject({
      sessionId: 'S4',
      forkFrom: { sessionId: 'S4', cliUuid: 'U1' },
    });
  });

  // ── 8. No source session state ──────────────────────────────────────────────

  it('returns copied:false when source has no session', async () => {
    const threads = new Map<string, MockThread>([
      ['source', { id: 'source', context: {}, tags: [] }],
      ['new', { id: 'new', context: {}, tags: [] }],
    ]);

    const { t, m } = createServices({
      threads,
      messages: new Map(),
    });

    const result = await handleFork(
      { sourceThreadId: t('source'), newThreadId: t('new'), sourceMessageId: m('M1') },
      services,
    );

    expect(result).toMatchObject({ success: true, copied: false });
  });

  // ── 9. Missing sourceMessageId ──────────────────────────────────────────────

  it('sets cliUuid to undefined when sourceMessageId is omitted', async () => {
    const threads = new Map<string, MockThread>([
      ['source', { id: 'source', context: { claudeCode: { sessionId: 'S1' } }, tags: [] }],
      ['new', { id: 'new', context: {}, tags: [] }],
    ]);

    const { t } = createServices({
      threads,
      messages: new Map(),
    });

    const result = await handleFork(
      { sourceThreadId: t('source'), newThreadId: t('new') },
      services,
    );

    expect(result).toMatchObject({ success: true, copied: true, cliUuid: undefined });

    const state = getState(t('new'));
    // A field holding undefined is absent once stored
    expect(state?.forkFrom).toEqual({ sessionId: 'S1' });
  });

});
