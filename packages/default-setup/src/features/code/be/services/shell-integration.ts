// Shell integration, arranged when the shell starts rather than typed into it afterwards — D3.
//
// **What it is for.** A terminal that knows where its shell is, what command is running and how that command
// ended can do things a dumb one cannot: follow `cd`, title a tab, tell an agent a build failed. Those facts
// come from OSC markers the shell emits, and a shell only emits them if something arranges for it to.
//
// **What was wrong with the old mechanism, which is F14 and X4.** It typed the hook into the user's
// interactive shell a moment after it started: the text echoes on their screen, it races the shell's own
// startup, it needs a branch per shell, and it had none for PowerShell or cmd — so on Windows the feature
// did nothing even when switched on. And exactly one line in this repo ever wrote the setting that turns it
// on, and that line writes `false`, so the whole subsystem had in all likelihood never run for anybody. A
// default that looks defensive was unfinished.
//
// **What replaces it** is the way every terminal emulator does this: start the shell pointing at a file. The
// file is ours, it sources the user's own configuration first so nothing of theirs is lost, and it adds the
// hook at the end. Nothing is typed, nothing echoes, and there is no race — the shell has read it before it
// draws its first prompt.
import * as path from 'path'
import { resolveAppEnvironment } from '@apackdev/sdk/env'

/** The environment variable a shell is started with when its marks are to be vouched for: the session's key */
export const MARKS_KEY_VARIABLE = 'APACK_MARKS_KEY'

// **The two marks a hook vouches for, which are what a command's record is made from.**
//
// Anything that prints can print a mark: a file shown with `cat`, a log line, a web response. So a mark
// by itself says only that some bytes were written. A session whose record is to be believed is started
// with a key in `APACK_MARKS_KEY`, and the hook puts that key on two marks of its own, OSC 633 with the
// letter `V`:
//
//     ESC ] 633 ; V ; S ; <seq> ; <key> ; <line> BEL                a command is starting
//     ESC ] 633 ; V ; F ; <seq> ; <key> ; <status> ; <cwd> BEL      that command ended
//
// `<seq>` counts the shell's commands from 1 and a finish carries the number of the start it ends, so what
// the terminal has already shown, printed again, is a number that has been used. The number and the key
// sit before anything a command line or a path could influence; that text is percent-encoded and last, so
// everything after the separator in front of it is the text, whatever it holds.
//
// **No byte of that text can end the mark or break it.** A percent sign and every control character, C0
// and DEL, goes out as a percent sign and two hexadecimal digits: a terminator would end the sequence
// early, and a CAN or a SUB abandons it, which is a command that started and left no record.
//
// **Every shell builds the two in one pair of functions**, `__apack_start` and `__apack_finish`
// (`__apackStart` and `__apackFinish` in PowerShell), and nothing else in a hook knows the layout.
//
// **The key is taken out of the environment before anything else runs.** Each hook reads it into a
// variable of its own and unsets the environment's, so no command the shell starts inherits it. That keeps
// it from what is printed, which is all it is for: a program running as the user in that shell can find
// it, since every mark the terminal has been sent carries it.
//
// **A hook that was given no key prints neither mark.** A fish started from an integrated fish reads the
// same file with the variable already gone, and what it runs is the output of the command that started it.

/**
 * What a Windows shell is told to do, as **OSC 633** — VS Code's set, which is what Phase A asks for.
 *
 * The prompt is where most of it goes, because a prompt hook is the one thing both shells have: it runs
 * after each command and before the next line is read, which is exactly the boundary the markers describe.
 * PowerShell can also be told when a line has been read, which is where a command's start is marked.
 *
 * **cmd reports no status, and says nothing rather than saying zero.** `PROMPT` has no code for the last
 * exit code, so there is no `D` marker — a caller is told the directory and the prompt boundaries and is
 * left not knowing how the last command ended, which is true. `$e` is the escape character `PROMPT`
 * understands and `$e\` is ST, which terminates an OSC string where a shell that can write BEL uses that.
 * A prompt string can neither count nor keep a key to itself, so cmd vouches for nothing.
 */
