import { createRequire } from 'module'

// Electron fetches its binary the first time its path is resolved, not at install. Resolve it here, once, so
// test workers launching the app in parallel find it rather than each starting a download into one directory.
// Absent only from an install that left devDependencies out, which launches no Electron
const require = createRequire(import.meta.url)
let installed = true
try { require.resolve('electron') } catch { installed = false }
if (installed) require('electron')
