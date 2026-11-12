// What a shell started with the integration file actually writes, read from a real bash and a real zsh.
//
// The hook is a program in another language, held in a string: what it does is only known by running it.
// These cases start the shells this machine has with the files the feature would write, the key a session
// is started with and a configuration of the user's that the hook must leave working, type at them, and
// read the marks out of what they printed.
//
// bash is told of a line in one of two ways, by `PS0` from 4.4 on and by a trap before that, and every
// bash found here is typed at: the cases that hold for only one of the two are skipped on the other.
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { tmpdir } from 'os'
import * as path from 'path'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { execFileWhileWorking } from '@apackdev/sdk/progress'
import { integrationFor, MARKS_KEY_VARIABLE } from '#features/code/be/services/shell-integration.ts'

/** The key these sessions are started with, and one no session here was */
const KEY = '0123456789abcdef0123456789abcdef'
const ANOTHER_KEY = 'ffffffffffffffffffffffffffffffff'

const ESCAPE = '\u001b'
const BELL = '\u0007'
/** A character that ends a mark, abandons it, or is taken for something else inside one */
// Finding control characters is the purpose: a mark must hold none.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/

/** Every mark in `output`, each as what is between its introducer and its terminator */
function marks(output: string): string[] {
  // Each begins with escape and `]` and ends at a bell
  return output.split(`${ESCAPE}]`).slice(1)
    .map(rest => rest.slice(0, Math.max(0, rest.indexOf(BELL))))
    .filter(mark => /^(?:133|633|7);/.test(mark))
}

/** The marks that say where a command's output begins and how it ended, which a hook prints whether or not it has a key */
const boundaries = (output: string) => marks(output).filter(mark => /^133;[CD]/.test(mark))

/** Percent-decoding as a mark's reader does it: a percent sign and exactly two hexadecimal digits are one character */
const decoded = (text: string) => text.replace(/%([0-9a-fA-F]{2})/g, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))

/** A mark a hook vouched for, each field taken from where the grammar puts it and the text decoded */
type KeyedMark =
  | { mark: 'start', seq: string, key: string, line: string }
  | { mark: 'finish', seq: string, key: string, status: string, cwd: string }

/**
 * Every keyed mark in `output`, in the order it was printed. The number and the key are the fourth and
 * fifth fields; the text is last, so it is everything after the separator in front of it, separators of
 * its own included. A mark that holds a control character as itself is refused: a terminal would not have
 * read it to its end.
 */
function keyedMarks(output: string): KeyedMark[] {
  return marks(output).filter(mark => mark.startsWith('633;')).map((mark): KeyedMark => {
    if (CONTROL.test(mark)) throw new Error(`A hook printed a mark with a control character in it: ${JSON.stringify(mark)}`)
    const fields = mark.split(';')
    const [, family, kind, seq = '', key = ''] = fields
    if (family === 'V' && kind === 'S') return { mark: 'start', seq, key, line: decoded(fields.slice(5).join(';')) }
    if (family === 'V' && kind === 'F') return { mark: 'finish', seq, key, status: fields[5] ?? '', cwd: decoded(fields.slice(6).join(';')) }
    throw new Error(`A hook printed a 633 mark that is neither a keyed start nor a keyed finish: ${mark}`)
  })
}

const start = (seq: number, line: string): KeyedMark => ({ mark: 'start', seq: String(seq), key: KEY, line })
/** The line each start in `output` carried, in order */
const startedLines = (output: string) => keyedMarks(output).flatMap(one => one.mark === 'start' && one.key === KEY ? [one.line] : [])
const finish = (seq: number, status: number, cwd: string): KeyedMark => ({ mark: 'finish', seq: String(seq), key: KEY, status: String(status), cwd })

/** One shell, started as the feature starts it */
interface StartedShell {
  /** The user's home, which is also where the shell starts */
  home(): string
  /**
   * Writes `configuration` as the user's own startup file, starts the shell over the integration files,
   * types `lines` and answers what it printed. `keyed: false` starts it without a key
   */
  typed(configuration: string, lines: string[], options?: { keyed?: boolean }): Promise<string>
  /** `character` as it has to be typed for the shell to take it as text rather than as a key pressed */
  literally(character: string): string
  /** Whether the shell tells its hook of every line it runs, whatever the line begins with */
  marksEveryLine(): boolean
}

