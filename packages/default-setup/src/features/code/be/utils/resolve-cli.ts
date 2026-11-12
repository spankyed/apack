import { featureSettings } from '#generated/settings.ts';
// Finds the CLIs the code feature runs (Claude Code, Codex, Copilot, gh, git): a path the user set in the code
// surface's settings (`cliPaths`), known install locations, then PATH.

import { execFileWhileWorking } from '@apackdev/sdk/progress'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'


export type CliName = 'copilot' | 'claude-code' | 'codex' | 'gh' | 'git'

const HOME = os.homedir()

const FALLBACK_PATHS: Record<CliName, string[]> = process.platform === 'win32'
  ? (() => {
      const appData = process.env.APPDATA || path.join(HOME, 'AppData', 'Roaming')
      const localAppData = process.env.LOCALAPPDATA || path.join(HOME, 'AppData', 'Local')
      return {
        copilot: [path.join(appData, 'npm', 'copilot.cmd')],
        'claude-code': [
          path.join(HOME, '.local', 'bin', 'claude.exe'),
          path.join(localAppData, 'Programs', 'claude-code', 'claude.exe'),
          path.join(appData, 'npm', 'claude.cmd'),
        ],
        codex: [path.join(appData, 'npm', 'codex.cmd')],
        gh: [
          path.join(process.env.ProgramFiles || 'C:\\Program Files', 'GitHub CLI', 'gh.exe'),
          path.join(localAppData, 'Programs', 'gh', 'gh.exe'),
        ],
        // Where Git for Windows installs, for each kind of Program Files, then for the user alone
        git: [
          ...[process.env.ProgramW6432, process.env['ProgramFiles(x86)'], process.env.ProgramFiles]
            .filter((root): root is string => !!root).map(root => path.join(root, 'Git', 'cmd', 'git.exe')),
          path.join(localAppData, 'Programs', 'Git', 'cmd', 'git.exe'),
        ],
      }
    })()
  : {
      copilot: ['/usr/local/bin/copilot', `${HOME}/.nvm/versions/node/*/bin/copilot`],
      'claude-code': [
        `${HOME}/.claude/local/claude`, `${HOME}/.local/bin/claude`,
        '/opt/homebrew/bin/claude', '/usr/local/bin/claude',
        `${HOME}/.nvm/versions/node/*/bin/claude`,
      ],
      codex: ['/usr/local/bin/codex', `${HOME}/.nvm/versions/node/*/bin/codex`],
      gh: ['/opt/homebrew/bin/gh', '/usr/local/bin/gh'],
      // An installed git ahead of the system's: on macOS `/usr/bin/git` stands for the developer tools until they
      // are installed, which the engine asks before it runs it, and only by that path
      git: ['/opt/homebrew/bin/git', '/usr/local/bin/git', '/usr/bin/git'],
    }

const resolvedCache = new Map<string, string>()

const CLI_COMMANDS: Record<CliName, string> = {
  copilot: 'copilot',
  'claude-code': 'claude',
  codex: 'codex',
  gh: 'gh',
  git: 'git',
}

/**
 * Expand nvm glob patterns (e.g. ~/.nvm/versions/node/* /bin/copilot)
 * into actual paths sorted by version descending (newest first).
 */
function expandGlobPaths(pattern: string): string[] {
  if (!pattern.includes('*')) return [pattern]

  // Split on the glob segment to find the parent directory and the suffix.
  // e.g. ~/.nvm/versions/node/*/bin/codex → dir=~/.nvm/versions/node, suffix=['bin','codex']
  const parts = pattern.split(path.sep)
  const globIndex = parts.findIndex(p => p.includes('*'))
  if (globIndex < 0) return [pattern]

  const dir = parts.slice(0, globIndex).join(path.sep)
  const suffix = parts.slice(globIndex + 1)

  try {
    const entries = fs.readdirSync(dir)
    return entries
      .filter(e => e.startsWith('v'))
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
      .map(version => path.join(dir, version, ...suffix))
  } catch {
    return []
  }
}

/**
 * Check if a command is executable.
 * Absolute paths: fs.accessSync with X_OK.
 * Bare commands: try running with --version.
 */
