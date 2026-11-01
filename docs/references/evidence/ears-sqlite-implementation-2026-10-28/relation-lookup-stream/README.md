# Stream ordinary relation identity lookup

The link/update identity check now shares a private matchingRelation helper. It streams endpoint-matching rows through the existing equality implementation and closes the native iterator on first match, exhaustion or decode failure before any write/commit. It no longer retains all candidate info payloads just to find one match. Existing key/value/weight and duplicate-refusal semantics are unchanged.

The source-helper control checks 1/128/128 visits for first/last/absent keys in a 128-row group, exclusion and decode-failure cursor closure. It uses controlled cursors, not SQLite or driver timings. Run from the repository root:

```sh
node docs/references/evidence/ears-sqlite-implementation-2026-10-28/relation-lookup-stream/control.mjs
```

The new actual-driver regression seeds 128 distinct keys sharing endpoints with large info payloads, then requires first-match traversal, cursor release before mutation, duplicate refusal without commit/row changes, full-scan exhaustion and a subsequent writable connection. It is a named requirement in the next focused/platform receipt. TypeScript parsing and helper controls pass; native/type/model qualification is pending. The currently running 4cc platform run predates this change.

This bounds retained candidate rows, not total distinct-key search work. One absent-key lookup still scans the endpoint group; repeated insertion can still be quadratic. The separate quadratic relation audit remains unresolved and requires equality-preserving disk-backed grouping/index design and measurements. No high-multiplicity speed or process-memory acceptance is claimed here.
