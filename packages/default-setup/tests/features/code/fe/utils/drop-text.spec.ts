// What a drop inserts into a terminal: each path one argument for the shell, separated by spaces, no newline.
//
// POSIX is checked by the shell itself: `printf '%s\0'` prints each word the shell split the text into, so a
// quoting that lets the path split, expand or run something shows up as a different list. PowerShell is not
// installed here, so its words are split by a small tokenizer written below for the single-quoted subset the
// function produces; it is a stand-in and says so.
import { describe, expect, it } from 'vitest'
import { execFileWhileWorking } from '@apackdev/sdk/progress'
import { dropShellOf, dropText } from '#features/code/fe/utils/drop-text.ts'

/** The paths that have every character a shell would act on: a space, a single quote, a dollar sign and a backtick */
const HOSTILE = [
  '/Users/me/My Documents/report.pdf',
  "/Users/me/it's here/notes.md",
  '/Users/me/$HOME/x',
  '/Users/me/`whoami`/y',
]

/** The words a POSIX shell reads from `text`, by letting the shell itself print them one per NUL */
async function shellWords(text: string): Promise<string[]> {
  const { stdout } = await execFileWhileWorking('/bin/sh', ['-c', `printf '%s\\0' ${text}`])
  return stdout.split('\0').slice(0, -1)
}

/**
 * The words PowerShell reads from a line of single-quoted arguments, separated by spaces: a quoted word is
 * literal, and a doubled quote inside one is a quote. Covers only what `dropText` writes for PowerShell.
 */
function powershellWords(text: string): string[] {
  const words: string[] = []
  let i = 0
  while (i < text.length) {
    if (text[i] === ' ') { i += 1; continue }
    if (text[i] !== "'") throw new Error(`unexpected ${text[i]} at ${i}`)
    let word = ''
    i += 1
    for (;;) {
      if (i >= text.length) throw new Error('unterminated string')
      if (text[i] === "'") {
        if (text[i + 1] === "'") { word += "'"; i += 2; continue }
        i += 1
        break
      }
      word += text[i]
      i += 1
    }
    words.push(word)
  }
  return words
}

describe('the text a drop inserts for a POSIX shell', () => {
  it('quotes each path as one word the shell reads back unchanged, paths with a space, quote, dollar and backtick included', async () => {
    const text = dropText(HOSTILE, 'posix')
    expect(text).toBeDefined()
    expect(await shellWords(text!), 'the shell split the drop into other words than the paths').toEqual(HOSTILE)
  })

  it('separates the paths by single spaces and ends without a newline', () => {
    expect(dropText(['/a b', '/c'], 'posix')).toBe("'/a b' '/c'")
    expect(dropText(['/a'], 'posix')!.endsWith('\n')).toBe(false)
  })

  it('writes a single quote inside a path as the closing, escaped and reopened quote', () => {
    expect(dropText(["/it's"], 'posix')).toBe(`'/it'\\''s'`)
  })

  it('inserts nothing for no paths', () => {
    expect(dropText([], 'posix')).toBe('')
  })
})

describe('the text a drop inserts for PowerShell', () => {
  it('quotes each path as one literal word, paths with a space, quote, dollar and backtick included', () => {
    const text = dropText(HOSTILE, 'powershell')
    expect(text).toBeDefined()
    expect(powershellWords(text!), 'the words read back are not the paths').toEqual(HOSTILE)
  })

  it('refuses a path holding a typographic single quote, which PowerShell would end the argument at', () => {
    expect(dropText(['/Users/me/it\u2019s/a.txt'], 'powershell')).toBeUndefined()
  })
})

describe('which quoting a terminal shell takes', () => {
  it('takes the POSIX shells, and PowerShell by either of its names or a path to one', () => {
    expect(dropShellOf('/bin/zsh')).toBe('posix')
    expect(dropShellOf('/opt/homebrew/bin/fish')).toBe('posix')
    expect(dropShellOf('bash')).toBe('posix')
    expect(dropShellOf('C:\\Program Files\\Git\\bin\\bash.exe')).toBe('posix')
    expect(dropShellOf('powershell.exe')).toBe('powershell')
    expect(dropShellOf('C:\\Program Files\\PowerShell\\7\\pwsh.exe')).toBe('powershell')
  })

  it('refuses a shell whose quoting is not implemented, and a terminal with no shell named', () => {
    expect(dropShellOf('cmd.exe')).toBeUndefined()
    expect(dropShellOf('wsl.exe')).toBeUndefined()
    expect(dropShellOf('/usr/bin/nu')).toBeUndefined()
    expect(dropShellOf(undefined)).toBeUndefined()
  })
})
