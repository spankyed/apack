// What a process this app starts for the user does **not** inherit from it.
//
// **The app's identity reaches every process it starts.** `@app/main` sets ten variables when it spawns the
// API (`APP_PROCESS_ENV_VARS`, `@apackdev/sdk/env`, which is the same declaration that construction is typed
// by), and anything the API starts inherits them. A child that inherits `ELECTRON_RUN_AS_NODE=1` breaks any
// Electron app launched from it; one that inherits `APACK_USER_DATA_DIR` or `SHIPPED_PACKS_DIR` tells
// whatever it runs where the app's data is. The strip is the SDK's, beside the list, so one declaration
// serves both this and the broker the host starts.
//
// **This file is the agent child's half** (G2). The terminal's half moved to `@apackdev/host` when the broker
// took the spawn over — hygiene lives where the spawn is, and leaving it here is what left it with no caller
// for the length of that change.
import { withoutAppProcessEnv } from '@apackdev/sdk/env'

/**
 * The environment an agent child is spawned with: this process's, minus everything the app set on it.
 *
 * A deny-list written by hand is what this replaced, and it named two of the ten.
 */
export function agentChildEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return withoutAppProcessEnv(env)
}
