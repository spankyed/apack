import * as fs from 'fs'
import * as path from 'path'

/** Where under a watched directory something changed, relative to it; `null` when the platform could not say */
export type WatchedChange = string | null

/**
 * Watches a directory and everything under it, apart from the directories `ignore` names relative to it.
 * An error means the watch has stopped reporting, or may have.
 */
export type SubscribeToDirectory = (
  directory: string,
  onChanges: (error: Error | null, changes: WatchedChange[]) => void,
  options: { ignore: string[] },
) => Promise<{ unsubscribe(): Promise<void> }>

/** The part of `fs.watch` a watch over a tree uses */
export type WatchTree = (
  directory: string,
  options: { recursive: true; persistent: false },
  listener: (eventType: string, filename: string | null) => void,
) => { on(event: 'error', listener: (error: Error) => void): unknown; close(): void }

/** `@parcel/watcher`'s `subscribe` */
export type ParcelSubscribe = (
  directory: string,
  onEvents: (error: Error | null, events: Array<{ path: string; type: 'create' | 'update' | 'delete' }>) => void,
  options: { ignore: string[] },
) => Promise<{ unsubscribe(): Promise<void> }>

/** Whether a path is one of these directories or under one, each named relative to the same root as the path */
function under(directories: string[]): (relativePath: string) => boolean {
  const named = new Set(directories.map(directory => path.normalize(directory)))
  return (relativePath) => {
    for (let end = relativePath.indexOf(path.sep); end !== -1; end = relativePath.indexOf(path.sep, end + 1)) {
      if (named.has(relativePath.slice(0, end))) return true
    }
    return named.has(relativePath)
  }
}

/**
 * Node's own recursive watch. The platform reports every change under the directory, so the ignored ones are
 * dropped here; a change to the watched directory itself arrives under that directory's own name. Deleting
 * the directory does not end the watch on macOS, where one made again at the path is reported on, and is an
 * error on Windows.
 */
export const nodeSubscriber = (watch: WatchTree = fs.watch): SubscribeToDirectory => async (directory, onChanges, { ignore }) => {
  const ignored = under(ignore)
  // Never the reason a process stays alive: whoever opened the watch closes it
  const watcher = watch(directory, { recursive: true, persistent: false }, (_eventType, filename) => {
    if (filename === null) onChanges(null, [null])
    else if (!ignored(filename)) onChanges(null, [filename])
  })
  watcher.on('error', error => onChanges(error, []))
  return { unsubscribe: async () => watcher.close() }
}

/**
 * `@parcel/watcher`, loaded on first use: a build that lacks its binary fails here, where the failure costs
 * this checkout its watching, rather than at import, where it would cost the pack its load.
 */
export const parcelSubscriber = (
  load: () => Promise<{ subscribe: ParcelSubscribe }> = () => import('./parcel-watcher.ts'),
): SubscribeToDirectory => async (directory, onChanges, options) => {
  const { subscribe } = await load()
  return subscribe(directory, (error, events) => {
    // Its watch ends with the directory it is on: one made again at the path is reported on by nothing
    const ended = error ?? (events.some(event => event.type === 'delete' && event.path === directory) ? new Error(`${directory} was deleted`) : null)
    onChanges(ended, ended ? [] : events.map(event => path.relative(directory, event.path)))
  }, options)
}

/**
 * The platform's watcher for a whole tree.
 *
 * macOS and Windows watch a tree natively, and Node's `fs.watch` is that watch. Linux has no watch over a
 * tree: `@parcel/watcher` holds one per directory it is not told to ignore, where Node's recursive watch there
 * holds one per file and reads the whole tree before it returns.
 *
 * **`@parcel/watcher` is not loaded on macOS or Windows, and nothing here checks whether it could be.** Its
 * macOS backend releases its event stream from two threads when a watched directory is deleted as its watch
 * closes, and its Windows one frees a subscription the kernel still writes to (parcel-bundler/watcher#271,
 * #262). Either corrupts the heap of the process that holds the user's database. Before moving a platform onto
 * it, close a watch as its directory is deleted, a few hundred times over, and see that the process survives.
 *
 * On Linux its `unsubscribe` rejects when a directory under the watch was deleted moments before, and leaves
 * some of the watch's inotify watches with the process. Whoever closes a watch catches the rejection
 * (`gitwatcher.ts`); nothing takes the watches back.
 */
export const subscribeToDirectory: SubscribeToDirectory =
  process.platform === 'darwin' || process.platform === 'win32' ? nodeSubscriber() : parcelSubscriber()
