# Actual graph package production passes; clean Preview ordering fails

[41211950546](https://github.com/spankyed/apack/actions/runs/41211950546), source `2cbafd7fb3`, succeeds on Linux. Matching published packages build through the actual locked graph builder, including dependency notices and path remapping. The emitted package's Rust/WASM core reaches independently computed modularity 0.41978961209730437, repeats its result, rejects invalid inputs and handles an empty graph. All three EARS API reports check current; the regenerated patch is empty. This closes production-build/API freshness at that Linux checkpoint, not full installed-platform qualification.

The emitted WASM digest is `7c529a9f83650e129bd6b82fd202444d01f5456d15a66004fd315d77cd9960b2`; generated loader digest is `51dca864da108c2491474c92d888cadc0697966e40ad623f7cb185cd0ed43b0f`. Compiled payloads remain outside Git. Source, actual probe/check/build logs, generated reports and uncompressed-byte receipts accompany this note.

## Cold Preview dependency order

[Installed-platform 41212950283](https://github.com/spankyed/apack/actions/runs/41212950283) at the same source fails on Linux before packaging/native execution. Preview invokes `generate:entries` before ensuring published workspace declarations exist; fresh codegen cannot resolve `SurfaceInbox<ThreadsInboxEvent>` in the Threads contract and refuses an `any` inbox. The retained error is not relabeled a native-module failure. Its Windows sibling is still active at the observation.

The targeted fix adds `npm run packages:ensure` before generation in the ordinary Preview command sequence, retaining the newer-master generation step and every later build. `build:default-setup` already ensures packages, but that occurs too late for this earlier standalone generation. Syntax checking passes; the real clean Preview path must requalify the change. No fixture/type refusal is weakened, and no workflow-only warmup hides the ordinary command's ordering.

Full strict41212565910 remains separately active at2cbafd7fb3. It must finish under that source; the subsequent Preview-order fix and exact-current integrated/installed acceptance still require their own evidence. Original performance/resource/recovery gates are unchanged.
