import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { watch, type FSWatcher } from 'chokidar';
import type { BuildWatchInputs } from './build-watch-inputs.ts';
import { physicalWatchPath, relativeCompilerPath } from '@apackdev/host/build/compiler-inputs';
import { createInputSubscriptions, type InputSubscription } from './input-subscriptions.ts';

const inside = (root: string, file: string) => {
  const relative = relativeCompilerPath(root, file);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};

export interface FrontendInputSnapshot {
  readonly hash: string;
  current(): boolean;
}

/**
 * Compiler observations drive ready subscriptions, never output reuse.
 * @param packageOutputs what a package build writes, whose bytes reach a pack build through the package signature
 * @param resubscribed called when the watches held changed, which may have lost events on every other watch in the process
 */
export function createFrontendWatcher(root: string, dataDirectory: string | undefined, changed: (file: string) => void, failed: (error: Error) => void, packageOutputs: readonly string[] = [], resubscribed: () => void = () => {}) {
  const authored = [...new Set([path.resolve(root), fs.realpathSync(root)])];
  const data = dataDirectory ? [...new Set([path.resolve(dataDirectory), physicalWatchPath(path.resolve(dataDirectory))])] : [];
  const files = new Set<string>();
  const directories = new Set<string>();
  let linkedInputs = new Set<string>();
  // Retired subscriptions remain owned until their asynchronous close settles.
  const subscriptions = new Map<FSWatcher, { closing?: Promise<void> }>();
  const live = (watcher: FSWatcher) => {
    const owned = subscriptions.get(watcher);
    return owned !== undefined && !owned.closing;
  };
  let current: FSWatcher[] = [];
  let currentRoots = '';
  let namespace = 0;
  let closed = false;
  let failure: Error | undefined;
  let closeTask: Promise<void> | undefined;
  let notified: string | undefined;
  let signalClose!: () => void;
  const closing = new Promise<void>(resolve => { signalClose = resolve; });
  const excluded = (file: string) => authored.some(root => inside(root, file));
  const normalize = (paths: readonly string[]) => {
    const selected = new Set<string>();
    const physical = new Map<string, string>();
    for (const file of paths) {
      for (const name of [file, physicalWatchPath(file, physical)]) if (!excluded(name)) selected.add(name);
    }
    return selected;
  };
  const directoryInputs = (contentDirectories: ReadonlySet<string>) => {
    const hash = createHash('sha256');
    const links = new Set<string>();
    const visited = new Set<string>();
    const visit = (directory: string) => {
      const physical = physicalWatchPath(directory);
      hash.update(JSON.stringify([directory, physical]));
      if (excluded(physical) || visited.has(physical)) return;
      visited.add(physical);
      for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
        const file = path.join(directory, entry.name);
        if (excluded(file)) continue;
        if (entry.isSymbolicLink()) {
          const target = physicalWatchPath(file);
          hash.update(JSON.stringify([file, fs.readlinkSync(file), target]));
          if (excluded(target)) continue;
          links.add(target);
          if (fs.statSync(file, { throwIfNoEntry: false })?.isDirectory()) visit(target);
          continue;
        }
        hash.update(JSON.stringify([file, entry.isDirectory()]));
        if (entry.isDirectory()) visit(file);
      }
    };
    for (const directory of [...contentDirectories].sort()) {
      hash.update(JSON.stringify(directory));
      try { visit(directory); } catch (error) { hash.update(String((error as NodeJS.ErrnoException).code)); }
    }
    return { hash: hash.digest('hex'), links };
  };
  const signature = (selected: ReadonlySet<string>, contentDirectories: ReadonlySet<string>) => {
    const hash = createHash('sha256').update(String(namespace));
    for (const file of [...selected].sort()) {
      hash.update(JSON.stringify(file));
      try { hash.update(fs.realpathSync.native(file)).update(fs.readFileSync(file)); }
      catch (error) { hash.update(String((error as NodeJS.ErrnoException).code)); }
    }
    return hash.update(directoryInputs(contentDirectories).hash).digest('hex');
  };
  const snapshot = (selected = new Set(files)): FrontendInputSnapshot => {
    const contentDirectories = new Set(directories);
    const hash = signature(selected, contentDirectories);
    return { hash, current: () => signature(selected, contentDirectories) === hash };
  };
  const contentLink = (file: string) => [...directories, ...linkedInputs].some(root => inside(root, file))
    && (fs.lstatSync(file, { throwIfNoEntry: false })?.isSymbolicLink() ?? false);
  const ignored = (file: string) => {
    if (excluded(file)) return true;
    try { if (excluded(physicalWatchPath(file)) && !contentLink(file)) return true; }
    catch { /* Broken links remain observable so their repair can trigger a build. */ }
    return ![...files].some(input => file === input || inside(file, input))
      && ![...directories, ...linkedInputs].some(root => inside(root, file) || inside(file, root))
      && (data.some(root => inside(root, file)) || file.split(/[\\/]/).includes('.git'));
  };
  const notify = (file: string, event?: string) => {
    if (closed || ignored(file)) return;
    let trackedLink = false;
    try { trackedLink = contentLink(file); }
    catch { /* An unreadable path still invalidates unknown namespace inputs. */ }
    // Link topology is in the directory signature; target metadata alone need not change inputs. New bytes in a file
    // the build never read can't change resolution, and a package build's writes are seen by the signature it runs
    // before. Their events can arrive long after that snapshot, so neither may count as a change during the build.
    const packageWrite = file.split(/[\\/]/).includes('.temp') || packageOutputs.some(output => file === output || inside(output, file));
    if (!files.has(file) && !trackedLink && event !== 'change' && !packageWrite) namespace++;
    const hash = signature(files, directories);
    if (hash === notified) return;
    notified = hash;
    changed(file);
  };
  const stop = async (watchers: readonly FSWatcher[]) => {
    const results = await Promise.allSettled(watchers.map(watcher => {
      const owned = subscriptions.get(watcher);
      if (!owned) return;
      return owned.closing ??= Promise.resolve().then(() => watcher.close()).finally(() => { subscriptions.delete(watcher); });
    }));
    const errors = results.flatMap(result => result.status === 'rejected' ? [result.reason] : []);
    if (errors.length) {
      const error = new AggregateError(errors, 'Could not close frontend input watchers');
      if (!closed) refuse(root, error);
      throw error;
    }
  };
  const close = (): Promise<void> => {
    if (!closeTask) { closed = true; signalClose(); guardWatches.close(); closeTask = stop([...subscriptions.keys()]); }
    return closeTask;
  };
  const refuse = (directory: string, error: unknown): Error => {
    if (!failure) {
      failure = new Error(`Cannot watch frontend input "${directory}": ${String(error)}`, { cause: error });
      const closing = close();
      failed(failure);
      void closing.catch(() => {});
    }
    return failure;
  };
  const guardWatches = createInputSubscriptions(refuse);
  async function subscribe() {
    if (failure) throw failure;
    if (closed) return;
    linkedInputs = directoryInputs(directories).links;
    const anchors = [...new Set([...files].map(file => path.dirname(file)).concat([...directories, ...linkedInputs]))].map(existingDirectory);
    const roots = [...new Set(anchors.map(directory => physicalWatchPath(directory)))].sort((a, b) => a.length - b.length);
    const selected = roots.filter((candidate, index) => !roots.slice(0, index).some(parent => inside(parent, candidate)));
    const guards = new Set<string>();
    for (const directory of anchors) {
      if (path.dirname(directory) === directory) throw new Error(`Frontend resources require a bounded source directory: ${directory}`);
      for (let child = directory; path.dirname(child) !== child; child = path.dirname(child)) guards.add(child);
    }
    const next: FSWatcher[] = [];
    const ready: Promise<void>[] = [];
    const selectedRoots = JSON.stringify(selected);
    const rootsMoved = selectedRoots !== currentRoots;
    if (rootsMoved && selected.length) {
      let watcher: FSWatcher;
      try { watcher = watch(selected, { ignoreInitial: true, followSymlinks: false, disableGlobbing: true, atomic: true, ignored }); }
      catch (error) { throw refuse(selected.join(', '), error); }
      subscriptions.set(watcher, {}); next.push(watcher);
      let initialized = false;
      watcher.on('all', (event, file) => { if (initialized && live(watcher)) notify(path.resolve(file), event); });
      ready.push(new Promise<void>((resolve, reject) => {
        watcher.once('ready', () => { initialized = true; resolve(); });
        watcher.on('error', error => {
          if (!live(watcher)) return;
          const failure = refuse(selected.join(', '), error);
          if (!initialized) reject(failure);
        });
      }));
    }
    try {
      const guardSubscriptions = [...guards].map((child): InputSubscription => {
        const identity = fs.statSync(child);
        const parent = path.dirname(child);
        return {
          key: JSON.stringify([child, identity.ino, identity.dev]), path: parent, recursive: false,
          receive(kind, file) {
            if (closed || kind !== 'rename' || (file && path.resolve(parent, file) !== child)) return;
            let stat: fs.Stats | undefined;
            try { stat = fs.statSync(child, { throwIfNoEntry: false }); } catch { notify(child); return; }
            if (!stat || stat.ino !== identity.ino || stat.dev !== identity.dev) notify(child);
          },
        };
      });
      const guardsMoved = guardWatches.hold(guardSubscriptions);
      await Promise.race([Promise.all(ready), closing]);
      if (closed) { await stop(next); if (failure) throw failure; return; }
      if (rootsMoved) {
        const previous = current;
        current = next;
        currentRoots = selectedRoots;
        await stop(previous);
      }
      if (closed) return;
      notified = signature(files, directories);
      if (rootsMoved || guardsMoved) resubscribed();
    } catch (error) { await stop(next); throw error; }
  }
  return {
    snapshot: () => snapshot(),
    async observe(inputs: BuildWatchInputs): Promise<FrontendInputSnapshot> {
      if (failure) throw failure;
      if (closed) return snapshot();
      const selected = normalize(inputs.files);
      selected.forEach(file => files.add(file));
      normalize(inputs.directories).forEach(directory => directories.add(directory));
      const before = snapshot(selected);
      await subscribe();
      return before;
    },
    async accept(inputs: BuildWatchInputs): Promise<void> {
      if (failure) throw failure;
      if (closed) return;
      files.clear(); normalize(inputs.files).forEach(file => files.add(file));
      directories.clear();
      normalize(inputs.directories).forEach(directory => directories.add(directory));
      await subscribe();
    },
    close,
  };
}

function existingDirectory(file: string): string {
  while (true) {
    try { if (fs.statSync(file, { throwIfNoEntry: false })?.isDirectory()) return file; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOTDIR') throw error; }
    const parent = path.dirname(file);
    if (parent === file) throw new Error(`No existing frontend input directory: ${file}`);
    file = parent;
  }
}
