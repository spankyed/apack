// Which shells this machine will start, and why that is a question with a derived answer.
//
// **F13: the list that was here could not refuse anything.** It was eleven hardcoded paths, and a shell it
// rejected fell back to `defaultShell` — which is `$SHELL`, the same value that had just failed it on any
// machine whose login shell is not one of the eleven. So the check ran and changed nothing, which is the
// worst of both: a reader sees a guard, and there is none.
//
// **S3 is what makes that matter.** A restored terminal spawns the `shell` its row holds, and a row is data:
// the database console writes one, `apack db exec` writes one, and a backup import replaces the whole store
// with no row-level validation. "Import a backup someone sent you" is enough to turn a stored string into an
// executable at the next boot. So a shell that arrives as data has to be checked against something that is
// not itself.
//
// **The answer the system already has is `/etc/shells`.** It is what `chsh` validates against, so it covers
// fish, nushell and a Homebrew bash without anyone enumerating them, and it moves when the user installs a
// shell rather than when this file is edited. Beside it, the user's own `$SHELL`, which is theirs by
// definition and is what an unconfigured terminal starts.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/** Where POSIX records the shells a user may be given. Windows has no equivalent, and no `$SHELL` either. */
const ETC_SHELLS = '/etc/shells';

/**
 * The shells Windows has a name for, each one resolved before it counts.
 *
 * **Measured on a stock Windows Server 2025 image, 2026-11-07**: `powershell.exe` and `cmd.exe` are in
 * System32, `wsl.exe` is there too, and `pwsh.exe` and `bash.exe` are absent — PowerShell 7 and Git Bash are
 * separate installs. So the list that was here named two of five and silently replaced `pwsh.exe` with
 * PowerShell 5.1, which is X12.
 *
 * It is a list of **names**, not paths, and a name only counts once the machine resolves it — which is what
 * keeps this the same kind of answer as `/etc/shells`: what this machine will start, rather than what
 * somebody typed into this file. A path whose basename is one of these but which resolves somewhere else is
 * refused, since `C:\evil\cmd.exe` is exactly the stored string S3 is about.
 */
const WINDOWS_SHELLS = ['powershell.exe', 'pwsh.exe', 'cmd.exe', 'bash.exe', 'wsl.exe'];

/** Where this machine's `PATH` finds `name`, or `undefined` */
function resolvedOnPath(name: string, env: NodeJS.ProcessEnv): string | undefined {
  const dirs = (env.PATH ?? env.Path ?? '').split(path.win32.delimiter).filter(Boolean);
  for (const dir of dirs) {
    const candidate = path.win32.join(dir, name);
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch { /* not here */ }
  }
  return undefined;
}

/**
 * The shell an unconfigured terminal starts: the user's own.
 *
 * Not validated against anything, because there is nothing above it to validate against — it is the login
 * shell the OS gave them, and a terminal that refused it would be refusing the user's own machine.
 */
export function defaultShell(platform: NodeJS.Platform = process.platform, env = process.env): string {
  if (platform === 'win32') return 'powershell.exe';
  return env.SHELL || '/bin/sh';
}

/** Every shell `/etc/shells` lists, ignoring comments and blank lines. Empty when there is no such file. */
export function listedShells(file = ETC_SHELLS): string[] {
  let text: string;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return []; }
  return text.split('\n')
    .map((line) => line.replace(/#.*$/, '').trim())
    .filter((line) => line.length > 0);
}

/** Whether `shell` is one this machine will start */
export function shellIsKnown(shell: string, options: {
  platform?: NodeJS.Platform; env?: NodeJS.ProcessEnv; listed?: readonly string[];
  /** Where this machine finds a shell by name; the real one walks `PATH` */
  resolve?: (name: string) => string | undefined;
} = {}): boolean {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const candidate = shell.trim();
  if (candidate.length === 0) return false;
  if (candidate === defaultShell(platform, env)) return true;
  if (platform === 'win32') {
    // **`path.win32`, not `path`**: a Windows path read on a Mac has no separators as far as `node:path` is
    // concerned, so its basename is the whole string — which is X7 and X8's mistake made again, here where
    // it would have meant refusing every shell named by its full path
    const name = path.win32.basename(candidate).toLowerCase();
    if (!WINDOWS_SHELLS.includes(name)) return false;
    const resolve = options.resolve ?? ((one: string) => resolvedOnPath(one, env));
    const found = resolve(name);
    if (found === undefined) return false;
    // A bare name is what the machine resolved; a full path has to *be* it, or `C:\\evil\\cmd.exe` passes
    return candidate === name || candidate.toLowerCase() === found.toLowerCase();
  }
  const listed = options.listed ?? listedShells();
  return listed.includes(candidate);
}

/**
 * `shell` if this machine will start it, and the user's own shell if it will not.
 *
 * **The fallback is a different value from the one refused**, which is the whole of F13: returning the
 * rejected value is a check that cannot change an outcome.
 */
export function shellToStart(shell: string | undefined, options: {
  platform?: NodeJS.Platform; env?: NodeJS.ProcessEnv; listed?: readonly string[];
  resolve?: (name: string) => string | undefined;
} = {}): { shell: string; refused?: string } {
  const fallback = defaultShell(options.platform ?? process.platform, options.env ?? process.env);
  if (shell === undefined || shell.trim().length === 0) return { shell: fallback };
  if (shellIsKnown(shell, options)) return { shell: shell.trim() };
  return { shell: fallback, refused: shell };
}

/**
 * `cwd` if it is a directory this user can reach, and their home directory if it is not.
 *
 * The same shape and the same reason: a restored terminal's `cwd` is a stored string, and a directory that
 * is gone, or was never one, is not somewhere to start a shell.
 */
export function directoryToStart(cwd: string | undefined): { cwd: string; refused?: string } {
  const home = os.homedir();
  if (!cwd || cwd.trim().length === 0) return { cwd: home };
  try {
    if (fs.statSync(cwd).isDirectory()) return { cwd };
  } catch { /* gone, or not reachable */ }
  return { cwd: home, refused: cwd };
}

/**
 * What ends a typed line for a shell on `platform` — X6.
 *
 * **Measured on Windows, 2026-11-07**, through a real ConPTY: `\n` is echoed and never runs, `\r` alone
 * does not get that far, and `\r\n` both echoes and runs. A POSIX pty's line discipline takes `\n`.
 *
 * It belongs to the session rather than to the window, which is why it is computed here and carried on the
 * descriptor: a window has no idea which shell is on the other end.
 */
export function submitFor(shell?: string, platform: NodeJS.Platform = process.platform): string {
  if (platform !== 'win32') return '\n';
  // **PowerShell takes a bare carriage return, and `\r\n` is wrong for it** — measured on Windows,
  // 2026-11-08. The trailing newline opens its continuation prompt: the line is taken, the parser then
  // waits for more, and the command never runs. The screen shows `>>` and nothing else, which reads like
  // the terminal having ignored the keystroke.
  const name = path.win32.basename(shell ?? '').toLowerCase();
  return name.startsWith('powershell') || name.startsWith('pwsh') ? '\r' : '\r\n';
}
