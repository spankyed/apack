import * as path from 'path'
import * as chokidar from 'chokidar'
import { realpathSync } from 'fs'
import { GitRepository } from './git.ts'
import { createLogger } from '@apackdev/sdk/logger'

const logger = createLogger('git-watcher')

export interface FileChangeInfo {
  path: string
  modifiedAt: Date
  changeType: 'add' | 'change' | 'unlink'
}

/** How long the repository must go quiet before a change is announced */
const REPOSITORY_QUIET_MS = 500
/** The same once one of this app's own git writes has finished: its lock is already released */
const REPOSITORY_QUIET_AFTER_WRITE_MS = 100
/** The longest a change waits for quiet, so a steady stream of writes cannot postpone it without end */
const REPOSITORY_MAX_WAIT_MS = 2000
/** How long one open file must go quiet before its change is announced */
const OPEN_FILE_QUIET_MS = 300

/** Files in a checkout's own git directory whose change means its status did */
const GIT_DIR_FILES = ['index', 'HEAD', 'ORIG_HEAD', 'FETCH_HEAD', 'MERGE_HEAD', 'REBASE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD']
/** The same in the common git directory, which a linked worktree shares with its main checkout */
const COMMON_DIR_PATHS = ['refs', 'packed-refs']

/** Directories and files a working tree's changes are not reported from */
const WORKING_TREE_IGNORED = [
  '**/.git/**',
  '**/node_modules/**',
  '**/dist/**', '**/build/**', '**/out/**', '**/.next/**',
  '**/.vscode/**', '**/.idea/**', '**/.DS_Store', '**/Thumbs.db',
  '**/logs/**', '**/*.log',
  '**/.cache/**', '**/tmp/**', '**/temp/**',
  '**/coverage/**', '**/.nyc_output/**',
]

export class GitWatcherService {
  private gitWatcher?: chokidar.FSWatcher
  private workingDirWatcher?: chokidar.FSWatcher
  private onGitChangeCallback?: () => void
  private onFileChangeCallback?: (change: FileChangeInfo) => void
  private gitStatusDebounceTimeout?: NodeJS.Timeout
  /** When the first change not yet announced arrived */
  private repositoryChangePendingSince?: number
  /** Whether a callback is already waiting on the repository's write in progress */
  private awaitingWrite = false
  private fileChangeTimeouts: Map<string, NodeJS.Timeout> = new Map()
  private isWatching = false
  /** Whether the working directory is in a repository; outside one, only the open files are watched */
  private inRepository = false
  /** Open files by the path they are compared under, each holding the path it was registered with */
  private openFiles: Map<string, string> = new Map()
  private realDirectories: Map<string, string> = new Map()
  private gitRepository?: GitRepository

  constructor(private workingDirectory: string) {}

  setGitRepository(repo: GitRepository): void {
    this.gitRepository = repo
  }

  setChangeCallback(callback: () => void) {
    this.onGitChangeCallback = callback
  }

  setFileChangeCallback(callback: (change: FileChangeInfo) => void) {
    this.onFileChangeCallback = callback
  }

  /**
   * The path a file is compared under: its directory's real path and its name. An open file and the event for
   * it can name one file two ways, through a symlinked directory or in another letter case, and would not
   * match as written.
   */
  private comparablePath(filePath: string): string {
    const resolved = path.resolve(filePath)
    const directory = path.dirname(resolved)
    let real = this.realDirectories.get(directory)
    if (real === undefined) {
      try {
        real = realpathSync.native(directory)
        this.realDirectories.set(directory, real)
      } catch {
        real = directory
      }
    }
    return path.join(real, path.basename(resolved))
  }

  registerOpenFile(filePath: string): void {
    this.openFiles.set(this.comparablePath(filePath), filePath)
    if (this.isWatching && !this.inRepository) this.workingDirWatcher?.add(path.resolve(filePath))
  }

  unregisterOpenFile(filePath: string): void {
    this.openFiles.delete(this.comparablePath(filePath))
    if (this.isWatching && !this.inRepository) this.workingDirWatcher?.unwatch(path.resolve(filePath))
  }

  isFileOpen(filePath: string): boolean {
    return this.openFiles.has(this.comparablePath(filePath))
  }

  getOpenFiles(): string[] {
    return Array.from(this.openFiles.values())
  }

