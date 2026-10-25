import { answer } from '../answer.ts'
import { featureSettings } from '#generated/settings.ts';

import { broadcastToSurface, sendToSystem } from '#generated/events.ts';
import { defineHandlers } from '@apackdev/sdk/framework';
import { assign, setup, enqueueActions, fromCallback, type AnyActorRef } from 'xstate'

import { GitRepository, StashConflictError } from '../services/git.ts'
import { GitWatcherService } from '../services/gitwatcher.ts'
import { requireGitRepository } from '../utils/git-helpers.ts'

const surfaceId = 'code' as const

// Incoming events from frontend

// Outgoing events to frontend

export interface CodeCommitSystemContext {
  gitRepository: GitRepository | null
  gitWatcher: GitWatcherService | null
  /** The code system, which routes a `pr.*` event to its pull request child */
  code?: AnyActorRef
}

export type Event =
  | { type: 'commit.GET_GIT_STATUS' }
  | { type: 'commit.GET_GIT_DIFF'; path?: string; staged?: boolean }
  | { type: 'commit.STAGE_FILES'; paths: string[] }
  | { type: 'commit.UNSTAGE_FILES'; paths: string[] }
  | { type: 'commit.COMMIT'; message: string }
  | { type: 'commit.GET_CURRENT_BRANCH' }
  | { type: 'commit.REVERT_FILE'; path: string }
  | { type: 'commit.REVERT_FILES'; paths: string[] }
  | { type: 'commit.GET_ALL_BRANCHES' }
  | { type: 'commit.CHECKOUT_BRANCH'; branchName: string }
  | { type: 'commit.PUBLISH_BRANCH' }
  | { type: 'commit.PULL_BRANCH' }
  | { type: 'commit.GENERATE_MESSAGE' }
  | { type: 'commit.STASH_PUSH'; message?: string; stagedOnly?: boolean }
  | { type: 'commit.STASH_LIST' }
  | { type: 'commit.STASH_APPLY'; index: number }
  | { type: 'commit.STASH_POP'; index: number }
  | { type: 'commit.STASH_DROP'; index: number }
  | { type: 'commit.STASH_CLEAR' }
  | { type: 'commit.WORKTREE_LIST' }
  | { type: 'commit.WORKTREE_ADD'; path: string; branch?: string; createBranch?: boolean }
  | { type: 'commit.WORKTREE_REMOVE'; path: string; force?: boolean }
  | { type: 'commit.WORKTREE_SWITCH'; path: string }
  | { type: 'commit.RESOLVE_CONFLICT'; path: string; strategy: 'ours' | 'theirs' }
  | { type: 'commit.MARK_RESOLVED'; path: string }
  | { type: 'commit.RESOLVE_ALL_CONFLICTS'; strategy: 'ours' | 'theirs' }
  | { type: 'commit.LOG_LIST' }
  | { type: 'commit.REVERT_COMMIT'; hash: string }
  | { type: 'commit.RESET_TO_COMMIT'; hash: string }
  | { type: 'commit.UPDATE_BASE_DIRECTORY'; path: string; gitRepository: GitRepository; gitWatcher: GitWatcherService }
  | { type: 'commit.GIT_STATUS_CHANGED' }
  | { type: 'CODE_CONNECTED' };

/** Hands each handler the answer for the message it is handling — see `defineHandlers` */
const handlers = defineHandlers<CodeCommitSystemContext, Event>();

