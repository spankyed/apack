import * as fs from 'node:fs';

/**
 * Whether a watcher's error is only a directory below `directory` going away while Node's recursive watch scanned it, as
 * a build's temporary output does. Node reports that and goes on watching, and the removal is an event of its own, so it
 * is no reason to stop. The watched directory itself going away is.
 */
export function isVanishedSubdirectory(error: unknown, directory: string): boolean {
  const { code, path: scanned } = error as NodeJS.ErrnoException;
  return code === 'ENOENT' && typeof scanned === 'string' && scanned !== directory && fs.existsSync(directory);
}

export interface InputSubscription {
  /** Same key, same handle: only `receive` is replaced. */
  readonly key: string;
  /** A directory, or on macOS a file, which libuv watches with kqueue rather than FSEvents. */
  readonly path: string;
  readonly recursive: boolean;
  readonly receive: fs.WatchListener<string>;
}

export interface InputSubscriptions {
  /**
   * Holds exactly `wanted`, opening and closing only the difference. True when a handle opened or closed, which is the
   * caller's cue to compare its inputs again, because that change may have lost events on every other handle.
   */
  hold(wanted: readonly InputSubscription[]): boolean;
  close(): void;
}

/**
 * The file watches of one process's build inputs, kept open for as long as they are wanted.
 *
 * On macOS, libuv serves every `fs.watch` on a directory in a process from one FSEvents stream. Opening or closing any of
 * them rebuilds that stream from "now", which discards what it had not yet delivered, for every handle. Under load that
 * can be many seconds of edits. So a watch that is still wanted stays open, and a caller re-reads its inputs whenever
 * `hold` says the set moved.
 *
 * @param refused builds the error for a watch that could not open or that later failed, and reports it
 */
export function createInputSubscriptions(refused: (watched: string, error: unknown) => Error): InputSubscriptions {
  interface Held { receive: fs.WatchListener<string>; readonly native: fs.FSWatcher }
  const held = new Map<string, Held>();
  const open = (subscription: InputSubscription): Held => {
    const { key, path: watched, recursive } = subscription;
    const entry: Held = {
      receive: subscription.receive,
      native: fs.watch(watched, { recursive }, (event, file) => {
        if (held.get(key) === entry) entry.receive(event, file);
      }),
    };
    entry.native.on('error', error => {
      if (held.get(key) !== entry || isVanishedSubdirectory(error, watched)) return;
      refused(watched, error);
    });
    return entry;
  };
  return {
    hold(wanted) {
      const keys = new Set(wanted.map(subscription => subscription.key));
      const opened = new Map<string, Held>();
      try {
        for (const subscription of wanted) {
          if (held.has(subscription.key) || opened.has(subscription.key)) continue;
          opened.set(subscription.key, open(subscription));
        }
      } catch (error) {
        for (const entry of opened.values()) entry.native.close();
        throw refused(wanted.find(subscription => !held.has(subscription.key) && !opened.has(subscription.key))?.path ?? '', error);
      }
      const retired = [...held].filter(([key]) => !keys.has(key));
      for (const [key, entry] of retired) { held.delete(key); entry.native.close(); }
      for (const [key, entry] of opened) held.set(key, entry);
      for (const subscription of wanted) held.get(subscription.key)!.receive = subscription.receive;
      return opened.size > 0 || retired.length > 0;
    },
    close() {
      for (const entry of held.values()) entry.native.close();
      held.clear();
    },
  };
}

export interface FileWatch {
  readonly file: string;
  /** Called when the file may have changed: an event, or a change found once a new watch is armed. */
  readonly receive: () => void;
}

export interface FileWatches {
  /** Holds a kqueue watch on each file that exists, reopening one whose file was replaced. */
  hold(files: readonly FileWatch[]): void;
  close(): void;
}

/**
 * Watches on single files, which reach an edit when FSEvents does not.
 *
 * On macOS FSEvents can deliver an event minutes or hours late, or never, for every process at once. libuv watches a
 * single file with kqueue instead, which tells this process directly. A watch is keyed by the file's inode, because a
 * save that replaces the file leaves the old watch on a file nobody reads; the next `hold` opens one on the new file.
 *
 * kqueue arms a watch when the event loop next polls, so an edit between opening it and that poll goes unseen. Each new
 * watch therefore re-reads its file's identity after the poll, and calls `receive` when it moved. An edit after an
 * event needs no such check: the event has already asked for a read, and that read sees the edit.
 *
 * kqueue also delivers on a poll, so a `hold` in the same turn as a save that replaced or deleted a file closes the old
 * watch with its event undelivered, and takes the new file as it already is. A watch closed by `hold` before it reported
 * its file going (a `rename` event) therefore calls `receive` itself.
 *
 * Elsewhere this holds nothing: a file watch there is no different from the directory watches the caller has. A watch
 * that cannot open (too many open files, say) warns once and leaves the caller on its directory watches.
 */
export function createFileWatches(warn: (message: string) => void, platform: NodeJS.Platform = process.platform): FileWatches {
  type Identity = { readonly ino: number; readonly dev: number; readonly mtimeMs: number; readonly size: number };
  const identityOf = (stats: fs.Stats | undefined): Identity | undefined =>
    stats && { ino: stats.ino, dev: stats.dev, mtimeMs: stats.mtimeMs, size: stats.size };
  let failed = false;
  // Each held watch's key, and whether it has reported its file being replaced or deleted
  let held = new Map<string, { receive: () => void; gone: boolean }>();
  const subscriptions = createInputSubscriptions((watched, error) => {
    const refusal = new Error(`Cannot watch "${watched}": ${String(error)}`, { cause: error });
    if (!failed) {
      failed = true;
      warn(`[watch] Watching files one by one stopped (${refusal.message}); edits are seen through directory watches only`);
      queueMicrotask(() => subscriptions.close());
    }
    return refusal;
  });
  return {
    hold(files) {
      if (platform !== 'darwin' || failed) return;
      const wanted: InputSubscription[] = [];
      const fresh: Array<{ file: string; identity: Identity; receive: () => void }> = [];
      const receivers = new Map<string, () => void>();
      for (const { file, receive } of files) {
        const identity = identityOf(fs.statSync(file, { throwIfNoEntry: false }));
        if (!identity) continue;
        const key = JSON.stringify([file, identity.ino, identity.dev]);
        wanted.push({ key, path: file, recursive: false, receive: event => {
          const watch = held.get(key);
          if (watch && event === 'rename') watch.gone = true;
          receive();
        } });
        receivers.set(key, receive);
        if (!held.has(key)) fresh.push({ file, identity, receive });
      }
      try { subscriptions.hold(wanted); }
      catch { subscriptions.close(); return; }
      const previous = held;
      held = new Map([...receivers].map(([key, receive]) => [key, previous.get(key) ?? { receive, gone: false }]));
      for (const [key, watch] of previous) if (!held.has(key) && !watch.gone) watch.receive();
      if (fresh.length === 0) return;
      // Resolves on the poll that armed the new watches; only a read started after it sees what they would miss
      const polled = fs.promises.stat(fresh[0]!.file).catch(() => undefined);
      for (const { file, identity, receive } of fresh) {
        void polled.then(() => fs.promises.stat(file)).then(identityOf, () => undefined).then(now => {
          if (failed || JSON.stringify(now) !== JSON.stringify(identity)) receive();
        });
      }
    },
    close() {
      held = new Map();
      subscriptions.close();
    },
  };
}