const OSC633 = {
  // `PSConsoleHostReadLine` is what PowerShell calls to read a line, so wrapping it is the one place that
  // runs between the person pressing Enter and the command starting: the start is told there, with the
  // line, and `C` after it. Without it a finish has no command to end. The status is `$?` first — a
  // cmdlet that failed sets no exit code — and the exit code only for a native program that set one
  powershell: '$Global:__apackKey = $env:' + MARKS_KEY_VARIABLE + '\r\n'
    + 'Remove-Item Env:' + MARKS_KEY_VARIABLE + ' -ErrorAction SilentlyContinue\r\n'
    + '$Global:__apackSeq = 0\r\n'
    + '$Global:__apackPrompt = $function:prompt\r\n'
    + '$Global:__apackRan = $false\r\n'
    + 'function Global:__apackEncode([string]$text) {\r\n'
    + '  [regex]::Replace($text, "[\\x00-\\x1f\\x7f%]", { param($found) "%{0:x2}" -f [int][char]$found.Value })\r\n'
    + '}\r\n'
    + 'function Global:__apackStart([string]$line) {\r\n'
    + '  if ($Global:__apackKey) { "$([char]27)]633;V;S;$($Global:__apackSeq);$($Global:__apackKey);$(__apackEncode $line)$([char]7)" } else { "" }\r\n'
    + '}\r\n'
    + 'function Global:__apackFinish($status) {\r\n'
    + '  if ($Global:__apackKey) { "$([char]27)]633;V;F;$($Global:__apackSeq);$($Global:__apackKey);$status;$(__apackEncode $PWD.Path)$([char]7)" } else { "" }\r\n'
    + '}\r\n'
    + 'function Global:prompt {\r\n'
    + '  $ok = $?\r\n'
    + '  $code = $LASTEXITCODE\r\n'
    + '  $status = if ($ok) { 0 } elseif ($code) { $code } else { 1 }\r\n'
    + '  $e = [char]27\r\n'
    + '  $bel = [char]7\r\n'
    + '  $done = if ($Global:__apackRan) { "$e]633;D;$status$bel" + (__apackFinish $status) } else { "" }\r\n'
    + '  $Global:__apackRan = $false\r\n'
    + '  $theirs = if ($Global:__apackPrompt) { & $Global:__apackPrompt } else { "PS $($PWD.Path)> " }\r\n'
    + '  $global:LASTEXITCODE = $code\r\n'
    + '  $done + "$e]633;P;Cwd=$(__apackEncode $PWD.Path)$bel" + "$e]633;A$bel" + $theirs + "$e]633;B$bel"\r\n'
    + '}\r\n'
    + 'if (Get-Command PSConsoleHostReadLine -ErrorAction SilentlyContinue) {\r\n'
    + '  $Global:__apackReadLine = $function:PSConsoleHostReadLine\r\n'
    + '  function Global:PSConsoleHostReadLine {\r\n'
    + '    $line = & $Global:__apackReadLine\r\n'
    + '    if ($line -and $line.Trim()) {\r\n'
    + '      $Global:__apackRan = $true\r\n'
    + '      $Global:__apackSeq += 1\r\n'
    + '      [Console]::Write((__apackStart $line) + "$([char]27)]633;C$([char]7)")\r\n'
    + '    }\r\n'
    + '    $line\r\n'
    + '  }\r\n'
    + '}\r\n',
  // `$P` is the directory as `PROMPT` expands it, which nothing can encode: a directory with a `%` and two
  // hex digits after it in its name is read as the character they spell
  cmd: '@echo off\r\n'
    + 'prompt $e]633;P;Cwd=$P$e\\$e]633;A$e\\$P$G$e]633;B$e\\\r\n',
}

/** The control characters a line or a directory can hold and a mark cannot, C0 and DEL, each as the two digits it is escaped with */
const CONTROLS = Array.from({ length: 33 }, (_, at) => (at === 32 ? 0x7f : at).toString(16).padStart(2, '0'))

/**
 * bash's and zsh's statements that replace each control character in the variable `s` with its escape,
 * from the character numbered `from`: 1 for a shell whose variables cannot hold a NUL
 */
const escapeControls = (from: number) => CONTROLS.slice(from).map(hex => `s=\${s//$'\\x${hex}'/%${hex}}`).join('; ')

