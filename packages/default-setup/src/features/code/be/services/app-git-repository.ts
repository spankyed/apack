// The app's half of a repository: what the git engine (`apack-git`) leaves to its host. The engine owns one working
// tree's truth and every git process; this owns when to fetch unasked, which branch a pull request is based on,
// files as data URLs for a window, the words a failed push or pull is said in, and what the engine is handed to
// run with.
import * as path from 'path'
import { createLogger, setDebugEnabled } from '@apackdev/sdk/logger'
import { execFileWhileWorking, processWork, watchWork } from '@apackdev/sdk/progress'
import {
  GitError, GitRepository, GitWatcherService,
  type GitErrorCode, type GitProgress, type RepositoryTies,
} from 'apack-git'
import type { RepositoryHandle, WatcherHandle } from '../types.ts'
import { featureSettings } from '#generated/settings.ts'
import { agentChildEnvironment } from './shell-environment.ts'
import { resolveGitPath } from '../utils/resolve-cli.ts'
import { signInHelpFor, type SignInHelp } from './sign-in.ts'

const logger = createLogger('git')
const watcherLogger = createLogger('git-watcher')

/**
 * Every git command run, with how long it took and whether it worked. Off until the code surface's setting
 * turns it on (`setDebugEnabled`): a status runs for most file events, and that is a line each.
 */
export const GIT_COMMAND_LOG = 'git-commands'
const commandLog = createLogger(GIT_COMMAND_LOG, { debug: true })
// A gated source starts on outside production, and this one is a line for every git run: off until asked for
setDebugEnabled(GIT_COMMAND_LOG, false)

/**
 * The repositories the user has said may have git run what their own configuration and hooks name, each by where
 * its git state really lives: the code settings' `trustedRepositories`. A linked worktree shares its repository's.
 */
export function trustedRepositories(): string[] {
  try {
    return featureSettings.forFeature('code').get()?.trustedRepositories ?? []
  } catch {
    // No settings to read, as in a tool that opens a repository outside the app: none is trusted
    return []
  }
}

/** Remembers that the user trusts a repository */
export function trustRepository(repository: string): void {
  const trusted = trustedRepositories()
  if (!trusted.includes(repository)) featureSettings.forFeature('code').set({ path: ['trustedRepositories'], value: [...trusted, repository] })
}

/**
 * What the engine runs with in this app. Git starts from the app's own environment with what the app set on its
 * own process taken out, and a git that stops working is ended rather than left to a clock.
 */
export const APP_TIES: RepositoryTies = {
  environment: () => agentChildEnvironment(process.env),
  run: (file, args, options) => execFileWhileWorking(file, args, options),
  watchProcess: (pid, onStalled, idleMs) => watchWork({ work: processWork(pid), idleMs, onRefused: onStalled }),
  isTrusted: repository => trustedRepositories().includes(repository),
  log: {
    warn: (message, data) => logger.warn(message, data),
    error: (message, data) => logger.error(message, data),
    command: line => commandLog.debug(line),
  },
}

const IMAGE_MIME_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  webp: 'image/webp',
  tiff: 'image/tiff',
  tif: 'image/tiff',
  bmp: 'image/bmp',
}

function getImageMimeType(filePath: string): string | null {
  const ext = path.extname(filePath).slice(1).toLowerCase()
  return IMAGE_MIME_TYPES[ext] || null
}

/** What a hosting service said when it refused a push, which git carries back on a line it begins `remote:` */
const hostSaid = (printed: string): string | undefined =>
  /^remote: error: (GH0\d\d: .*?)\s*$/m.exec(printed)?.[1]

/** What a push or a pull that failed is said to have failed on, for the reasons that have plainer words than git's */
function saidOfRemote(code: GitErrorCode | undefined, printed: string): string | undefined {
  switch (code) {
    case 'unrelated-histories': return 'This branch and the remote branch share no commit, so git will not bring them together. Merge with `--allow-unrelated-histories` from a terminal if they belong together.'
    case 'host-refused': return `The host refused the push: ${hostSaid(printed) ?? 'it gave a rule of its own.'}`
    case 'authentication': return 'The remote asked for a sign-in that git does not have.'
    case 'permission': return 'Permission denied. Check your repository access rights.'
    case 'remote-unreachable': return 'Cannot connect to remote repository. Check your network connection and the remote\'s address.'
    case 'non-fast-forward': return 'Remote branch has diverged. Pull changes first.'
    case 'diverged': return 'This branch and the remote branch have both moved on, and git is not set to merge or rebase them on a pull. Merge or rebase from a terminal, or set `pull.rebase` or `pull.ff` in git\'s config.'
    case 'conflict': return 'Merge conflicts detected. Resolve conflicts and commit.'
    case 'local-changes': return 'You have uncommitted changes. Commit or stash them first.'
    default: return undefined
  }
}

