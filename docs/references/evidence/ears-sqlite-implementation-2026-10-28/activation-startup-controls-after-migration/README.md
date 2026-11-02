# Post-migration activation startup controls — 2026-10-31

Frozen runtime source 1d7a3de090, existing verified API/pack outputs; Linux arm64,
2 CPUs, 6 GiB, no swap. Session 48802 is terminal failure, not an accepted activation result.

Both old and new observer preloads reach API readiness within the original 45-second
observation bound (28.53 and 32.27 seconds). The subsequent real RPC pack activation
with the new observer exceeds its original 30-second observation window. The API
reports registration and content application, but no completed activation is recorded.
The API requires forced termination after the 15-second graceful-stop bound. The hook
report remains active; no completed CPU sampled-stack profile is available.

Child-state samples during startup include uninterruptible sleep and kernel wait
channels associated with file/page or filesystem work. These samples do not establish
which filesystem operation dominates, or a causal regression in SQLite. The initial
45-second readiness failure and successful import controls remain preserved separately
under real-io-after-migration/. No timeout, durability policy or assertion was relaxed.
The external Seagate storage boundary differs from historical internal-storage timings.

All raw reports/logs and exact private recipes are retained as compressed text with
hash receipts. Source volume is unchanged by this diagnostic apart from its owned
transient RPC client, which its finally block removes. The native checkpoint is untouched.
