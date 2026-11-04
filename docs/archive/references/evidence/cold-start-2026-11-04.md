# Fresh-profile startup diagnosis — 2026-11-04

## Outcome

A reproduced window-discovery failure occurred before the main application window existed.
First-use API provisioning delayed its creation; the renderer exposed application state about
513 ms after that window appeared. This is a diagnostic finding, not a cold-start qualification
or a newly measured improvement.

Source: `c876aac5cc128d00db6e193e454fa93fb07dc56e` (merged master, production code from
#329), native pin `bc450ee1746adfee5294ba19acb96b44d1271f19`.
The earlier [warm qualification](pack-admission-2026-11-04.json) remains independently valid.

## Window and API boundary

The owned Linux container used two CPUs, 6 GiB RAM with no additional swap, and disk-backed
application profiles on OrbStack's btrfs filesystem. Compiler scratch alone used tmpfs.
Recording was disabled. No unrelated container was stopped, and no global cache eviction ran.

In the reproduced discovery miss, elapsed from Electron launch:

| Event | Seconds |
| --- | ---: |
| Playwright attached | 15.428 |
| Unchanged 45-second discovery budget expired | 60.468 |
| Main application window created | 62.144 |
| Application state available | 62.657 |

The structured main log places API startup at 07:14:30.279, shipped-pack installation at
07:15:02.324, pack loading at 07:15:02.644, system registration at 07:15:17.254 and API
readiness at 07:15:17.627. Window creation follows readiness by approximately 3 ms.
This fresh-profile provisioning path differs from the populated-profile startup action.

`WindowManager` waits for API readiness before creating the main window. The API permits
60 seconds to become ready; the testing fixture starts its 45-second application-window
search after Electron attaches. That search can therefore fail during otherwise permitted
API startup. Continuing observation after the miss diagnosed the phase; it did not turn
the failed case into a passing test. Neither timeout was changed.

## Backend profile

Separate fresh-profile API diagnostics used the same built server, source condition and
recording-disabled configuration as the app child. They omit the Electron UI and are not
paired performance comparisons.

The V8 profile reached API readiness in 14.067 seconds. Sampled wall-time attribution found
approximately 5.75 seconds at two native database opens and 4.14 seconds at schema declaration.
About 1.99 seconds at database close belong to shutdown and are excluded from startup conclusions.
These samples include native waits; they do not establish native CPU cost or a codec bottleneck.

A separate `strace` run reached readiness in 49.463 seconds. Five completed startup
`fdatasync` calls totaled 28.313 seconds, with a maximum of 17.583 seconds. Their individual
durations were 17.583, 4.082, 1.059, 1.169 and 4.420 seconds, across the main and run-history
databases. One further main-database sync started approximately 45 ms before readiness and
completed afterwards; it is excluded from that completed-call total. The trace establishes
substantial synchronization waits in this run, not an invariant percentage of startup.
Tracing wrote to the same storage and can perturb execution. Differences between these runs
cannot be attributed to profiling overhead alone.

## Cache experiment limits

The attempted sequence covered only the owned Electron distribution and built main, preload,
renderer and default pack: 390 files, 353,703,307 bytes, 86,582 guest page-cache pages.
Shared libraries, external Node dependencies and host disk-image/APFS caches were uncontrolled.

Three diagnostic launches completed: warm-at-admission 62.657 seconds, then two cold-at-admission
launches 27.702 and 27.683 seconds. The final warm admission reached only 84,662 resident pages
and failed the unchanged 99% guard. The initial attempt also failed cache admission.
There is no complete balanced sequence, qualified median or valid warm/cold comparison.
In particular, these observations do not mean cold execution is faster. Whole-host contention
was not controlled, and the container recorded CPU throttling.

## Next justified work

1. Count and attribute the existing application startup database opens, schema declarations
   and durability barriers. Separate fresh-profile provisioning from populated-profile reopen.
   Establish which work is necessary before changing its ordering or frequency.
2. Reproduce the slow storage synchronization on an isolated disposable database to distinguish
   storage latency from redundant application work. Preserve the current durability contract.
3. Address the test's startup-phase mismatch explicitly, using existing lifecycle boundaries;
   retain a bounded overall startup budget and failure evidence. Do not merely increase a timer
   or add test-only runtime markers.
4. Qualify any resulting optimization with the maintained suite and recording disabled.
   A cold-cache claim additionally needs a complete admitted sequence and stated cache scope.

No production optimization, database policy, test assertion or deadline changed in this investigation.
There is no evidence here to prioritize allocation/codec changes over the observed startup waits.

## Evidence custody

Raw reports, both failed cache admissions, structured first-profile logs, V8 profile, syscall
trace and exact scratch probes are preserved locally under
`.apack/evidence/cold-start-2026-11-04/`, with a SHA-256 manifest over 32 files.
These diagnostic probes are not a new maintained benchmark API. The container was released only
after export; unrelated agents' containers, data and worktrees were left untouched.