/**
 * What a POSIX shell is told to report, as the hook each is given.
 *
 * **Four moments, a directory, and two marks it vouches for.** OSC 133 marks the moments — `A` a prompt is
 * about to be drawn, `B` it is drawn, `C` a command's output begins, `D;<status>` it ended — which is what
 * lets a terminal know which rows are a prompt, and OSC 7 says the working directory. The keyed start goes
 * out before `C` with the command line as the shell read it, and the keyed finish after `D` with the
 * status and the directory the command left the shell in.
 *
 * **The status is taken first and the prompt is marked last.** A hook that runs after anything else of the
 * user's reads *that* hook's status, so ours is put at the front of each shell's list; and a prompt a
 * theme rebuilds on every draw is one a wrapper set once would be lost from, so the marks are put back
 * around it each time, by a hook at the end.
 *
 * **The command line and the directory are percent-encoded**, which is what whoever reads them decodes: a
 * line with a control character in it would otherwise end or abandon the sequence it is carried in, and a
 * directory with a `%` in its name would be read as another. bash and zsh encode into a variable rather
 * than through a command substitution, and look for a control character before replacing any, so a
 * prompt costs no process for it and an ordinary line one pattern match.
 *
 * **bash is told a line was entered by `PS0` where it has one**, 4.4 and later: bash expands it after
 * reading a line and before running anything of it, whatever the line begins with, and never for an empty
 * one. Its arithmetic counts the command in the shell itself and its command substitution prints the
 * start. An older bash has only the `DEBUG` trap, which runs before a simple command and not before a
 * `( … )`: there a line that begins with a subshell is started when its first simple command outside one
 * runs, and one that is only a subshell is not marked at all.
 *
 * **The line is the whole line, read from history, when history can vouch for it**: the entry the prompt
 * expected was added, or none was and nothing is set that keeps a line out, where that can only mean the
 * line had been entered before (`ignoredups`, `erasedups`). A line history did not keep — a leading space
 * under `ignorespace` or `ignoreboth`, a `HISTIGNORE` match, history switched off — leaves the list as it
 * was, and under `ignoreboth` so does the last line entered again, so the last entry may then be some
 * other line's and is not used: the start carries no line from `PS0`, which runs before bash has named a
 * command, and the first simple command from the trap.
 *
 * **Nothing of the user's is replaced.** Their `PROMPT_COMMAND` runs between the two halves of ours, on
 * lines of its own so that one ending in `;` is still a command; a `DEBUG` trap their configuration set
 * goes on running after ours; and where bash-preexec is loaded — which takes the trap for itself at the
 * first prompt — the hooks are its to call. Every variable is read with a default, so a configuration
 * that turned `set -u` on has nothing to complain of.
 */
