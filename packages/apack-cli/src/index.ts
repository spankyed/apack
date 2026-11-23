import * as fs from 'node:fs';
import * as path from 'node:path';
import { errorMessage } from '@apackdev/sdk/utils/pure';
import { runCommand } from './command-tree.ts';

const pkg = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'package.json'), 'utf-8'));

/**
 * Exit quietly when whatever is reading our stdout goes away.
 *
 * `apack profiles | head` closes the pipe under the writer, and an unhandled EPIPE crashes with a stack
 * trace that reads like a failure of the command. Every command could always hit this; none did, because
 * none printed more than fits the pipe buffer before the reader exits — `apack profiles` is the first
 * with a table long enough, which is how it was found.
 *
 * Only EPIPE: attaching a listener at all stops Node throwing on any stdout error, so anything else would
 * be swallowed silently, which is worse than the crash this prevents. `process.exit` is right here and
 * almost nowhere else — stdout is already closed, so there is nothing left to flush.
 *
 * `scripts/lib/exit-on-epipe.ts` is the same five lines for the repo's own orchestrators. Not imported:
 * `check:specifiers` refuses a package reaching into `scripts/`, because a module there belongs to no
 * package and `npm run spec` could not route a change to it back to anything that covers it.
 */
function exitOnEpipe(): void {
  process.stdout.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code !== 'EPIPE') throw err;
    process.exit(0);
  });
}

async function main() {
  exitOnEpipe();
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === '--help' || command === '-h') {
    await runCommand([]);
    return;
  }

  if (command === '--version' || command === '-v') {
    console.log(pkg.version);
    process.exit(0);
  }

  try {
    await runCommand(args);
  } catch (err) {
    console.error(errorMessage(err));
    process.exit(1);
  }
}

main();
