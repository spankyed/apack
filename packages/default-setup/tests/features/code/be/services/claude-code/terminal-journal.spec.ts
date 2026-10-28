import { mkdtemp, writeFile, appendFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createClaudeNativeJournalReader, type ClaudeNativeJournalEntry, type ClaudeNativeJournalBatch } from '#features/code/be/services/claude-code/terminal-journal.ts'
const session = '11111111-1111-1111-1111-111111111111'
let directory: string
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'native-journal-')) })
afterEach(async () => { await rm(directory, { recursive: true, force: true }) })
it('waits for complete UTF-8 rows and reads only newly appended native session records', async () => {
  const path = join(directory, session + '.jsonl'), read = createClaudeNativeJournalReader(), scope = [{ sessionId: session, path }]
  const bytes = Buffer.from(JSON.stringify({ sessionId: session, type: 'user', text: '中🙂' }) + '\n')
  const at = bytes.indexOf(Buffer.from('🙂')) + 2
  await writeFile(path, bytes.subarray(0, at)); expect((await read(scope)).entries).toEqual([])
  await appendFile(path, bytes.subarray(at)); expect((await read(scope)).entries).toEqual([{ sessionId: session, row: { sessionId: session, type: 'user', text: '中🙂' } }])
  expect((await read(scope)).entries).toEqual([])
  await appendFile(path, JSON.stringify({ sessionId: 'foreign', text: 'ignored' }) + '\n')
  expect((await read(scope)).entries).toEqual([])
})
it('handles native truncation and refuses paths not matching the native session identity', async () => {
  const path = join(directory, session + '.jsonl'), read = createClaudeNativeJournalReader(), scope = [{ sessionId: session, path }]
  await writeFile(path, JSON.stringify({ sessionId: session, text: 'long original row' }) + '\n'); await read(scope)
  await writeFile(path, JSON.stringify({ sessionId: session, text: 'new' }) + '\n')
  expect((await read(scope)).entries[0]?.row.text).toBe('new')
  await expect(read([{ sessionId: session, path: join(directory, 'other.jsonl') }])).rejects.toThrow('identity')
})
it('drains transcripts larger than one batch without losing a row spanning batch boundaries', async () => {
  const path = join(directory, session + '.jsonl'), read = createClaudeNativeJournalReader(), scope = [{ sessionId: session, path }]
  const row = (text: string) => JSON.stringify({ sessionId: session, text }) + '\n'
  await writeFile(path, row('before') + row('🙂'.repeat(600000)) + row('after'))
  const first = await read(scope, { final: true })
  expect(first.pending).toBe(true); expect(first.problems).toEqual([])
  expect(first.entries.map(entry => entry.row.text)).toEqual(['before'])
  const last = await read(scope, { final: true })
  expect(last.pending).toBe(false); expect(last.problems).toEqual([])
  expect(last.entries.map(entry => entry.row.text)).toEqual(['🙂'.repeat(600000), 'after'])
  expect((await read(scope, { final: true })).entries).toEqual([])
})
it('keeps valid neighboring rows and sticky damage warnings after malformed JSON and non-object rows', async () => {
  const path = join(directory, session + '.jsonl'), read = createClaudeNativeJournalReader(), scope = [{ sessionId: session, path }]
  const row = (text: string) => JSON.stringify({ sessionId: session, text }) + '\n'
  await writeFile(path, row('before') + '{broken\n[]\n' + row('after'))
  const batch = await read(scope)
  expect(batch.entries.map(entry => entry.row.text)).toEqual(['before', 'after'])
  expect(batch.problems).toEqual(['Native transcript contains invalid JSON', 'Native transcript row is not an object'])
  expect((await read(scope)).problems).toEqual(batch.problems)
  await appendFile(path, row('later'))
  expect((await read(scope)).entries.map(entry => entry.row.text)).toEqual(['later'])
  await writeFile(path, row('replaced'))
  expect((await read(scope)).problems).toEqual([])
})
it('bounds oversized row memory, skips through its newline, and preserves subsequent records', async () => {
  const path = join(directory, session + '.jsonl'), read = createClaudeNativeJournalReader(), scope = [{ sessionId: session, path }]
  await writeFile(path, 'x'.repeat(32 * 1024 * 1024 + 1) + '\n' + JSON.stringify({ sessionId: session, text: 'after oversized row' }) + '\n')
  const entries: ClaudeNativeJournalEntry[] = []; let batch: ClaudeNativeJournalBatch
  do { batch = await read(scope, { final: true }); entries.push(...batch.entries) } while (batch.pending)
  expect(entries.map(entry => entry.row.text)).toEqual(['after oversized row'])
  expect(batch.problems).toEqual(['Native transcript row exceeds the mirror limit'])
  expect((await read(scope)).entries).toEqual([])
})
it('reports a truncated trailing row only after process exit', async () => {
  const path = join(directory, session + '.jsonl'), read = createClaudeNativeJournalReader(), scope = [{ sessionId: session, path }]
  await writeFile(path, '{"sessionId":')
  expect((await read(scope)).problems).toEqual([])
  expect((await read(scope, { final: true })).problems).toEqual(['Native transcript ended with an incomplete row'])
})
it('restarts when a transcript is rewritten and regrows beyond its prior cursor', async () => {
  const path = join(directory, session + '.jsonl'), read = createClaudeNativeJournalReader(), scope = [{ sessionId: session, path }]
  const row = (text: string) => JSON.stringify({ sessionId: session, text }) + '\n'
  const before = row('old first') + row('old second')
  await writeFile(path, before); await read(scope)
  await writeFile(path, row('replacement with a different row boundary') + row('new continuation '.repeat(40)))
  const batch = await read(scope)
  expect(batch.problems).toEqual([])
  expect(batch.entries.map(entry => entry.row.text)).toEqual(['replacement with a different row boundary', 'new continuation '.repeat(40)])
  expect((await read(scope)).entries).toEqual([])
})
it('drops partial UTF-8 bytes from a replaced native transcript before reading its continuation', async () => {
  const path = join(directory, session + '.jsonl'), read = createClaudeNativeJournalReader(), scope = [{ sessionId: session, path }]
  const original = Buffer.from(JSON.stringify({ sessionId: session, text: 'original 🙂' }) + '\n')
  await writeFile(path, original.subarray(0, original.indexOf(Buffer.from('🙂')) + 2)); await read(scope)
  const text = 'replacement 中🙂 '.repeat(30)
  await writeFile(path, JSON.stringify({ sessionId: session, text }) + '\n')
  const batch = await read(scope)
  expect(batch.problems).toEqual([]); expect(batch.entries.map(entry => entry.row.text)).toEqual([text])
})