  async startWatching(signal: AbortSignal): Promise<void> {
    if (this.isWatching || signal.aborted) {
      return
    }

    // Git says where its state lives: the working directory may be a subfolder of the checkout or a linked
    // worktree, and neither keeps a `.git` directory of its own holding the refs.
    const directories = await this.gitRepository?.resolveGitDirectories() ?? null

    // Do not create handles after the owner cancels asynchronous filesystem preflight.
    if (this.isWatching || signal.aborted) return
    this.isWatching = true
    this.inRepository = directories !== null

    const report = (changeType: FileChangeInfo['changeType']) => (filePath: string) => this.handleFileChange(changeType, filePath)

    if (!directories) {
      // No repository to report on, and no bound on what the directory holds: watch the open files alone.
      logger.info('Not in a git repository, watching open files only')
      this.workingDirWatcher = chokidar.watch([...this.openFiles.values()].map(file => path.resolve(file)), {
        persistent: true,
        ignoreInitial: true,
        followSymlinks: false,
        awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
      })
      this.workingDirWatcher
        .on('change', report('change'))
        .on('add', report('add'))
        .on('unlink', report('unlink'))
        .on('error', (error) => { logger.error('Open file watcher error', { error }) })
      return
    }

    this.gitWatcher = chokidar.watch([
      ...GIT_DIR_FILES.map(name => path.join(directories.gitDir, name)),
      ...COMMON_DIR_PATHS.map(name => path.join(directories.commonDir, name)),
    ], {
      persistent: true,
      ignoreInitial: true,
      // Don't follow symlinks to avoid watching outside .git
      followSymlinks: false,
      // Dot files, and the lock files git holds while it writes a ref
      ignored: [/\/\.[^/]+$/, /\.lock$/],
      awaitWriteFinish: {
        stabilityThreshold: 200,
        pollInterval: 100
      }
    })

    this.gitWatcher
      .on('change', report('change'))
      .on('add', report('add'))
      .on('unlink', report('unlink'))
      .on('error', (error) => {
        logger.error('Git watcher error', { error })
      })
      .on('ready', () => {
        logger.info('Git watcher ready')
      })

    // Watch working directory for file changes (unstaged changes)
    this.workingDirWatcher = chokidar.watch(this.workingDirectory, {
      persistent: true,
      ignoreInitial: true,
      followSymlinks: false,
      ignored: WORKING_TREE_IGNORED,
      awaitWriteFinish: {
        stabilityThreshold: 300,
        pollInterval: 100
      }
    })

    this.workingDirWatcher
      .on('change', report('change'))
      .on('add', report('add'))
      .on('unlink', report('unlink'))
      .on('error', (error) => {
        logger.error('Working directory watcher error', { error })
      })
      .on('ready', () => {
        logger.info('Working directory watcher ready')
      })
  }

  private handleFileChange(changeType: FileChangeInfo['changeType'], filePath: string) {
    if (!this.isWatching) return
    if (this.inRepository) this.scheduleRepositoryChange()
    if (this.openFiles.size > 0 && this.onFileChangeCallback) this.scheduleOpenFileChange(changeType, filePath)
  }

  /** One announcement for every change that arrives close together */
  private scheduleRepositoryChange() {
    this.repositoryChangePendingSince ??= Date.now()

    // While one of this app's git writes runs, wait for it to finish instead of racing it on a timer
    if (this.gitRepository?.isWriteInProgress) {
      clearTimeout(this.gitStatusDebounceTimeout)
      this.gitStatusDebounceTimeout = undefined
      if (this.awaitingWrite) return
      this.awaitingWrite = true
      this.gitRepository.onWriteComplete(() => {
        this.awaitingWrite = false
        if (!this.isWatching || this.repositoryChangePendingSince === undefined) return
        this.armRepositoryChange(REPOSITORY_QUIET_AFTER_WRITE_MS)
      })
      return
    }
    this.armRepositoryChange(REPOSITORY_QUIET_MS)
  }

  private armRepositoryChange(quietMs: number) {
    clearTimeout(this.gitStatusDebounceTimeout)
    const waited = Date.now() - (this.repositoryChangePendingSince ?? Date.now())
    const delay = Math.max(0, Math.min(quietMs, REPOSITORY_MAX_WAIT_MS - waited))
    this.gitStatusDebounceTimeout = setTimeout(() => {
      this.gitStatusDebounceTimeout = undefined
      this.repositoryChangePendingSince = undefined
      this.onGitChangeCallback?.()
    }, delay)
  }

  /** Per file, so a change to one open file is never dropped for a change to another */
  private scheduleOpenFileChange(changeType: FileChangeInfo['changeType'], filePath: string) {
    const comparable = this.comparablePath(filePath)
    const registered = this.openFiles.get(comparable)
    if (registered === undefined) return

    clearTimeout(this.fileChangeTimeouts.get(comparable))
    this.fileChangeTimeouts.set(comparable, setTimeout(() => {
      this.fileChangeTimeouts.delete(comparable)
      this.onFileChangeCallback?.({ path: registered, modifiedAt: new Date(), changeType })
    }, OPEN_FILE_QUIET_MS))
  }

  async stopWatching(): Promise<void> {
    const watchers = [this.gitWatcher, this.workingDirWatcher];
    this.gitWatcher = undefined;
    this.workingDirWatcher = undefined;
    this.isWatching = false
    this.inRepository = false
    this.onGitChangeCallback = undefined;
    this.onFileChangeCallback = undefined;

    // Clear all debounce timeouts
    clearTimeout(this.gitStatusDebounceTimeout)
    this.gitStatusDebounceTimeout = undefined
    this.repositoryChangePendingSince = undefined
    this.awaitingWrite = false

    for (const timeout of this.fileChangeTimeouts.values()) {
      clearTimeout(timeout)
    }
    this.fileChangeTimeouts.clear()

    this.openFiles.clear()
    this.realDirectories.clear()
    await Promise.all(watchers.map(watcher => watcher?.close()));
  }

  isActive(): boolean {
    return this.isWatching
  }
}