export const commitSystem = setup({
  types: {
    context: {} as CodeCommitSystemContext,
    events: {} as Event,
    input: {} as { baseDirectory: string | null; gitRepository?: GitRepository | null; gitWatcher?: GitWatcherService | null; code?: AnyActorRef }
  },
  actors: {
    statusRefresh: fromCallback<{ type: 'REFRESH' }>(({ receive, sendBack }) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      receive(() => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          timer = undefined;
          sendBack({ type: 'commit.GET_GIT_STATUS' });
          sendBack({ type: 'commit.LOG_LIST' });
        }, 150);
      });
      return () => clearTimeout(timer);
    }),
  },
  actions: handlers.actions({
    handleGitStatusChanged: enqueueActions(({ context, enqueue }) => {
      enqueue.sendTo('statusRefresh', { type: 'REFRESH' });
      context.code?.send({ type: 'pr.GIT_STATUS_CHANGED' })
    }),

    getGitStatus: ({ context, reply }) => {
      if (!requireGitRepository(context, reply)) return

      context.gitRepository.isGitRepository().then((isGitRepo) => {
        if (!isGitRepo) {
          answer(reply, {
            type: 'commit.ERROR_RECEIVED',
            data: { message: 'Not a git repository' }
          })
          return
        }

        return Promise.all([
          context.gitRepository!.getStatus(),
          context.gitRepository!.getCurrentBranch(),
          context.gitRepository!.isCurrentBranchPublished(),
          context.gitRepository!.getCommitsAheadBehind()
        ]).then(([status, branch, hasUpstream, commitsInfo]) => {
          answer(reply, {
            type: 'commit.STATUS_RECEIVED',
            data: { files: status, branch, hasUpstream, commitsAhead: commitsInfo.ahead, commitsBehind: commitsInfo.behind }
          })
        })
      }).catch((error: any) => {
        let errorMessage = error.message
        if (error.message.includes('git: command not found') || error.message.includes('\'git\' is not recognized')) {
          errorMessage = 'Git is not installed. Please install Git to use version control features.'
        } else if (error.message.includes('not a git repository')) {
          errorMessage = 'This directory is not a Git repository. Initialize with "git init" first.'
        }

        answer(reply, {
          type: 'commit.ERROR_RECEIVED',
          data: { message: errorMessage }
        })
      })
    },

    getGitDiff: ({ event, context, reply }) => {
      const ev = event as { type: 'commit.GET_GIT_DIFF'; path?: string; staged?: boolean }

      if (!requireGitRepository(context, reply)) return

      const isImage = ev.path ? context.gitRepository!.isImageFile(ev.path) : false
      const getContent = isImage
        ? (p: string, v: 'HEAD' | 'working' | 'index') => context.gitRepository!.getFileContentAsDataUrl(p, v)
        : (p: string, v: 'HEAD' | 'working' | 'index') => context.gitRepository!.getFileContent(p, v)

      Promise.all([
        context.gitRepository!.getDiff(ev.path, ev.staged || false),
        context.gitRepository!.getStatus()
      ]).then(async ([diff, status]) => {
        const fileStatus = status.find(f => f.path === ev.path && f.staged === (ev.staged || false))

        let originalContent = ''
        let modifiedContent = ''

        if (fileStatus) {
          if (fileStatus.status === 'added' || fileStatus.status === 'untracked') {
            originalContent = ''
            modifiedContent = ev.staged
              ? await getContent(ev.path!, 'index')
              : await getContent(ev.path!, 'working')
          } else if (fileStatus.status === 'deleted') {
            originalContent = ev.staged
              ? await getContent(ev.path!, 'HEAD')
              : await getContent(ev.path!, 'index')
            modifiedContent = ''
          } else if (fileStatus.status === 'renamed' || fileStatus.status === 'copied') {
            const oldPath = fileStatus.originalPath || ev.path!
            if (ev.staged) {
              originalContent = await getContent(oldPath, 'HEAD')
              modifiedContent = await getContent(ev.path!, 'index')
            } else {
              originalContent = await getContent(ev.path!, 'index')
              modifiedContent = await getContent(ev.path!, 'working')
            }
          } else if (fileStatus.status === 'unmerged') {
            originalContent = await getContent(ev.path!, 'HEAD')
            modifiedContent = await getContent(ev.path!, 'working')
          } else {
            if (ev.staged) {
              originalContent = await getContent(ev.path!, 'HEAD')
              modifiedContent = await getContent(ev.path!, 'index')
            } else {
              originalContent = await getContent(ev.path!, 'index')
              modifiedContent = await getContent(ev.path!, 'working')
            }
          }
        }

        answer(reply, {
          type: 'commit.DIFF_RECEIVED',
          data: {
            path: ev.path || 'all',
            diff,
            staged: ev.staged || false,
            originalContent,
            modifiedContent,
            isImage
          }
        })
      }).catch((error: any) => {
        answer(reply, {
          type: 'commit.ERROR_RECEIVED',
          data: { message: error.message }
        })
      })
    },

    stageFiles: ({ event, context, self, reply }) => {
      const ev = event as { type: 'commit.STAGE_FILES'; paths: string[] }

      if (!requireGitRepository(context, reply)) return

      context.gitRepository.stageFiles(ev.paths).then(() => {
        answer(reply, {
          type: 'commit.FILES_STAGED',
          data: { paths: ev.paths }
        })
        self.send({ type: 'commit.GIT_STATUS_CHANGED' })
      }).catch((error: any) => {
        answer(reply, {
          type: 'commit.ERROR_RECEIVED',
          data: { message: error.message }
        })
      })
    },

    unstageFiles: ({ event, context, self, reply }) => {
      const ev = event as { type: 'commit.UNSTAGE_FILES'; paths: string[] }

      if (!requireGitRepository(context, reply)) return

      context.gitRepository.getStatus().then((status) => {
        const allPaths = new Set(ev.paths)
        for (const p of ev.paths) {
          const fileStatus = status.find(f => f.path === p)
          if (fileStatus && (fileStatus.status === 'renamed' || fileStatus.status === 'copied') && fileStatus.originalPath) {
            allPaths.add(fileStatus.originalPath)
          }
        }
        return context.gitRepository!.unstageFiles([...allPaths])
      }).then(() => {
        answer(reply, {
          type: 'commit.FILES_UNSTAGED',
          data: { paths: ev.paths }
        })
        self.send({ type: 'commit.GIT_STATUS_CHANGED' })
      }).catch((error: any) => {
        answer(reply, {
          type: 'commit.ERROR_RECEIVED',
          data: { message: error.message }
        })
      })
    },

    revertFile: ({ event, context, self, reply }) => {
      const ev = event as { type: 'commit.REVERT_FILE'; path: string }

      if (!requireGitRepository(context, reply)) return

      context.gitRepository.revertFile(ev.path).then(() => {
        answer(reply, {
          type: 'commit.FILE_REVERTED',
          data: { path: ev.path }
        })
        self.send({ type: 'commit.GIT_STATUS_CHANGED' })
        broadcastToSurface(surfaceId, {
          type: 'explorer.FILE_CHANGED_EXTERNALLY',
          data: {
            path: ev.path,
            changeType: 'change',
            modifiedAt: new Date()
          }
        })
      }).catch((error: any) => {
        answer(reply, {
          type: 'commit.ERROR_RECEIVED',
          data: { message: error.message }
        })
      })
    },

    revertFiles: ({ event, context, self, reply }) => {
      const ev = event as { type: 'commit.REVERT_FILES'; paths: string[] }

      if (!requireGitRepository(context, reply)) return

      context.gitRepository.revertFiles(ev.paths).then(() => {
        answer(reply, {
          type: 'commit.FILES_REVERTED',
          data: { paths: ev.paths }
        })
        self.send({ type: 'commit.GIT_STATUS_CHANGED' })
        for (const path of ev.paths) {
          broadcastToSurface(surfaceId, {
            type: 'explorer.FILE_CHANGED_EXTERNALLY',
            data: {
              path,
              changeType: 'change',
              modifiedAt: new Date()
            }
          })
        }
      }).catch((error: any) => {
        answer(reply, {
          type: 'commit.ERROR_RECEIVED',
          data: { message: error.message }
        })
      })
    },

    resolveConflict: ({ event, context, self, reply }) => {
      const ev = event as { type: 'commit.RESOLVE_CONFLICT'; path: string; strategy: 'ours' | 'theirs' }
      if (!requireGitRepository(context, reply)) return

      context.gitRepository.resolveConflict(ev.path, ev.strategy).then(() => {
        answer(reply, {
          type: 'commit.CONFLICT_RESOLVED',
          data: { path: ev.path }
        })
        self.send({ type: 'commit.GIT_STATUS_CHANGED' })
      }).catch((error: any) => {
        answer(reply, {
          type: 'commit.ERROR_RECEIVED',
          data: { message: error.message }
        })
      })
    },

    markResolved: ({ event, context, self, reply }) => {
      const ev = event as { type: 'commit.MARK_RESOLVED'; path: string }
      if (!requireGitRepository(context, reply)) return

      context.gitRepository.stageFiles([ev.path]).then(() => {
        answer(reply, {
          type: 'commit.CONFLICT_RESOLVED',
          data: { path: ev.path }
        })
        self.send({ type: 'commit.GIT_STATUS_CHANGED' })
      }).catch((error: any) => {
        answer(reply, {
          type: 'commit.ERROR_RECEIVED',
          data: { message: error.message }
        })
      })
    },

    resolveAllConflicts: ({ event, context, self, reply }) => {
      const ev = event as { type: 'commit.RESOLVE_ALL_CONFLICTS'; strategy: 'ours' | 'theirs' }
      if (!requireGitRepository(context, reply)) return

      context.gitRepository.getStatus().then(async (status) => {
        const unmerged = status.filter(f => f.status === 'unmerged')
        for (const f of unmerged) {
          await context.gitRepository!.resolveConflict(f.path, ev.strategy)
        }
        answer(reply, { type: 'commit.ALL_CONFLICTS_RESOLVED' })
        self.send({ type: 'commit.GIT_STATUS_CHANGED' })
      }).catch((error: any) => {
        answer(reply, {
          type: 'commit.ERROR_RECEIVED',
          data: { message: error.message }
        })
      })
    },

    commit: ({ event, context, self, reply }) => {
      const ev = event as { type: 'commit.COMMIT'; message: string }

      if (!requireGitRepository(context, reply)) return

      context.gitRepository.getStagedFiles().then((stagedFiles) => {
        if (stagedFiles.length === 0) {
          answer(reply, {
            type: 'commit.ERROR_RECEIVED',
            data: { message: 'No files staged for commit. Please stage files before committing.' }
          })
          return
        }

        return context.gitRepository!.commit(ev.message).then(() => {
          answer(reply, {
            type: 'commit.COMMIT_SUCCESS',
            data: { message: ev.message }
          })
          self.send({ type: 'commit.GIT_STATUS_CHANGED' })
        })
      }).catch((error: any) => {
        let errorMessage = error.message
        if (error.message.includes('nothing to commit')) {
          errorMessage = 'No changes to commit. Stage your changes first.'
        } else if (error.message.includes('Please tell me who you are')) {
          errorMessage = 'Git user not configured. Run "git config --global user.email" and "git config --global user.name"'
        }

        answer(reply, {
          type: 'commit.ERROR_RECEIVED',
          data: { message: errorMessage }
        })
      })
    },

    getCurrentBranch: ({ context, reply }) => {
      if (!requireGitRepository(context, reply)) return

      context.gitRepository.getCurrentBranch().then((branch) => {
        answer(reply, {
          type: 'commit.BRANCH_RETRIEVED',
          data: { branch }
        })
      }).catch((error: any) => {
        answer(reply, {
          type: 'commit.ERROR_RECEIVED',
          data: { message: error.message }
        })
      })
    },

    getAllBranches: ({ context, reply }) => {
      if (!requireGitRepository(context, reply)) return

      context.gitRepository.getAllBranches().then((branches) => {
        answer(reply, {
          type: 'commit.BRANCHES_RECEIVED',
          data: { branches }
        })
      }).catch((error: any) => {
        answer(reply, {
          type: 'commit.ERROR_RECEIVED',
          data: { message: error.message }
        })
      })
    },

    checkoutBranch: ({ event, context, self, reply }) => {
      const ev = event as { type: 'commit.CHECKOUT_BRANCH'; branchName: string }

      if (!requireGitRepository(context, reply)) return

      context.gitRepository.checkoutBranch(ev.branchName).then(() => {
        context.gitRepository!.clearCache()

        answer(reply, {
          type: 'commit.BRANCH_CHECKOUT_SUCCESS',
          data: { branchName: ev.branchName }
        })

        self.send({ type: 'commit.GIT_STATUS_CHANGED' })

        context.code?.send({ type: 'pr.GIT_STATUS_CHANGED' })
      }).catch((error: any) => {
        answer(reply, {
          type: 'commit.ERROR_RECEIVED',
          data: { message: error.message }
        })
      })
    },

    pushBranch: ({ context, self, reply }) => {
      if (!requireGitRepository(context, reply)) return

      let branchName: string
      context.gitRepository.getCurrentBranch().then((currentBranch) => {
        branchName = currentBranch
        return context.gitRepository!.pushBranch()
      }).then(() => {
        answer(reply, {
          type: 'commit.BRANCH_PUSHED',
          data: { branchName }
        })
        self.send({ type: 'commit.GIT_STATUS_CHANGED' })
      }).catch((error: any) => {
        answer(reply, {
          type: 'commit.ERROR_RECEIVED',
          data: { message: error.message }
        })
      })
    },

    generateCommitMessage: ({ context, reply }) => {
      if (!requireGitRepository(context, reply)) return

      context.gitRepository.getStagedFiles().then((stagedFiles) => {
        const staged = stagedFiles.length > 0
        return context.gitRepository!.getDiff(undefined, staged)
      }).then(async (diff) => {
        if (!diff.trim()) {
          answer(reply, {
            type: 'commit.ERROR_RECEIVED',
            data: { message: 'No changes found to generate a commit message from.' }
          })
          return
        }

        const truncatedDiff = diff.length > 40000 ? diff.substring(0, 40000) + '\n... (truncated)' : diff

        const branch = await context.gitRepository!.getCurrentBranch()
        const repoDir = context.gitRepository!.getWorkingDir()
        const repoName = repoDir.split('/').pop() || ''

        const threadsSettings = featureSettings.forFeature('threads').get()
        const provider = threadsSettings?.chat?.defaultMode || 'Claude Code'

        sendToSystem({ role: 'brain' }, { type: 'TRIGGER_BRAIN_EVENT',
          eventType: 'commit.generate',
          payload: { diff: truncatedDiff, branch, repoName, provider },
        })
      }).catch((error: any) => {
        answer(reply, {
          type: 'commit.ERROR_RECEIVED',
          data: { message: error.message }
        })
      })
    },

    pullBranch: ({ context, self, reply }) => {
      if (!requireGitRepository(context, reply)) return

      let branchName: string
      context.gitRepository.getCurrentBranch().then((currentBranch) => {
        branchName = currentBranch
        return context.gitRepository!.pullBranch()
      }).then(() => {
        context.gitRepository!.forceFetchOnce()

        answer(reply, {
          type: 'commit.BRANCH_PULLED',
          data: { branchName }
        })
        self.send({ type: 'commit.GIT_STATUS_CHANGED' })
      }).catch((error: any) => {
        answer(reply, {
          type: 'commit.ERROR_RECEIVED',
          data: { message: error.message }
        })
      })
    },

    updateBaseDirectory: assign({
      gitRepository: ({ event }) => {
        const ev = event as { type: 'commit.UPDATE_BASE_DIRECTORY'; path: string; gitRepository: GitRepository; gitWatcher: GitWatcherService }
        return ev.gitRepository
      },
      gitWatcher: ({ event }) => {
        const ev = event as { type: 'commit.UPDATE_BASE_DIRECTORY'; path: string; gitRepository: GitRepository; gitWatcher: GitWatcherService }
        return ev.gitWatcher
      }
    }),

    selfRefreshGitStatus: ({ self }) => {
      self.send({ type: 'commit.GIT_STATUS_CHANGED' })
    },

    stashPush: ({ event, context, self, reply }) => {
      const ev = event as { type: 'commit.STASH_PUSH'; message?: string; stagedOnly?: boolean }

      if (!requireGitRepository(context, reply)) return

      context.gitRepository.stashPush(ev.message, ev.stagedOnly).then((result) => {
        answer(reply, {
          type: 'commit.STASH_SUCCESS',
          data: { message: result }
        })
        self.send({ type: 'commit.GIT_STATUS_CHANGED' })
        self.send({ type: 'commit.STASH_LIST' })
      }).catch((error: any) => {
        answer(reply, {
          type: 'commit.ERROR_RECEIVED',
          data: { message: error.message }
        })
      })
    },

    stashList: ({ context, reply }) => {
      if (!requireGitRepository(context, reply)) return

      context.gitRepository.stashList().then((stashes) => {
        answer(reply, {
          type: 'commit.STASH_LIST_RECEIVED',
          data: { stashes }
        })
      }).catch((error: any) => {
        answer(reply, {
          type: 'commit.ERROR_RECEIVED',
          data: { message: error.message }
        })
      })
    },

    stashApply: ({ event, context, self, reply }) => {
      const ev = event as { type: 'commit.STASH_APPLY'; index: number }

      if (!requireGitRepository(context, reply)) return

      context.gitRepository.stashApply(ev.index).then(() => {
        answer(reply, {
          type: 'commit.STASH_SUCCESS',
          data: { message: 'Stash applied successfully' }
        })
        self.send({ type: 'commit.GIT_STATUS_CHANGED' })
      }).catch((error: any) => {
        if (error instanceof StashConflictError) {
          answer(reply, {
            type: 'commit.STASH_SUCCESS',
            data: { message: error.message }
          })
          self.send({ type: 'commit.GIT_STATUS_CHANGED' })
          return
        }
        answer(reply, {
          type: 'commit.ERROR_RECEIVED',
          data: { message: error.message }
        })
      })
    },

    stashPop: ({ event, context, self, reply }) => {
      const ev = event as { type: 'commit.STASH_POP'; index: number }

      if (!requireGitRepository(context, reply)) return

      context.gitRepository.stashPop(ev.index).then(() => {
        answer(reply, {
          type: 'commit.STASH_SUCCESS',
          data: { message: 'Stash popped successfully' }
        })
        self.send({ type: 'commit.GIT_STATUS_CHANGED' })
        self.send({ type: 'commit.STASH_LIST' })
      }).catch((error: any) => {
        if (error instanceof StashConflictError) {
          answer(reply, {
            type: 'commit.STASH_SUCCESS',
            data: { message: error.message }
          })
          self.send({ type: 'commit.GIT_STATUS_CHANGED' })
          self.send({ type: 'commit.STASH_LIST' })
          return
        }
        answer(reply, {
          type: 'commit.ERROR_RECEIVED',
          data: { message: error.message }
        })
      })
    },

    stashDrop: ({ event, context, self, reply }) => {
      const ev = event as { type: 'commit.STASH_DROP'; index: number }

      if (!requireGitRepository(context, reply)) return

      context.gitRepository.stashDrop(ev.index).then(() => {
        self.send({ type: 'commit.STASH_LIST' })
      }).catch((error: any) => {
        answer(reply, {
          type: 'commit.ERROR_RECEIVED',
          data: { message: error.message }
        })
      })
    },

    stashClear: ({ context, self, reply }) => {
      if (!requireGitRepository(context, reply)) return

      context.gitRepository.stashClear().then(() => {
        self.send({ type: 'commit.STASH_LIST' })
      }).catch((error: any) => {
        answer(reply, {
          type: 'commit.ERROR_RECEIVED',
          data: { message: error.message }
        })
      })
    },

    logList: ({ context, reply }) => {
      if (!requireGitRepository(context, reply)) return

      context.gitRepository.gitLog().then((commits) => {
        answer(reply, {
          type: 'commit.LOG_LIST_RECEIVED',
          data: { commits }
        })
      }).catch((error: any) => {
        answer(reply, {
          type: 'commit.ERROR_RECEIVED',
          data: { message: error.message }
        })
      })
    },

    revertCommit: ({ event, context, self, reply }) => {
      const ev = event as { type: 'commit.REVERT_COMMIT'; hash: string }

      if (!requireGitRepository(context, reply)) return

      context.gitRepository.revertCommit(ev.hash).then(() => {
        answer(reply, {
          type: 'commit.REVERT_COMMIT_SUCCESS',
          data: { hash: ev.hash }
        })
        self.send({ type: 'commit.GIT_STATUS_CHANGED' })
        self.send({ type: 'commit.LOG_LIST' })
      }).catch((error: any) => {
        answer(reply, {
          type: 'commit.ERROR_RECEIVED',
          data: { message: error.message }
        })
      })
    },

    resetToCommit: ({ event, context, self, reply }) => {
      const ev = event as { type: 'commit.RESET_TO_COMMIT'; hash: string }

      if (!requireGitRepository(context, reply)) return

      context.gitRepository.resetToCommit(ev.hash).then(() => {
        answer(reply, {
          type: 'commit.RESET_COMMIT_SUCCESS',
          data: { hash: ev.hash }
        })
        self.send({ type: 'commit.GIT_STATUS_CHANGED' })
        self.send({ type: 'commit.LOG_LIST' })
      }).catch((error: any) => {
        answer(reply, {
          type: 'commit.ERROR_RECEIVED',
          data: { message: error.message }
        })
      })
    },

    worktreeList: ({ context, reply }) => {
      if (!requireGitRepository(context, reply)) return

      context.gitRepository.worktreeList().then((worktrees) => {
        answer(reply, {
          type: 'commit.WORKTREE_LIST_RECEIVED',
          data: { worktrees }
        })
      }).catch((error: any) => {
        answer(reply, {
          type: 'commit.ERROR_RECEIVED',
          data: { message: error.message }
        })
      })
    },

    worktreeAdd: ({ event, context, self, reply }) => {
      if (!requireGitRepository(context, reply)) return
      const ev = event as { type: 'commit.WORKTREE_ADD'; path: string; branch?: string; createBranch?: boolean }

      context.gitRepository.worktreeAdd(ev.path, ev.branch, ev.createBranch).then(() => {
        answer(reply, {
          type: 'commit.WORKTREE_ADDED',
          data: { path: ev.path, branch: ev.branch || '' }
        })
        self.send({ type: 'commit.WORKTREE_LIST' })
      }).catch((error: any) => {
        answer(reply, {
          type: 'commit.ERROR_RECEIVED',
          data: { message: error.message }
        })
      })
    },

    worktreeRemove: ({ event, context, self, reply }) => {
      if (!requireGitRepository(context, reply)) return
      const ev = event as { type: 'commit.WORKTREE_REMOVE'; path: string; force?: boolean }

      context.gitRepository.worktreeRemove(ev.path, ev.force).then(() => {
        answer(reply, {
          type: 'commit.WORKTREE_REMOVED',
          data: { path: ev.path }
        })
        self.send({ type: 'commit.WORKTREE_LIST' })
      }).catch((error: any) => {
        answer(reply, {
          type: 'commit.ERROR_RECEIVED',
          data: { message: error.message }
        })
      })
    }
  })
}).createMachine({
  id: 'commit',
  initial: 'idle',
  invoke: { id: 'statusRefresh', src: 'statusRefresh' },
  context: ({ input }) => {
    const baseDir = input?.baseDirectory
    return {
      gitRepository: input?.gitRepository || (baseDir ? new GitRepository(baseDir) : null),
      gitWatcher: input?.gitWatcher || (baseDir ? new GitWatcherService(baseDir) : null),
      code: input?.code
    }
  },
  states: {
    idle: {
      on: {
        'CODE_CONNECTED': {
          // No specific action needed for commit on startup
        },
        'commit.GET_GIT_STATUS': {
          actions: 'getGitStatus'
        },
        'commit.GET_GIT_DIFF': {
          actions: 'getGitDiff'
        },
        'commit.STAGE_FILES': {
          actions: 'stageFiles'
        },
        'commit.UNSTAGE_FILES': {
          actions: 'unstageFiles'
        },
        'commit.REVERT_FILE': {
          actions: 'revertFile'
        },
        'commit.REVERT_FILES': {
          actions: 'revertFiles'
        },
        'commit.RESOLVE_CONFLICT': {
          actions: 'resolveConflict'
        },
        'commit.MARK_RESOLVED': {
          actions: 'markResolved'
        },
        'commit.RESOLVE_ALL_CONFLICTS': {
          actions: 'resolveAllConflicts'
        },
        'commit.COMMIT': {
          actions: 'commit'
        },
        'commit.GET_CURRENT_BRANCH': {
          actions: 'getCurrentBranch'
        },
        'commit.GET_ALL_BRANCHES': {
          actions: 'getAllBranches'
        },
        'commit.CHECKOUT_BRANCH': {
          actions: 'checkoutBranch'
        },
        'commit.PUBLISH_BRANCH': {
          actions: 'pushBranch'
        },
        'commit.PULL_BRANCH': {
          actions: 'pullBranch'
        },
        'commit.GENERATE_MESSAGE': {
          actions: 'generateCommitMessage'
        },
        'commit.UPDATE_BASE_DIRECTORY': {
          actions: ['updateBaseDirectory', 'selfRefreshGitStatus', 'worktreeList', 'getAllBranches', 'logList']
        },
        'commit.GIT_STATUS_CHANGED': {
          actions: 'handleGitStatusChanged'
        },
        'commit.STASH_PUSH': {
          actions: 'stashPush'
        },
        'commit.STASH_LIST': {
          actions: 'stashList'
        },
        'commit.STASH_APPLY': {
          actions: 'stashApply'
        },
        'commit.STASH_POP': {
          actions: 'stashPop'
        },
        'commit.STASH_DROP': {
          actions: 'stashDrop'
        },
        'commit.STASH_CLEAR': {
          actions: 'stashClear'
        },
        'commit.WORKTREE_LIST': {
          actions: 'worktreeList'
        },
        'commit.WORKTREE_ADD': {
          actions: 'worktreeAdd'
        },
        'commit.WORKTREE_REMOVE': {
          actions: 'worktreeRemove'
        },
        'commit.LOG_LIST': {
          actions: 'logList'
        },
        'commit.REVERT_COMMIT': {
          actions: 'revertCommit'
        },
        'commit.RESET_TO_COMMIT': {
          actions: 'resetToCommit'
        }
      }
    }
  }
})
