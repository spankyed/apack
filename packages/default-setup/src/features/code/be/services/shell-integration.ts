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
 */
const OSC633 = {
  // `PSConsoleHostReadLine` is what PowerShell calls to read a line, so wrapping it is the one place that
  // runs between the person pressing Enter and the command starting: the line is told there, and `C` after
  // it. Without that mark a `D` has no command to end. The status is `$?` first — a cmdlet that failed
  // sets no exit code — and the exit code only for a native program that set one
  powershell: '$Global:__apackPrompt = $function:prompt\r\n'
    + '$Global:__apackRan = $false\r\n'
    + 'function Global:__apackEncode([string]$text) {\r\n'
    + '  $text.Replace("%", "%25").Replace("`n", "%0a").Replace("`r", "%0d").Replace([string][char]27, "%1b").Replace([string][char]7, "%07")\r\n'
    + '}\r\n'
    + 'function Global:prompt {\r\n'
    + '  $ok = $?\r\n'
    + '  $code = $LASTEXITCODE\r\n'
    + '  $status = if ($ok) { 0 } elseif ($code) { $code } else { 1 }\r\n'
    + '  $e = [char]27\r\n'
    + '  $bel = [char]7\r\n'
    + '  $done = if ($Global:__apackRan) { "$e]633;D;$status$bel" } else { "" }\r\n'
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
    + '      [Console]::Write("$([char]27)]633;E;$(__apackEncode $line)$([char]7)$([char]27)]633;C$([char]7)")\r\n'
    + '    }\r\n'
    + '    $line\r\n'
    + '  }\r\n'
    + '}\r\n',
  // `$P` is the directory as `PROMPT` expands it, which nothing can encode: a directory with a `%` and two
  // hex digits after it in its name is read as the character they spell
  cmd: '@echo off\r\n'
    + 'prompt $e]633;P;Cwd=$P$e\\$e]633;A$e\\$P$G$e]633;B$e\\\r\n',
}

/**
 * What a POSIX shell is told to report, as the hook each is given.
 *
 * **Four moments and two facts.** OSC 133 marks the moments — `A` a prompt is about to be drawn, `B` it is
 * drawn, `C` a command's output begins, `D;<status>` it ended — which is what lets a terminal know where
 * one command stops and the next begins: jump between them, read one's output, say how it ended. OSC
 * 633's `E` carries the command line as the shell read it, and OSC 7 the working directory.
 *
 * **The status is taken first and the prompt is marked last.** A hook that runs after anything else of the
 * user's reads *that* hook's status, so ours is put at the front of each shell's list; and a prompt a
 * theme rebuilds on every draw is one a wrapper set once would be lost from, so the marks are put back
 * around it each time, by a hook at the end.
 *
 * **The command line and the directory are percent-encoded**, which is what whoever reads them decodes: a
 * line with an escape or a newline in it would otherwise end the sequence it is carried in, and a
 * directory with a `%` in its name would be read as another.
 *
 * **Nothing of the user's is replaced.** Their `PROMPT_COMMAND` runs between the two halves of ours, on
 * lines of its own so that one ending in `;` is still a command; a `DEBUG` trap their configuration set
 * goes on running after ours; and where bash-preexec is loaded — which takes the trap for itself at the
 * first prompt — the hooks are its to call. Every variable is read with a default, so a configuration
 * that turned `set -u` on has nothing to complain of.
 */
