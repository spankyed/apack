# Integrated watch lifecycle checkpoint

Inputs: detached integration `4af1b513e3`, combining SQLite `9c339d89a4` with master
`98386b36a18d244c19ffb501830b990ed49f7653`; native engine `6ab2f69fa13289ed4f02952253c58b4d41922c98`.
The lifecycle changes and exact regression sources are committed alongside this report.

The first disposable Linux integration passes five consumer typechecks and all 239 native EARS cases
(38 SQLite-only skips). SQLite passes 274/277; the three failures are newly inherited `containing`/`matching`
contracts, not waived requirements. `master-integration-linux.txt` retains the full terminal result.

A targeted process probe reproduced two further lifecycle failures: close retained a watch key, and a Node
process exited with status 13 during an explicit settlement wait. SQLite close now clears dependency and
statement/layout caches after the connection closes. Settlement waits ref both existing gap timers and timers
created later during a flush; ordinary idle timers remain unrefed.

The final four-case SQLite-only process suite passes on macOS: close releases tracked dependencies; waits made
by callers and inside delivery finish; an unawaited watch permits process exit. Each timer mutation independently
fails its targeted process assertion. The initial observer mutation passed because its wait occurred after timer
creation; the revised case awaits settlement before its reentrant write, covering creation with an existing waiter.
Only the revised failing mutation logs are included. The fixed suite was rerun after restoring both changes.

A local attempt to include the shared native-importing watch suite failed at module loading because this private
6ab2f69 checkout intentionally has no Mac binding. No local Rust build was run. Shared/native validation runs in
Linux, where the correct source is built. This report does not establish the full strict gate or SQLite adoption.
