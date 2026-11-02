# Settings meta-schema reuse qualification at7781b2de04 — 2026-10-31

Hosted run41185730370 passes normal fresh packages/pack/API builds, SDK/host typechecks,
lint,118affected SDK and117host settings/catalog cases with zero failures/skips, plus
both ordinary RPC activations. New regressions preserve independent local references
under reused schema$id and reject mutated invalid metadata after a prior acceptance.
The meta-schema checker never compiles or registers a pack schema; private strict
compilers and schema/default validation remain per definition. No mutable-definition
cache, reference namespace sharing or storage acknowledgment change was introduced.

SQLite backendReady is1510.472ms, native1018.053ms, compared with5357.929/4257.873ms in
the earlier9db trace. SQLite still has197 observed commits. Under settings compilation,
inclusive sampled wall intervals fall to316.833/232.207ms; no meta-schema compilation
samples occur inside activation. This supports the targeted mechanism; different hosted
runs and overlapping sampled spans do not justify an exact causal speedup ratio. Fresh
process startup is also faster (2.57/2.40seconds versus7.21/6.16). No OS-cold claim.

The original renderer case remains required. Run41186295488 targetsb7300724a0 (same
production code), three repeats with the unchanged five-second assertion and original
draft/selection/update/unwatch checks. Inspect its terminal result; paired backend
profiling alone does not close editor acceptance, full strict concurrency or the goal.
Raw profiles, positive cases, build/input hashes, SQL spans and workflow metadata remain
retained. The older failed editor and post-migration local traces remain visible.
