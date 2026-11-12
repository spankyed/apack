# apack-terminal: public release (deferred)

Status: deferred by decision, 2026-11-12. Nothing here is started or scheduled. The v1 plan
(`docs/plans/apack-terminal-v1.md`) is apack-only and does not include any of this.

Why deferred: apack is the only consumer, and nothing outside this repository depends on the broker. Publishing
would add a support and compatibility burden with no user asking for it.

## What "public" would mean

Someone outside apack could install the broker and its view, build a client against the protocol, and rely on
version numbers meaning what they say.

## What it would take

Each item is a separate task when the time comes. Sizes are judgement, not measurement.

1. **A compatibility policy.** What counts as additive, what is breaking, when the protocol number moves, and the
   first version frozen as public. (Small.)
2. **A black-box conformance suite.** A language-neutral set of tests that drives the binary over the socket, so a
   client written by someone else can be checked against the same behaviour. Built from the existing binary
   test vectors (`node/view-vectors.json`) and the protocol document. (Medium.)
3. **A specification a stranger can read.** Today `docs/architecture/protocol.md` is internal prose. Public would
   need a reference that stands alone: every request and event, its fields, its errors, and the state machine
   for sessions and waits. (Medium.)
4. **Reproducible Windows libghostty build.** The Windows build of libghostty-vt is made out of band from signed
   tarballs with a specific Zig version (`vt-windows-setup.ps1`). A stranger cannot repeat that today. Public
   needs it either scripted from pinned inputs, or replaced by a published artifact. (Medium to large.)
5. **Packaging.** The npm packages are private. Public needs: prebuilt broker binaries per platform, shipped as
   optional dependencies or per-platform packages; the view published to npm; semantic version tags; a
   changelog. The node package's engine range (Node 22.17) and the view's (Node 24.12) would need to agree. (Medium.)
6. **Signing and notarization.** A downloadable macOS or Windows binary needs signing. The app already has a
   packaging story; the broker's own binary needs to be covered by it. (Medium.)
7. **A security policy.** How to report a vulnerability, what the broker promises and does not promise. The
   design doc already says marks are not a boundary against local programs; that statement becomes public.
   (Small.)
8. **Documentation for integrators.** Quick start, examples in more than one language, and an explicit statement
   of what is stable. (Small to medium.)
9. **A second consumer.** A client that is not apack, used in CI or by a developer, which shows the protocol holds
   for someone who did not write it. (Medium.)
10. **Accessibility claims made public.** Only after the v1 accessibility pass (F2) has real results. (Small.)
11. **The Ghostty dependency's terms.** Confirm the license and stability terms of libghostty-vt before it is
    redistributed in a binary. The survey could not confirm whether its 1.0 release has a stable C ABI; that
    needs a primary source before public. (Small.)

## When to revisit

- Someone outside apack asks to use the broker or the view.
- The owner decides to publish.

Until one of those, do not start any of the items above.

## Relation to v1

Nothing in the v1 plan is wasted by this. Items 1 to 3 would be partly done by the v1 work on recording format
versioning and the fuzzers. Nothing in v1 should be built so that public becomes impossible; the v1 plan's
decision to freeze nothing keeps that option open.
