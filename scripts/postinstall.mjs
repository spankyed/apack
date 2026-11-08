import { createRequire } from 'module'

const require = createRequire(import.meta.url)

/**
 * How many times the Electron binary is asked for, and how long between asks.
 *
 * **The shape is `@electron/get`'s own**, which retries a cache write three times at a flat two seconds —
 * and this repo's `writePrivateFile`, which retries a rename on three named Windows errors. Both name the
 * transient condition and rethrow everything else. **This cannot**: `electron/index.js` spawns `install.js`
 * with inherited stdio and throws one fixed message whatever happened, so the `504` that prompted this never
 * reaches the `catch`. A 404 for a yanked version arrives identically. That is the whole reason the count is
 * small and the wait flat: an unnameable condition earns one more ask, not a schedule.
 *
 * **And it is the smaller half of the fix.** The cache in `ci.yml` and `strict-chain.yml` is what the
 * ecosystem actually does and what the evidence supports: on 2026-11-08 a sustained `504` for this artifact
 * failed the same job twice, five minutes apart, and `curl` answered 504 in 83ms from a developer's machine
 * — an outage no retry survives. This covers the single refusal that clears, which is cheap to cover and has
 * not been observed here.
 */
const ASKS = 2
const WAIT_MS = 2_000

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
      console.warn(`[postinstall] Electron's binary did not arrive (ask ${ask} of ${ASKS}): ${error instanceof Error ? error.message : String(error)}`)
      console.warn(`[postinstall] asking again in ${WAIT_MS}ms`)
      await new Promise(settle => setTimeout(settle, WAIT_MS))
    }
  }
}
