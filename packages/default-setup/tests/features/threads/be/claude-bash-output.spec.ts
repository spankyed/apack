import { nativeBashOutputFile } from '../../../../src/features/threads/be/claude-bash-output.ts'

const sessionId = '80d003be-ac57-44d8-82a8-6b2127b27fd6'
const validPath = '/owned profile/projects/release/' + sessionId + '/tool-results/release-log.txt'
const summary = (file: string) =>
  '<persisted-output>\nOutput too large (42.7KB). Full output saved to: ' + file
  + '\n\nPreview (first 2KB):\nMigration checklist started\n...\n</persisted-output>'
const result = (file: string) => ({ persistedOutputPath: file, persistedOutputSize: 43749 })

it('exposes a Bash file only when the native metadata and full-output envelope agree', () => {
  expect(nativeBashOutputFile(sessionId, result(validPath), summary(validPath))).toBe(validPath)
  expect(nativeBashOutputFile(sessionId, undefined, summary(validPath))).toBeUndefined()
  expect(nativeBashOutputFile(sessionId, result(validPath), summary(validPath.replace('release-log', 'other-log')))).toBeUndefined()
  expect(nativeBashOutputFile(sessionId, result(validPath), summary(validPath).replace('Full output saved', 'Partial output saved'))).toBeUndefined()
  expect(nativeBashOutputFile(sessionId, result(validPath), summary(validPath) + '\nextra')).toBeUndefined()
})

it('requires a bounded local path in the exact native session namespace', () => {
  for (const file of [
    validPath.replace('release-log.txt', 'release.log.txt'), '/etc/passwd', validPath.replace(sessionId, '11111111-1111-1111-1111-111111111111'),
    validPath.replace('/release/', '/../release/'), validPath.replace('/projects/', '/unrelated/'),
    validPath.replace('/tool-results/', '/other/'), validPath + '\0',
  ]) expect(nativeBashOutputFile(sessionId, result(file), summary(file))).toBeUndefined()

  expect(nativeBashOutputFile(sessionId, { ...result(validPath), persistedOutputSize: 0 }, summary(validPath))).toBeUndefined()
})
