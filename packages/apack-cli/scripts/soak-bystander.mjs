// Beside the soak's watcher and sharing nothing with it: its own process, so its own file-event stream. It makes each
// edit, since the watcher's process blocks for the whole of an input read, and reports whether the event for it arrived.
import * as fs from 'node:fs';
import * as path from 'node:path';

const [directory, probe] = process.argv.slice(2);
fs.watch(directory, { recursive: true }, (_event, file) => {
  if (file && path.join(directory, file) === probe) process.send({ type: 'event' });
});
process.on('message', ({ text, delayMs, replace }) => {
  setTimeout(() => {
    // Editors save both ways: writing the file in place, or writing a new file and renaming it over the old
    if (replace) { fs.writeFileSync(`${probe}.tmp`, text); fs.renameSync(`${probe}.tmp`, probe); }
    else fs.writeFileSync(probe, text);
    process.send({ type: 'wrote', text });
  }, delayMs);
});
process.on('disconnect', () => process.exit(0));
process.send({ type: 'ready' });
