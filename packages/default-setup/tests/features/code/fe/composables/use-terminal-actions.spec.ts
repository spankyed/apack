// What a terminal is called in the lists that show it.
//
// This derived the cwd's basename and fell back to the terminal's own `title` only when that came out empty,
// so the title was discarded in every case that mattered — including a title a create passed deliberately
// (T8 in the terminal integration review). The backend already derives a title from the cwd and keeps it
// current as the cwd moves unless the user has renamed the terminal, so this was a second copy of that rule
// overriding the first.
import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import { useTerminalActions } from '#features/code/fe/composables/useTerminalActions.ts'
import type { TerminalInfo } from '#features/code/fe/features/terminal/state.ts'

const { getTerminalDisplayName } = useTerminalActions(undefined, ref(false), ref(false))

const terminal = (fields: Partial<TerminalInfo>): TerminalInfo =>
  ({ id: 't-1', title: 'Terminal', cwd: '/repo', pid: 1, shell: '/bin/zsh', active: true, ...fields }) as TerminalInfo

describe('a terminal’s display name', () => {
  it('is the name the user gave it', () => {
    expect(getTerminalDisplayName(terminal({ customTitle: 'build', title: 'repo', cwd: '/repo/packages/api' }))).toBe('build')
  })

  it('is the terminal’s own title, not the cwd it happens to be in', () => {
    // A create passed this title; the old derivation answered 'api' and the title was never seen
    expect(getTerminalDisplayName(terminal({ title: 'Claude Code', cwd: '/repo/packages/api' }))).toBe('Claude Code')
  })

  it('is the title the backend derived from the cwd, when that is all there is', () => {
    // The backend sets `title` to the cwd's basename on create and keeps it current, so there is nothing
    // for a second derivation here to add
    expect(getTerminalDisplayName(terminal({ title: 'api', cwd: '/repo/packages/api' }))).toBe('api')
  })
})
