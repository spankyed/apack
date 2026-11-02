# Managed-model hybrid failure at b04e91fba5

[Actual capped run 41238461001](https://github.com/spankyed/apack/actions/runs/41238461001/job/124647978187) completed all 1,800 fusion cases, verified the independent canonical Float32/Float64 cosine oracle and scalar cross-checks, and correctly failed the unchanged per-group mean recall target of 0.95. This is retained failure evidence, not candidate acceptance.

At 1k, the ordinary service retained exact routing with no trained model. At 10k and 99.9k it published ready models with 10,000 and 20,000 training samples, respectively. Model/extension/recipe hashes and readiness receipts are in `summary.json`. Background admission took about 9.7s and 44.2s; these completion times are not foreground schema-admission latency. No concurrent foreground write/watch load was applied during training.

All-live mean recall at K=40 was 0.92475–0.941 at 10k and 0.92225–0.929 at 99.9k. At K=64 it was 0.87703–0.89844 and 0.87109–0.88891. The 99.9k 10% cohort also fails at K=40/64. K=10 passes the 0.95 mean target; exact small eligible scopes have recall 1. These outcomes use the production 256-owner target, native probe count 32 and the independent oracle, not the earlier same-engine exact reference.

All-live 99.9k warm p95 is 53.02–60.02ms, but heartbeat p99 is 74.14–83.61ms. Selective 10% queries remain slower (p95 149.93–163.15ms), and all 99.9k groups miss 16ms heartbeat. Detailed group dispositions and inspected numeric samples are retained. This is one warm pass, not cold/reopen, update/trash, variance or complete app qualification.

Each database scratch removal is witnessed. The workflow's EXIT trap removes the private acquisition directory, but this failed revision did not emit a private acquisition cleanup receipt after the recall gate failed; do not describe that removal as independently witnessed. A later workflow fixes failure-path cleanup reporting. No source text, source IDs, model weights or vector payloads are included here. Full reports remain in CI/private local evidence, identified by their original digests.
