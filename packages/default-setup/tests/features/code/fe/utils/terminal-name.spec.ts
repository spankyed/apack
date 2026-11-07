// What a terminal is called when nobody has named it — X7 and X8.
//
// Two call sites each did `cwd.split('/').filter(Boolean).pop()`, and both were wrong the same two ways on
// Windows: a path with no forward slashes returns whole, so a tab showed `C:\Users\someone\project` where
// every other tab shows a word; and a path that is only a root has no last part, so `C:\` fell through to a
// hardcoded "root" that names the drive for nobody.
import { describe, expect, it } from 'vitest'
import { terminalNameFor } from '#features/code/fe/utils/terminal-name.ts'

describe('what a terminal is called', () => {
  it('takes the last part of a POSIX path', () => {
    expect(terminalNameFor('/Users/someone/project')).toBe('project')
    expect(terminalNameFor('/Users/someone/project/')).toBe('project')
  })

  it('takes the last part of a Windows path, which has no forward slashes in it', () => {
    expect(terminalNameFor('C:\\Users\\someone\\project')).toBe('project')
    expect(terminalNameFor('C:\\Users\\someone\\project\\')).toBe('project')
  })

  it('names a drive root by its drive', () => {
    expect(terminalNameFor('C:\\')).toBe('C:')
    expect(terminalNameFor('d:\\')).toBe('D:')
  })

  it('names the POSIX root by what it is', () => {
    expect(terminalNameFor('/')).toBe('/')
  })

  it('answers nothing when the path says nothing, so the caller can fall back to the title', () => {
    expect(terminalNameFor(undefined)).toBeUndefined()
    expect(terminalNameFor('')).toBeUndefined()
    expect(terminalNameFor('   ')).toBeUndefined()
  })

  it('handles a mixed path, which a shell on Windows will happily report', () => {
    expect(terminalNameFor('C:/Users/someone/project')).toBe('project')
  })
})