/** A push or a pull that failed, in the words the panel shows, carrying why it failed */
const remoteFailure = (verb: 'push' | 'pull', error: unknown): unknown =>
  // Stopped by the user, which is no failure and has no plainer words to be put in
  error instanceof GitError && error.code === 'aborted' ? error : error instanceof GitError ? new GitError(`Failed to ${verb}: ${saidOfRemote(error.code, error.message) ?? error.message}`, error.code) : error

/** What a commit or a branch that failed is said to have failed on, where the panel has plainer words than git's */
function saidOfLocal(code: GitErrorCode | undefined): string | undefined {
  switch (code) {
    case 'signing-failed': return 'The commit could not be signed: the signing program failed or could not be run. Check `gpg.program` and that its key is unlocked, or commit from a terminal to see what it said.'
    case 'nothing-to-commit': return 'There is nothing staged to commit.'
    case 'branch-exists': return 'A branch of that name already exists. Choose another name, or use the existing branch.'
    default: return undefined
  }
}

/** A local write that failed, in the words the panel shows where it has them, carrying why it failed */
const localFailure = (error: unknown): unknown => {
  const said = error instanceof GitError ? saidOfLocal(error.code) : undefined
  return said && error instanceof GitError ? new GitError(said, error.code) : error
}

/** How long the branch a pull request is based on is kept before it is worked out again */
const PR_BASE_KEPT_MS = 5000
/** How far back a branch's tip may be for it to be the branch this one was made from */
const PARENT_BRANCH_SEARCH_DEPTH = 25

export class AppGitRepository extends GitRepository {
  private lastFetchTimestamp = 0
  private autoFetchEnabled = false
  private fetchThrottleMs = 180_000
  /** Whether a fetch is running, so a second is not started beside it */
  private fetching = false
  /** Whether fetching by itself has stopped because the remote wanted credentials nobody was there to give */
  private autoFetchSuspended = false
  private suspendedSignIn: SignInHelp | undefined
  private forceFetchNext = false
  private prBase: { branch: string; at: number } | undefined

  constructor(workingDirectory: string, ties: RepositoryTies = APP_TIES) {
    super(workingDirectory, ties)
    this.suspend(false)
  }

  /**
   * Whether fetching by itself has stopped is shown with the checkout's status, so the engine is told: its next
   * check then reads a change to it as a change to the status
   */
  private suspend(suspended: boolean): void {
    this.autoFetchSuspended = suspended
    this.setStatusNote(suspended ? 'not fetching' : 'fetching')
  }

  setFetchConfig(enabled: boolean, intervalSeconds: number): void {
    this.autoFetchEnabled = enabled
    this.fetchThrottleMs = intervalSeconds * 1000
    // The settings were changed, which is the user saying to try again
    this.suspend(false)
  }

  /**
   * Whether fetching by itself has stopped because the remote asked for credentials. What the checkout knows of
   * its remote is then as old as the last fetch that worked, which a panel showing it says
   */
  get isAutoFetchSuspended(): boolean {
    return this.autoFetchSuspended
  }

  /** What can be done about the sign-in the remote asked for when fetching by itself stopped */
  get autoFetchSignIn(): SignInHelp | undefined {
    return this.autoFetchSuspended ? this.suspendedSignIn : undefined
  }

  /**
   * What can be done about a sign-in the remote this branch follows asked for, from that remote's address as
   * git would use it. Nothing where there is no remote, or it is a path here.
   */
  async signInHelp(): Promise<SignInHelp | undefined> {
    const address = await this.getRemoteUrl()
    return address ? signInHelpFor(address) : undefined
  }

  /** Fetching by itself starts again, at once: the user signed in, which is them saying to try */
  resumeAutoFetch(): void {
    this.suspend(false)
    this.forceFetchNext = true
  }

