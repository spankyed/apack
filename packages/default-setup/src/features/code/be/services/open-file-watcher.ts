import * as path from 'path'
import * as fs from 'fs/promises'
import * as chokidar from 'chokidar'
import { createLogger } from '@apackdev/sdk/logger'

const logger = createLogger('open-file-watcher')

export interface FileChangeInfo {
  path: string
  modifiedAt: Date
  changeType: 'add' | 'change' | 'unlink'
}

/** How long one file must go quiet before it is looked at, so a save written in pieces is one change */
const QUIET_MS = 100

/** What a file looked like when last read: which file it is, when it was modified and how long it is; null when it is not there */
type Signature = { inode: number; mtime: Date; size: number } | null

interface OpenFile {
  /** The path the file was opened by, which is the one its changes are reported under */
  openedAs: string
  /** Undefined until the file has been looked at once */
  signature?: Signature
}

async function signatureOf(filePath: string): Promise<Signature> {
  try {
    const stat = await fs.stat(filePath)
    return { inode: stat.ino, mtime: stat.mtime, size: stat.size }
  } catch {
    return null
  }
}

/**
 * Reports when a file open in an editor changes on disk.
 *
 * **An event says to look; the file says what happened.** Each open file is remembered as it was last seen,
 * and a change is reported only when it differs from that — so an event that arrives for nothing is nothing,
 * and `check` finds a change no event was delivered for by looking at every open file again.
 *
 * Each file is watched on its own, by its own descriptor, whatever directory it is in: a file under a
 * directory git ignores is watched like any other, and no tree is ever walked to watch one file.
 */
export class OpenFileWatcher {
  private watcher?: chokidar.FSWatcher
  /** Open files by resolved path */
  private files = new Map<string, OpenFile>()
  private quietTimeouts = new Map<string, NodeJS.Timeout>()
  private closed = false

  constructor(private onChange: (change: FileChangeInfo) => void) {}

  open(filePath: string): void {
    if (this.closed) return
    const resolved = path.resolve(filePath)
    const known = this.files.get(resolved)
    if (known) {
      known.openedAs = filePath
      return
    }
    const file: OpenFile = { openedAs: filePath }
    this.files.set(resolved, file)
    void signatureOf(resolved).then((signature) => { file.signature ??= signature })

    this.watcher ??= chokidar.watch([], {
      persistent: true,
      ignoreInitial: true,
      followSymlinks: false,
      // One descriptor per file rather than the platform's directory events, which is what a handful of
      // exact paths wants; and a save that replaces the file is followed to the file that replaced it
      useFsEvents: false,
      usePolling: false,
      atomic: true,
    })
      .on('all', (_event, changedPath) => this.look(path.resolve(changedPath)))
      .on('error', (error) => { logger.error('Open file watcher error', { error }) })
    this.watcher.add(resolved)
  }

  close(filePath: string): void {
    const resolved = path.resolve(filePath)
    if (!this.files.delete(resolved)) return
    clearTimeout(this.quietTimeouts.get(resolved))
    this.quietTimeouts.delete(resolved)
    this.watcher?.unwatch(resolved)
  }

  isOpen(filePath: string): boolean {
    return this.files.has(path.resolve(filePath))
  }

  /** Looks at every open file again, reporting each that changed since it was last seen */
  async check(): Promise<void> {
    await Promise.all([...this.files.keys()].map(resolved => this.compare(resolved)))
  }

  private look(resolved: string) {
    if (!this.files.has(resolved)) return
    clearTimeout(this.quietTimeouts.get(resolved))
    this.quietTimeouts.set(resolved, setTimeout(() => {
      this.quietTimeouts.delete(resolved)
      void this.compare(resolved)
    }, QUIET_MS))
  }

  private async compare(resolved: string): Promise<void> {
    const now = await signatureOf(resolved)
    const file = this.files.get(resolved)
    if (this.closed || !file) return
    const before = file.signature
    file.signature = now
    // Not looked at before: this is what the file is, not a change to it
    if (before === undefined) return
    if (before?.inode === now?.inode && before?.mtime.getTime() === now?.mtime.getTime() && before?.size === now?.size) return
    // A save that replaced the file left the watch on the file it replaced, which nothing writes to again:
    // watch the path anew, so the next change is to the file that is there now
    if (now !== null && before?.inode !== now.inode) {
      this.watcher?.unwatch(resolved)
      this.watcher?.add(resolved)
      // A change made before the new watch is armed has no event: look once more
      this.look(resolved)
    }
    this.onChange({
      path: file.openedAs,
      modifiedAt: now ? now.mtime : new Date(),
      changeType: now === null ? 'unlink' : before === null ? 'add' : 'change',
    })
  }

  async stop(): Promise<void> {
    this.closed = true
    for (const timeout of this.quietTimeouts.values()) clearTimeout(timeout)
    this.quietTimeouts.clear()
    this.files.clear()
    const watcher = this.watcher
    this.watcher = undefined
    await watcher?.close()
  }
}
