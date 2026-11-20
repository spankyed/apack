/**
 * A vitest setup file: git, run by a spec or by the code under test, reads no config of the machine's — no
 * `~/.gitconfig`, no `/etc/gitconfig`, nothing injected through the environment — so a spec passes or fails the same
 * everywhere. A spec testing what git does with a user's config writes one and points `GIT_CONFIG_GLOBAL` at it.
 *
 * The null device is git's documented way to skip a level, and makes a `git config --global` write fail rather than
 * reach the next test file. Every host config lists this file; a pack's gets it through `isolatedDataDir()`.
 */
import * as os from 'node:os';

process.env.GIT_CONFIG_GLOBAL = os.devNull;
process.env.GIT_CONFIG_NOSYSTEM = '1';
for (const name of Object.keys(process.env)) {
  if (name === 'GIT_CONFIG_PARAMETERS' || /^GIT_CONFIG_(COUNT|KEY_\d+|VALUE_\d+)$/.test(name)) delete process.env[name];
}
