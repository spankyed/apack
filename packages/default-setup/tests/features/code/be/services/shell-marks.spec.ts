// What a shell started with the integration file actually writes, read from a real bash.
//
// The hook is a program in another language, held in a string: what it does is only known by running it.
// These cases start the bash this machine has with the file the feature would write and a configuration
// of the user's that the hook must leave working, type at it, and read the marks out of what it printed.
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { tmpdir } from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { execFileWhileWorking } from '@apackdev/sdk/progress'
import { integrationFor } from '#features/code/be/services/shell-integration.ts'

const BASH = '/bin/bash'

/** Every mark in `output`, each as what is between its introducer and its terminator */
function marks(output: string): string[] {
  // Each begins with escape and `]` and ends at a bell
  return output.split('\u001b]').slice(1)
    .map(rest => rest.slice(0, Math.max(0, rest.indexOf('\u0007'))))
    .filter(mark => /^(?:133|633|7);/.test(mark))
}

describe.skipIf(process.platform === 'win32' || !existsSync(BASH))('what an integrated bash reports', () => {
  let home: string

  beforeEach(async () => {
    home = await mkdtemp(path.join(tmpdir(), 'apack-shell-marks-'))
  })
  afterEach(async () => {
    await rm(home, { recursive: true, force: true })
  })

  /** Starts bash with the integration file over `bashrc`, types `lines` and answers what it printed */
  async function typed(bashrc: string, lines: string[]): Promise<string> {
    const arranged = integrationFor(BASH, path.join(home, 'integration'), 'darwin', {})!
    for (const file of arranged.files) {
      await mkdir(path.dirname(path.join(home, 'integration', file.at)), { recursive: true })
      await writeFile(path.join(home, 'integration', file.at), file.contents)
    }
    await writeFile(path.join(home, '.bashrc'), bashrc)
    await writeFile(path.join(home, 'typed'), [...lines, 'exit', ''].join('\n'))
    const { stdout, stderr } = await execFileWhileWorking(
      '/bin/sh',
      // The shell ends with its last command's status, which is not this case's to fail on
      ['-c', '"$0" --noprofile "$@" -i < "$HOME/typed" 2>&1; exit 0', BASH, ...arranged.args],
      { env: { HOME: home, PATH: process.env.PATH ?? '', TERM: 'dumb' }, cwd: home },
    )
    return stdout + stderr
  }

  const commandsIn = (output: string) => marks(output).filter(mark => !mark.startsWith('7;') && !/^133;[AB]/.test(mark))

  it('marks each command once, with its line and how it ended', async () => {
    const output = await typed("PS1='$ '\n", ['echo hi', 'false'])

    expect(commandsIn(output)).toEqual([
      '633;E;echo hi', '133;C', '133;D;0',
      '633;E;false', '133;C', '133;D;1',
      '633;E;exit', '133;C',
    ])
  })

  it('reports no command for a prompt drawn again with nothing typed', async () => {
    const output = await typed("PS1='$ '\n", ['', '', 'echo hi'])

    expect(commandsIn(output)).toEqual(['633;E;echo hi', '133;C', '133;D;0', '633;E;exit', '133;C'])
  })

  it("leaves the user's own prompt command, DEBUG trap and unset-variable rule working", async () => {
    const output = await typed(
      // A prompt command ending in a separator, a trap of their own, and `set -u`
      "set -u\nPROMPT_COMMAND='history -a;'\ntrap 'THEIRS=$((${THEIRS-0}+1))' DEBUG\nPS1='$ '\n",
      ['echo hi', 'echo "theirs ran $((THEIRS > 0))"'],
    )

    expect(output).not.toMatch(/unbound variable|syntax error/)
    expect(output).toContain('theirs ran 1')
    expect(commandsIn(output).slice(0, 3)).toEqual(['633;E;echo hi', '133;C', '133;D;0'])
  })

  it('reports a directory with a percent sign in its name as that directory', async () => {
    await mkdir(path.join(home, '50%20 off'))
    const output = await typed("PS1='$ '\n", ['cd "50%20 off"'])

    // Percent-encoded, so whoever decodes it reads the name back rather than a space
    expect(marks(output).filter(mark => mark.startsWith('7;')).at(-1)).toMatch(/^7;file:\/\/[^/]*\/.*\/50%2520 off$/)
  })
})

const ZSH = '/bin/zsh'

describe.skipIf(process.platform === 'win32' || !existsSync(ZSH))('what an integrated zsh reports', () => {
  let home: string

  beforeEach(async () => {
    home = await mkdtemp(path.join(tmpdir(), 'apack-shell-marks-'))
  })
  afterEach(async () => {
    await rm(home, { recursive: true, force: true })
  })

  /** Starts zsh pointed at the integration directory over `zshrc`, types `lines` and answers what it printed */
  async function typed(zshrc: string, lines: string[]): Promise<string> {
    const directory = path.join(home, 'integration')
    const arranged = integrationFor(ZSH, directory, 'darwin', {})!
    await mkdir(directory, { recursive: true })
    for (const file of arranged.files) await writeFile(path.join(directory, file.at), file.contents)
    await writeFile(path.join(home, '.zshrc'), zshrc)
    await writeFile(path.join(home, 'typed'), [...lines, 'exit', ''].join('\n'))
    const { stdout, stderr } = await execFileWhileWorking(
      '/bin/sh',
      ['-c', '"$0" -i < "$HOME/typed" 2>&1; exit 0', ZSH],
      { env: { HOME: home, PATH: process.env.PATH ?? '', TERM: 'dumb', ...arranged.env }, cwd: home },
    )
    return stdout + stderr
  }

  const commandsIn = (output: string) => marks(output).filter(mark => !mark.startsWith('7;') && !/^133;[AB]/.test(mark))

  it('marks each command once, with its line and how it ended', async () => {
    const output = await typed("PS1='$ '\n", ['echo hi', 'false'])

    expect(commandsIn(output)).toEqual([
      '633;E;echo hi', '133;C', '133;D;0',
      '633;E;false', '133;C', '133;D;1',
      '633;E;exit', '133;C',
    ])
  })

  it("keeps the user's own prompt hooks, under options that make an unset or an indexed variable an error", async () => {
    const output = await typed(
      "setopt nounset ksharrays\nPS1='$ '\ntheirs_one(){ ONE=ran }\ntheirs_two(){ TWO=ran }\nprecmd_functions=(theirs_one theirs_two)\n",
      ['echo "hooks-${ONE-}-${TWO-}"'],
    )

    expect(output).not.toMatch(/parameter not set|bad substitution/)
    expect(output).toContain('hooks-ran-ran')
    expect(commandsIn(output).slice(0, 3)).toEqual(['633;E;echo "hooks-${ONE-}-${TWO-}"', '133;C', '133;D;0'])
  })

  it('starts under nounset when the user registered no hooks at all', async () => {
    const output = await typed("setopt nounset\nPS1='$ '\n", ['echo hi'])

    expect(output).not.toMatch(/parameter not set/)
    expect(commandsIn(output).slice(0, 3)).toEqual(['633;E;echo hi', '133;C', '133;D;0'])
  })
})
