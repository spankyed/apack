import { answer } from '../answer.ts'
import { featureSettings } from '#generated/settings.ts';

import { broadcastToSurface, sendToSystem } from '#generated/events.ts';
import { defineHandlers } from '@apackdev/sdk/framework';
import { assign, setup, enqueueActions, fromCallback, type AnyActorRef } from 'xstate'

import { GitRepository, NOTHING_CHANGED, StashConflictError, changedAnything } from '../services/git.ts'
import { GitError } from '../services/git-errors.ts'
import { setUpGitSignIn } from '../services/gh-cli.ts'
import { isHostName } from '../services/sign-in.ts'
import type { CommitFailure, OperationMove, RepositoryChange } from '../types.ts'
import { requireGitRepository } from '../utils/git-helpers.ts'

const surfaceId = 'code' as const

// Incoming events from frontend

// Outgoing events to frontend

export interface CodeCommitSystemContext {
  gitRepository: GitRepository | null
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
  | { type: 'commit.MOVE_OPERATION'; move: OperationMove }
  | { type: 'commit.SET_UP_SIGN_IN'; host: string }
  | { type: 'commit.LOG_LIST' }
  | { type: 'commit.REVERT_COMMIT'; hash: string }
  | { type: 'commit.RESET_TO_COMMIT'; hash: string }
  | { type: 'commit.UPDATE_BASE_DIRECTORY'; path: string; gitRepository: GitRepository }
  | { type: 'commit.GIT_STATUS_CHANGED' }
  /** A hint that the repository changed. `reconcile` says it comes from someone who knows a change is likely, not from a file event */
  | { type: 'commit.REPOSITORY_MAY_HAVE_CHANGED'; reconcile?: boolean; byWindow?: boolean }
  | { type: 'commit.ANNOUNCE_REPOSITORY_CHANGED'; changed: RepositoryChange };

/** What the panel is told of a command that failed: git's words, and why it failed where git said */
function failureOf(error: unknown): CommitFailure {
  const message = error instanceof Error ? error.message : String(error)
  return { message, ...(error instanceof GitError && error.code && { code: error.code }) }
}

/** The same for a push or a pull, which the panel can run again, with what can be done when the remote asked for a sign-in */
async function remoteFailureOf(error: unknown, during: 'push' | 'pull', repository: GitRepository): Promise<CommitFailure> {
  const failure = failureOf(error)
  const signIn = failure.code === 'authentication' ? await repository.signInHelp().catch(() => undefined) : undefined
  return { ...failure, during, ...(signIn && { signIn }) }
}

/**
 * Fetches from the remote when a fetch is due, behind whoever asked, and has the repository checked once it has:
 * what the fetch brought is then announced like any other change. Nobody waits on the network for an answer.
 */
function fetchInBackground(repository: GitRepository, commit: { send(event: Event): void }): void {
  const suspended = repository.isAutoFetchSuspended
  void repository.fetchIfDue().then((fetched) => {
    // What a fetch brought is one thing to announce. That fetching has stopped, or started again, is another
    if (fetched || repository.isAutoFetchSuspended !== suspended) commit.send({ type: 'commit.REPOSITORY_MAY_HAVE_CHANGED' })
  })
}

/** Hands each handler the answer for the message it is handling — see `defineHandlers` */
const handlers = defineHandlers<CodeCommitSystemContext, Event>();

export const commitSystem = setup({
  types: {
    context: {} as CodeCommitSystemContext,
    events: {} as Event,
    input: {} as { baseDirectory: string | null; gitRepository?: GitRepository | null; code?: AnyActorRef }
  },
  actors: {
    /**
     * Turns what may be a change into the one announcement of it, which says which parts of the repository changed.
     *
     * `CHECK` is a hint — a file event, a reconcile — so git is asked, and what differs from the last check is
     * announced, or nothing when nothing does. `REFRESH` is a write made here, checked once the writes that
     * arrive together have: its status is announced whatever the check finds, since the window that made it is
     * waiting to show it, and the other parts only when they differ — staging a file moves no commit, so it asks
     * nobody for the log or a pull request again. Checking is also what keeps the file event that write causes
     * from being announced a second time. One check runs at a time, and whatever arrives during it is one more.
     */
    statusRefresh: fromCallback<
      | { type: 'REFRESH'; repository: GitRepository | null }
      | { type: 'CHECK'; repository: GitRepository | null; everything: boolean; refreshIndex: boolean; byWindow: boolean }
      | { type: 'ASKED'; repository: GitRepository | null }
    >(({ receive, sendBack }) => {
      /**
       * `everything` when there is no watcher's event to go by, and the whole repository is read again;
       * `refreshIndex` when this is a moment git's index may be written at
       */
      type Request = { repository: GitRepository | null; written: boolean; everything: boolean; refreshIndex: boolean };
      const both = (one: Request, other: Request | undefined): Request => (other?.repository !== one.repository ? one : {
        repository: one.repository, written: one.written || other.written,
        everything: one.everything || other.everything, refreshIndex: one.refreshIndex || other.refreshIndex,
      });
      let timer: ReturnType<typeof setTimeout> | undefined;
      let stopped = false;
      let checking = false;
      let next: Request | undefined;
      /**
       * Whether a changed status was announced and no window has asked for it since. Every window showing the
       * repository asks when it hears that, so none asking means none is: a hint that arrives then is `owed`,
       * and git is asked when a window next does
       */
      let unasked = false;
      let owed: Request | undefined;
      const run = async (first: Request) => {
        checking = true;
        try {
          for (let current: Request | undefined = first; current && !stopped; current = next) {
            next = undefined;
            const found = current.repository
              ? await current.repository.refreshSnapshot(current.everything ? 'everything' : 'noted', { refreshIndex: current.refreshIndex })
              : NOTHING_CHANGED;
            const changed = current.written ? { ...found, status: true } : found;
            if (stopped || !changedAnything(changed)) continue;
            if (changed.status) unasked = true;
            sendBack({ type: 'commit.ANNOUNCE_REPOSITORY_CHANGED', changed });
          }
        } finally {
          checking = false;
        }
      };
      const request = (asked: Request) => {
        if (checking) next = both(asked, next);
        else void run(asked);
      };
      receive((event) => {
        if (event.type === 'ASKED') {
          unasked = false;
          const waiting = owed;
          owed = undefined;
          // What was put off is checked now, for the windows that did not ask as well as the one that did
          if (waiting && waiting.repository === event.repository) request(waiting);
          return;
        }
        if (event.type === 'CHECK') {
          const asked = { repository: event.repository, written: false, everything: event.everything, refreshIndex: event.refreshIndex };
          // A window that gained focus is somebody looking, whatever it has asked for
          // Put off, it is checked whenever a window next asks, which is not a moment chosen to write the index at
          if (unasked && !event.byWindow) owed = { ...both(asked, owed), refreshIndex: false };
          else request(asked);
          return;
        }
        clearTimeout(timer);
        timer = setTimeout(() => {
          timer = undefined;
          request({ repository: event.repository, written: true, everything: true, refreshIndex: false });
        }, 150);
      });
      return () => { stopped = true; clearTimeout(timer); };
    }),
  },
  actions: handlers.actions({
    handleGitStatusChanged: enqueueActions(({ context, enqueue }) => {
      enqueue.sendTo('statusRefresh', { type: 'REFRESH', repository: context.gitRepository });
    }),

    /** A hint that the repository changed, from its watcher or a reconcile: git decides whether it did */
    checkRepository: enqueueActions(({ context, event, enqueue, self }) => {
      const repository = context.gitRepository
      if (!repository) return
      const { reconcile = false, byWindow = false } = event as { reconcile?: boolean; byWindow?: boolean }
      // A reconcile has no event to go by. Any other hint is a watcher's, or follows a fetch, and each has
      // noted what it changed with the repository already. One that no window asked for follows a terminal
      // command or an agent's turn ending: the moment least likely to have another git running, so the one at
      // which git's index may be written
      enqueue.sendTo('statusRefresh', { type: 'CHECK', repository, everything: reconcile, refreshIndex: reconcile && !byWindow, byWindow });
      // Someone has come back to the repository, which is when what the remote has is worth knowing
      if (reconcile) enqueue(() => { fetchInBackground(repository, self) });
    }),

    getGitStatus: ({ context, reply, self }) => {
      if (!requireGitRepository(context, reply)) return
      const repository = context.gitRepository
      // Somebody is looking: whatever was put off while nobody was is checked now
      self.getSnapshot().children.statusRefresh?.send({ type: 'ASKED', repository })

      context.gitRepository.isGitRepository().then((isGitRepo) => {
        if (!isGitRepo) {
          answer(reply, {
            type: 'commit.ERROR_RECEIVED',
            data: { message: 'Not a git repository' }
          })
          return
        }

        return repository.readSnapshot().then((snapshot) => {
          answer(reply, {
            type: 'commit.STATUS_RECEIVED',
            data: { files: snapshot.files, truncated: snapshot.truncated, branch: snapshot.branch, hasUpstream: snapshot.hasUpstream, commitsAhead: snapshot.ahead, commitsBehind: snapshot.behind, signIn: repository.autoFetchSignIn, watching: !repository.hasWatchFailed, operation: snapshot.operation, fetchSuspended: repository.isAutoFetchSuspended }
          })
          // The window has its answer: what the remote has is fetched behind it, and announced if it differs
          fetchInBackground(repository, self)
        })
      }).catch((error: any) => {
        const failed = failureOf(error)
        answer(reply, {
          type: 'commit.ERROR_RECEIVED',
          data: failed.code === 'not-a-repository'
            ? { ...failed, message: 'This directory is not a Git repository. Initialize with "git init" first.' }
            : failed,
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

      // The editor draws the change from the file's two sides, so those are what is read: no patch is made
      context.gitRepository!.getStatus().then(async (status) => {
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
        } else if (ev.path) {
          // The file has no change on this side any more: both sides are what it holds now, so the diff is
          // empty, and an edit made in it is an edit to the file as it is
          originalContent = modifiedContent = await getContent(ev.path, ev.staged ? 'index' : 'working').catch(() => '')
        }

        answer(reply, {
          type: 'commit.DIFF_RECEIVED',
          data: {
            path: ev.path || 'all',
            staged: ev.staged || false,
            originalContent,
            modifiedContent,
            isImage
          }
        })
      }).catch((error: any) => {
        answer(reply, {
          type: 'commit.ERROR_RECEIVED',
          data: failureOf(error)
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
          data: failureOf(error)
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
          data: failureOf(error)
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
          data: failureOf(error)
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
          data: failureOf(error)
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
          data: failureOf(error)
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
          data: failureOf(error)
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
          data: failureOf(error)
        })
      })
    },

    /**
     * Carries on with what git is in the middle of, leaves out the commit a rebase stopped at, or gives it up.
     * Whether it could or not, the repository may be somewhere else afterwards, so it is checked either way
     */
    moveOperation: ({ event, context, self, reply }) => {
      const { move } = event as { type: 'commit.MOVE_OPERATION'; move: OperationMove }
      if (!requireGitRepository(context, reply)) return

      context.gitRepository.moveOperation(move).then(() => {
        answer(reply, { type: 'commit.OPERATION_MOVED', data: { move } })
      }, (error: Error) => {
        answer(reply, { type: 'commit.ERROR_RECEIVED', data: failureOf(error) })
      }).finally(() => {
        self.send({ type: 'commit.GIT_STATUS_CHANGED' })
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
          data: failureOf(error)
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
          data: failureOf(error)
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
      }).catch((error: any) => {
        answer(reply, {
          type: 'commit.ERROR_RECEIVED',
          data: failureOf(error)
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
      }).catch(async (error: unknown) => {
        answer(reply, { type: 'commit.ERROR_RECEIVED', data: await remoteFailureOf(error, 'push', context.gitRepository!) })
      })
    },

    generateCommitMessage: ({ context, reply, client }) => {
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
          // A flow run has no return address, so the ask carries the asking window's connection for the action to answer
          payload: { diff: truncatedDiff, branch, repoName, provider, ...(client && { client }) },
        })
      }).catch((error: any) => {
        answer(reply, {
          type: 'commit.ERROR_RECEIVED',
          data: failureOf(error)
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
      }).catch(async (error: unknown) => {
        answer(reply, { type: 'commit.ERROR_RECEIVED', data: await remoteFailureOf(error, 'pull', context.gitRepository!) })
      })
    },

    /**
     * Has the GitHub CLI give git its sign-in for the host a remote asked on, and starts fetching again. The
     * host arrives from the window, so it is held to a host name before it reaches a command line
     */
    setUpSignIn: ({ event, context, self, reply }) => {
      const { host } = event as { type: 'commit.SET_UP_SIGN_IN'; host: string }
      if (!requireGitRepository(context, reply)) return
      const repository = context.gitRepository
      if (!isHostName(host)) {
        answer(reply, { type: 'commit.ERROR_RECEIVED', data: { message: `Not a host name: ${JSON.stringify(host)}` } })
        return
      }

      setUpGitSignIn(repository.getWorkingDir(), host).then(() => {
        repository.resumeAutoFetch()
        answer(reply, { type: 'commit.SIGN_IN_SET_UP', data: { host } })
        self.send({ type: 'commit.GIT_STATUS_CHANGED' })
      }, (error: unknown) => {
        // Still the sign-in that is missing, so the offer stays with what went wrong setting it up
        answer(reply, { type: 'commit.ERROR_RECEIVED', data: { ...failureOf(error), code: 'authentication', signIn: { host, kind: 'github-cli' } } })
      })
    },

    updateBaseDirectory: assign({
      gitRepository: ({ event }) => {
        const ev = event as { type: 'commit.UPDATE_BASE_DIRECTORY'; path: string; gitRepository: GitRepository }
        return ev.gitRepository
      },
    }),

    /**
     * The repository changed (on disk, or by a write here; coalesced): news for every window, saying which parts
     * of it changed, and each window asks again for what it shows of those
     */
    announceRepositoryChanged: ({ event }) => {
      const { changed } = event as { type: 'commit.ANNOUNCE_REPOSITORY_CHANGED'; changed: RepositoryChange }
      broadcastToSurface(surfaceId, { type: 'commit.REPOSITORY_CHANGED', changed })
    },

    /**
     * What a pull request shows is read from the commits of the same repository, so it hears of those moving —
     * and of nothing else: an edit to a file changes no pull request, and asking the remote about one costs a
     * round trip to it
     */
    tellPullRequests: ({ context, event }) => {
      const { changed } = event as { type: 'commit.ANNOUNCE_REPOSITORY_CHANGED'; changed: RepositoryChange }
      if (changed.history) context.code?.send({ type: 'pr.GIT_STATUS_CHANGED' })
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
      }).catch((error: any) => {
        answer(reply, {
          type: 'commit.ERROR_RECEIVED',
          data: failureOf(error)
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
          data: failureOf(error)
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
            data: failureOf(error)
          })
          self.send({ type: 'commit.GIT_STATUS_CHANGED' })
          return
        }
        answer(reply, {
          type: 'commit.ERROR_RECEIVED',
          data: failureOf(error)
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
      }).catch((error: any) => {
        if (error instanceof StashConflictError) {
          answer(reply, {
            type: 'commit.STASH_SUCCESS',
            data: failureOf(error)
          })
          self.send({ type: 'commit.GIT_STATUS_CHANGED' })
          return
        }
        answer(reply, {
          type: 'commit.ERROR_RECEIVED',
          data: failureOf(error)
        })
      })
    },

    stashDrop: ({ event, context, self, reply }) => {
      const ev = event as { type: 'commit.STASH_DROP'; index: number }

      if (!requireGitRepository(context, reply)) return

      context.gitRepository.stashDrop(ev.index).then(() => {
        self.send({ type: 'commit.GIT_STATUS_CHANGED' })
      }).catch((error: any) => {
        answer(reply, {
          type: 'commit.ERROR_RECEIVED',
          data: failureOf(error)
        })
      })
    },

    stashClear: ({ context, self, reply }) => {
      if (!requireGitRepository(context, reply)) return

      context.gitRepository.stashClear().then(() => {
        self.send({ type: 'commit.GIT_STATUS_CHANGED' })
      }).catch((error: any) => {
        answer(reply, {
          type: 'commit.ERROR_RECEIVED',
          data: failureOf(error)
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
          data: failureOf(error)
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
      }).catch((error: any) => {
        answer(reply, {
          type: 'commit.ERROR_RECEIVED',
          data: failureOf(error)
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
      }).catch((error: any) => {
        answer(reply, {
          type: 'commit.ERROR_RECEIVED',
          data: failureOf(error)
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
          data: failureOf(error)
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
        self.send({ type: 'commit.GIT_STATUS_CHANGED' })
      }).catch((error: any) => {
        answer(reply, {
          type: 'commit.ERROR_RECEIVED',
          data: failureOf(error)
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
        self.send({ type: 'commit.GIT_STATUS_CHANGED' })
      }).catch((error: any) => {
        answer(reply, {
          type: 'commit.ERROR_RECEIVED',
          data: failureOf(error)
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
      code: input?.code
    }
  },
  states: {
    idle: {
      on: {
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
        'commit.MOVE_OPERATION': {
          actions: 'moveOperation'
        },
        'commit.SET_UP_SIGN_IN': {
          actions: 'setUpSignIn'
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
          actions: ['updateBaseDirectory']
        },
        'commit.GIT_STATUS_CHANGED': {
          actions: 'handleGitStatusChanged'
        },
        'commit.REPOSITORY_MAY_HAVE_CHANGED': {
          actions: 'checkRepository'
        },
        'commit.ANNOUNCE_REPOSITORY_CHANGED': {
          actions: ['announceRepositoryChanged', 'tellPullRequests']
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
