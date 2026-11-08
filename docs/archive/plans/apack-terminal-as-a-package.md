# Consume apack-terminal as a package, as elmdb is

Status: **done, 2026-11-08.** The package is `node/` in the
[apack-terminal](https://github.com/spankyed/apack-terminal) repository, staged by `cargo xtask package`
there and installed here as `file:../../vendor/apack-terminal/node`. Everything below followed from that one
change, as it said it would. What landed, against what this planned:

| planned | what happened |
|---|---|
| delete `scripts/broker-protocol.ts`, the copy, the `protocol:check` leg | all three, and the two npm scripts |
| move `brokerBinaryPath` and `brokerBinary` into the package | `brokerBinaryPath` deleted; the package answers for its own binary, and the host keeps `brokerBinary`, which is its refusal and the `APACK_TERMINAL_BINARY` override |
| move 4 `socketPath` cases into the package | **not done, on purpose.** One broker per data dir is the *app's* policy, and the socket's name is derived from a path only the app knows — the same reason this plan keeps the `brokerEnvironment` cases here |
| delete ~2 cases in `tests/broker/lifetime.spec.ts` | **not done.** They had never run anywhere: the suite named a path into the checkout's `target/debug`, which exists on no runner, so every case was skipped on every CI run. They run now, against the package's binary, in 65 ms. Deleting cases that have just started proving something is not a saving |
| the `protocol:check` gate that could not fail in CI | moot, as this predicted: the check is gone rather than fixed |

Also landed, which this plan listed only as "worth knowing while someone is in that repository": CI on all
three platforms, `cargo xtask pre-push`, mutation testing, `.config/nextest.toml` and `rustfmt.toml`.

**All of it green at `3c1e4bd`**, and its first three runs were worth the trouble — every failure was in the
tooling rather than the broker, and none of them was reachable from a developer's machine:

| what failed | why it was invisible locally |
|---|---|
| `cargo xtask` was not a command — no `.cargo/config.toml` alias | it had only ever been run as `cargo run -p xtask --`, so the spelling every document here prescribes was the one thing never exercised |
| every `tests` job raced on the generated protocol | `[profile.ci]`'s only setting was `fail-fast = false`, and nextest does not merge a profile's overrides with the default's, so the single-thread group never applied where CI selected it. One profile now, with `--no-fail-fast` as a flag |
| the alternate-screen case waited 10s for a switch that never came | it drives `less`, which reads terminfo before using the alternate screen; a developer's run inherits their terminal's `TERM` and CI has none. It declares `TERM` now |
| that case and the keystroke case spawned the platform default shell | so they depended on which shell the account points at and what it does with a profile it has never seen. Their subject is the pty round trip, so they name a shell |

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
the shape [`CLAUDE.md`](../../../CLAUDE.md) names as *a check that reports nothing may have looked at
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
