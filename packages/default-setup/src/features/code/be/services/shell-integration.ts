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
 * **Windows answers `undefined` deliberately.** PowerShell takes `-NoExit -Command` and cmd takes `/K`, and
 * both would work the same way — but this goal says a Windows claim is made on a Windows run or not at all,
 * and the run that proved the broker there happened before this existed. Writing the flags here unverified
 * would be claiming **X4** closed on the strength of a plausible argument, which is the thing the rule is
 * against. X4 stays open and this returns nothing there, so a Windows terminal is exactly as it was.
 */
export function integrationFor(
  shell: string,
  directory: string,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): ShellIntegration | undefined {
  if (platform === 'win32') return undefined
  const name = path.basename(shell).toLowerCase()

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
