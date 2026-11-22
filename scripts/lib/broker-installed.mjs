// Whether the install holds the terminal broker for this platform, asked of `@apackdev/terminal` itself.
//
// **npm skips an optional dependency it fails to fetch, and says nothing.** The broker's binary is in a platform
// package `@apackdev/terminal` names as an optional dependency, so an install whose download of it failed exits 0 and
// leaves an app with no terminal, which it would find out only when a window opened one. The install (postinstall)
// and the chain's first check ask here instead and refuse, naming the package.
//
// Plain Node, importing nothing outside `node:`: the postinstall runs it.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

/**
 * The refusal when this platform's broker package is missing from the install in `root`, or `undefined` when it is
 * there, or `@apackdev/terminal` builds none for this platform (its optional dependencies name no package for it)
 * @param {string} root
 * @returns {string | undefined}
 */
export function missingBroker(root) {
  const require = createRequire(path.join(root, 'package.json'));
  /** @type {{ brokerBinary(): string | undefined, brokerBinaryPath(): string | undefined, PACKAGE_NAME: string }} */
  const terminal = require('@apackdev/terminal');
  const manifest = JSON.parse(readFileSync(require.resolve('@apackdev/terminal/package.json'), 'utf8'));
  if (!(terminal.PACKAGE_NAME in (manifest.optionalDependencies ?? {}))) return undefined;
  if (terminal.brokerBinary() !== undefined) return undefined;
  return `${terminal.PACKAGE_NAME}, which holds the terminal broker for this platform, is not installed whole`
    + `${terminal.brokerBinaryPath() ? ` (looked for ${terminal.brokerBinaryPath()} and the files beside it)` : ''}: npm skips an`
    + ' optional dependency it fails to fetch without failing. Run `npm ci` again.';
}