  /** Fetches the next time one is considered, whatever the fetch settings and the time since the last say */
  forceFetchOnce(): void {
    this.forceFetchNext = true
  }

  /**
   * Fetches from the remote when one is due — it was forced, or the fetch settings ask for it and their interval
   * has passed — and says whether it did. **Never part of a read**: whoever asked for the repository has its
   * answer already, and what the fetch brings is found by the check that follows it.
   *
   * It stops fetching by itself once the remote wants credentials nobody is there to give, since every later try
   * would fail the same way; changing the fetch settings, or a push or pull that works, starts it again.
   */
  async fetchIfDue(): Promise<boolean> {
    if (this.fetching) return false
    if (!this.forceFetchNext) {
      if (!this.autoFetchEnabled || this.autoFetchSuspended) return false
      if (Date.now() - this.lastFetchTimestamp < this.fetchThrottleMs) return false
    }
    this.fetching = true
    try {
      // Nothing to fetch for a branch that follows no remote one, and not a reason to forget a forced fetch
      if (!(await this.readSnapshot()).hasUpstream) return false
      this.forceFetchNext = false
      this.lastFetchTimestamp = Date.now()
      const result = await this.fetch()
      if (result.code === 'authentication') {
        this.suspendedSignIn = await this.signInHelp()
        this.suspend(true)
        logger.warn('Fetching by itself has stopped for this repository: the remote asked for credentials', { error: result.error })
      }
      return result.success
    } catch {
      return false
    } finally {
      this.fetching = false
    }
  }

  override async commit(message: string): Promise<void> {
    await super.commit(message).catch((error: unknown) => { throw localFailure(error) })
  }

  override async worktreeAdd(wtPath: string, branch?: string, createBranch?: boolean): Promise<string> {
    return super.worktreeAdd(wtPath, branch, createBranch).catch((error: unknown) => { throw localFailure(error) })
  }

  /** The push running, which `stopPush` stops */
  private pushing: AbortController | undefined

  override async pushBranch(onProgress?: (progress: GitProgress) => void, signal?: AbortSignal): Promise<void> {
    const pushing = new AbortController()
    this.pushing = pushing
    try {
      await super.pushBranch(onProgress, signal ? AbortSignal.any([signal, pushing.signal]) : pushing.signal)
        .catch((error: unknown) => { throw remoteFailure('push', error) })
    } finally {
      if (this.pushing === pushing) this.pushing = undefined
    }
    // A push moved the remote's refs here too, so a fetch is not due
    this.lastFetchTimestamp = Date.now()
    this.suspend(false)
  }

  /**
   * Stops the push running, ending git and what it started; the push then rejects coded `aborted`. Whether there
   * was one to stop. Only a push: a stopped push leaves the working tree and the index as they were
   */
  stopPush(): boolean {
    if (!this.pushing) return false
    this.pushing.abort()
    return true
  }

  override async pullBranch(onProgress?: (progress: GitProgress) => void): Promise<void> {
    await super.pullBranch(onProgress).catch((error: unknown) => { throw remoteFailure('pull', error) })
    // A pull fetched already
    this.lastFetchTimestamp = Date.now()
    this.suspend(false)
  }

  override clearCache(): void {
    this.prBase = undefined
    super.clearCache()
  }

  override invalidateCache(paths?: string[]): void {
    // A change under `.git` may be a branch made, moved or checked out
    if (!paths || paths.length === 0 || paths.some(changed => changed.includes('.git'))) this.prBase = undefined
    super.invalidateCache(paths)
  }

  /**
   * The branch a pull request of this one would be based on: what the branch was made from where that was written
   * down, and otherwise the nearest branch by commits, falling back to the repository's default branch.
   */
  async getPRBaseBranch(): Promise<string> {
    if (this.prBase && Date.now() - this.prBase.at <= PR_BASE_KEPT_MS) return this.prBase.branch
    const keep = (branch: string) => {
      this.prBase = { branch, at: Date.now() }
      return branch
    }

    // What the branch was made from is known where it was written down, and guessed from the commits otherwise
    const current = await this.getCurrentBranch().catch(() => 'HEAD')
    const remembered = current === 'HEAD' ? undefined : await this.rememberedBaseOf(current).catch(() => undefined)
    if (remembered) return keep(remembered)

    const defaultBase = await this.getBaseBranch({ preferUpstream: false })

    // Try to find a closer parent branch via merge-base distance
    try {
      const closestParent = await this.findClosestParentBranch(defaultBase)
      if (closestParent) return keep(closestParent)
    } catch {
      // Fall through to default
    }

    return keep(defaultBase)
  }

