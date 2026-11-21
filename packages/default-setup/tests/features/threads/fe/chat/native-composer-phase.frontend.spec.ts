import { claudeWindowStorageKey } from '#features/threads/fe/chat/native-window-storage.ts'
import { readClaudeComposerPhase, stageClaudeComposerPhase, commitClaudeComposerPhase } from '#features/threads/fe/chat/native-composer-phase.ts'

afterEach(() => { history.replaceState({}, '', '/'); localStorage.clear() })
it('keeps independent main, popout and thread choices and only consumes the submitted revision', () => {
  const thread = crypto.randomUUID()
  stageClaudeComposerPhase(thread, 'Plan')
  const main = readClaudeComposerPhase(thread)!
  expect(readClaudeComposerPhase(crypto.randomUUID())).toBeUndefined()
  history.replaceState({}, '', '/?popout=surface&surfaceId=default-setup/threads')
  expect(readClaudeComposerPhase(thread)).toBeUndefined()
  stageClaudeComposerPhase(thread, 'Edit')
  expect(readClaudeComposerPhase(thread)?.phase).toBe('Edit')
  history.replaceState({}, '', '/')
  expect(readClaudeComposerPhase(thread)).toEqual(main)
  stageClaudeComposerPhase(thread, 'Plan')
  commitClaudeComposerPhase(thread, main.revision)
  const latest = readClaudeComposerPhase(thread)!
  expect(latest.revision).not.toBe(main.revision)
  commitClaudeComposerPhase(thread, latest.revision)
  expect(readClaudeComposerPhase(thread)).toBeUndefined()
  expect(localStorage.getItem(`default-setup/threads:${claudeWindowStorageKey('composer-phase', thread)!}`)).toBeNull()
})
it('adopts a valid persisted stage after a fresh window load and ignores malformed preferences', () => {
  const thread = crypto.randomUUID(), key = claudeWindowStorageKey('composer-phase', thread)!
  localStorage.setItem(`default-setup/threads:${key}`, JSON.stringify({phase:'Plan',revision:'saved-choice'}))
  expect(readClaudeComposerPhase(thread)).toEqual({phase:'Plan',revision:'saved-choice'})
  commitClaudeComposerPhase(thread, 'saved-choice')
  for (const raw of ['{', '{}', '{"phase":"bypassPermissions","revision":"foreign"}']) {
    localStorage.setItem(`default-setup/threads:${key}`, raw)
    expect(readClaudeComposerPhase(thread)).toBeUndefined()
  }
})
