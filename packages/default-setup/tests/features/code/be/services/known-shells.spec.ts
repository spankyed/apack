// Which shells this machine will start — F13, and the half of S3 that is not about a pid.
//
// The list this replaced could not refuse anything: eleven hardcoded paths, and a shell it rejected fell
// back to `$SHELL`, the same value that had just failed it on any machine whose login shell is not one of
// the eleven. A check whose remedy is the value it refused cannot change an outcome.
//
// It matters because a restored terminal spawns the `shell` its row holds, and a row is data — the database
// console writes one, `apack db exec` writes one, and a backup import replaces the whole store with no
// row-level validation. "Import a backup someone sent you" is enough to turn a stored string into an
// executable at the next boot.
import { describe, expect, it } from 'vitest'
import { defaultShell, listedShells, shellIsKnown, shellToStart } from '#features/code/be/services/known-shells.ts'

const POSIX: NodeJS.Platform = 'darwin'
const LISTED = ['/bin/sh', '/bin/zsh', '/opt/homebrew/bin/fish']
const env = { SHELL: '/bin/zsh' } as NodeJS.ProcessEnv
const on = { platform: POSIX, env, listed: LISTED }

describe('the shell a terminal starts', () => {
  it('refuses a shell this machine does not list, and falls back to something else', () => {
    const chosen = shellToStart('/tmp/payload.sh', on)

    // The whole of F13: the fallback is a *different* value from the one refused
    expect(chosen).toEqual({ shell: '/bin/zsh', refused: '/tmp/payload.sh' })
    expect(chosen.shell).not.toBe(chosen.refused)
  })

  it('starts a shell the system lists, whoever asked for it', () => {
    // `/etc/shells` is what `chsh` validates against, so fish and a Homebrew bash are covered without
    // anyone enumerating them — and the answer moves when the user installs a shell, not when this is edited
    expect(shellToStart('/opt/homebrew/bin/fish', on)).toEqual({ shell: '/opt/homebrew/bin/fish' })
  })

  it("starts the user's own shell even when the system does not list it", () => {
    // A login shell the OS gave them is theirs by definition; refusing it would be refusing their machine
    expect(shellToStart('/usr/local/bin/nu', { ...on, env: { SHELL: '/usr/local/bin/nu' } as NodeJS.ProcessEnv }))
      .toEqual({ shell: '/usr/local/bin/nu' })
  })

  it('takes the default when nothing was asked for', () => {
    expect(shellToStart(undefined, on)).toEqual({ shell: '/bin/zsh' })
    expect(shellToStart('   ', on)).toEqual({ shell: '/bin/zsh' })
  })

  it('does not match on a basename, so a lookalike beside it is still refused', () => {
    // `path.basename` matching is what let `/tmp/zsh` pass as `zsh`
    expect(shellIsKnown('/tmp/zsh', on)).toBe(false)
    expect(shellIsKnown('zsh', on)).toBe(false)
  })

  it('names the two Windows shells, where there is no /etc/shells to ask', () => {
    const windows = { platform: 'win32' as NodeJS.Platform, env: {} as NodeJS.ProcessEnv, listed: [] }
    expect(shellToStart('powershell.exe', windows)).toEqual({ shell: 'powershell.exe' })
    expect(shellToStart('cmd.exe', windows)).toEqual({ shell: 'cmd.exe' })
    expect(shellToStart('C:\\\\evil.bat', windows).refused).toBe('C:\\\\evil.bat')
  })

  it('reads the real /etc/shells, so the derivation has a subject on this machine', () => {
    // A rule over a file nobody reads is a rule over nothing: on any POSIX machine this file exists and
    // holds at least one shell, and the case says so rather than passing over an empty list
    if (process.platform === 'win32') return
    const listed = listedShells()
    expect(listed.length, '/etc/shells held nothing, so the check has no subject here').toBeGreaterThan(0)
    expect(listed.every(shell => shell.startsWith('/'))).toBe(true)
    expect(listed.some(shell => shell.includes('#')), 'a comment reached the list').toBe(false)
  })

  it('answers the platform default where there is no $SHELL', () => {
    expect(defaultShell('darwin', {} as NodeJS.ProcessEnv)).toBe('/bin/sh')
    expect(defaultShell('win32', {} as NodeJS.ProcessEnv)).toBe('powershell.exe')
  })
})
