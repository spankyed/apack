#!/usr/bin/env node
// Runs a command whose Node processes resolve workspace @apackdev/* packages to their source (the
// @apackdev/source condition in their package.json exports). The condition is appended to any
// NODE_OPTIONS the caller set, so their flags survive.
//
//   node scripts/with-source.mjs playwright test smoke
import { spawn } from 'node:child_process';
import { formatNodeOptions, parseNodeOptions } from '../packages/apack-host/src/build/node-options.js';
import { realpathSync } from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

export const SOURCE_CONDITION = '--conditions=@apackdev/source';

/**
 * `PATH` with this repo's `node_modules/.bin` in front, which is the one thing npm supplies and a bare
 * `node scripts/with-source.mjs …` does not.
 *
 * Without it the usage line above is a lie: the same command works through `npm run` and dies with
 * `spawn playwright ENOENT` when it is copied into a terminal, which is where it is read from. Prepended
 * rather than appended, as npm does, so a locally installed tool wins over a global one of another version.
 */
export function withLocalBin(currentPath = '', root = import.meta.dirname) {
  const bin = path.join(path.dirname(root), 'node_modules', '.bin');
  const entries = currentPath.split(path.delimiter).filter(Boolean);
  return entries[0] === bin ? currentPath : [bin, ...entries].join(path.delimiter);
}

/** NODE_OPTIONS with the source condition appended once */
export function withSourceCondition(nodeOptions = '') {
  const options = parseNodeOptions(nodeOptions);
  return formatNodeOptions(options.includes(SOURCE_CONDITION) ? options : [...options, SOURCE_CONDITION]);
}

// Run as a script (tests import withSourceCondition)
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const [command, ...args] = process.argv.slice(2);
  if (!command) {
    console.error('Usage: node scripts/with-source.mjs <command> [args...]');
    process.exit(1);
  }
  const child = spawn(command, args, {
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_OPTIONS: withSourceCondition(process.env.NODE_OPTIONS),
      PATH: withLocalBin(process.env.PATH),
    },
    // npm's .bin shims are .cmd files on Windows
    shell: process.platform === 'win32',
  });
  // The child runs in this process's group, so a terminal Ctrl+C (SIGINT to the whole foreground
  // group) already reaches it; re-sending would deliver a second signal to a child that is midway
  // through shutting down. Absorb it here instead — this process only has to outlive the child to
  // report its status. SIGTERM is never terminal-generated, so one aimed at this process alone is
  // forwarded once.
  process.on('SIGINT', () => {});
  process.on('SIGTERM', () => child.kill('SIGTERM'));
  child.on('error', (err) => {
    console.error(`${command}: ${err.message}`);
    process.exit(1);
  });
  child.on('exit', (code, signal) => {
    // Die the way the child did (128 + signal): dropping the listener restores the default action.
    if (signal) {
      process.removeAllListeners(signal);
      process.kill(process.pid, signal);
    } else process.exit(code ?? 1);
  });
}