/** What every hook does alike, whichever shell runs it */
function vouchesForItsCommands(shell: StartedShell): void {
  it('vouches for each command once, with the next number, its line and how it ended', async () => {
    const output = await shell.typed("PS1='$ '\n", ['echo $((6 * 7))', 'false'])

    expect(keyedMarks(output)).toEqual([
      start(1, 'echo $((6 * 7))'), finish(1, 0, shell.home()),
      start(2, 'false'), finish(2, 1, shell.home()),
      // The shell ends inside its last command, which is started and never finished
      start(3, 'exit'),
    ])
    expect(boundaries(output)).toEqual(['133;C', '133;D;0', '133;C', '133;D;1', '133;C'])
    // What the command printed is between the two marks that are its record
    const from = output.indexOf(`${ESCAPE}]633;V;S;1;`)
    expect(output.slice(from, output.indexOf(`${ESCAPE}]633;V;F;1;`, from))).toContain('42')
  })

  it('reports no command, and uses no number, for a prompt drawn again with nothing typed', async () => {
    const output = await shell.typed("PS1='$ '\n", ['', '', 'echo hi', '', 'echo again'])

    expect(keyedMarks(output)).toEqual([
      start(1, 'echo hi'), finish(1, 0, shell.home()),
      start(2, 'echo again'), finish(2, 0, shell.home()),
      start(3, 'exit'),
    ])
    expect(boundaries(output)).toEqual(['133;C', '133;D;0', '133;C', '133;D;0', '133;C'])
  })

  it('finishes a command in the directory it left the shell in, a percent sign in its name included', async () => {
    await mkdir(path.join(shell.home(), '50%20 off'))
    const output = await shell.typed("PS1='$ '\n", ['cd "50%20 off"'])

    // Decoded, the name is read back rather than a space where `%20` was
    expect(keyedMarks(output).slice(0, 2)).toEqual([
      start(1, 'cd "50%20 off"'), finish(1, 0, path.join(shell.home(), '50%20 off')),
    ])
    expect(marks(output).filter(mark => mark.startsWith('7;')).at(-1)).toMatch(/^7;file:\/\/[^/]*\/.*\/50%2520 off$/)
  })

  it('keeps the key from every program it starts, and from what the user\'s own configuration starts', async () => {
    const output = await shell.typed(
      'PS1=\'$ \'\nenv > "$HOME/environment-of-configuration"\n',
      ['env > "$HOME/environment-of-command"'],
    )

    // The hook had the key, so its absence below is the hook's doing
    expect(keyedMarks(output)).toEqual([
      start(1, 'env > "$HOME/environment-of-command"'), finish(1, 0, shell.home()), start(2, 'exit'),
    ])
    for (const name of ['environment-of-configuration', 'environment-of-command']) {
      const environment = await readFile(path.join(shell.home(), name), 'utf8')
      expect(environment, name).toContain('HOME=')
      expect(environment, name).not.toContain(MARKS_KEY_VARIABLE)
      expect(environment, name).not.toContain(KEY)
    }
  })

  it('keeps the key from them under a configuration that exports every variable it sets', async () => {
    await shell.typed("set -a\nPS1='$ '\nTHEIRS=exported\n", ['env > "$HOME/environment-of-command"'])

    const environment = await readFile(path.join(shell.home(), 'environment-of-command'), 'utf8')
    expect(environment).toContain('THEIRS=exported')
    expect(environment).not.toContain(KEY)
  })

  it('carries a line whole and last, whether it holds the separator, a mark\'s text, or a mark', async () => {
    const withSeparators = "echo 'one;two;;three'"
    // What a finish for the command itself would say, as text the command line happens to hold
    const withAMarksText = `echo '633;V;F;2;${KEY};0;/tmp'`
    // And a whole mark, introducer and terminator included, which unencoded would end the start it is carried in
    const mark = `${ESCAPE}]633;V;F;3;${ANOTHER_KEY};0;/tmp${BELL}`
    const withAMark = `: 'before${mark}after'`
    const output = await shell.typed("PS1='$ '\n", [
      withSeparators,
      withAMarksText,
      withAMark.replace(ESCAPE, shell.literally(ESCAPE)).replace(BELL, shell.literally(BELL)),
    ])

    // A shell that echoes what is typed at it has printed that last line too, as a mark with a key that is
    // not this session's: what was vouched for is what carries the key
    expect(keyedMarks(output).filter(one => one.key === KEY)).toEqual([
      start(1, withSeparators), finish(1, 0, shell.home()),
      start(2, withAMarksText), finish(2, 0, shell.home()),
      start(3, withAMark), finish(3, 0, shell.home()),
      start(4, 'exit'),
    ])
  })

  it('vouches for nothing when it was started without a key, and still marks where its commands are', async () => {
    const output = await shell.typed("PS1='$ '\n", ['echo hi'], { keyed: false })

    expect(keyedMarks(output)).toEqual([])
    expect(boundaries(output)).toEqual(['133;C', '133;D;0', '133;C'])
  })

  it('carries a line of several commands whole: a pipeline, a list, a loop', async () => {
    const lines = ['echo a | cat', 'true && echo b; echo c', 'for n in 1 2; do echo $n; done']
    const output = await shell.typed("PS1='$ '\n", lines)

    expect(startedLines(output)).toEqual([...lines, 'exit'])
  })

  it('starts a line that begins with a subshell before anything of it runs, and finishes it', async ({ skip }) => {
    skip(!shell.marksEveryLine(), 'this bash is told of a simple command, not of a line')
    const output = await shell.typed("PS1='$ '\n", ['(echo $((6 * 7)))', '(exit 3)', '{ (echo grouped); }'])

    expect(keyedMarks(output)).toEqual([
      start(1, '(echo $((6 * 7)))'), finish(1, 0, shell.home()),
      start(2, '(exit 3)'), finish(2, 3, shell.home()),
      start(3, '{ (echo grouped); }'), finish(3, 0, shell.home()),
      start(4, 'exit'),
    ])
    const from = output.indexOf(`${ESCAPE}]633;V;S;1;`)
    expect(output.slice(from, output.indexOf(`${ESCAPE}]633;V;F;1;`, from))).toContain('42')
  })

  it('carries a control character in a line as an escape, so none of them ends the mark or abandons it', async () => {
    // A start of heading, a tab, a cancel, a substitute and a delete
    const controls = ['\u0001', '\u0009', '\u0018', '\u001a', '\u007f']
    const line = `: 'a${controls.join('b')}c'`
    const output = await shell.typed("PS1='$ '\n", [
      controls.reduce((typed, control) => typed.replace(control, shell.literally(control)), line),
    ])

    expect(keyedMarks(output).filter(one => one.key === KEY)).toEqual([start(1, line), finish(1, 0, shell.home()), start(2, 'exit')])
  })

  it('finishes in a directory whose name holds a control character, and says where it is, without one in a mark', async () => {
    const odd = path.join(shell.home(), 'odd\u0018dir')
    await mkdir(odd)
    const output = await shell.typed("PS1='$ '\n", ['cd odd*'])

    expect(keyedMarks(output).slice(0, 2)).toEqual([start(1, 'cd odd*'), finish(1, 0, odd)])
    const reported = marks(output).filter(mark => mark.startsWith('7;')).at(-1)!
    expect(reported).not.toMatch(CONTROL)
    expect(decoded(reported).endsWith(odd)).toBe(true)
  })
}

