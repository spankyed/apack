# Early startup attribution

Manual investigation on disposable macOS:

```sh
gh workflow run ci.yml --ref <branch> -f startup_entry_profile=true
```

Uses the maintained populated-startup seed and assertions, five warmups and three diagnostic trials.
Only diagnostic trials add the Electron `-r` preloader and Chromium startup trace. The preloader
samples main before app imports, observes launch/navigation, and arms the API child's early sampler.
Playwright strips launch-time `NODE_OPTIONS`, so it cannot install the main preloader that way.

The app recorder stays disabled to avoid competing profilers. External profiling is enabled:
these runs cannot certify recording-disabled latency or a speedup. Captures, failures and actual
built app files are retained. The normal runtime and ordinary test launches do not load these hooks.

[Findings and limits](../../../../docs/archive/references/evidence/2026-11-07-startup-entry-profile.md)
record the initial investigation. [Electron's `loaded` event](https://www.electronjs.org/docs/latest/api/process#event-loaded)
sets the observer boundary when an early Node preload runs before Electron's APIs are available;
[Chromium startup tracing](https://www.chromium.org/developers/how-tos/trace-event-profiling-tool/recording-tracing-runs/)
covers early browser and renderer work.
