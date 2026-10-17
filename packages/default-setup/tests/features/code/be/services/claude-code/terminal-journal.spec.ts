import { mkdtemp, writeFile, appendFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createClaudeNativeJournalReader } from '#features/code/be/services/claude-code/terminal-journal.ts'
const session = '11111111-1111-1111-1111-111111111111'
let directory: string
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'native-journal-')) })
afterEach(async () => { await rm(directory, { recursive: true, force: true }) })
it('waits for complete UTF-8 rows and reads only newly appended native session records', async () => {
  const path = join(directory, session + '.jsonl'), read = createClaudeNativeJournalReader(), scope = [{ sessionId: session, path }]
  const bytes = Buffer.from(JSON.stringify({ sessionId: session, type: 'user', text: '中🙂' }) + '\n')
  const at = bytes.indexOf(Buffer.from('🙂')) + 2
  await writeFile(path, bytes.subarray(0, at)); expect(await read(scope)).toEqual([])
  await appendFile(path, bytes.subarray(at)); expect(await read(scope)).toEqual([{ sessionId: session, row: { sessionId: session, type: 'user', text: '中🙂' } }])
  expect(await read(scope)).toEqual([])
  await appendFile(path, JSON.stringify({ sessionId: 'foreign', text: 'ignored' }) + '\n')
  expect(await read(scope)).toEqual([])
})
it('handles native truncation and refuses paths not matching the native session identity', async () => {
  const path = join(directory, session + '.jsonl'), read = createClaudeNativeJournalReader(), scope = [{ sessionId: session, path }]
  await writeFile(path, JSON.stringify({ sessionId: session, text: 'long original row' }) + '\n'); await read(scope)
  await writeFile(path, JSON.stringify({ sessionId: session, text: 'new' }) + '\n')
  expect((await read(scope))[0]?.row.text).toBe('new')
  await expect(read([{ sessionId: session, path: join(directory, 'other.jsonl') }])).rejects.toThrow('identity')
})
