# Relation-key audit worst-case comparison cost

`audit.ts:primaryData` visits prior relations with the same kind/source/target and compares their decoded keys. For a group of g distinct keyed edges, no comparison can break early: there are g(g−1)/2 prior-row comparisons. The between index restricts endpoint lookup; it does not eliminate repeated scans/decodes inside that group. Streaming bounds retained JS rows, not cumulative CPU or I/O. This is an owned complexity finding under the existing review requirement, not a new data-loss claim.

The control executes the current actual primaryData and sameRelationKey source with controlled cursors. It records 120/496/2,016/8,128 comparisons for groups of 16/32/64/128, with no duplicate identities. It proves the loop's comparison growth, not actual SQLite timing or resource consumption. Run from the repository root:

```sh
node docs/references/evidence/ears-sqlite-implementation-2026-10-28/relation-audit-complexity/control.mjs
```

Current ordinary link/update identity checks also scan the matching endpoint group; link materializes it through all() before find(). That is O(g) per operation plus decoded key size, and repeated insertion of distinct keys can similarly accumulate quadratic work. Typical g=1 does not expose this regime. Unkeyed duplicate audit breaks at the first prior identity and does not have the same distinct-key worst case.

Required resolution remains in the active complexity review: use one equality-preserving canonical representation of the declared key (own map key order ignored; list order, Date/bytes types and missing=null semantics retained), then build an offline disk-backed ordered spool for audit or a rebuildable identity index if also justified for ordinary writes. Do not add a second subtly different equality definition, keep all keys in an unbounded JS map or treat a hash match as identity. Define declaration/restore/rebuild ownership before persisting any new derived key index. Verify malformed/unchecked inputs and collision handling, and measure high-multiplicity endpoints alongside sparse graph cases. Runtime is deliberately unchanged while corpus measurements finish; this finding is unresolved, not waived by passing functional tests.
