// What a process this pack starts for the user does **not** inherit from it.
//
// **The app's identity reaches every process it starts.** `@app/main` sets ten variables when it spawns the
// API (`APP_PROCESS_ENV_VARS`, `@apackdev/sdk/env`, which is the same declaration that construction is typed
// by), and anything the API starts inherits them. A child that inherits `ELECTRON_RUN_AS_NODE=1` breaks any
// Electron app launched from it; one that inherits `APACK_USER_DATA_DIR` or `SHIPPED_PACKS_DIR` tells whatever
// it runs where the app's data is, and `APACK_API_TOKEN` hands it app-process-level access to that data.
//
// An agent child is the widest case of all, because it is not one program: its Bash tool spawns whatever the
// model asks for, in that same environment.
import { withoutAppProcessEnv } from '@apackdev/sdk/env'

/**
 * The environment an agent child is spawned with: the given environment, minus everything the app set on its
 * own process.
 *
 * The strip is derived from the declaration rather than written out here, so a variable added to what the app
 * sets is stripped without anyone remembering. The deny-list this replaces named two of the ten.
 */
export function agentChildEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return withoutAppProcessEnv(env)
}