const MARKS = {
  bash: [
    '__apack_seq=0',
    '__apack_ran=',
    '__apack_at_prompt=',
    '__apack_next=0',
    '__apack_text=',
    '__apack_encoded=',
    // A bash variable cannot hold a NUL, so there is none to replace
    '__apack_encode(){ local s=${1//%/%25}; case $s in *[[:cntrl:]]*) ' + escapeControls(1) + ' ;; esac; __apack_encoded=$s; }',
    '__apack_start(){ [ -n "${__apack_key-}" ] || return 0; __apack_encode "$1"; printf "\\033]633;V;S;%s;%s;%s\\007" "${__apack_seq-}" "$__apack_key" "$__apack_encoded"; }',
    '__apack_finish(){ [ -n "${__apack_key-}" ] || return 0; __apack_encode "$PWD"; printf "\\033]633;V;F;%s;%s;%s;%s\\007" "${__apack_seq-}" "$__apack_key" "$1" "$__apack_encoded"; }',
    // The line just entered, into `__apack_text`: the last history entry where history can vouch for it,
    // and what it is given otherwise. `history` prints an entry as its number, a `*` if it was edited, and
    // the line; `__apack_next` is the number the prompt said the next entry would take. The last entry is
    // this line when it took that number. When none did, it is this line only if nothing can keep a line
    // out, since then the line was entered before and history kept the one copy; and a number past it is
    // several entries for one command, of which the last is a part
    '__apack_entered(){ __apack_text=$1; local entry number; shopt -qo history || return 0; '
      + 'entry=$(HISTTIMEFORMAT= builtin history 1); entry=${entry#"${entry%%[![:space:]]*}"}; number=${entry%%[!0-9]*}; entry=${entry#"$number"}; entry=${entry#[* ]}; entry=${entry# }; '
      + 'case $((${number:-0}-${__apack_next:-0})) in 0) ;; -*) [ -z "${HISTIGNORE-}" ] || return 0; case ":${HISTCONTROL-}:" in *:ignorespace:*|*:ignoreboth:*) return 0 ;; esac ;; *) return 0 ;; esac; '
      + '[ -n "$entry" ] && __apack_text=$entry; return 0; }',
    // What `PS0` prints. It runs in a command substitution, so the counting is `PS0`'s own arithmetic
    '__apack_started(){ __apack_entered ""; __apack_start "$__apack_text"; printf "\\033]133;C\\007"; }',
    // First at a prompt: the status is the command's, and a command is ended only if one ran
    '__apack_precmd(){ local status=$?; __apack_at_prompt=; if [ -n "${__apack_ran-}" ]; then printf "\\033]133;D;%s\\007" "$status"; __apack_finish "$status"; fi; __apack_ran=; '
      + '__apack_encode "$PWD"; printf "\\033]7;file://%s%s\\007" "${HOSTNAME:-$(hostname)}" "$__apack_encoded"; return $status; }',
    // Last at a prompt: from here the next command bash is about to run is one the user typed. What the
    // prompt strings are given goes back each time, as the prompt's marks do, and `PS0`'s after whatever
    // the user has there. With `promptvars` off bash would print them instead of expanding them, so they
    // are taken out: the trap marks the line then, and with no number from the prompt no entry is the line's
    '__apack_ready(){ __apack_at_prompt=1; __apack_next=0; case "$PS1" in *"133;A"*) ;; *) PS1="\\[\\e]133;A\\a\\]${PS1}\\[\\e]133;B\\a\\]" ;; esac; '
      + 'if shopt -q promptvars; then case "$PS1" in *__apack_next*) ;; *) PS1=$__apack_ps1$PS1 ;; esac; '
      + 'if [ -n "$__apack_ps0" ]; then case "${PS0-}" in *__apack_started*) ;; *) PS0=${PS0-}$__apack_ps0 ;; esac; fi; '
      + 'else PS1=${PS1//"$__apack_ps1"/}; if [ -n "$__apack_ps0" ]; then PS0=${PS0-}; PS0=${PS0//"$__apack_ps0"/}; fi; fi; }',
    // The DEBUG trap runs before every simple command, the prompt hooks' own included: only the first
    // after a prompt is the user's, a completion function is not a command at all, and a prompt drawn
    // again with nothing typed runs the prompt hook first — which is no command either.
    // bash-preexec passes the whole line; the trap alone has `BASH_COMMAND`, the simple command about to
    // run, which is what the start carries where history cannot say what the line was
    // …and nor is what a key bound with `bind -x` runs while the line is being edited, which is the one
    // time readline's own line is set. A line `PS0` has started is started: this then marks only what
    // bash runs without reading a line for it, the editor of `fc` among them
    '__apack_preexec(){ [ -n "${__apack_ran-}${COMP_LINE-}${READLINE_LINE+x}" ] && return; [ -z "${__apack_at_prompt-}" ] && return; __apack_at_prompt=; '
      + 'case "${1-$BASH_COMMAND}" in __apack_precmd*) return ;; esac; __apack_ran=1; __apack_seq=$((${__apack_seq:-0}+1)); '
      + 'if [ $# -gt 0 ]; then __apack_text=$1; else __apack_entered "$BASH_COMMAND"; fi; '
      + '__apack_start "$__apack_text"; printf "\\033]133;C\\007"; }',
    // A subscript's arithmetic is the one place a prompt string runs anything in the shell itself, and an
    // element that is not there expands to nothing. `PS1`'s notes the number the next history entry will
    // take, `\!`, which a prompt command cannot read; `PS0`'s takes the next number and notes that a
    // command ran, and its command substitution prints the start
    "__apack_ps1='${__apack_none[$((__apack_next = \\!, 0))]-}'",
    'if (( BASH_VERSINFO[0] > 4 || (BASH_VERSINFO[0] == 4 && BASH_VERSINFO[1] >= 4) )); then',
    "  __apack_ps0='${__apack_none[$((__apack_seq += 1, __apack_ran = 1, 0))]-}$(__apack_started)'",
    'else __apack_ps0=; fi',
    'if [ -n "${bash_preexec_imported-}${__bp_imported-}" ]; then',
    // The status first and the prompt's marks last, around whatever else is registered. Expanded this
    // way because an empty array is an unset variable to bash before 4.4
    '  precmd_functions=(__apack_precmd ${precmd_functions[@]+"${precmd_functions[@]}"} __apack_ready)',
    '  preexec_functions+=(__apack_preexec)',
    'else',
    // `trap -p` prints the trap as the command that would set it again: `trap -- '<theirs>' DEBUG`
    '  __apack_their_debug=',
    '  eval "set -- $(trap -p DEBUG)"; [ "${1-}" = trap ] && __apack_their_debug=${3-}; set --',
    '  if [ -n "$__apack_their_debug" ]; then trap \'__apack_preexec; eval "$__apack_their_debug"\' DEBUG; else trap \'__apack_preexec\' DEBUG; fi',
    // An array from bash 5.1 on where the user's configuration made it one, a string otherwise
    '  if [[ "$(declare -p PROMPT_COMMAND 2>/dev/null)" == "declare -a"* ]]; then PROMPT_COMMAND=(__apack_precmd "${PROMPT_COMMAND[@]}" __apack_ready)',
    '  else PROMPT_COMMAND=$\'__apack_precmd\\n\'"${PROMPT_COMMAND-}"$\'\\n__apack_ready\'; fi',
    'fi',
  ].join('\n'),
  zsh: [
    '__apack_seq=0',
    '__apack_ran=',
    '__apack_encoded=',
    '__apack_encode(){ local s=${1//\\%/%25}; if [[ $s == *[[:cntrl:]]* ]]; then ' + escapeControls(0) + '; fi; __apack_encoded=$s; }',
    '__apack_start(){ [[ -n ${__apack_key-} ]] || return 0; __apack_encode "$1"; printf "\\033]633;V;S;%s;%s;%s\\007" "${__apack_seq-}" "$__apack_key" "$__apack_encoded"; }',
    '__apack_finish(){ [[ -n ${__apack_key-} ]] || return 0; __apack_encode "$PWD"; printf "\\033]633;V;F;%s;%s;%s;%s\\007" "${__apack_seq-}" "$__apack_key" "$1" "$__apack_encoded"; }',
    '__apack_precmd(){ local code=$?; if [[ -n ${__apack_ran-} ]]; then printf "\\033]133;D;%s\\007" "$code"; __apack_finish "$code"; fi; __apack_ran=; '
      + '__apack_encode "$PWD"; printf "\\033]7;file://%s%s\\007" "${HOST}" "$__apack_encoded"; }',
    '__apack_prompt(){ [[ $PS1 == *"133;A"* ]] || PS1=$\'%{\\e]133;A\\a%}\'"$PS1"$\'%{\\e]133;B\\a%}\'; }',
    '__apack_preexec(){ __apack_ran=1; __apack_seq=$((${__apack_seq:-0}+1)); __apack_start "$1"; printf "\\033]133;C\\007"; }',
    // Declared first, so a shell with `nounset` has them to read, and expanded whole, so one with
    // `ksharrays` keeps every hook the user registered
    'typeset -ga precmd_functions preexec_functions',
    'precmd_functions=(__apack_precmd "${precmd_functions[@]}" __apack_prompt)',
    'preexec_functions+=(__apack_preexec)',
  ].join('\n'),
  // fish 4 marks its own prompts and commands, so only what it does not say is added there: the directory
  // and the two keyed marks, which every version is given. `string escape --style=url` is
  // percent-encoding, and leaves a path's slashes. fish reads this file before the user's `config.fish`,
  // so the key is out of the environment before that runs; neither event is raised for an empty line
  fish: [
    'set -g __apack_key "$' + MARKS_KEY_VARIABLE + '"',
    'set -eg ' + MARKS_KEY_VARIABLE,
    'set -g __apack_seq 0',
    'function __apack_start; test -n "$__apack_key"; and printf "\\033]633;V;S;%s;%s;%s\\007" $__apack_seq $__apack_key (string escape --style=url -- "$argv"); end',
    'function __apack_finish; test -n "$__apack_key"; and printf "\\033]633;V;F;%s;%s;%s;%s\\007" $__apack_seq $__apack_key $argv[1] (string escape --style=url -- $PWD); end',
    'function __apack_osc7 --on-event fish_prompt; printf "\\033]7;file://%s%s\\007" (hostname) (string escape --style=url -- $PWD); end',
    'function __apack_preexec --on-event fish_preexec; set -g __apack_seq (math $__apack_seq + 1); __apack_start $argv; end',
    'if test (string split . -- $version)[1] -lt 4',
    '  function __apack_prompt_start --on-event fish_prompt; printf "\\033]133;A\\007"; end',
    '  function __apack_output_start --on-event fish_preexec; printf "\\033]133;C\\007"; end',
    '  function __apack_done --on-event fish_postexec; printf "\\033]133;D;%s\\007" $status; end',
    'end',
    // The status is the command's only as a function begins, so it is the first thing read. fish runs
    // an event's functions in the order they were defined, so the finish follows `D` as it does in bash
    'function __apack_postexec --on-event fish_postexec; __apack_finish $status; end',
  ].join('\n'),
}

