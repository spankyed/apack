# Editor activation boundary diagnostics — 2026-10-30

The existing real-app activation test now attaches timestamped frontend lifecycle events, default-setup
resource timings and accepted-runtime/loader state. It uses XState inspection and PerformanceObserver;
no production loader, event, policy or editor operation is replaced. The observer and subscription are
released with the mounted editor. The unchanged five-second referenceSuggestion predicate and document,
selection, update-count and deactivation assertions remain the acceptance conditions. Timelines are
retained on success as well as failure so a passing control can show the same boundaries.

Focused oxlint passes with zero warnings/errors and the complete tests TypeScript project passes with
incremental cache disabled. The owned Linux container is capped at two CPUs, six GiB and no swap, after
quiet admission. All 118 frozen inputs are hash-verified and the tested spec digest is recorded. Static
validation does not prove any actual macOS frontend delivery or fix the existing intermittent failure.

The first private admission waiter called an older controller. That controller's existing-CID guard
refused before container creation; zero test cases ran. The owned waiter is stopped through its stop
marker and confirmed terminal before the corrected waiter is started. Original and corrected recipes
and the zero-case refusal are retained. No other agent's container was stopped or altered.
