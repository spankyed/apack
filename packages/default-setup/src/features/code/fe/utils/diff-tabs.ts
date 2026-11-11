import type { GitDiff } from '../../be/types.ts'
import type { OpenFile } from '../contract.ts'

/** The tab a file's diff is shown in: one for its staged change, another for its unstaged */
export const diffTabPath = (file: { path: string; staged: boolean }): string =>
  `diff:${file.path}:${file.staged ? 'staged' : 'unstaged'}`

/** What a diff's tab holds of it. The right side of an unstaged diff is the file in the working tree, edited in place */
const shown = (diff: GitDiff) => ({
  content: diff.staged ? '' : diff.modifiedContent ?? '',
  originalContent: diff.staged ? undefined : diff.modifiedContent,
  modified: false,
  gitDiff: diff,
})

/** The tab a diff opens in */
export const diffTab = (diff: GitDiff) => ({
  path: diffTabPath(diff),
  ...shown(diff),
  isDiff: true,
  gitFile: { path: diff.path, staged: diff.staged },
})

/**
 * An open diff's tab brought up to date with its file. What the user typed into it and has not saved stays, with
 * the left side moved on: the file having changed under their edit is theirs to settle when they save, as it is
 * in any other tab.
 */
export function refreshedDiffTab(tab: OpenFile, diff: GitDiff): OpenFile {
  if (diff.staged || !tab.modified) return { ...tab, ...shown(diff) } as OpenFile
  const changedOnDisk = diff.modifiedContent !== tab.originalContent
  return {
    ...tab,
    gitDiff: diff,
    ...(changedOnDisk && { externallyModified: true, externalModificationTime: new Date(), pendingSaveConflict: true }),
  }
}
