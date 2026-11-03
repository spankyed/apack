# Representative application actions on merged master — 2026-11-02

Completed measurement and focused profiling; no production change. Source: merged master
`36a0292e1dc3ad22801c083856a4e02c7f20bbc4` (includes #312). Native checkout and pin both
`e5ecfec8894c0f32d243c7d5b18245b35b018fdc`. All manifests report clean authored source and native
source, and retain actual output hashes. The normal chain admitted the current app build from cache;
the runner built the pinned binding. Work stayed in the isolated measurement checkout.

## Baseline

The [maintained suite](../../../../tests/performance/README.md) ran recording **disabled**, five
warmups then twenty measured trials per action. All four runs passed normal report admission with
20/20 successful measured trials and no incomplete outcomes. Each scenario used its own disposable
profile; startup used a common closed seed and copied profiles for serial fresh-process launches.

| Action | Median | Measured range | Boundary |
| --- | ---: | ---: | --- |
| Populated startup | 3,851.8 ms | 3,337.3–6,142.0 ms | Process launch through usable restored 50-message chat |
| Deterministic reply streaming | 799.4 ms | 704.2–1,522.0 ms | Dispatch through complete persisted visible reply |
| Thread opening | 487.4 ms | 327.9–1,048.0 ms | Dispatch through complete 50-message page and truncation controls |
| Search | 16.2 ms | 14.4–26.2 ms | Dispatched query through complete laid-out results |

Streaming includes the fixture's roughly 600 ms producer schedule. Its first-visible median was
179.5 ms (74–384 ms), with a median maximum update gap of 97.7 ms (82.5–698.3 ms). These are different
milestones; subtracting a producer duration from the end-to-end median is not a measured pipeline cost.
Thread opening used the maintained default plain corpus. Search/startup use twelve threads and 1,200
large messages; search requires twenty known results. No external model/provider participated.

Startup is the largest measured delay. Thread opening is the next warm interaction to investigate;
streaming's complete-reply duration includes intentional production time. These synthetic actions do
not establish which operation users perform most often or their total daily waiting time.

## Startup profiles and source attribution

The same built app then ran the maintained populated-startup scenario in detailed mode: five warmups
and **five diagnostic measured captures**, all admitted with complete driver/backend/renderer reports.
This smaller run supports attribution, not a twenty-sample latency or recording-overhead qualification.
Its 4,475.0 ms median is kept separate from the disabled baseline.

Existing V8 CPU and sampled allocation captures were analyzed without modifying application execution.
Frame identities combine function, URL, line and column, excluding unstable script ids. Caller stacks
were resolved against the exact retained API/pack bundles and source at the measured revision.
Inclusive stack categories can overlap; their times are not additive wall-time savings.

- **Pack verification is the strongest startup lead.** `verifyPack` in
  [assets.ts](../../../../packages/apack-host/src/packs/assets.ts) reads and hashes the entire receipt.
  Inclusive sampled time was a median 326.8 ms per capture (295.9–598.8 ms). Stacks include installed
  build reads and source catalog discovery, including pack-list publication. The verified shipped pack
  contains 116 files totaling 34,600,667 bytes, including build records and source maps. Source
  `readBuiltPackSource` calls `readBuiltPackIntegrity` and then `readPackBuild`; both verify the build.
  This establishes repeated verification paths, not a dynamic invocation count or permission to omit checks.
- **Snapshot parsing is a related allocation lead.** `readSnapshotFile` in
  [layout.ts](../../../../packages/apack-host/src/packs/layout.ts) reads and parses declarations repeatedly.
  Inclusive sampled time was a median 49.6 ms, with 49.7–57.9 MB of sampled allocation estimates per
  capture under that stack. The snapshot file itself is 1,115,265 bytes. These are transient sampled JS
  allocation estimates, not retained memory, native allocations or exact byte accounting.
- **Message timestamp formatting is a smaller, simpler renderer lead.** `formatTime` in
  [message.vue](../../../../packages/default-setup/src/features/threads/fe/chat/message.vue) calls
  `Date.toLocaleTimeString` with options during rendering. Inclusive sampled time was a median
  131.1 ms (46.7–293.9 ms). Any reusable formatter must preserve default locale, timezone and displayed
  values; the startup capture does not establish its effect on warm thread-opening latency.
- Recorded `app.index.admission` spans had a median 352.7 ms, but this boundary wraps pack loading;
  its name is not evidence that native database index construction dominates. Across all five captures,
  `app.view.read` spans totaled 45.4 ms (about 9.1 ms per capture). The data does not justify a query/index
  or codec optimization as the next startup change.

Disabled-run launch logs place a median 497.3 ms before process attachment, 2,258.5 ms between attachment
and application-state discovery, and 1,032.0 ms between that discovery and the connected observation.
These independently summarized intervals need not sum to the end-to-end median. They are driver
observations, not an attribution of all that time to CPU or transport. The detailed recorder starts
inside backend setup and renderer initialization; earlier module evaluation/Electron boot is not fully
profiled. The roughly one-second final interval remains an observation to explain, not a proven
removable delay. The profile does not account for every millisecond of startup.

## Recommended next change

Start with a focused pack-admission PR: pass one verified build description through a single admission
operation instead of reparsing/reverifying the same build in nested readers. Keep ownership within
existing pack loading/catalog code. Preserve changed/missing/extra-file refusal, receipt/declaration
consistency, revisioned asset checks and interrupted-install recovery. Do not introduce a process-wide
cache or relax verification merely because this corpus is trusted. First count actual verification and
snapshot reads; acceptance requires reduced duplicate work plus a controlled disabled-mode startup
comparison, with existing lifecycle/integrity suites passing. No speedup is claimed by this investigation.

A separate, smaller timestamp-formatter change is a reasonable second candidate, validated on startup
and warm thread opening. Neither candidate has been implemented here. Earlier boot/connection waits
remain unresolved attribution, and should not be hidden by predicted savings from these two hotspots.

## Reproduction and retained evidence

Execution used the maintained Linux runner, disk-backed temporary profiles on the Seagate-hosted
OrbStack disk, two CPUs, 6 GiB memory, no extra swap and 256 MiB shared memory. Explicit machine label:
`seagate-diskbacked-linux-2cpu-6g-20261102`. Machine identity hash:
`5988157c68af37b5290193373ce03f9391bf382bd1845956277d6ee12696f8a2`.
No competing Docker job was present at admission. This is warm-filesystem Linux evidence, not physical
macOS input-to-paint latency, cold-disk startup or a claim about large production corpora. Search
excludes input debounce. Twenty trials do not establish tail percentiles.

Owned volume `apack-linux-work-2bd9183070f1` retains
`/work/.apack/performance/master-actions-20261102-v1/`: build log, four admitted baseline runs, raw
trials, startup lifecycle/invocations, detailed startup captures, launch/stack/phase analyses, pack-size
inventory and exact invocation/analysis scripts. `*-admission.json` records maintained reader acceptance;
`profile-admission.json` explicitly admits only five diagnostic measured profiles.

An independent host copy is `.apack/performance/master-actions-2026-11-02.tar.gz` in the owning
worktree. SHA-256 matches the container archive:

```text
f3368c8d52da0477fdd2ae5bd96d715e6b096633a3adc1963c8569e21e8e4f24
```

The report adds documentation only after measurements finished. No production implementation,
benchmark threshold, completion condition or maintained scenario changed. No rebuild or CI run is
needed for this evidence-only document.