async function isExecutable(cmd: string): Promise<boolean> {
  if (path.isAbsolute(cmd)) {
    try {
      fs.accessSync(cmd, fs.constants.X_OK)
      return true
    } catch {
      return false
    }
  }

  try {
    // `timeout` is CPU: a `--version` that is slow only because the machine is busy still answers
    await execFileWhileWorking(cmd, ['--version'], { timeout: 2000 })
    return true
  } catch {
    return false
  }
}

/**
 * Resolve a CLI binary path with fallbacks.
 *
 * 1. If preferred path is absolute, check it exists (fast fs check)
 * 2. Try known fallback locations on disk (fast fs checks)
 * 3. If preferred path is a bare command, try executing it (slow, last resort)
 * 4. Return CLI name if nothing found (caller gets standard ENOENT)
 */
export async function resolveCliPath(
  cli: CliName,
  preferredPath?: string,
): Promise<string> {
  const effective = preferredPath?.trim() || undefined
  const cacheKey = `${cli}:${effective ?? ''}`
  const cached = resolvedCache.get(cacheKey)
  if (cached) return cached

  // 1. Fast check: absolute preferred path
  if (effective && path.isAbsolute(effective)) {
    if (await isExecutable(effective)) {
      resolvedCache.set(cacheKey, effective)
      return effective
    }
  }

  // 2. Fast check: known fallback locations (filesystem only)
  const fallbacks = FALLBACK_PATHS[cli] ?? []
  for (const pattern of fallbacks) {
    for (const candidate of expandGlobPaths(pattern)) {
      if (fs.existsSync(candidate)) {
        resolvedCache.set(cacheKey, candidate)
        return candidate
      }
    }
  }

  // 3. Slow check: bare command via PATH (`--version`, at most 2s of CPU)
  const bareCmd = effective && !path.isAbsolute(effective) ? effective : CLI_COMMANDS[cli]
  if (await isExecutable(bareCmd)) {
    resolvedCache.set(cacheKey, bareCmd)
    return bareCmd
  }

  // 4. Nothing found — return the provider command so caller gets a recognizable ENOENT
  const fallbackCommand = CLI_COMMANDS[cli]
  resolvedCache.set(cacheKey, fallbackCommand)
  return fallbackCommand
}

/** Clear the resolution cache (e.g. when CLI paths are updated in settings). */
export function clearCliPathCache(): void {
  resolvedCache.clear()
}

const CLI_NAMES: Set<string> = new Set<string>(['copilot', 'claude-code', 'codex', 'gh', 'git'])

export function isCliName(value: string): value is CliName {
  return CLI_NAMES.has(value)
}

/** Resolve and test a CLI binary. Clears cache first so it always probes fresh. */
export async function testCli(
  cli: CliName,
  storedPath?: string,
): Promise<{ success: true; resolvedPath: string } | { success: false; error: string }> {
  clearCliPathCache()
  try {
    const resolved = await resolveCliPath(cli, storedPath)
    await execFileWhileWorking(resolved, ['--version'], { timeout: 10000 })
    return { success: true, resolvedPath: resolved }
  } catch (err: any) {
    return { success: false, error: err.message || 'Command failed' }
  }
}

/**
 * The git a repository is opened with: the path the user set, the first known install location that exists, or
 * `git` from the PATH. Nothing is run to find it, since whether it can be used is the engine's to ask, once,
 * before its first command; a path set and not there is handed in as it is, so the engine says it is not there.
 */
export function resolveGitPath(storedPath = featureSettings.forFeature('code').get()?.cliPaths?.git): string {
  const preferred = storedPath?.trim()
  if (preferred) return preferred
  for (const candidate of FALLBACK_PATHS.git) if (fs.existsSync(candidate)) return candidate
  return CLI_COMMANDS.git
}

/** Convenience: read stored path from settings and resolve. Used by CLI service modules. */
export async function resolveForService(cli: CliName): Promise<string> {
  const storedPath = featureSettings.forFeature('code').get()?.cliPaths?.[cli]
  return resolveCliPath(cli, storedPath)
}
