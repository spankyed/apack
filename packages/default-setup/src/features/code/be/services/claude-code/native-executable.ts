import {access, realpath, stat} from 'node:fs/promises'
import {constants} from 'node:fs'
import {resolve, delimiter} from 'node:path'

// Match the parent's actual spawn environment; a PATH-selected CLI is not relative to this module.
export async function resolveClaudeExecutable(executable: string, cwd: string, searchPath: string | undefined) {
  const candidates = executable.includes('/') ? [resolve(cwd, executable)]
    : (searchPath ?? '/usr/bin:/bin').split(delimiter).map(directory => resolve(cwd, directory, executable))
  for (const candidate of candidates) {
    try {
      if (!(await stat(candidate)).isFile()) continue
      await access(candidate, constants.X_OK)
      return await realpath(candidate)
    } catch (error) {
      if (!['ENOENT', 'ENOTDIR', 'EACCES'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error
    }
  }
  throw new Error('The selected Claude executable is unavailable in the launch directory and PATH')
}

