# Background native model training ownership, 2026-10-29

Runtime source `7478a0fc34` passes **617 SQLite EARS cases, 135 host/storage cases,
ten focused native lifecycle cases**, package builds, types/API and static checks in
disposable Linux ARM64. Two mutation checks fail their intended assertions: returning
a model after an in-flight generation change, and removing the bounded cursor index.
This is an inactive internal training/admission slice, not the selected app query path
or automatic persistent model admission. Production remains elmdb.

`SqliteVectorTraining` owns a read-only worker connection. It samples at most 20,000 live
current vectors, with a dimension-based 128 MiB encoded-input cap (not a total native
memory bound), and trains 64 buckets with binary quantization and one native training
thread. SQLite windows select evenly spaced eligible IDs. Only the bounded model crosses
the worker channel; it includes source commit bytes, native/model/worker hashes and native
version. Unsupported dimensions refuse explicitly. Training neither holds the foreground
writer nor increments the logical commit. The foreground fixture can commit while it runs.
A yielded turn is a functional witness, not a measured 16 ms responsiveness guarantee.

Only a trusted owner supplies executable/dependency paths. Replies are validated, and the
current vector generation/definition is checked at launch, in the worker snapshot and again
on its owner after completion. Cancellation serializes worker ownership until actual exit;
close signals cancellation. Native C execution is not guaranteed to be preemptible: owners
must await `stop()` before file replacement/deletion, especially on Windows. Normal host
composition has not activated this service, and that host drain integration remains required.

A real bug was found by strengthening the race test. The first timing-dependent test could
pass when schema changed before the worker opened its snapshot. A test-side shared-memory
barrier now proves the worker holds the old snapshot before schema/close changes. That test
caught the missing owner-side completion check; the fix rejects the old result. Removing the
check again fails deterministically. Production code has no test barrier/progress hook.
All earlier harness, fixture and genuine stale-result failures remain retained. Their model
bytes are synthetic sine-fixture output, not the sealed third-party corpus or model.

The projection cursor now pages IDs through `chunk_native_admission` before looking up
canonical BLOBs, avoiding a whole-generation join/sort per batch. Tests verify the actual
indexed keyset and primary-ID lookup plans. Enabling a missing cursor index on a populated
store refuses with `MAINTENANCE_REQUIRED`; no long foreground SQL index build is hidden.
Explicit offline preparation/normal bootstrap and complete repair ownership remain required.

These runs record the actual original extension SHA-256
`2fd22bc6d242afe2b2cb6a5c7ec281caf769a2683452c701adc707521961df65`,
source hash and pinned upstream revision. The worker independently hashes its loaded file.
No membership patch was applied. The old lifecycle runs' missing binary hashes are not
retroactively claimed to exist. Container inspection records the actual live image and
resource configuration; all runs use two CPUs/6 GiB/no swap, dropped capabilities and an
actual mode-denial preflight. No other-agent target/source or daily Mac compiler is touched.

The new platform workflow compiles the same hash-verified original source on disposable
Linux/macOS/Windows and requires all five generation and five worker cases plus native
provenance. Windows compiler setup is pinned. A Linux ARM64 builder check verifies actual
loading and refusal of a wrong source hash. Its Git metadata is explicitly synthetic for
an exact source archive; it is not a GitHub qualification receipt. Source download and the
other hosts still require the real CI run. This builder is for lifecycle qualification,
not production packaging, signing, native fork selection or ANN performance acceptance.

Next connect persistent attempt/model states, scheduler-owned short writes, restart/recovery
and host draining. Retain the incumbent model during refresh rather than interrupting usable
reads. Final EARS owner aggregation/reranking, growth/update/model freshness, readiness/watch
signals, audit/rebuild/restore, normal native distribution and frozen fresh-corpus/app/platform/
full Strict acceptance remain open. The active integrated search still misses broad heartbeat.
