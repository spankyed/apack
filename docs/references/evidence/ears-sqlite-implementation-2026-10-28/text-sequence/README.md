# Carry immutable entity sequence through text ranking — 2026-10-29

The adjacent text-plans diagnosis on 4a89893fe8 observes three entity seeks on broad native ranking.
This correction carries the already joined entity's immutable sequence through clause and accepted-entity
aggregates. Ranking/output use that sequence directly. Candidate membership, owner masks, clause scores,
original order ties, phrase/highlight scope and snapshot rules are unchanged; no derived layout or API changes.

Exact tested runtime is 4a89893fe8 plus sequence.patch (manifest retained). One isolated Linux arm64
container, two CPUs/6 GiB, dropped capabilities and real permission-denial preflight: five package builds,
EARS types, 68 focused cases, lint/imports/API reports, **484 SQLite cases / 289 native cases** pass.
The permanent native-plan guard sees no more than one entity lookup in a single-clause ranked statement.
Restoring the preceding production text implementation makes it fail with three lookups, while its expected
answers still pass. This is execution-path evidence, not proof that the latency target is met.

The new prefix/sequence/sequence/prefix cohort is preregistered in the benchmark README after functional
validation, before timing. Its documentation-only addition is outside the runtime archive. It retains the
identical fixture and original resources/deadline; all old failed cohorts and every remaining acceptance
criterion stay open. Recency still hydrates/ranks generic values in JS; no early cap is introduced there.
