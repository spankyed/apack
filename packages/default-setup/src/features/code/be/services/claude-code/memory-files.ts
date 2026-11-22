import { mkdir, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute } from 'node:path'
import type { ClaudeMemoryDialog } from './host-controls.ts'

export type ClaudeMemoryFileAction = { kind: 'createInstruction' | 'openFolder'; path: string }

/** Resolve a click against the original catalog before preparing its local filesystem target. */
export async function prepareClaudeMemoryPath(dialog: ClaudeMemoryDialog, action: ClaudeMemoryFileAction, current: () => void): Promise<string> {
  const { kind, path } = action
  if (!isAbsolute(path)) throw new Error('Claude memory path is no longer available')
  if (kind === 'openFolder') {
    if (!dialog.folders.some(folder => folder.path === path)) throw new Error('Claude memory folder is no longer available')
    current()
    await mkdir(path, { recursive: true })
    return path
  }
  if (basename(path) !== 'CLAUDE.md' || !dialog.files.some(file => file.path === path && ['user', 'project'].includes(file.kind))) {
    throw new Error('Claude instruction file is no longer available')
  }
  current()
  await mkdir(dirname(path), { recursive: true })
  current()
  try {
    await writeFile(path, '', { flag: 'wx' })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    if (!(await stat(path)).isFile()) throw new Error('The Claude instruction path is occupied by a non-file')
  }
  return path
}
