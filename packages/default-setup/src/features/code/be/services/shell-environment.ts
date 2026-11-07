import { APP_PROCESS_ENV_VARS } from '@apackdev/sdk/env'

/**
 * Loaders that would run code of someone else's choosing in the shell, whoever set them: the app's own
 * environment is what a terminal inherits, so a loader set for the app would be set for every command the
 * user runs.
 */
const BLOCKED_LOADER_VARS = [
  'LD_PRELOAD',
  'LD_LIBRARY_PATH',
  'DYLD_INSERT_LIBRARIES',
  'DYLD_LIBRARY_PATH',
]

/**
 * The environment a user's shell is spawned with: this process's, minus the loaders above and minus every
 * variable the app set on this process (`APP_PROCESS_ENV_VARS`, `@apackdev/sdk/env`, which is the same
 * declaration the construction in `@app/main` that sets them is typed by — so one added there arrives here
 * without anyone remembering to add it).
 *
 * A written list is what this was, and it named two of the ten: the shell inherited `APACK_USER_DATA_DIR`,
 * `SHIPPED_PACKS_DIR`, `API_PORT` and the API token, which is app-process-level access to the user's data.
 */
export function shellEnvironment(env: { [key: string]: string }): { [key: string]: string } {
  const shell = { ...env }

  for (const name of [...BLOCKED_LOADER_VARS, ...APP_PROCESS_ENV_VARS]) delete shell[name]

  // Tell the shell it is in a capable terminal
  shell.TERM_PROGRAM = 'apack'
  shell.COLORTERM = 'truecolor'

  return shell
}
