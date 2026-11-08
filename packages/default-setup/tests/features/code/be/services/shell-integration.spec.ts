// How a shell is started so that it reports itself — D3, and the mechanism half of F14.
//
// The old way typed the hook into the user's interactive shell a moment after it started: the text echoed on
// their screen, it raced the shell's own startup, it needed a branch per shell and had none for PowerShell
// or cmd. And exactly one line in this repo ever wrote the setting that turns it on, and that line writes
// `false` — so the subsystem behind it had in all likelihood never run for anybody.
//
// What matters about the replacement is not that it points a shell at a file. It is that **the user's own
// configuration survives**: `--init-file` and `ZDOTDIR` both *replace* what the shell would otherwise read,
// so an arrangement that forgets to source theirs gives them a shell with no configuration at all — which
// is worse than no integration.
import { describe, expect, it } from 'vitest'
import { integrationFor } from '#features/code/be/services/shell-integration.ts'

const DIR = '/data/apack/shell-integration'
const posix: NodeJS.Platform = 'darwin'
const noEnv = {} as NodeJS.ProcessEnv

describe('starting a shell so that it reports itself', () => {
  it('points bash at a file that sources the user\'s own first', () => {
    const arranged = integrationFor('/bin/bash', DIR, posix, noEnv)!

    expect(arranged.args).toEqual(['--init-file', `${DIR}/apack.bash`])
    const file = arranged.files.find(one => one.at === 'apack.bash')!
    // `--init-file` replaces `.bashrc` rather than adding to it
    expect(file.contents).toContain('. "$HOME/.bashrc"')
    expect(file.contents).toContain('\\033]7;file://')
  })

  it("points zsh at a directory and hands ZDOTDIR back, so a shell started from it finds the user's files", () => {
    const arranged = integrationFor('/bin/zsh', DIR, posix, noEnv)!

    expect(arranged.env).toEqual({ ZDOTDIR: DIR })
    expect(arranged.args).toEqual([])
    const file = arranged.files.find(one => one.at === '.zshrc')!
    expect(file.contents).toContain('ZDOTDIR=$HOME')
    expect(file.contents).toContain('${ZDOTDIR}/.zshrc')
  })

  it("keeps a ZDOTDIR the user had already set, rather than sending them to their home", () => {
    const arranged = integrationFor('/bin/zsh', DIR, posix, { ZDOTDIR: '/home/someone/.config/zsh' } as NodeJS.ProcessEnv)!

    expect(arranged.files[0]!.contents).toContain('ZDOTDIR=/home/someone/.config/zsh')
  })

  it('adds to fish\'s data directories rather than replacing them', () => {
    const arranged = integrationFor('/opt/homebrew/bin/fish', DIR, posix, { XDG_DATA_DIRS: '/opt/share' } as NodeJS.ProcessEnv)!

    // fish reads `vendor_conf.d` from every entry, so this is the one shell with nothing to source back
    expect(arranged.env).toEqual({ XDG_DATA_DIRS: `${DIR}:/opt/share` })
    expect(arranged.files[0]!.at).toBe('fish/vendor_conf.d/apack.fish')
  })

  it('answers nothing for a shell it has no arrangement for, so that shell starts as the user would', () => {
    expect(integrationFor('/usr/local/bin/nu', DIR, posix, noEnv)).toBeUndefined()
    expect(integrationFor('/bin/sh', DIR, posix, noEnv)).toBeUndefined()
  })

  it('points PowerShell at a file it dot-sources, which is X4', () => {
    const arranged = integrationFor('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', 'C:\\data\\si', 'win32')

    expect(arranged?.args).toEqual(['-NoExit', '-Command', ". 'C:\\data\\si\\apack.ps1'"])
    expect(arranged?.files[0]?.at).toBe('apack.ps1')
    // The prompt is the hook, so the markers have to be in what it writes
    expect(arranged?.files[0]?.contents).toContain('633;P;Cwd=')
    expect(arranged?.files[0]?.contents).toContain('function Global:prompt')
    // **And the user's own prompt is still drawn.** Both halves, because either alone is satisfied by a
    // script that loses it: the capture without the call replaces their prompt, and the call without the
    // capture invokes nothing. A single mention of the name is matched twice over and proves neither.
    expect(arranged?.files[0]?.contents, 'theirs is captured').toContain('$Global:__apackPrompt = $function:prompt')
    expect(arranged?.files[0]?.contents, 'and theirs is called').toContain('& $Global:__apackPrompt')
  })

  it('points cmd at a batch file with /K', () => {
    const arranged = integrationFor('cmd.exe', 'C:\\data\\si', 'win32')

    expect(arranged?.args).toEqual(['/K', 'C:\\data\\si\\apack.cmd'])
    expect(arranged?.files[0]?.at).toBe('apack.cmd')
    expect(arranged?.files[0]?.contents).toContain('633;P;Cwd=$P')
  })

  /**
   * **cmd is told the directory and not the status, which is the honest answer.** `PROMPT` has no code for
   * the last exit code, so there is no `D` marker to write — and writing `D;0` would report every command
   * as having succeeded, which is worse than reporting nothing.
   */
  it('emits no status marker for cmd, rather than a wrong one', () => {
    expect(integrationFor('cmd.exe', 'C:\\data\\si', 'win32')?.files[0]?.contents).not.toContain('633;D')
    expect(integrationFor('powershell.exe', 'C:\\data\\si', 'win32')?.files[0]?.contents, 'where PowerShell has one').toContain('633;D;')
  })

  it('arranges nothing for a Windows shell that reaches a POSIX one through a launcher', () => {
    expect(integrationFor('wsl.exe', 'C:\\data\\si', 'win32')).toBeUndefined()
    expect(integrationFor('bash.exe', 'C:\\data\\si', 'win32')).toBeUndefined()
  })
})