/**
 * How bash and zsh take the key, as the first line of the first file of ours each reads: before the user's
 * own configuration, so that nothing it starts inherits the key either. It is assigned once and never
 * again, which is what keeps it unexported under an `allexport` their configuration turns on later.
 */
const TAKE_KEY = '__apack_key=${' + MARKS_KEY_VARIABLE + '-}; unset ' + MARKS_KEY_VARIABLE

/** A file this feature writes, and what goes in it */
export interface IntegrationFile {
  /** Relative to the integration directory */
  at: string
  contents: string
}

/** How to start a shell so that it reports what the terminal needs */
export interface ShellIntegration {
  /** The shell's own launch arguments */
  args: string[]
  /** Added to the session's environment */
  env: Record<string, string>
  /** What has to be on disk before the shell starts */
  files: IntegrationFile[]
  /**
   * Whether the hook vouches for its marks. A shell started for one that does is given a key in
   * `MARKS_KEY_VARIABLE`, and whatever reads its marks is given the same key; one that does not is given
   * none, and what it reports stays a claim.
   */
  keyed: boolean
}

/** Where this feature keeps the files it starts shells with: inside the app's own data directory */
export function integrationDirectory(userDataDir = resolveAppEnvironment().userDataDir): string {
  return path.join(userDataDir, 'apack', 'shell-integration')
}

