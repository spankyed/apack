# The vendored checkouts hand over artifacts, not source

Status: **route decided, not scheduled — 2026-11-08.** Prompted by
[apack-terminal as a package](../archive/plans/apack-terminal-as-a-package.md), which left publishing as the
remaining condition — *"Only publishing to a registry retires those, and elmdb has not got there either."*
Publishing is the larger of two answers and it is the one taken: **the npm registry**. The smaller
answer — a per-platform release asset — stays below as the step that proves the matrix first, not as a
route still open.

Not the same work as [npm and Homebrew distribution](deferred/npm-and-homebrew-distribution.md), which
publishes the five `@apackdev` packages and the CLI. These two are native, unscoped, and consumed through
`vendor/`; nothing in that plan reaches them.

## What this is for

**Nothing here is wrong with how the app consumes these two; what costs is that every consumer builds them
from source.** Both checkouts already ship real npm packages and the app already resolves them as
dependencies —
`"apack-terminal": "file:../../vendor/apack-terminal/node"` in `@apackdev/host` and the API,
`"elmdb": "file:../../vendor/elmdb/crates/elmdb-node"` in `@apackdev/ears` and the API. So this changes
**where the tarball comes from** and nothing about how the app reaches it. What it removes:

| | |
|---|---|
| **A pin that can name an unpushed commit** | Twice in one day, with different commits: CI's clone died ninety seconds in on `upload-pack: not our ref` (`42476840456`, `42491942672`). `link:*` checks the *local* checkout holds the pin, which is why it passes in exactly that case |
| **A Rust build in every CI job** | Each action is used at 11 call sites across 9 workflows. elmdb's binding is built at **all** of its — that action takes no `build` input, so there is no opting out — and the broker at 6 (`build: 'true'`). Read a run for the per-job cost before citing one |
| **A per-platform workaround inside a CI action** | `.github/actions/elmdb` builds with `cargo` and renames the artifact by hand on Windows, because `@napi-rs/cli`'s build times out on its own filesystem-reconciliation lock there |
| **A pin and a link that can disagree** | The link is machine-specific so it is gitignored, which leaves the `.rev` as the only committed fact about which commit is current — and the two are set by different acts |
| **An untracked file that no local run exercises** | `cargo xtask`'s alias lives in `.cargo/config.toml`; it was untracked, so CI's clone had no such command and five jobs failed `error: no such command: xtask` |

## What actually needs to change

**Two problems were one word here, and separating them is most of the plan.**

| | |
|---|---|
| **A developer builds a sibling checkout and the app resolves it** | Already solved. The symlink, the `file:` dependency and a linker that refuses a checkout that isn't one. Every cost in the table above is somebody else's |
| **CI compiles that checkout from source, in every job** | The actual problem. What it wants is a **prebuilt artifact per platform**, which is a smaller thing than a registry |

So there are two versions of this work, and the first is a prerequisite of the second rather than a lesser
form of it. **The registry is the destination**; artifacts are the step that proves each repository can build
its matrix before a version range replaces a path.

- **Artifacts** — each repository's CI builds its matrix on release and publishes the per-platform artifact
  as a GitHub release asset. This repo's two actions download the asset for the runner instead of cloning and
  compiling. No scope, no registry account, no publish in the development loop, and nothing entangled with
  [npm and Homebrew distribution](deferred/npm-and-homebrew-distribution.md).
- **A registry — chosen.** The same artifacts, served by npm, with the `file:` dependency replaced by a
  version range. It additionally buys an outside consumer for elmdb and removes `vendor/` entirely. What it
  brings with it is a publish in the path of a protocol change and version negotiation where there is none;
  the local loop below is what answers the first, and it is this route's load-bearing assumption.

**The committed shared fact changes either way, and that is the repair for the pin.** `vendor/*.rev` names a
commit, which is fetchable only if someone remembered to push; a release tag or a version names something
that exists by construction. That is why no `ls-remote` check belongs anywhere in this plan — it would
guard the failure instead of removing its cause, and where git owns the problem git already has the refusal
(below).

