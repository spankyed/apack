# One conversation viewer

Replace PR #311's independent Markdown renderer and `readOnly` contribution contract with one
read-only Tiptap editor for the displayed conversation. The existing text-editor extensions remain
the sole pack contract. The earlier renderer's evidence is historical and does not qualify this design.

## Implementation

- Remove the alternate renderer, DOM adapters, manifest/compiler/schema additions and their tests.
- Represent messages as identified block nodes in one ProseMirror document. Vue node views compose
  the existing message chrome around a stable content DOM. Keep attachments, actions, interactions,
  truncation and collapsed rows under the existing message component's ownership.
- Parse changed Markdown through the editor's existing `setContent` command, capturing its transaction
  without applying it. Wrap its parsed blocks in message nodes. Never construct an editor per message
  or reach into the Markdown parser's private storage.
- Cache parsed messages for the current editor only. Apply targeted transactions for changed bodies,
  insertions and removals; preserve unchanged node views and mapped selections. Reconcile thread switches
  using the conversation component's key. Reject duplicate identities before changing the document.
- Reuse the contributed-editor owner for extension replacement and teardown. Schema replacement must
  retain document data or report refusal. Parsing errors must retire a capturing editor safely.
- Adapt the existing command decoration to message boundaries. Clipboard, references, links and code
  remain owned by their existing extensions. Disable editing-only trailing paragraphs in viewers.

## Verification and delivery

1. Focused tests: one editor, unchanged row identity, body replacement, prepend/reorder/removal, empty
   bodies, contribution replacement/refusal, cleanup and Markdown clipboard/extension behavior.
2. Actual app checks: all 50 complete bodies and 25 truncation controls, expansion/collapse, references,
   code copy, native selection copy, streaming updates, scroll preservation and thread switching.
3. Prepare an independent old-app baseline with identical maintained measurement harness. Retain raw
   reports and provenance. Five warmups and 20 measured iterations per variant, balanced order.
4. Qualify plain median improvement of at least 5% and 20 ms, sampled allocation reduction of at least
   10%, rich correctness/performance, streaming regression at most 5%, and recording overhead at most 5%.
   Do not substitute the removed renderer's measurements.
5. Review final changes, regenerate public reports, run the repository chain and all six strict CI jobs.
   Commit and push the reworked PR with current evidence; mark ready only after qualification.

## Status

Implementation in progress. No new performance result is claimed.

Review caught two integration requirements: scrolling must follow mounted message node views rather
than the parent component's next tick, and Markdown must use the existing command options. Tiptap's
optional strict HTML check rejects Markdown-generated `<tbody>` wrappers and constructs an additional
schema per parse; it is not the existing viewer's parsing contract. A rich-content regression test
reproduced that refusal before the option was removed.
