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
  readonly directory: string;
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
export function createInputSubscriptions(refused: (directory: string, error: unknown) => Error): InputSubscriptions {
  interface Held { receive: fs.WatchListener<string>; readonly native: fs.FSWatcher }
  const held = new Map<string, Held>();
  const open = (subscription: InputSubscription): Held => {
    const { key, directory, recursive } = subscription;
    const entry: Held = {
      receive: subscription.receive,
      native: fs.watch(directory, { recursive }, (event, file) => {
        if (held.get(key) === entry) entry.receive(event, file);
      }),
    };
    entry.native.on('error', error => {
      if (held.get(key) !== entry || isVanishedSubdirectory(error, directory)) return;
      refused(directory, error);
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
        throw refused(wanted.find(subscription => !held.has(subscription.key) && !opened.has(subscription.key))?.directory ?? '', error);
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