/**
 * How to start `shell` so that it reports where it is and what it runs, or `undefined` for a shell this
 * does not know how to arrange.
 *
 * **Windows is arranged the same way, and it is claimed on a Windows run** — 2026-11-08, on the development
 * VM: PowerShell started with these arguments emits the markers and the broker reads them back as facts
 * (`apack-terminal`'s `a_windows_shell_reports_itself_when_started_with_an_integration_file`). That is X4,
 * which was shell integration being inert there whatever the setting said.
 */
export function integrationFor(
  shell: string,
  directory: string,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): ShellIntegration | undefined {
  const name = (platform === 'win32' ? path.win32.basename(shell) : path.basename(shell)).toLowerCase()

  if (platform === 'win32') {
    // **A file, as every other shell gets, rather than the script inlined into an argument.** Both forms
    // work; one of them puts a program through argv quoting on the platform whose quoting is the reason
    // this feature had no Windows branch for so long
    if (name.startsWith('powershell') || name.startsWith('pwsh')) {
      return {
        args: ['-NoExit', '-Command', `. '${path.win32.join(directory, 'apack.ps1')}'`],
        env: {},
        files: [{ at: 'apack.ps1', contents: OSC633.powershell }],
        keyed: true,
      }
    }
    if (name.startsWith('cmd')) {
      return {
        args: ['/K', path.win32.join(directory, 'apack.cmd')],
        env: {},
        files: [{ at: 'apack.cmd', contents: OSC633.cmd }],
        keyed: false,
      }
    }
    // bash.exe and wsl.exe reach a POSIX shell through a Windows launcher, and what they need there is not
    // what the branches below write for a shell this process can see
    return undefined
  }

  if (name.includes('bash')) {
    const file = path.join(directory, 'apack.bash')
    return {
      // `--init-file` *replaces* the user's own startup file rather than adding to it, which is why ours
      // sources theirs first: without that line an integrated shell is one with no configuration
      args: ['--init-file', file],
      env: {},
      files: [{
        at: 'apack.bash',
        contents: `# Written by apack. Sources your own configuration first, then reports where it is and what it runs.\n`
          + `${TAKE_KEY}\n[ -f "$HOME/.bashrc" ] && . "$HOME/.bashrc"\n${MARKS.bash}\n`,
      }],
      keyed: true,
    }
  }

  if (name.includes('zsh')) {
    // zsh reads its startup files from `ZDOTDIR`, so ours points there and hands the variable back: a shell
    // the user starts *from* this one must find their own files, not ours
    // Inside double quotes in the files below: the literal `$HOME` is left to expand, and a path the user
    // set has the four characters double quotes still read escaped
    const theirs = env.ZDOTDIR === undefined ? '$HOME' : env.ZDOTDIR.replace(/[\\"$`]/g, '\\$&')
    return {
      args: [],
      env: { ZDOTDIR: directory },
      files: [{
        // **`.zshenv` is written as well as `.zshrc`, because zsh reads it from `ZDOTDIR` too — first, and
        // for every shell.** With the variable pointed here and no file of ours in its place, the user's own
        // `.zshenv` was simply skipped: an integrated terminal lost whatever they set there, which is where
        // `PATH` and version managers usually go, and only in this app. It also honours a `ZDOTDIR` their
        // own `.zshenv` sets, which is how a dotfile manager redirects zsh: that value is what `.zshrc`
        // below then sources, and `ZDOTDIR` is put back to ours so this file's own `.zshrc` is still read.
        at: '.zshenv',
        contents: `# Written by apack. zsh reads .zshenv from ZDOTDIR, so without this one yours is skipped.\n`
          // Quoted, because this is either a path the user set or the literal `$HOME`: double quotes expand
          // the second and keep the first whole, where unquoted a directory with a space in it split and
          // zsh ran the tail as a command
          + `${TAKE_KEY}\n__apack_zdotdir="$ZDOTDIR"\nZDOTDIR="${theirs}"\n`
          + `[ -f "\${ZDOTDIR}/.zshenv" ] && . "\${ZDOTDIR}/.zshenv"\n`
          + `APACK_USER_ZDOTDIR="$ZDOTDIR"\nZDOTDIR="$__apack_zdotdir"\nunset __apack_zdotdir\n`,
      }, {
        at: '.zshrc',
        contents: `# Written by apack. Sources your own configuration first, then reports where it is and what it runs.\n`
          + `ZDOTDIR="\${APACK_USER_ZDOTDIR:-${theirs}}"\nunset APACK_USER_ZDOTDIR\n`
          + `[ -f "\${ZDOTDIR}/.zshrc" ] && . "\${ZDOTDIR}/.zshrc"\n${MARKS.zsh}\n`,
      }],
      keyed: true,
    }
  }

  if (name.includes('fish')) {
    // fish reads `vendor_conf.d` out of every `XDG_DATA_DIRS` entry, which is additive by design — so this
    // is the one shell that needs nothing of the user's sourced back
    const existing = env.XDG_DATA_DIRS ?? '/usr/local/share:/usr/share'
    return {
      args: [],
      env: { XDG_DATA_DIRS: `${directory}:${existing}` },
      files: [{
        at: path.join('fish', 'vendor_conf.d', 'apack.fish'),
        contents: `# Written by apack. Reports where it is and what it runs.\n${MARKS.fish}\n`,
      }],
      keyed: true,
    }
  }

  return undefined
}
