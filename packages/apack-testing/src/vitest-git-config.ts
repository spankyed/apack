/**
 * A vitest setup file: git, run by a spec or by the code under test, reads no configuration of the machine's.
 *
 * Git layers the system's config (`/etc/gitconfig`), the user's (`~/.gitconfig`, `$XDG_CONFIG_HOME/git/config`)
 * and whatever the environment injects (`GIT_CONFIG_PARAMETERS`, `GIT_CONFIG_COUNT`) under a repository's own. A
 * spec that leans on any of them passes only where they are set: an identity, a default branch name, `pull.ff`, an
 * LFS filter. And a setting there changes what every spec that runs git does — `core.fsmonitor=true` starts a
 * daemon per repository a spec creates. So a worker's git reads only what the spec gave it: its repository's
 * config, `-c` on the command, or an environment the spec built. A spec testing what git does with a user's config
 * writes one and points `GIT_CONFIG_GLOBAL` at it, since that outranks `HOME` and `XDG_CONFIG_HOME`.
 *
 * The null device rather than an empty file, which git's own documentation gives for skipping a level: there is no
 * file to clean up, and nothing one test file writes with `git config --global` can reach the next — that write
 * fails, naming the file, as it should in a spec.
 *
 * Every host package's config lists it, and a pack's has it through `isolatedDataDir()` (`definePackTestConfig`).
 * A worker loads it before each file, so a spec's `vi.stubEnv` over these is undone by the next file at the latest.
 */
import * as os from 'node:os';

process.env.GIT_CONFIG_GLOBAL = os.devNull;
process.env.GIT_CONFIG_NOSYSTEM = '1';
for (const name of Object.keys(process.env)) {
  if (name === 'GIT_CONFIG_PARAMETERS' || /^GIT_CONFIG_(COUNT|KEY_\d+|VALUE_\d+)$/.test(name)) delete process.env[name];
}
