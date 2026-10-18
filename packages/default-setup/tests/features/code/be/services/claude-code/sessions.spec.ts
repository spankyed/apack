import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listAll } from '#features/code/be/services/claude-code/sessions.ts'
/**
 * Tests for `encodeProjectPath` — the cwd-to-bucket encoder used by
 * `claudeCode.sessions.list()`.
 *
 * This must match the CLI's `sanitizePath` algorithm exactly (see
 * `src/utils/sessionStoragePortable.ts:311` in the leaked source) or the
 * wrapper silently returns empty session lists for any real project.
 */

import { encodeProjectPath, MAX_SANITIZED_LENGTH } from '#features/code/be/services/claude-code/sessions.ts'

describe('encodeProjectPath', () => {
  it('replaces forward slashes with dashes', () => {
    expect(encodeProjectPath('/Users/foo/app')).toBe('-Users-foo-app')
  })

  it('replaces dots with dashes (the bug that prompted F1)', () => {
    // The old impl only touched slashes, so this would have returned
    // `-Users-foo.bar-app` and `sessions.list()` would never find the bucket.
    expect(encodeProjectPath('/Users/foo.bar/app')).toBe('-Users-foo-bar-app')
  })

  it('replaces every non-alphanumeric char including spaces and colons', () => {
    expect(encodeProjectPath('/Users/My Project/src')).toBe('-Users-My-Project-src')
    // In a JS string literal `C:\\Users\\foo\\app` is C + : + \ + Users + \ + foo + \ + app.
    // Colon and each backslash each map to a single `-`.
    expect(encodeProjectPath('C:\\Users\\foo\\app')).toBe('C--Users-foo-app')
  })

  it('replaces unicode with dashes (single replacement per char)', () => {
    expect(encodeProjectPath('/résumé/app')).toBe('-r-sum--app')
  })

  it('passes through all-alphanumeric inputs unchanged', () => {
    expect(encodeProjectPath('abc123XYZ')).toBe('abc123XYZ')
  })

  it('returns the sanitized string untouched when exactly at the length cap', () => {
    const cwd = '/' + 'a'.repeat(MAX_SANITIZED_LENGTH - 1) // leading / becomes -
    const out = encodeProjectPath(cwd)
    // Exactly cap chars, no hash appended, no truncation.
    expect(out.length).toBe(MAX_SANITIZED_LENGTH)
    expect(out).toBe('-' + 'a'.repeat(MAX_SANITIZED_LENGTH - 1))
  })

  it('truncates + hashes when the sanitized string exceeds the cap', () => {
    const cwd = '/' + 'a'.repeat(MAX_SANITIZED_LENGTH + 50) // way over the limit
    const out = encodeProjectPath(cwd)
    // Length = cap + `-` + djb2 base-36 hash (at most 7 chars for uint32)
    expect(out.length).toBeGreaterThan(MAX_SANITIZED_LENGTH)
    expect(out.length).toBeLessThanOrEqual(MAX_SANITIZED_LENGTH + 1 + 8)
    // First MAX chars are still the sanitized prefix.
    expect(out.startsWith('-' + 'a'.repeat(MAX_SANITIZED_LENGTH - 1))).toBe(true)
    // Middle separator.
    expect(out[MAX_SANITIZED_LENGTH]).toBe('-')
  })

  it('produces the same hash suffix for the same input (deterministic)', () => {
    const cwd = '/' + 'x'.repeat(MAX_SANITIZED_LENGTH + 10)
    expect(encodeProjectPath(cwd)).toBe(encodeProjectPath(cwd))
  })

  it('matches the real on-disk fixture', () => {
    // Real directory name that exists under ~/.claude/projects/ on this
    // developer machine (and in CI after a first successful claude run).
    expect(encodeProjectPath('/Users/spankyed/Develop/Projects/apack'))
      .toBe('-Users-spankyed-Develop-Projects-apack')
  })
})

it('all-session discovery uses the native journal cwd instead of guessing from a lossy bucket name', async () => {
 const directory=await mkdtemp(join(tmpdir(),'native-session-dirs-'))
 vi.stubEnv('CLAUDE_CONFIG_DIR',directory)
 try {
  const cwd='/private/tmp/project-with-hyphens.and spaces'
  const bucket=join(directory,'projects',encodeProjectPath(cwd));await mkdir(bucket,{recursive:true})
  await writeFile(join(bucket,'native-session.jsonl'),'malformed\n'+JSON.stringify({type:'user',cwd,message:{role:'user',content:'Hello'}})+'\n')
  await writeFile(join(bucket,'unknown-session.jsonl'),JSON.stringify({type:'user',message:{role:'user',content:'Unknown project'}})+'\n')
  const sessions=await listAll()
  expect(sessions.find(s=>s.id==='native-session')?.cwd).toBe(cwd)
  expect(sessions.find(s=>s.id==='unknown-session')?.cwd).toBeUndefined()
 } finally {vi.unstubAllEnvs();await rm(directory,{recursive:true,force:true})}
});
