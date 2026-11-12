// Where the git engine's answers meet the feature's contract. The contract declares what crosses the bus
// (`be/types.ts`) and names no type of the engine's; the engine declares what it answers in (`apack-git`). The two
// are written twice on purpose, and this is the one place that holds them to each other: a shape that drifts on
// either side stops compiling here.
import type * as Engine from 'apack-git'
import type * as Contract from './types.ts'

/** `true` only when each of the two can be handed where the other is expected */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false

export const SHAPES_AGREE: {
  statusFile: Same<Engine.GitStatusFile, Contract.GitStatusFile>
  conflict: Same<Engine.ConflictKind, Contract.ConflictKind>
  operation: Same<Engine.RepositoryOperation, Contract.RepositoryOperation>
  move: Same<Engine.OperationMove, Contract.OperationMove>
  part: Same<Engine.RepositoryPart, Contract.RepositoryPart>
  change: Same<Engine.RepositoryChange, Contract.RepositoryChange>
  progress: Same<Engine.GitProgress, Contract.GitProgress>
  hunk: Same<Engine.DiffHunk, Contract.DiffHunk>
  stash: Same<Engine.StashEntry, Contract.StashEntry>
  worktree: Same<Engine.WorktreeEntry, Contract.WorktreeEntry>
  commit: Same<Engine.CommitLogEntry, Contract.CommitLogEntry>
  errorCode: Same<Engine.GitErrorCode, Contract.GitErrorCode>
  discardKept: Same<Engine.DiscardKept, Contract.DiscardKept>
  discardRestored: Same<Engine.DiscardRestored, Contract.DiscardRestored>
} = {
  statusFile: true, conflict: true, operation: true, move: true, part: true, change: true, progress: true, hunk: true,
  stash: true, worktree: true, commit: true, errorCode: true, discardKept: true, discardRestored: true,
}
