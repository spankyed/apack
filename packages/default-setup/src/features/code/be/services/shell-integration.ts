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
 * The prompt is where all of it goes, because a prompt hook is the one thing both shells have: it runs
 * after each command and before the next line is read, which is exactly the boundary the markers describe.
 *
 * **cmd reports no status, and says nothing rather than saying zero.** `PROMPT` has no code for the last
 * exit code, so there is no `D` marker — a caller is told the directory and the prompt boundaries and is
 * left not knowing how the last command ended, which is true. `$e` is the escape character `PROMPT`
 * understands and `$e\` is ST, which terminates an OSC string where a shell that can write BEL uses that.
 */
const OSC633 = {
  powershell: '$Global:__apackPrompt = $function:prompt\r\n'
    + 'function Global:prompt {\r\n'
    + '  $status = $LASTEXITCODE\r\n'
    + '  if ($null -eq $status) { $status = 0 }\r\n'
    + '  $e = [char]27\r\n'
    + '  $bel = [char]7\r\n'
    + '  $theirs = if ($Global:__apackPrompt) { & $Global:__apackPrompt } else { "PS $($PWD.Path)> " }\r\n'
    + '  "$e]633;D;$status$bel" + "$e]633;P;Cwd=$($PWD.Path)$bel" + "$e]633;A$bel" + $theirs + "$e]633;B$bel"\r\n'
    + '}\r\n',
  cmd: '@echo off\r\n'
    + 'prompt $e]633;P;Cwd=$P$e\\$e]633;A$e\\$P$G$e]633;B$e\\\r\n',
}

/** The marker the app reads a working directory from, which is what OSC 7 is for */
const OSC7 = {
  bash: '__apack_osc7(){ printf "\\033]7;file://%s%s\\007" "${HOSTNAME:-$(hostname)}" "$PWD"; }; '
    + 'PROMPT_COMMAND="__apack_osc7${PROMPT_COMMAND:+;$PROMPT_COMMAND}"',
  zsh: '__apack_osc7(){ printf "\\033]7;file://%s%s\\007" "${HOST}" "$PWD"; }; precmd_functions+=(__apack_osc7)',
  fish: 'function __apack_osc7 --on-event fish_prompt; printf "\\033]7;file://%s%s\\007" (hostname) $PWD; end',
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
 * How to start `shell` so that it reports its working directory, or `undefined` for a shell this does not
 * know how to arrange.
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
        contents: `# Written by apack. Sources your own configuration first, then reports the working directory.\n`
          + `[ -f "$HOME/.bashrc" ] && . "$HOME/.bashrc"\n${OSC7.bash}\n`,
      }],
    }
  }

  if (name.includes('zsh')) {
    // zsh reads its startup files from `ZDOTDIR`, so ours points there and hands the variable back: a shell
    // the user starts *from* this one must find their own files, not ours
    const theirs = env.ZDOTDIR ?? '$HOME'
    return {
      args: [],
      env: { ZDOTDIR: directory },
      files: [{
        at: '.zshrc',
        contents: `# Written by apack. Sources your own configuration first, then reports the working directory.\n`
          + `ZDOTDIR=${theirs}\n[ -f "\${ZDOTDIR}/.zshrc" ] && . "\${ZDOTDIR}/.zshrc"\n${OSC7.zsh}\n`,
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
        contents: `# Written by apack. Reports the working directory.\n${OSC7.fish}\n`,
      }],
    }
  }

  return undefined
}
