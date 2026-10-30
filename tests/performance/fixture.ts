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
    threads: 2, messagesPerThread: 100, requestedPage: 50,
  } };
}
