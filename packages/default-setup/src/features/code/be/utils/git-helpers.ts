import type { Reply } from '@apackdev/sdk/events';
import type { OutgoingCodeEvents } from '../contract.ts'
import { answer } from '../answer.ts'
import { GitRepository } from '../services/git.ts'

type ErrorEventType = 'commit.ERROR_RECEIVED' | 'pr.ERROR'

/** Whether the system has a repository; without one, says so to whoever asked (\`answer\`) */
export function requireGitRepository<T extends { gitRepository: GitRepository | null }>(
  context: T,
  reply: Reply<OutgoingCodeEvents> | undefined,
  errorEventType: ErrorEventType = 'commit.ERROR_RECEIVED'
): context is T & { gitRepository: GitRepository } {
  if (!context.gitRepository) {
    const message = 'No directory selected. Please select a directory first.'

    if (errorEventType === 'pr.ERROR') {
      answer(reply, { type: 'pr.ERROR', message })
    } else {
      answer(reply, { type: 'commit.ERROR_RECEIVED', data: { message } })
    }
    return false
  }
  return true
}
