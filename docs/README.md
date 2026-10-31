# Documentation

Start with [getting started](public-facing/getting-started.md) for using apack and authoring packs.
For repository implementation and validation rules, read [CLAUDE.md](../CLAUDE.md).

## Where to look

| Directory | Purpose | What belongs here |
|---|---|---|
| [public-facing/](public-facing/) | User and pack-author documentation | Supported workflows, APIs, CLI commands and manifest contracts |
| [references/](references/) | How the current system works | Architecture, internal contracts, operational guidance and reusable lessons |
| [references/guides/](references/guides/) | Development environment guides | Agent access, practical workflows, resource ownership and operational safeguards |
| [goals/](goals/) | Delivery scope and completion | Required outcomes, execution order, remaining checkpoints and acceptance |
| [plans/](plans/) | Intended designs | Proposed contracts, decisions, dependencies and acceptance cases |
| [references/evidence/](references/evidence/) | What happened | Dated investigations, experiments, source commits and validation results |
| [issues/](issues/) | Problems awaiting resolution | Reproductions, observed impact and unresolved findings |
| [archive/](archive/) | Historical work and decisions | Completed, superseded, absorbed, abandoned or rejected documents with explicit status |

Goals coordinate delivery; subsystem plans own detailed designs. Small goals may contain their design
without a separate plan. Reference describes implemented behavior; evidence records what a particular
investigation or checkpoint established, including its limits. Moving a document never changes whether
its requirements are complete.

## Current work

The [completed settings and pack contracts goal](archive/goals/goal-settings-and-pack-contracts.md#outcome-2026-10-19)
records the delivered architecture and acceptance, and the archived [manifest maturity](archive/plans/manifest-maturity.md)
roadmap the decisions behind it. Consult document status rather than
treating historical handoffs as additional instructions. Other goals and plans carry their own status;
this index is not a second backlog.

For interactive Windows development and native debugging, use the
[Windows development VM guide](references/guides/windows-development-vm.md). It covers access, source
transfer, focused validation, costs, shutdown and recovery; it does not replace the goal's final gates.

For this host's shared external OrbStack data location, safe relocation and verification, see the
[Docker storage guide](references/guides/docker-storage.md).

## Document lifecycle

Keep current decisions and requirements in place. When a decision changes, reconcile the affected
phase, acceptance criteria, startup prompt and dependent plans in the same change; preserve the old
reasoning in evidence. Repair both incoming and outgoing links when moving a document.

Deferred goals and plans stay in their respective directories with an explicit status and a condition
for reconsideration. Deferral is not permission to start work. Rejected proposals belong in the archive
with their reasons; historical rejected/deferred decision collections may remain together there.

When implementation finishes, document its resulting contract in reference or public-facing docs,
record closure evidence, and archive the goal and completed plans. A completed proposal must not be
the only account of current behavior. Do not archive unfinished requirements as completed or lose them
when absorbing one goal into another.

See [goal authoring](goals/README.md) for the template and [documentation rules](AGENTS.md) for upkeep.