## Precedent, on both halves

**Linking a sibling checkout for co-development is a first-class feature wherever native code is involved**,
so that half of the arrangement is the normal one:

| | |
|---|---|
| Cargo | `[patch.crates-io] foo = { path = "../foo" }`, and it may live in a user-level `.cargo/config.toml`, so the override is **not committed** |
| Go | `go.work`, added in 1.18 for multi-module local development and conventionally gitignored — a first-class uncommitted override |
| Bazel | `--override_repository`, a flag |
| Gradle | composite builds, `--include-build`, a flag |
| pnpm, Yarn | the `link:` and `portal:` protocols; `resolutions` |
| Chromium | `DEPS`: a pinned revision of a sibling repository cloned into a path, which is what `vendor/*.rev` is |

**Two things here are outside that precedent, and they are what this plan is about.**

**npm is the one ecosystem with no uncommitted override**, which is why this repo's arrangement is
hand-rolled: there is no primitive to use. `overrides` is a committed field and `npm link` is removed by
`npm ci`. The gitignored symlink beside a committed `.rev` is a hand-rolled submodule standing in for the
mechanism Cargo and Go both ship.

**Compiling the dependency in every CI job has no precedent at all.** napi-rs exists so that a consumer
never builds the addon — the matrix is built once on release and an install picks a prebuild. For a
**spawned binary** the shape is esbuild's: 26 per-platform `optionalDependencies`, each constrained by `os`
and `cpu`, with the main package resolving whichever installed. That precedent is already in this tree —
`packages/apack-cli/tests/build/compiler-installation.native.spec.ts` resolves
`@esbuild/${process.platform}-${process.arch}` by hand.

**node-pty is not the precedent, in either direction.** Official node-pty compiles from source through
node-gyp on install; the existence of `node-pty-prebuilt-multiarch` and its siblings is the evidence, since
nobody forks a package to add prebuilds it already ships. So it is neither an example of consuming a pty
layer prebuilt nor a reason to vendor one — it is the cost this plan is avoiding, paid by every consumer
instead of by two release pipelines.

### The submodule option, which is orthogonal

A git submodule would make the pin and the checkout **one fact instead of two set by different acts**, and it
brings git's own answer to the failure this plan is repairing: `push.recurseSubmodules = check` aborts a push
whose submodule commit is not on a remote, which is exactly what the two ninety-second CI deaths were. That
is the `ls-remote` idea done by the tool that owns the problem instead of by a script.

**It is not free here, and the cost is this repo's worktrees.** A submodule lives *inside* the checkout, so
each worktree gets its own clone and its own Cargo target directory — where the symlink points every worktree
at one shared checkout outside the repo (`APACK_TERMINAL_DIR`, defaulting to `~/Develop/Projects/apack/…`).
`npm run janitor` exists because those target directories are large; multiplying them per worktree is the
wrong direction, and this repo creates worktrees routinely (`npm run session:new`).

So it is recorded as an alternative rather than a step: it fixes the pin by refusing a bad push, where the
artifact route fixes it by making the committed fact a release that exists by construction. Only one of the
two is needed, and the artifact route is wanted anyway. Check `git submodule`'s behaviour against the shared
external checkout before treating this as available.

## What has to exist first, per repository

**Both routes need the same thing from each repository: a built artifact per triple, produced on release
rather than on a consumer's machine.** Only the last paragraph of each half below is registry-specific, and
`"private": true` — which both manifests carry today — is the switch that route ends on.

### elmdb

`crates/elmdb-node` is a napi-rs addon and **already declares its matrix** — `napi.targets` lists seven
triples. The flow is the standard one: a matrix job per triple runs `napi build --platform --release`,
`napi artifacts` collects them, and `napi prepublish` writes one `elmdb-<platform>` package per triple
that the main package names in `optionalDependencies`. The Windows lock above is the one known obstacle and
is already worked around in this repo's action; fix it there rather than carrying the workaround into a
release pipeline.