  /**
   * Find the closest parent branch by comparing merge-base distances.
   * When branching feature-B from feature-A, feature-A will have a much
   * smaller commit distance than main/master.
   */
  private async findClosestParentBranch(defaultBase: string): Promise<string | null> {
    const currentBranch = await this.getCurrentBranch()

    // Only check branches whose tip is within recent commits AND merged into HEAD
    const candidates = await this.getNearbyMergedBranches(PARENT_BRANCH_SEARCH_DEPTH)
    const filtered = candidates.filter(b =>
      b !== currentBranch && b !== defaultBase && b !== 'HEAD'
    )
    if (filtered.length === 0) return null

    // For merged branches, tip = merge-base, so rev-list --count <branch>..HEAD gives distance directly
    const [defaultDistance, ...distances] = await Promise.all([
      this.getCommitDistance(defaultBase),
      ...filtered.map(b => this.getCommitDistance(b)),
    ])

    if (defaultDistance === undefined || defaultDistance <= 0) return null

    let closestBranch: string | null = null
    let closestDistance = defaultDistance

    for (let i = 0; i < filtered.length; i++) {
      const distance = distances[i]
      if (distance !== undefined && distance > 0 && distance < closestDistance) {
        closestDistance = distance
        closestBranch = filtered[i] ?? null
      }
    }

    return closestBranch
  }

  /** Check if a file path is an image based on extension. */
  isImageFile(filePath: string): boolean {
    return getImageMimeType(filePath) !== null
  }

  /** A file as a base64 data URL if it is an image, and as text otherwise: empty when there is no such file */
  async getFileContentAsDataUrl(filePath: string, version: 'HEAD' | 'working' | 'index' = 'working'): Promise<string> {
    const mimeType = getImageMimeType(filePath)
    if (!mimeType) {
      return this.getFileContent(filePath, version)
    }
    const buffer = await this.getFileBytes(filePath, version)
    if (!buffer || (version !== 'working' && buffer.length === 0)) return ''
    return `data:${mimeType};base64,${buffer.toString('base64')}`
  }

  /** A file as a branch has it, as a base64 data URL if it is an image and as text otherwise */
  async getFileContentFromBranchAsDataUrl(filePath: string, branch: string): Promise<string> {
    const mimeType = getImageMimeType(filePath)
    if (!mimeType) {
      return this.getFileContentFromBranch(filePath, branch)
    }
    try {
      const buffer = await this.getFileBytesFromBranch(filePath, branch)
      if (!buffer || buffer.length === 0) return ''
      return `data:${mimeType};base64,${buffer.toString('base64')}`
    } catch (error) {
      // An image a partial clone was not given is said to be missing, as any other file is, and not shown as none
      if ((error as { code?: string }).code === 'content-missing') throw error
      return ''
    }
  }
}

/** The repository of a working directory, as this app runs it */
/** A working directory's repository, run with the git the user set or the first found (`resolveGitPath`) */
export const openGitRepository = (workingDirectory: string): AppGitRepository =>
  new AppGitRepository(workingDirectory, { ...APP_TIES, git: resolveGitPath() })

/** The watcher of a working directory's repository, logging where this app logs */
export const openGitWatcher = (workingDirectory: string): GitWatcherService =>
  new GitWatcherService(workingDirectory, { log: { error: (message, data) => watcherLogger.error(message, data) } })

// The system's context is part of the pack's published contract, which names no type of the engine's: it holds the
// repository and its watcher as handles, and the feature's own code reads them here as what they are.

export const repositoryOf = (handle: RepositoryHandle | null): AppGitRepository | null => handle as unknown as AppGitRepository | null
export const watcherOf = (handle: WatcherHandle | null): GitWatcherService | null => handle as unknown as GitWatcherService | null
export const repositoryHandle = (opened: AppGitRepository | null): RepositoryHandle | null => opened as unknown as RepositoryHandle | null
export const watcherHandle = (watcher: GitWatcherService | null): WatcherHandle | null => watcher as unknown as WatcherHandle | null
