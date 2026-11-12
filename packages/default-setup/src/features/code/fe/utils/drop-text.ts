// The text a drop of files inserts into a terminal: each path quoted as one argument for the shell the
// terminal runs, separated by single spaces, with no newline, so nothing runs until the person presses Enter.
//
// **Which shells, and why these.** The terminal starts the shell its row names (`known-shells.ts`). A
// window knows that name from `TerminalInfo.shell` and nothing else, so the quoting follows the family of
// that name:
//
// - `posix`: sh, bash, zsh and fish (and Git Bash's `bash.exe`). A single-quoted word is literal in all of
//   them except for its own quote, which closes the word; `'\''` is how a quote is written inside one, and
//   fish reads that sequence the same way.
// - `powershell`: powershell.exe and pwsh.exe. A single-quoted string is literal, and a quote is written by
//   doubling it.
//
// Every other shell (`cmd.exe`, `wsl.exe`, nushell, tcsh) has a quoting this file does not implement, so a
// drop on it is refused by `dropShellOf` returning `undefined` rather than guessed at.

/** The quoting families a drop can be written for */
export type DropShell = 'posix' | 'powershell'

/** The family of a shell's name, or `undefined` when no drop can be quoted for it */
export function dropShellOf(shell: string | undefined): DropShell | undefined {
  if (shell === undefined) return undefined
  // The basename, whichever separator the path was written with: a Windows path arrives in a window that is
  // not running Windows as readily as the reverse
  const name = (shell.trim().split(/[\\/]/).pop() ?? '').toLowerCase()
  if (['sh', 'bash', 'bash.exe', 'zsh', 'fish'].includes(name)) return 'posix'
  if (['powershell', 'powershell.exe', 'pwsh', 'pwsh.exe'].includes(name)) return 'powershell'
  return undefined
}

/** The quote characters PowerShell reads as a single quote, its typographic ones included */
const POWERSHELL_TYPOGRAPHIC_QUOTES = /[‘’‚‛]/

/**
 * The text that inserts `paths` into a `shell` as separate arguments, or `undefined` when a path cannot be
 * quoted for it. An empty list is the empty string.
 *
 * `undefined` is refused, not guessed: PowerShell reads four typographic quotes as single quotes and has no
 * escape for them inside a single-quoted string, so a path holding one would end its argument early.
 */
export function dropText(paths: readonly string[], shell: DropShell): string | undefined {
  if (shell === 'powershell') {
    if (paths.some((path) => POWERSHELL_TYPOGRAPHIC_QUOTES.test(path))) return undefined
    return paths.map((path) => `'${path.replace(/'/g, "''")}'`).join(' ')
  }
  return paths.map((path) => `'${path.replace(/'/g, `'\\''`)}'`).join(' ')
}