### apack-terminal

`node/` ships a **binary the app spawns**, not an addon, so napi's shape does not apply. For the artifact
route that is a simplification — a binary per triple is a release asset, and `brokerBinary()` already knows
how to look for one and how to refuse when it is absent. Under a registry the shape is **a package per
platform** — esbuild's, above: `apack-terminal-darwin-arm64` and siblings in `optionalDependencies`, the
main package resolving whichever installed. It keeps the install offline and hermetic, keeps
`brokerBinary()`'s refusal meaningful, and matches what the app already assumes, which is a package that
answers for its own binary. It costs a publish per platform per release.

The alternative, recorded with why it loses: **one package fetching its binary on install** from a GitHub
release, `prebuild-install`-style. One tarball, but an install then needs the network and a checksum, and a
packaged app's `node_modules` has to be collected after that fetch rather than by installing it.

### The matrix is four triples, not seven

What the app ships (`electron-builder.mjs`) plus where this repo's tests run:

| triple | why |
|---|---|
| `aarch64-apple-darwin` | the mac build (`dmg`, `zip`, arm64 only) and every developer machine |
| `x86_64-pc-windows-msvc` | the win build (`nsis`, x64) and the Windows development VM |
| `x86_64-unknown-linux-gnu` | the linux build (`AppImage`, `deb`, x64) and GitHub's linux runners |
| `aarch64-unknown-linux-gnu` | the Linux test container (`node:24-bookworm`) on an Apple Silicon host |

elmdb's other three are its ambition as a general library, which is elmdb's release decision and not a
condition of this work. Nothing here ships an Intel mac.

## What lands in this repo

**With artifacts alone.** The checkout's role shrinks to "where a developer builds"; CI stops having one:

| | |
|---|---|
| `.github/actions/elmdb`, `.github/actions/apack-terminal` | the clone and the `cargo`/`napi` build in both, at 22 call sites across 9 workflows. Each becomes a download and an unpack |
| the Windows rename in `.github/actions/elmdb` | `@napi-rs/cli`'s build lock stops being this repo's problem the moment the artifact is built where napi's own tooling runs |
| `rustCheckoutsForRun(...)` in `scripts/linux-runner.ts` | the container needs no Rust toolchain once nothing is compiled in it |
| `vendor/elmdb.rev`, `vendor/apack-terminal.rev` | **changed, not deleted**: the committed fact becomes the release they name. The linker's "does this checkout hold the pin" check becomes "does this checkout build what the pin names", which is a weaker claim and needs its wording thought about rather than ported |

**Only with a registry**, and not before:

| | |
|---|---|
| `scripts/link-elmdb.mjs`, `scripts/link-apack-terminal.mjs` | and the two `link:*` scripts |
| `vendor/` and both `file:` dependencies | four declarations across `@apackdev/host`, `@apackdev/ears` and the API, replaced by version ranges |
| `scripts/lib/vendored-checkouts.ts` | the derivation and its two consumers |
| the `vendor/` paragraph in `CLAUDE.md` | and the `.rev`/link rules the guides repeat |

**What stays either way, and why it is not cruft.** `packages/apack-host/src/broker/client.ts` is the app's
half of the protocol and would exist whatever the broker shipped. `brokerBinary()` keeps its refusal and its
`APACK_TERMINAL_BINARY` override, which is how a developer runs a locally built broker. The lifetime case
asserting that *this app's* client greets as a non-owner stays: it is the one thing the Rust suite cannot
show. `npm run janitor` keeps its subject — a developer still has a checkout to build — but loses its derived
population under a registry, so it would read a configured path instead; if it ever does go, unload `launchd`
as well as removing the script.

