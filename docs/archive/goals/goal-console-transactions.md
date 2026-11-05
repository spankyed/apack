> **Done** (2026-11-04). Code running after its transaction ended writes nothing. See Outcome. The rest is the plan as
> written, with Decision 1 corrected.

```text
# Goal: console transaction code can't write outside its transaction

Implement docs/goals/goal-console-transactions.md. Follow CLAUDE.md and docs/AGENTS.md.
Read Scope, Current handoff, Decisions and Phases before continuing.
The survey was made at 1b69d15677 on master; inspect current code before relying on it.
Follow the current checkout arrangement and preserve unrelated work.

Finished when:
- Every phase's acceptance condition below is met on current source.
- docs/public-facing/cli.md and the runner's messages describe the resulting contract.
- Record Outcome, archive this goal, repair links and commit closure.

Commit usable checkpoints as you go. Do not expand or reduce scope without user authorization.
```

## The issue

The console is where someone repairs data by hand, on a database they usually can't reconstruct: `apack db` exists for
when the app won't start. A half-applied repair is worse than a refused one, because nothing records which statements ran.
So transaction code has to mean what it says: **all of it, or none of it, and a message that tells the truth about which.**

## What already holds

Moving onto elmdb solved the original problem. This goal was written (2026-09-17) when the engine held the data in memory
and the plan was an undo log over it. The engine now keeps no copy in memory, and a unit is one LMDB write transaction.

`runTransactionCode` (`packages/apack-sdk/src/database-console/index.ts`) wraps the code in `transact`:

| Asked for | Today |
|---|---|
| Code that throws leaves the database as it was | Yes: the unit aborts (`database-console.spec.ts`, and `db.integration.spec.ts` through the CLI) |
| Code that returns keeps every write | Yes: the unit commits |
| A commit reaches the files in one LMDB transaction | Yes: one elmdb `Unit` |
| Every console runs through it | Yes: the Database surface and `apack db exec` and `repl --write`, where each line is its own transaction |
| No doc or message says a failure keeps writes | Yes: `cli.md` and the failure message say the opposite, apart from the gap below |

The rest of the old plan no longer applies:

- **Where the undo lives, and a failed rollback being fatal:** nothing to undo or to get out of step. LMDB aborts a
  transaction, and there is no memory copy.
- **What other writers do during a transaction:** the code is synchronous, so nothing in the process can interleave with
  it, and LMDB and `apack db`'s write lock cover other processes.
- **The `query` step's write mode:** gone. A query step only reads.
- **A host-only boundary:** reversed. Packs have `transact` through `#generated/ears`, which is why the old Deferred item
  on pack transactions is closed.

## Scope

Close the remaining gap. Code that runs after its unit ended can still write, because the helpers it closed over stay
live, and each late write commits as a unit of its own. Probed at 1b69d15677:

| Code | Reports | Actually |
|---|---|---|
| `(async () => { await 0; create(...) })(); return 'ok'` | success | the write lands outside the transaction |
| `setTimeout(() => create(...), 0); throw new Error('boom')` | "Nothing it wrote was kept" | **the write lands: the message is false** |
| `return (async () => { create(...); await 0; create(...) })()` | refused, and says the later write is kept | as reported, but a transaction shouldn't keep anything |

Nobody writes these by accident in a one-line repair, but a longer script can, and the failure case is the one that lies.

Excluded: sandboxing console code. It's the user's own code and can reach anything in the process; the aim is a helper that
can't quietly break the promise, not a security boundary.

## Outcome

Done 2026-11-04. `runTransactionCode` closes its write helpers and their builders as the unit ends. A later call writes
nothing and logs an error, a builder's `id` and `row` still answer, and every row of the Scope table now keeps nothing it
wrote late.

- **Changed from the plan:** Decision 1 said a late write throws. A throw from a timer or unawaited async code is uncaught,
  which ends the app's API process, so it logs instead.
- **Specs:** `database-console.spec.ts`. Five mutations each fail it: helpers left open, a closed helper throwing, a raw
  builder, a chained call returning the raw builder, and a late builder that reads as a thenable.
- **Through the CLI:** `apack db exec` on a temporary data dir, with a timer writing after success and after a throw. The
  row stayed as it was.
- **Gate:** `npm run chain -- --no-native` passed, Node 24.16.0. `test:native` was not run, since the compiler isn't touched.
  The app's Database surface goes through the same function; it was not driven by hand.

## Decisions

1. **The write helpers close when the unit ends.** A write through a console helper after that writes nothing and logs an
   error naming why, and the writes made inside the unit stand or fall as they do now. It doesn't throw: late code has no
   caller to catch it, and in the app an uncaught error ends the API process (`packages/api/src/boot/errors.ts`).
2. **The helpers include what they return.** `const w = write(id)` held past the unit is the same escape as calling `write`
   late, so a held builder is closed too.
3. **The console only.** `transact` for packs and for host code stays as it is: `engine.md`'s unit contract is elmdb's, and
   a pack's code isn't a person repairing data by hand.

## Phases

### Phase 1: close the helpers

In `runTransactionCode`, give the code write helpers that close once the unit has ended, returned builders included. A
returned promise stays refused, and its message loses the "is kept" clause.

**Done when:** `database-console.spec.ts` shows each row of the table above keeps nothing it wrote after the unit, and the
existing "Kept" case asserts the opposite. Mutation: leaving the helpers open fails those cases.

### Phase 2: the contract in the docs

`docs/public-facing/cli.md` (`exec`) and the `runTransactionCode` doc comment drop the exception. `npm run api:update` if
an export moved.

**Done when:** no doc or message describes a write outside the transaction as kept.

## Deferred

- **Durability on return.** `transact` leaves the sync to group commit, so a crash within about a second of a console success
  in the app can lose the whole transaction, never part of it, and `apack db` syncs when it closes. Passing
  `{ durable: true }` is one line if that ever matters.
- **A transaction across `repl` lines.** Each line is its own. No one has asked for `.begin` and `.commit`.
- **Transactions across the bus.** A system handler writing in several steps isn't one transaction. `transact` is synchronous,
  so this needs its own design.
