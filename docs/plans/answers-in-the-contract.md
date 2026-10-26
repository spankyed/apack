# A system's contract declares its answers apart from its news

Status: planned, 2026-10-26. Nothing built. Follows live queries
([archive/plans/live-queries.md](../archive/plans/live-queries.md), Open), which left this as the condition its step 5
pack rule needed.

## Where it stands

A system sends a surface two kinds of message, and its contract holds both in one union:

- **An answer**: a `reply(event)` to the message being handled, which goes to its asker alone
  (`_replyTo`, `@apackdev/sdk/events`). `GET_SCHEMA` → `SCHEMA_READ`, `GET_CHAT_START` → `CHAT_STARTED`.
- **News**: a `broadcastToSurface(name, event)` nobody asked for, which reaches every window showing that surface.

`packages/default-setup/CLAUDE.md` ("What a system sends a surface") states the rule as data is a view, a result is a
reply and news is a broadcast. The rule is in the guide, and the types don't hold it:

- `reply` is typed against the answerer's `outgoing` (`ContractOutgoing<C>`, `define-system.ts`), and so is
  `broadcastToSurface`. Either can send the other's events. A broadcast of `SCHEMA_READ` compiles, reaches every
  window, and is taken there as the answer to an ask they never made.
- The step 5 pack rule ("news never carries what a view serves") couldn't ship. An answer carrying a row is right
  (`NOTE_CREATED` with its summary, `SAVED_SESSION_READ`), and in one union, codegen can't tell it from a broadcast
  carrying one.

## The change

`SystemContract` gets a fifth field, `answers`, beside `outgoing`:

```ts
export type Contract = {
  context: DatabaseContext
  incoming: DatabaseIncoming
  answers: DatabaseAnswers   // sent only by reply
  outgoing: DatabaseNews     // sent only by broadcast
}
```

1. **SDK types** (`framework/define-system.ts`, `events/index.ts`). Add `ContractAnswers<C>` and `AnswersEventsOf<C>`
   beside their neighbours. A handler's `reply` becomes `Reply<ContractAnswers<C>>`. `broadcastToSurface`, and
   `services.emitter.broadcastToSurface`, stay on `outgoing`. `sendToWindow`, which answers one window through a flow,
   takes `answers`. The machine's own event union is unchanged, since a system receives neither.
2. **Codegen** (`build/generate-entries.ts`, `framework/event-contracts.ts`, `_EventContractsSchema`). Compile
   `answers` into `FeatureEventContract.system`. A surface's `receives` becomes its system's `outgoing` ∪ `answers` ∪
   its inbox audiences, so the app's send check still accepts an answer. Codegen refuses an event type named in both
   `answers` and `outgoing`. One event doing both jobs is the ambiguity this removes.
3. **Migration.** Every contract in the tree is migrated in the same change: default-setup's, the host's
   (`host/packs`, `host/settings`) and the fixture packs'. The compiler gives the list. Once `reply` takes only
   `answers`, every reply of an event still in `outgoing` fails to compile, and so does every broadcast of a moved
   one. Where an event is genuinely sent both ways, it splits into two events.
4. **Rule and docs.** The guide's section states the rule as the contract now enforces it. `npm run api:update`
   (SDK exports), `npm run schema:update -w @apackdev/sdk` if the event-contract schema reaches `apack.schema.json`,
   and `npm run facade:update -w @app/default-setup`. Read each regenerated diff.
5. **The pack rule, now statable** (optional, last). Codegen has types, so it can refuse an `outgoing` event whose
   payload holds a shape a feature's view serves. This is the step 5 rule from live queries. It ships only if it
   fires on no news in the tree that is actually right. If it does, keep the guide as the rule, as now.

## Open questions

- **A system asking a system.** `reply` reaches a system asker over the bus too. The answer must be in the asker's
  `incoming`, which the answerer's contract can't name, since it doesn't know who asks. Types check the surface side
  only; a system-to-system answer stays checked at runtime by the receiver's `receives`, as now.
- **Typing `reply` to the asked event's answer.** A finer contract maps each incoming ask to its answer
  (`GET_SCHEMA` → `SCHEMA_READ`), so `reply` in the `GET_SCHEMA` handler takes only that. That costs a map per system
  rather than a union. Take the union first, and revisit only if a wrong-answer bug shows up in practice.

## Done when

- `reply({ type: <a news event> })` and `broadcastToSurface(name, <an answer event>)` each fail to compile, and a
  type-level spec pins both.
- Every contract in the tree declares `answers`, and no event type is in both unions (codegen refuses it, with a
  failing case).
- `npm run chain -- --no-native` passes, with the regenerated API, schema and facade reports read and committed.
