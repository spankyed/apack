# Native graph quality exposes a candidate regression

Source `563ec93ed0` plus an independent Zachary karate-club regression passes EARS typechecking but fails that new quality test: 98 of 99 focused cases pass. Native's seed-zero reference reaches modularity 0.4197896; the candidate's `leiden-ts@0.1.0` returns 0.3952169625246548. The test computes undirected modularity independently from the 78 original friendships. Neither threshold nor seed is changed to obtain a pass. Earlier 98-case functional evidence remains historical, not sufficient graph-quality qualification.

A direct isolated dependency check reproduces exactly 0.3952169625246548 with every edge weight 1 or 2. This rules out the adapter's uniform edge doubling as the explanation. A heuristic need not reach a global optimum, so this alone does not prove an algorithm defect; it establishes a concrete quality regression against the retained native fixture. The current TypeScript dependency is not accepted for final integration.

The next implementation checkpoint evaluates the same pinned `leiden-rs@0.8.1` as the native baseline through a small synchronous WASM transport. No graph algorithm is copied into the wrapper. Upstream's convenience WASM function suppresses errors into singleton partitions and does not expose resolution, so the owned wrapper uses the core API and propagates failures. This portable core is not integrated or qualified yet; its Cargo lockfile, compiled assets, fixture result, packaging and resource costs still need review. Compiled binaries remain outside Git.

## API generation

[41209245253](https://github.com/spankyed/apack/actions/runs/41209245253), source `563ec93ed0`, succeeds: the matching d33f859 native binding and published packages build, API regeneration completes, and all three EARS API reports check current. The recorded report patch is empty. This proves build/API freshness at that source; it does not erase the newly discovered quality failure or qualify final native parity/installed runtime/performance.

Compressed raw failed/passing-case reports, direct dependency diagnostic, generated API reports and build/check logs have uncompressed-byte SHA-256 receipts. No original database snapshot is modified.
