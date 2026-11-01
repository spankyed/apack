# Original editor acceptance after meta-schema reuse — 2026-10-31

Run41186295488 atb7300724a0 is terminal failure:two passes,one failure,zero skips/flaky
cases/retries. Both passing repeats execute the original five-second activation predicate
and draft/selection/update/unwatch assertions. Their frontend loads settle about428/237ms
after PACK_ACTIVATED. Resource arrays are empty again; they do not attribute network work.

The third repeat fails before mounting the editor and before any toggle/activation: its
first asynchronous page.evaluateHandle loses its execution context. It lasts163ms before
the reported context-destroyed error, after the base fixture's connected-state check. The
trace has test API events, not browser frame-navigation events, so it does not establish
an actual reload/navigation cause. The original timeout failure is not reproduced in this
repeat, but the whole three-repeat run is not green and editor acceptance stays open.

The next harness change requires the initial document load before manual component
injection and records frame/load/crash/close events on failure. It introduces no retry,
sleep, weakened assertion or activation deadline change. This is a readiness hypothesis
with better diagnostics, not a claimed causal fix. Closing checks are cache-disabled
E2E types/lint and the same three-repeat original case; retain another failure if it
occurs rather than assuming every context-destroyed error is a navigation race.
Raw reports, logs, the test trace and both decoded passing timelines are retained with
hash receipts. Database/media/native binary payloads and screenshot ZIP resources are
not checked into Git. No final app/strict/adoption qualification is claimed.
