import { createHash } from 'node:crypto';

/** Public import format, fixed timestamps and synthetic content; never a developer database. */
export function threadFixture() {
  const threads = Array.from({ length: 2 }, (_, thread) => ({
    id: `Thread-performance-${thread}`,
    topic: `Performance fixture ${thread}`,
    instructions: '', status: 'Backlog', tags: [], shortCode: '',
    timestamp: 1_700_000_000_000 + thread * 1_000_000,
    linkedThreads: [], artifacts: [],
    messages: Array.from({ length: 100 }, (_, message) => ({
      sender: message % 2 === 0 ? 'user' : 'assistant',
      timestamp: 1_700_000_000_000 + thread * 1_000_000 + message * 1_000,
      text: `Fixture thread ${thread} message ${message}. ${'Synthetic representative message body. '.repeat(50)}`,
    })),
  }));
  const data = { version: 2, threads };
  return { data, identity: {
    generator: 'populated-threads-v1', seed: 0,
    sha256: createHash('sha256').update(JSON.stringify(data)).digest('hex'),
    distribution: { threads: 2, messagesPerThread: 100, requestedPage: 50, bodyRepetitions: 50 },
  } };
}

/** Exactly twenty matches per query among 1,200 large messages; ranking cannot hide missing rows. */
export function searchFixture() {
  const template = threadFixture().data.threads[0]!;
  const threads = Array.from({ length: 12 }, (_, thread) => ({
    ...template,
    id: `Thread-search-${thread}`,
    topic: `Search fixture ${thread}`,
    timestamp: 1_700_000_000_000 + thread * 1_000_000,
    messages: template.messages.map((message, index) => ({
      ...message,
      timestamp: 1_700_000_000_000 + thread * 1_000_000 + index * 1_000,
      text: `Search fixture thread ${thread} message ${index}. ${thread < 2 && index < 20 ? ['quartzalpha', 'quartzbeta'][thread] : 'unrelatedcorpus'} ${'Synthetic representative message body. '.repeat(50)}`,
    })),
  }));
  const data = { version: 2, threads };
  return { data, identity: {
    generator: 'message-search-v1', seed: 0,
    sha256: createHash('sha256').update(JSON.stringify(data)).digest('hex'),
    distribution: { threads: 12, messagesPerThread: 100, matchingQueries: 2, matchesPerQuery: 20, resultLimit: 20, bodyRepetitions: 50 },
  } };
}

/** A fresh conversation per trial keeps input size constant as replies are persisted. */
export function streamingFixture(trials: number) {
  const template = threadFixture().data.threads[0]!;
  const script = { intervalMs: 25, chunks: Array.from({ length: 24 }, (_, index) => `Stream segment ${String(index).padStart(2, '0')} is deterministic. `) };
  const data = { version: 2, threads: Array.from({ length: trials }, (_, index) => ({
    ...template, id: `Thread-stream-${index}`, topic: `Streaming fixture ${index}`, messages: template.messages.slice(0, 20),
  })) };
  return { data, script, identity: {
    generator: 'streaming-conversations-v1', seed: 0,
    sha256: createHash('sha256').update(JSON.stringify({ data, script })).digest('hex'),
    distribution: { threads: trials, historyMessagesPerThread: 20, scriptedChunks: script.chunks.length, intervalMs: script.intervalMs, bodyRepetitions: 50 },
  } };
}