const MARKS = {
  bash: [
    '__apack_ran=',
    '__apack_at_prompt=',
    '__apack_encode(){ local line=${1//%/%25}; line=${line//$\'\\n\'/%0a}; line=${line//$\'\\e\'/%1b}; line=${line//$\'\\a\'/%07}; printf %s "$line"; }',
    // First at a prompt: the status is the command's, and `D` is sent only for a command that ran
    '__apack_precmd(){ local status=$?; __apack_at_prompt=; if [ -n "${__apack_ran-}" ]; then printf "\\033]133;D;%s\\007" "$status"; fi; __apack_ran=; '
      + 'printf "\\033]7;file://%s%s\\007" "${HOSTNAME:-$(hostname)}" "$(__apack_encode "$PWD")"; return $status; }',
    // Last at a prompt: from here the next command bash is about to run is one the user typed
    '__apack_ready(){ __apack_at_prompt=1; case "$PS1" in *"133;A"*) ;; *) PS1="\\[\\e]133;A\\a\\]${PS1}\\[\\e]133;B\\a\\]" ;; esac; }',
    // The DEBUG trap runs before every simple command, the prompt hooks' own included: only the first
    // after a prompt is the user's, a completion function is not a command at all, and a prompt drawn
    // again with nothing typed runs the prompt hook first — which is no command either.
    // `BASH_COMMAND` is the simple command about to run, so a line of several is told as its first;
    // bash-preexec passes the whole line instead
    // …and nor is what a key bound with `bind -x` runs while the line is being edited, which is the one
    // time readline's own line is set
    '__apack_preexec(){ [ -n "${COMP_LINE-}${READLINE_LINE+x}" ] && return; [ -z "${__apack_at_prompt-}" ] && return; __apack_at_prompt=; '
      + 'case "${1-$BASH_COMMAND}" in __apack_precmd*) return ;; esac; __apack_ran=1; '
      + 'printf "\\033]633;E;%s\\007\\033]133;C\\007" "$(__apack_encode "${1-$BASH_COMMAND}")"; }',
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
    '__apack_ran=',
    '__apack_encode(){ local line=${1//\\%/%25}; line=${line//$\'\\n\'/%0a}; line=${line//$\'\\e\'/%1b}; line=${line//$\'\\a\'/%07}; print -rn -- "$line"; }',
    '__apack_precmd(){ local code=$?; if [[ -n ${__apack_ran-} ]]; then printf "\\033]133;D;%s\\007" "$code"; fi; __apack_ran=; '
      + 'printf "\\033]7;file://%s%s\\007" "${HOST}" "$(__apack_encode "$PWD")"; }',
    '__apack_prompt(){ [[ $PS1 == *"133;A"* ]] || PS1=$\'%{\\e]133;A\\a%}\'"$PS1"$\'%{\\e]133;B\\a%}\'; }',
    '__apack_preexec(){ __apack_ran=1; printf "\\033]633;E;%s\\007\\033]133;C\\007" "$(__apack_encode "$1")"; }',
    // Declared first, so a shell with `nounset` has them to read, and expanded whole, so one with
    // `ksharrays` keeps every hook the user registered
    'typeset -ga precmd_functions preexec_functions',
    'precmd_functions=(__apack_precmd "${precmd_functions[@]}" __apack_prompt)',
    'preexec_functions+=(__apack_preexec)',
  ].join('\n'),
  // fish 4 marks its own prompts and commands, so only what it does not say is added there: the command
  // line and the directory. `string escape --style=url` is percent-encoding, and leaves a path's slashes
  fish: [
    'function __apack_osc7 --on-event fish_prompt; printf "\\033]7;file://%s%s\\007" (hostname) (string escape --style=url -- $PWD); end',
    'function __apack_line --on-event fish_preexec; printf "\\033]633;E;%s\\007" (string escape --style=url -- "$argv"); end',
    'if test (string split . -- $version)[1] -lt 4',
    '  function __apack_prompt_start --on-event fish_prompt; printf "\\033]133;A\\007"; end',
    '  function __apack_output_start --on-event fish_preexec; printf "\\033]133;C\\007"; end',
    '  function __apack_done --on-event fish_postexec; printf "\\033]133;D;%s\\007" $status; end',
    'end',
  ].join('\n'),
}

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
      }
    }
    if (name.startsWith('cmd')) {
      return {
        args: ['/K', path.win32.join(directory, 'apack.cmd')],
        env: {},
        files: [{ at: 'apack.cmd', contents: OSC633.cmd }],
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
          + `[ -f "$HOME/.bashrc" ] && . "$HOME/.bashrc"\n${MARKS.bash}\n`,
      }],
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
          + `__apack_zdotdir="$ZDOTDIR"\nZDOTDIR="${theirs}"\n`
          + `[ -f "\${ZDOTDIR}/.zshenv" ] && . "\${ZDOTDIR}/.zshenv"\n`
          + `APACK_USER_ZDOTDIR="$ZDOTDIR"\nZDOTDIR="$__apack_zdotdir"\nunset __apack_zdotdir\n`,
      }, {
        at: '.zshrc',
        contents: `# Written by apack. Sources your own configuration first, then reports where it is and what it runs.\n`
          + `ZDOTDIR="\${APACK_USER_ZDOTDIR:-${theirs}}"\nunset APACK_USER_ZDOTDIR\n`
          + `[ -f "\${ZDOTDIR}/.zshrc" ] && . "\${ZDOTDIR}/.zshrc"\n${MARKS.zsh}\n`,
      }],
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
    }
  }

  return undefined
}