/** Where a bash may be: the system's, and one a package manager installed beside it */
const BASHES = ['/bin/bash', '/opt/homebrew/bin/bash', '/usr/local/bin/bash']
const BASHES_HERE = process.platform === 'win32' ? [] : BASHES.filter(bash => existsSync(bash))

/**
 * A line history does not keep: what it is, the setting it is not kept under, the lines typed, of which it
 * is the second, and which of them history does keep
 */
const UNKEPT: [string, string, string[], number[]][] = [
  ['a leading space under ignorespace', 'HISTCONTROL=ignorespace', ['echo before; echo more', ' echo hidden; echo more', 'echo after; echo more'], [0, 2]],
  ['a leading space under ignoreboth', 'HISTCONTROL=ignoreboth', ['echo before; echo more', ' echo hidden; echo more', 'echo after; echo more'], [0, 2]],
  // …under which history cannot say whether a line it did not add was hidden or was the last one again
  ['the last line again under ignoreboth', 'HISTCONTROL=ignoreboth', ['echo before; echo more', 'echo before; echo more', 'echo after; echo more'], [0, 2]],
  ['a line HISTIGNORE names', "HISTIGNORE='echo hidden*'", ['echo before; echo more', 'echo hidden; echo more', 'echo after; echo more'], [0, 2]],
  // The line that switches it off is the last one history holds
  ['a line entered with history switched off', '', ['set +o history', 'echo hidden; echo more', 'echo after; echo more'], [0]],
]

