# Backend pack activation profile — 2026-10-30

Source `5569fdd656bf8e8f44a6e93988f9598860752b09`. The owned source API and shipped pack are
built normally before measuring the real authenticated RPC toggle and PACK_ACTIVATED event in isolated
SQLite and elmdb profiles. All 1602 recorded source inputs are verified. One owned two-CPU/6-GiB/no-swap
container runs after quiet admission; no protective pause occurs. The first attempt refuses before API
creation because the matching API build is missing; its zero-case preflight failure is retained.

SQLite backend-ready is 3243 ms, with the follow-up loaded-pack query served at 3270 ms; elmdb backend-ready
is 5336 ms, served at 5391 ms. SQLite records 197 commits: 176 primary totaling 403.6 ms (maximum 48.0 ms)
and 21 history totaling 70.2 ms. Its one schema call takes 103.6 ms. The most frequent membership inserts
total only 11.8 ms. Nested method spans overlap: do not sum write/finish/commit totals. CPU counters cover
the whole process, not only SQLite or the main thread. SQL keys retain prefixes, not parameters.

This is one backend-only diagnostic with SQLite first and elmdb second. Cache/order effects and different
default acknowledgment policies remain. It is neither a matched-durability benchmark nor a renderer run,
and it does not qualify the original five-second editor predicate. The reversed ordering relative to the
macOS editor samples prevents a general claim that SQLite activation is slower. No production optimization,
policy change, deadline relaxation or acceptance closure follows from this measurement. Most observed
activation time lies outside measured SQL commit/schema calls; investigate lifecycle and frontend arrival
before choosing an optimization. Individual synchronous commits still exceed the 16-ms responsiveness budget.
