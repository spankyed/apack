import { createRequire } from 'module'

const require = createRequire(import.meta.url)

/**
 * How many times the Electron binary is asked for, and how long between asks.
 *
 * **A transient refusal must not fail an install.** The binary comes from GitHub's release CDN, and on
 * 2026-11-08 a `504 Gateway Time-out` for it failed a strict job inside this script — before a line of the
 * repo's own code ran, and after 90 minutes of queueing for the runner. One ask is a coin flip on somebody
 * else's availability; the retries are what make the install depend on the CDN *eventually* answering rather
 * than answering first time.
 *
 * The backoff is linear and short because the failure it is for is a gateway refusing, which clears in
 * seconds or not at all — a long one would turn a genuine outage into a job that looks hung.
 */
const ASKS = 4
const BACKOFF_MS = 3_000

/**
 * Electron fetches its binary the first time its path is resolved, not at install. Resolve it here, once, so
 * test workers launching the app in parallel find it rather than each starting a download into one directory.
 * Absent only from an install that left devDependencies out, which launches no Electron.
 *
 * **Requiring it is what downloads it**: `electron/index.js` spawns its own `install.js` when the binary is
 * missing, so this line is the download and not a check of one. That is also why the retry is here and not
 * around a separate command — there is no separate command.
 */
let installed = true
try { require.resolve('electron') } catch { installed = false }

if (installed) {
  for (let ask = 1; ask <= ASKS; ask += 1) {
    try {
      // A module that throws is not cached, so a later require runs `getElectronPath` again and re-downloads
      require('electron')
      break
    } catch (error) {
      if (ask === ASKS) {
        console.error(`[postinstall] Electron's binary did not arrive in ${ASKS} asks; this is the last error`)
        throw error
      }
      const wait = BACKOFF_MS * ask
      console.warn(`[postinstall] Electron's binary did not arrive (ask ${ask} of ${ASKS}): ${error instanceof Error ? error.message : String(error)}`)
      console.warn(`[postinstall] asking again in ${wait}ms`)
      await new Promise(settle => setTimeout(settle, wait))
    }
  }
}