**The link stays, and that is load-bearing.** An earlier revision of this plan said local co-development
would move to an uncommitted `overrides` or `file:` override. There is no such thing: `overrides` is a field
in the committed root `package.json`, so "uncommitted" means editing a tracked file and remembering never to
commit it, and `npm link` — the other candidate — is removed by the `npm ci` this repo runs constantly. The
symlink plus `file:` *is* the co-development mechanism, and it is the one part of vendoring that works. A
protocol change touches Rust and TypeScript together, and nothing may stand between the halves. Under a
registry that mechanism has to be replaced **before** the `file:` dependency goes, and npm has no primitive
to replace it with.

**So the loop becomes a prerelease, and that is this route's real cost — not the publish.** Iterate inside
the sibling checkout against its own suite, and publish a prerelease only when the *protocol seam* moves,
then move the range here. The seam moved twice across the whole of the work that produced this plan
(`data`→`text`, and `Hello { protocol, history }`), so the latency lands per seam change rather than per
edit. It is also the cheapest assumption to falsify, which is why it is step 1 below: prove it with
`vendor/` still in place, because if the loop is intolerable in practice that is an argument against the
route itself.

One escape hatch, recorded **so that nobody reinvents it as the loop**: `npm i --no-save
./vendor/apack-terminal/node`, then `git checkout package-lock.json`. It serves a single check and is not
reproducible — `--no-save` is documented as not saving but is unreliable about the lockfile, and npm's own
docs point at `npm ci` when both files must stay in sync.

## Order

1. **Prove the prerelease loop**, with both checkouts still vendored: publish one prerelease of
   `apack-terminal` from its own CI, consume it here behind a version range on a scratch branch, and make
   one protocol change end to end through it. Nothing is deleted until this holds.
2. **elmdb's artifacts first.** It already declares its matrix, its CI already runs the three platforms, and
   napi's `artifacts`/`prepublish` steps produce exactly the per-triple output either channel needs.
3. **This repo's elmdb action downloads instead of compiling**, and the shared fact becomes the release it
   names. The broker keeps compiling, deliberately: one checkout built from source still exercises the
   container's toolchain derivation and the janitor, so nothing rots unnoticed between the two halves.
4. **The broker's per-platform packages, then the same switch.** Under the artifact step a release asset is
   just a file and `brokerBinary()` already knows how to want one, so the package split is work the registry
   needs and the artifact step does not.
5. **The registry**, once the loop has held and both matrices build on release. Each sibling repository
   releases itself: changesets covers the five `@apackdev` packages and must not be extended to these two,
   which would tie their versions to the app's.

## What proves it

- **No `cargo` and no `rustup` in any workflow run**, and `npm ci` then `npm run chain` green on a runner
  with no Rust toolchain at all.
- **A CI job's time before and after**, read from runs rather than estimated — the claim this is sold on and
  the one figure it does not yet have.
- A **packaged app per platform** whose terminal starts and whose database opens. A missing artifact fails by
  being silently absent rather than by erroring, in both channels, so this is the check that cannot be
  skipped.
- The **first protocol change after the switch** made end to end through the prerelease loop, with the
  release taken afterwards rather than in the middle. If that is awkward, the plan's load-bearing assumption
  is wrong and this is where it shows.

## What it costs

The artifact route costs a release step in two repositories and a published artifact that can be stale
against a checkout — which is a real failure mode and a legible one, since the version is committed here.

The registry route costs more than a publish, and these are accepted rather than open. It brings version
negotiation where there is none, it replaces the local link with the prerelease loop above, and it ends the
repo's rule that a signature changes outright and every caller migrates in the same change — a published
elmdb with an outside consumer is precisely the condition under which that rule stops applying. The repo
guide names that condition already (*"Revisit this when a third-party pack can actually be installed from a
registry"*), and this is the half of it that arrives first. A deliberate consequence of wanting an outside
consumer, not a side effect to absorb quietly.
