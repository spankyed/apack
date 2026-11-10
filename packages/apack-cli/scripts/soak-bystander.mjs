// Beside the soak's watcher and sharing nothing with it: its own process, so its own file-event streams. It makes each
// edit, since the watcher's process blocks for the whole of an input read, and reports whether the event for it arrived
// on two routes: `fs.watch` on a directory, which `tsup --watch` and the pack watcher's directory watches use, and
// chokidar 3 over the `fsevents` package, which Vite's dev server uses, with Vite's default options. Each message carries
// this process's clock, since the watcher's process reads its messages late.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { watch } from 'chokidar';

const [directory, probe] = process.argv.slice(2);
fs.watch(directory, { recursive: true }, (_event, file) => {
  if (file && path.join(directory, file) === probe) process.send({ type: 'event', at: Date.now() });
});
const viteRoute = watch(directory, {
  ignored: ['**/.git/**', '**/node_modules/**', '**/test-results/**'], ignoreInitial: true, ignorePermissionErrors: true,
});
viteRoute.on('all', (_event, file) => {
  if (path.resolve(file) === probe) process.send({ type: 'vite-event', at: Date.now() });
});
process.on('message', ({ text, delayMs, replace }) => {
  setTimeout(() => {
    // Editors save both ways: writing the file in place, or writing a new file and renaming it over the old
    if (replace) { fs.writeFileSync(`${probe}.tmp`, text); fs.renameSync(`${probe}.tmp`, probe); }
    else fs.writeFileSync(probe, text);
    process.send({ type: 'wrote', text, at: Date.now() });
  }, delayMs);
});
process.on('disconnect', () => process.exit(0));
viteRoute.on('ready', () => process.send({ type: 'ready' }));
