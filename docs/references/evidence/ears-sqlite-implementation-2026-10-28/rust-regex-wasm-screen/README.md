# Rust-regex WASM candidate screen — 2026-10-28

This is a dependency screen, not production integration. rregex 1.13.1 is not installed in the EARS candidate.
The inspected npm artifact is pinned by its tarball SHA-256 and the actual loaded WASM hash. Its generated ESM
metadata advertises Rust regex 1.13.1 and regex-syntax 0.8.11. Upstream:
[rregex](https://github.com/2fd/rregex), [Cargo features](https://github.com/2fd/rregex/blob/master/Cargo.toml).

An owned 1-CPU / 512-MiB Linux arm64 / Node 23.11.1 container installs only that tarball, with install scripts
disabled. A CommonJS require provides synchronous initialization without the ESM entry's top-level await.
Tests exercise inline case flags, Unicode Greek properties, Unicode word matching, class intersection,
look-around/backreference/parse refusal, explicit free(), and syntax-tree extraction. A nested-repetition
nonmatch over 100,001 characters completes correctly. Raw times are single diagnostic samples, not load budgets
or evidence of the complete API/corpus/packaging behavior. The wrapper's syntax tree could support conservative
required-literal extraction for SQLite trigram candidate narrowing; it has not been integrated or qualified.

## Resource finding

The first mixed probe grows WASM linear memory from 5.7 to 40.6 MB after 1,000 explicit compile/match/free cycles.
Three fresh-process controls then run six batches of 500 cycles with GC after every batch:

- Same pattern: memory grows 15.6 / 28.7 / 41.8 / 54.9 / 68.0 / 81.1 MB.
- Unique patterns with matching: 21.1 / 37.5 / 54.3 / 70.7 / 87.2 / 103.7 MB.
- Unique patterns compiled/freed without matching: the same 21.1 → 103.7 MB sequence.

No stabilization is observed over these samples. Explicit free() and JS GC do not stop the measured growth.
This is enough to reject the stock artifact for candidate integration pending a resolution; it does not by
itself identify the allocation defect or prove unbounded growth over every workload.

Upstream enables wee_alloc by default. That allocator is archived and has an open
[repeated-allocation leak report](https://github.com/rustwasm/wee_alloc/issues/106). This is a plausible cause,
not a demonstrated attribution for this artifact. A controlled default-allocator rebuild or a different audited
wrapper must pass sustained compilation/matching memory tests before selection. Caching a handful of patterns
would not establish safe behavior for varied user patterns.

No application source or dependency changes came from this screen. No Rust build ran on the daily Mac. Exact
probe sources, artifact hashes, errors, syntax output, memory samples and install output are retained here.
