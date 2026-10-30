# Logical readiness and managed model startup

Focused Linux evidence for the runtime overlay identified in `focused-source.json` over
`1d16d85c8104859932a555d09d4b4f00600f8b1a`. Ordinary EARS/SDK packages were built in a
private disposable Linux volume. The six selected cases passed at 0.5 CPU / 768 MiB,
with networking disabled. The other 17 model cases were deliberately not selected;
this run is not the full contract suite.

The cases exercise logical readiness with pending/failed optional models; mixed waiters
when a model owner stops; preservation of a committed primary write if background probing
fails; claimed recovery of an abandoned attempt; cleanup/retry after startup refusal;
and refusal to create a read-only service. Two negative controls each fail exactly one
case when recovery or the post-commit probe guard is removed. The controls restore source
bytes afterward, and the input hashes were verified against the restored volume.

The subsequent integrated run built the exact pinned `006d6cec880471e7ccc83899cd9c8704288b04e0`
engine from its archive in a fresh private Cargo target. All **652 EARS cases** passed with
zero skips, as did **18 host cases** and **7 API cases**, including partial startup refusal
and service cleanup. EARS and host typechecks passed. The API typecheck initially caught
an optional-method spy typing error in the new test; its type assertion was corrected,
the five-case API profile file was rerun, and the complete API typecheck passed. The
initial failure remains in `api-types.log` and `integrated-results.json`; successful
continuation is in `finish-results.json`. No runtime fix followed the 652-case pass.

API reports were regenerated and checked in Linux, then copied using the report's existing
LF convention. Boundaries, changed-file correctness lint and platform script syntax passed.
`final-source.json` verifies the final runtime, test and normalized report hashes against
the validated volume and records both actual native binary identities. `validate.py` and
`finish.py` preserve the exact command sequence. The broader container used 2 CPU / 6 GiB
and zero swap; it was paused while the other agent's heavy containers ran, preserving its
original build process. Dependency acquisition used networking; the finish checks did not.

This qualifies the overlay on the prior master/native baseline, not subsequent integration
with the newer master, platform CI for this change, signed installed builds, physical
refresh, live replacement suspension, performance budgets or the complete strict chain.
