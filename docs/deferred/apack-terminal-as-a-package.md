# Consume apack-terminal as a package, as elmdb is

Status: deferred, and **not blocked on a release process**. This document authorizes no implementation.
Revisit when somebody is ready to add an npm package to the
[apack-terminal](https://github.com/spankyed/apack-terminal) repository; everything below follows from
that one change.

## What it is actually for

The broker's protocol is generated from its Rust by `ts-rs` and then **hand-carried into this repo**: a
committed copy at `packages/apack-host/src/broker/protocol.ts`, a script that re-derives and compares it
(`scripts/broker-protocol.ts`), and a typecheck leg that runs the comparison. The app also locates the
broker's binary by **guessing a path** into the vendored checkout's build directory.

None of that is the price of vendoring by symlink. `elmdb` is also unpublished and also vendored by
symlink, and needs none of it:

| | elmdb | apack-terminal |
|---|---|---|
| consumed as | `"elmdb": "file:../../vendor/elmdb/crates/elmdb-node"` | nothing; the symlink is read by hand |
| protocol TypeScript | ships inside the package (`files` names `protocol/`) | copied here and kept fresh by a script |
| binary located by | npm resolution | `brokerBinary()` building a path from `SHIPPED_PACKS_DIR` |

**The machinery is the price of the missing package.** The difference between the two is only what they
ship: elmdb is a napi addon, so its package uses `napi.targets`; apack-terminal is a binary the app
*spawns*, so its package exports "where is the binary for this platform" — esbuild's shape rather than
elmdb's.

**The guessed path has already cost a defect.** `brokerBinary()` asked for `apack-terminal` where Windows
writes `apack-terminal.exe`, so `existsSync` answered false and the caller got a refusal telling it to run
`cargo build` in a checkout where `cargo build` had just succeeded — the terminal never started on Windows
at all. A package that answers for its own binary cannot be wrong about its own name.

## What lands in this repo when it exists

| | |
|---|---|
| delete `scripts/broker-protocol.ts` | 129 lines |
| delete `packages/apack-host/src/broker/protocol.ts` | 83 lines, the hand-carried copy |
| delete the `protocol:check` leg | and its row in `TYPECHECK_LEGS` |
| move `brokerBinaryPath` and `brokerBinary` | 34 lines, into the package |
| move 7 test cases | 4 for `socketPath`, 3 for `brokerBinaryPath` |
| delete ~2 cases in `tests/broker/lifetime.spec.ts` | the matrix `apack-terminal/tests/broker.rs` already proves |

**What stays, and why it is not cruft.** `packages/apack-host/src/broker/client.ts` is the *app's* half —
the handshake, frames into calls and a feed, the reconnect — and would exist whatever the broker shipped.
The `brokerEnvironment` cases stay too: what a shell may inherit is the app's decision. And one lifetime
case stays, because it is the one thing the Rust suite cannot show — that *this app's* client and hold ask
for the right roles. A client that greeted as an owner would keep every shell running after the app quit,
with every case on both sides green.

**The pin and the linker also stay.** `vendor/apack-terminal.rev` and `scripts/link-apack-terminal.mjs`
survive a package: elmdb has a package and still has `vendor/elmdb.rev` and `link-elmdb.mjs`, because the
`file:` dependency points *through* the symlink. Only publishing to a registry retires those, and elmdb
has not got there either.

## One thing that becomes moot rather than fixed

`protocol:check` is **inert in CI today**: `.github/workflows/ci.yml` never links the vendored checkouts,
so the check prints *"not derived here"* and exits 0 — a gate that cannot fail where it matters, which is
the shape [`CLAUDE.md`](../../CLAUDE.md) names as *a check that reports nothing may have looked at
nothing*. Making it fail instead of pass is a one-line change and a reasonable stopgap; it is recorded
here rather than done because this document deletes the check outright, and fixing a thing on its way out
is motion.

## What else apack-terminal is missing, measured against elmdb

Not required by the above, and worth knowing while someone is in that repository:

1. **No CI at all.** elmdb has four workflows across linux, musl and windows, plus loom and shuttle for
   concurrency. apack-terminal has threads, a shared `Sessions`, a credit-bounded output channel and a
   lifetime rule — and nothing automated.
2. **No `cargo xtask pre-push`**, so every check is remembered by hand.
3. **No mutation testing.** elmdb's `.cargo/mutants.toml` and `scripts/mutants-in-diff.py` fail on a
   survivor in a change; apack-terminal's mutation checking has been done by hand, which has the three
   failure modes that script exists to prevent.
4. **No `.config/nextest.toml`**, so tests share a process rather than each getting one with a deadline.
5. **No `rustfmt.toml`**, so its formatting is whatever the toolchain's defaults were on the day.