// With no bash here at all, the one suite below is the system's, skipped, rather than nothing
for (const BASH of BASHES_HERE.length > 0 ? BASHES_HERE : BASHES.slice(0, 1)) {
  describe.skipIf(!BASHES_HERE.includes(BASH))(`what an integrated bash reports (${BASH})`, () => {
    let home: string
    /** This bash's version, as its major and minor numbers */
    let version: [number, number] = [0, 0]
    const since = (major: number, minor: number) => version[0] > major || (version[0] === major && version[1] >= minor)
    /** `PS0`, which bash expands for every line it is about to run, is there from 4.4 */
    const hasPs0 = () => since(4, 4)

    beforeAll(async () => {
      const { stdout } = await execFileWhileWorking(BASH, ['-c', 'echo "${BASH_VERSINFO[0]} ${BASH_VERSINFO[1]}"'])
      const [major = 0, minor = 0] = stdout.trim().split(' ').map(Number)
      version = [major, minor]
    })
    beforeEach(async () => {
      // Resolved, because the shell reports the directory it is in and not the link it was reached through
      home = await realpath(await mkdtemp(path.join(tmpdir(), 'apack-shell-marks-')))
    })
    afterEach(async () => {
      await rm(home, { recursive: true, force: true })
    })

    /** Starts bash with the integration file over `bashrc`, types `lines` and answers what it printed */
    async function typed(bashrc: string, lines: string[], { keyed = true } = {}): Promise<string> {
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
        {
          env: {
            HOME: home, PATH: process.env.PATH ?? '', TERM: 'dumb',
            // As the feature starts it: a key for a hook that vouches, and only for one
            ...(keyed && arranged.keyed && { [MARKS_KEY_VARIABLE]: KEY }),
          },
          cwd: home,
        },
      )
      return stdout + stderr
    }

    vouchesForItsCommands({
      home: () => home,
      typed,
      // bash reads what is typed through readline, which takes a control character as a key unless the one
      // before it is its quoted-insert
      literally: character => `\u0016${character}`,
      marksEveryLine: hasPs0,
    })

    it("leaves the user's own prompt command, DEBUG trap and unset-variable rule working", async () => {
      const output = await typed(
        // A prompt command ending in a separator, a trap of their own, and `set -u`
        "set -u\nPROMPT_COMMAND='history -a;'\ntrap 'THEIRS=$((${THEIRS-0}+1))' DEBUG\nPS1='$ '\n",
        ['echo hi', 'echo "theirs ran $((THEIRS > 0))"'],
      )

      expect(output).not.toMatch(/unbound variable|syntax error/)
      expect(output).toContain('theirs ran 1')
      expect(keyedMarks(output).slice(0, 2)).toEqual([start(1, 'echo hi'), finish(1, 0, home)])
      expect(boundaries(output).slice(0, 2)).toEqual(['133;C', '133;D;0'])
    })

    it("runs every command of the user's prompt command where it is an array", async ({ skip }) => {
      skip(!since(5, 1), 'a prompt command is an array from bash 5.1')
      const output = await typed(
        "set -u\nPROMPT_COMMAND=('ONE=ran' 'TWO=ran')\nPS1='$ '\n",
        ['echo "array-${ONE-}-${TWO-}"'],
      )

      expect(output).not.toMatch(/unbound variable|syntax error/)
      expect(output).toContain('array-ran-ran')
      expect(keyedMarks(output).slice(0, 2)).toEqual([start(1, 'echo "array-${ONE-}-${TWO-}"'), finish(1, 0, home)])
    })

    it("prints the user's own PS0 as well as its own, though their prompt command sets it again at every prompt", async ({ skip }) => {
      skip(!hasPs0(), 'this bash has no PS0')
      const output = await typed(
        "PROMPT_COMMAND='PS0=\"theirs-\\$((6 * 7))-\"'\nPS1='$ '\n",
        ['echo one', '(echo two)'],
      )

      expect(output.split('theirs-42-')).toHaveLength(4)
      expect(startedLines(output)).toEqual(['echo one', '(echo two)', 'exit'])
    })

    it('leaves a line that is only a subshell unmarked where bash has no PS0, and keeps its count', async ({ skip }) => {
      skip(hasPs0(), 'this bash has PS0, and marks the line')
      const output = await typed("PS1='$ '\n", ['echo before', '(echo sub)', 'echo after'])

      // Neither half of a record: a finish with no start would end a command that never began
      expect(keyedMarks(output)).toEqual([
        start(1, 'echo before'), finish(1, 0, home),
        start(2, 'echo after'), finish(2, 0, home),
        start(3, 'exit'),
      ])
    })

    it('carries a line entered twice running both times, where history keeps it once', async () => {
      const output = await typed("HISTCONTROL=ignoredups\nPS1='$ '\n", ['echo twice && echo more', 'echo twice && echo more', 'echo other'])

      expect(startedLines(output)).toEqual(['echo twice && echo more', 'echo twice && echo more', 'echo other', 'exit'])
    })

    it.each(UNKEPT)('starts a line history did not keep, %s, and never as another line', async (_, setting, lines, kept) => {
      const output = await typed(`${setting}\nPS1='$ '\n`, lines)

      expect(keyedMarks(output).map(one => `${one.mark} ${one.seq}`)).toEqual(['start 1', 'finish 1', 'start 2', 'finish 2', 'start 3', 'finish 3', 'start 4'])
      // What a start carries is its own line's: all of it, its first command, or nothing
      const carried = startedLines(output)
      for (const [at, line] of lines.entries()) expect(line, `line ${at + 1} carried ${JSON.stringify(carried[at])}`).toContain(carried[at])
      // …and a line history did keep is whole, one that follows the line it did not keep included
      expect(kept.map(at => carried[at])).toEqual(kept.map(at => lines[at]))
    })
  })
}

