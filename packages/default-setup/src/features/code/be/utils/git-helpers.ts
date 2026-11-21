import type { CodeSystemContext } from '../types.ts'
import { repositoryOf, type AppGitRepository } from '../services/app-git-repository.ts'

/** The repository the code surface is over, for an ask that runs git: an ask made with none is refused */
export function gitRepositoryOf(context: CodeSystemContext): AppGitRepository {
  const repository = repositoryOf(context.gitRepository)
  if (!repository) throw new Error('No directory selected. Please select a directory first.')
  return repository
}
