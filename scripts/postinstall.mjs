import { createRequire } from 'module'

const require = createRequire(import.meta.url)

/**
 * How many times the Electron binary is asked for, and how long between asks.
 *
 * **Sized from what the outage actually did, not from a guess about gateways.** On 2026-11-08 a `504` for
 * `electron-v44.9.3-darwin-arm64.zip` failed a strict job twice, five minutes apart, and `curl` answered 504
 * in 83ms from a developer's machine — then the artifact returned `200` about **three minutes** later. So the
 * refusal was neither instant-clearing nor permanent, and a schedule measured in seconds cannot survive one:
 * an earlier revision of this file waited 18s in total and would have failed today exactly as it did.
 *
 * **The shape is what projects hitting this converge on**: run Electron's own installer again, a handful of
 * times, with a growing pause spanning minutes — `electron/install.js` is idempotent, so asking again is the
 * whole mechanism. 20s doubling to 80s is ~3m20s of patience, which covers the one outage this repo has
 * measured with room over it.
 *
 * **It is still the smaller half.** The cache in `ci.yml` and `strict-chain.yml` is what the ecosystem does
 * first and what a warm run needs none of this for. And the condition cannot be named — `electron/index.js`
 * spawns `install.js` with inherited stdio and throws one fixed message whatever happened, so a 404 for a
 * yanked version is indistinguishable from a 504 here. That is the cost of the patience: a genuinely absent
 * version takes the full schedule to report. Jobs that never launch Electron should not pay it at all, which
 * is what `ELECTRON_SKIP_BINARY_DOWNLOAD` is for and is not wired up here.
 */
const ASKS = 5
const FIRST_WAIT_MS = 20_000

/**
 * Electron fetches its binary the first time its path is resolved, not at install. Resolve it here, once, so
 * test workers launching the app in parallel find it rather than each starting a download into one directory.
 * Absent only from an install that left devDependencies out, which launches no Electron.
 *
 * **Requiring it is what downloads it**: `electron/index.js` spawns its own `install.js` when the binary is
 * missing, so this line is the download and not a check of one. That is also why the retry is here and not
 * around a separate command — there is no separate command.
 */
/**
 * Whether this install wants the binary at all.
 *
 * **Nothing else in the tree downloads it.** `electron@44.9.3` ships `scripts: null` — no postinstall of its
 * own — and no file in the package reads `ELECTRON_SKIP_BINARY_DOWNLOAD`, so the variable is inert there and
 * installing the package fetches nothing. The download happens here and only here, because requiring the
 * package is what triggers it. That makes the gate ours to implement, and the ecosystem's name the one to
 * implement it under: a future Electron that honours the variable agrees with this rather than fighting it.
 *
 * **Why it matters more than the retry beside it.** A job that never launches the app was fetching 180MB and
 * then failing on somebody else's gateway: on 2026-11-08 a `504` failed the strict `producers` job, which
 * runs typechecks and builds and launches no app at all. Skipping is not an optimisation there, it is the
 * removal of a dependency the job never had.
 *
 * Only `1` and `true` skip, so a `0` from a workflow expression downloads rather than silently not.
 */
const skip = ['1', 'true'].includes((process.env.ELECTRON_SKIP_BINARY_DOWNLOAD ?? '').toLowerCase())

let installed = !skip
if (skip) console.log("[postinstall] ELECTRON_SKIP_BINARY_DOWNLOAD is set; leaving Electron's binary alone")
else { try { require.resolve('electron') } catch { installed = false } }

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
      const wait = FIRST_WAIT_MS * ask
      console.warn(`[postinstall] Electron's binary did not arrive (ask ${ask} of ${ASKS}): ${error instanceof Error ? error.message : String(error)}`)
      console.warn(`[postinstall] asking again in ${Math.round(wait / 1000)}s`)
      await new Promise(settle => setTimeout(settle, wait))
    }
  }
}