const ZSH = '/bin/zsh'

describe.skipIf(process.platform === 'win32' || !existsSync(ZSH))('what an integrated zsh reports', () => {
  let home: string

  beforeEach(async () => {
    home = await realpath(await mkdtemp(path.join(tmpdir(), 'apack-shell-marks-')))
  })
  afterEach(async () => {
    await rm(home, { recursive: true, force: true })
  })

  /** Starts zsh pointed at the integration directory over `zshrc`, types `lines` and answers what it printed */
  async function typed(zshrc: string, lines: string[], { keyed = true } = {}): Promise<string> {
    const directory = path.join(home, 'integration')
    const arranged = integrationFor(ZSH, directory, 'darwin', {})!
    await mkdir(directory, { recursive: true })
    for (const file of arranged.files) await writeFile(path.join(directory, file.at), file.contents)
    await writeFile(path.join(home, '.zshrc'), zshrc)
    await writeFile(path.join(home, 'typed'), [...lines, 'exit', ''].join('\n'))
    const { stdout, stderr } = await execFileWhileWorking(
      '/bin/sh',
      ['-c', '"$0" -i < "$HOME/typed" 2>&1; exit 0', ZSH],
      {
        env: {
          HOME: home, PATH: process.env.PATH ?? '', TERM: 'dumb', ...arranged.env,
          ...(keyed && arranged.keyed && { [MARKS_KEY_VARIABLE]: KEY }),
        },
        cwd: home,
      },
    )
    return stdout + stderr
  }

  vouchesForItsCommands({
    home: () => home,
    typed,
    // zsh has no line editor over input that is not a terminal, so what is typed is the line
    literally: character => character,
    marksEveryLine: () => true,
  })

  it("keeps the user's own prompt hooks, under options that make an unset or an indexed variable an error", async () => {
    const output = await typed(
      "setopt nounset ksharrays\nPS1='$ '\ntheirs_one(){ ONE=ran }\ntheirs_two(){ TWO=ran }\nprecmd_functions=(theirs_one theirs_two)\n",
      ['echo "hooks-${ONE-}-${TWO-}"'],
    )

    expect(output).not.toMatch(/parameter not set|bad substitution/)
    expect(output).toContain('hooks-ran-ran')
    expect(keyedMarks(output).slice(0, 2)).toEqual([start(1, 'echo "hooks-${ONE-}-${TWO-}"'), finish(1, 0, home)])
    expect(boundaries(output).slice(0, 2)).toEqual(['133;C', '133;D;0'])
  })

  it('starts under nounset when the user registered no hooks at all', async () => {
    const output = await typed("setopt nounset\nPS1='$ '\n", ['echo hi'])

    expect(output).not.toMatch(/parameter not set/)
    expect(keyedMarks(output).slice(0, 2)).toEqual([start(1, 'echo hi'), finish(1, 0, home)])
  })
})

describe('which hooks are given a key', () => {
  it('gives one to PowerShell, and none to cmd, whose prompt string can keep nothing to itself', () => {
    expect(integrationFor('pwsh.exe', 'C:\\data\\si', 'win32')?.keyed).toBe(true)
    expect(integrationFor('cmd.exe', 'C:\\data\\si', 'win32')?.keyed).toBe(false)
  })
})
