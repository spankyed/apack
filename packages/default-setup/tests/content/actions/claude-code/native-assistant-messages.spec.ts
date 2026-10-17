import { createClaudeNativeMessageTracker } from '../../../../src/content/actions/claude-code/_helpers/native-assistant-messages.ts';

it('retains separate native UUIDs and exact text ranges within streamed reply text', () => {
  const tracker = createClaudeNativeMessageTracker();
  const first = tracker.accept('Same text', { uuid: 'native-a', sessionId: 'session', text: 'Same text' });
  const second = tracker.accept('Same text\nSame text', { uuid: 'native-b', sessionId: 'session', text: 'Same text' });
  expect(first.rows).toHaveLength(1);
  expect(second.rows).toEqual([
    { uuid: 'native-a', sessionId: 'session', text: 'Same text', start: 0, end: 9 },
    { uuid: 'native-b', sessionId: 'session', text: 'Same text', start: 10, end: 19 },
  ]);
  for (const row of second.rows) expect(second.text.slice(row.start, row.end)).toBe(row.text);
});
it('preserves completed-only rows after earlier prose and handles a streamed separator', () => {
  const tracker = createClaudeNativeMessageTracker();
  const first = tracker.accept('', { uuid: 'a', sessionId: 'session', text: 'First' });
  const second = tracker.accept(first.text, { uuid: 'b', sessionId: 'session', text: 'Second' });
  const third = tracker.accept(second.text + '\n', { uuid: 'c', sessionId: 'session', text: 'Third' });
  expect(third.text).toBe('First\nSecond\nThird');
  expect(third.rows.map(row => row.uuid)).toEqual(['a', 'b', 'c']);
  expect(tracker.accept(third.text, { uuid: 'c', sessionId: 'session', text: 'Third' })).toEqual(third);
});
it('leaves unmatched streamed content untouched and never assigns an earlier matching suffix', () => {
  const tracker = createClaudeNativeMessageTracker();
  expect(tracker.accept('Visible original', { uuid: 'a', sessionId: 'session', text: 'Different' })).toEqual({ text: 'Visible original', rows: [] });
  expect(tracker.accept('Visible original\nNew tail', { uuid: 'b', sessionId: 'session', text: 'original' }).rows).toEqual([]);
});
it('does not project nested activity and does not invent missing native identities', () => {
  const tracker = createClaudeNativeMessageTracker();
  expect(tracker.accept('', { uuid: 'nested', sessionId: 'session', text: 'Child', parentToolUseId: 'agent-tool' })).toEqual({ text: '', rows: [] });
  expect(tracker.accept('', { text: 'No identity' })).toEqual({ text: 'No identity', rows: [] });
  expect(createClaudeNativeMessageTracker().accept('', { uuid: 'a', sessionId: 'session', text: 'Next' }).rows[0]?.start).toBe(0);
});
