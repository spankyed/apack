# What the app's third-party notices and SBOM don't cover

Status: deferred, 2026-11-20. Each item below was left open by the reviews of 2026-11-19 of the notices `afterPack`
writes (`scripts/lib/third-party-notices.ts`, `scripts/lib/electron-notices.ts`); the rest of what those reviews found
is fixed. Nothing here is designed or built. Each item says what it is, why it wasn't done, what it would take and
what should start it.

## Deferred

### The Rust code compiled into npm packages' prebuilt binaries

**What.** Four binaries the app carries are built from Rust crates and the Rust standard library, and the app carries
no notice for either: `@napi-rs/keyring`'s platform binary, Rollup's (`@rollup/rollup-<platform>`), on Linux
`@napi-rs/lzma`'s, and the `rg` that `@vscode/ripgrep`'s install downloads. Each package's own license, and for `rg`
ripgrep's and PCRE2's (`EXTRAS`), is there; the crates each links in are not, and most are MIT or Apache-2.0, which ask
a binary to carry their notice. elmdb's binding and the terminal broker, which this repository's owner builds, ship
theirs (`THIRD-PARTY-NOTICES` and `COPYRIGHT-rust-library.html`, from cargo-about and the toolchain).

**Why not here.** None of the four upstreams publishes such a file, so each has to be generated from the upstream's
source, and the result is a text someone has to read before it is committed. That is a piece of work per binary and
per platform, not an edit.

**What it would take.** For each binary, at the version the lockfile installs (for `rg`, the ripgrep tag that
ripgrep-prebuilt's release builds):

1. Check out the upstream at that tag and take its `Cargo.lock`.
2. Run `cargo about generate` over it once per target the app ships (`aarch64-apple-darwin`, `x86_64-pc-windows-msvc`,
   `x86_64-unknown-linux-gnu`), since a crate can be compiled into one platform's binary alone, with an accepted list
   like the one elmdb's `crates/elmdb-node/about.toml` holds.
3. Find the Rust toolchain the binary was built with (the upstream's `rust-toolchain` file or its release workflow),
   and take that toolchain's `COPYRIGHT.html` for the standard library.
4. Commit the texts under `build/licenses/`, and name them in `EXTRAS` for the platform package each belongs to.
5. Give those `EXTRAS` entries a staleness check. `readFor` today reads the release a package's own code declares it
   downloads; a platform package's binary is the package, so its check is the package's version against the version
   the texts were generated for.

**Trigger.** Before the first production release offered to people outside the team; or when item "A lawyer's read"
below says these notices are owed; or when an upstream starts shipping its own, which is then carried instead.

### A pack's CSS says nothing of where it came from

**What.** The notices learn what a built-in pack inlined from its bundles' source maps and esbuild's module comments
(`packBundledPackages`). The pack's stylesheet (`dist/runtime/fe.css`) has neither: Vite writes no source map for the
CSS of a build. A package a pack imports only CSS from is therefore credited by nothing. Tailwind, which writes the
utilities, is credited by name whenever a pack has CSS. On 2026-11-20 the built-in pack imported stylesheets from two
packages, vidstack and `@vue-flow/core`, and JavaScript from both, so both were credited.

**Why not here.** There is nothing in the built pack to read. Finding the packages means recording them where the
CSS is bundled, in the pack builder (`packages/apack-cli/src/build/fe-bundler.ts`), which changes what a pack's
`dist` holds.

**What it would take.** Have the pack's frontend build record the packages of every module Rollup bundled, CSS
modules included, the way the app's own bundlers do (`rollupBundledPackages`, `recordBundledPackages`), into a file in
the pack's `dist`; then have `packBundledPackages` read that record and keep the source maps as the fallback for a
pack built without one. The record has to be part of what the pack's `integrity.json` covers.

**Trigger.** The first pack that imports a third-party stylesheet; or the pack builder dropping source maps from the
packs the app ships, which would leave the notices nothing to read for the JavaScript either.

### What the SBOM leaves out

**What.** The SBOM (`appSbom`) names Electron by its GitHub release with Chromium and FFmpeg inside it, the terminal
broker with the hashes its pin records, and the `rg` binary with the hash of the file carried. It does not name Node,
which Electron builds in; PCRE2, which `rg` builds in; or the crates of the item above. Electron's own component has
no hash.

**Why not here.** Node's version is not in anything `scripts/lib/electron-notices.ts` records, and Electron's hash
is of the release archive electron-builder downloads, which the build doesn't keep a record of.

**What it would take.** Add Node's version to `READ_FOR_ELECTRON`, read from Electron's `DEPS` as the others are, and
a component for it. For the hash, read the packaged platform's line of the `SHASUMS256.txt` Electron publishes with
each release, committed beside `READ_FOR_ELECTRON` and checked against the Electron packaged. PCRE2 goes in with the
crates of the item above, since the same `Cargo.lock` names it.

**Trigger.** A consumer of the SBOM asking for any of them, or a vulnerability scanner run over the SBOM, which is
what would use them.

### A wider scan for adapted code

**What.** A shipped source file that says it was "adapted from", "ported from" or "copied from" elsewhere has to be
credited in `ADAPTED` (`uncreditedAdaptations`). Other wordings pass unseen: "inspired by", "based on", "derived
from", "taken from".

**Why not here.** Read over the tree on 2026-11-20, those wordings are nearly all about first-party code ("derived
from the list above"). Adding them to the scan would ask for an excuse per file and teach nothing. The one file that
says "inspired by" a third party is judged below.

**What it would take.** A pattern narrow enough to be worth an excuse list: the wording followed by a URL or a
product's name, for instance.

**Trigger.** A second file found by hand that took third-party code under a wording the scan doesn't know.

## Can't be fixed in code

### A lawyer's read

**What.** Three lists are engineers' readings of licenses, not legal advice: `ACCEPTED`
(`scripts/lib/third-party-notices.ts`), with its rule that LGPL code may be shipped as its own files and never inlined;
and the accepted lists and per-crate clarifications in elmdb's and apack-terminal's `about.toml`. The same goes for the
judgment that a notice is owed for statically linked MIT and Apache-2.0 crates, and for the one under "Not credited"
below.

**What it would take.** Someone qualified reading the three lists, the notices a build writes and its SBOM, and
saying what is missing or unnecessary.

**Trigger.** Before the first production release offered to people outside the team.

## Not credited, with why

### `fuzzy-search.ts` and VS Code

`packages/default-setup/src/features/code/fe/utils/fuzzy-search.ts` says it is "inspired by VS Code's fuzzy scoring
algorithm" and calls its constants "VS Code heuristics". Read on 2026-11-20 against VS Code's
`src/vs/base/common/filters.ts` (`fuzzyScore`, `_doScore`) and `fuzzyScorer.ts` (`doScoreFuzzy`, `computeCharScore`)
on its `main` branch, MIT, Microsoft, it is not a port:

- VS Code's `fuzzyScore` fills a table of scores over every pattern and word position, with a second table of
  arrows, and walks it back to find the best alignment. `fuzzyScorer.ts` fills a matrix too. This file makes one pass
  and takes the first place each character matches. No function, loop or data structure is shared.
- What it shares is the idea, which its header states (reward word starts, camel-case boundaries and runs; penalize
  gaps), and five numbers: 7 and 5 for a prefix in the same or another case, 5 at a separator, 3 and 5 for a gap, 2
  for a full match, which are `_doScore`'s. It uses them otherwise: the prefix score is multiplied by the pattern's
  length, the gap penalty by the gap's length, and its bonuses add up where VS Code's are alternatives.
- The filename bonuses, the highlighting ranges and `fuzzySearch` itself have no counterpart there.

An idea and a handful of tuning constants are not the code MIT asks a copy to carry a notice for, so `ADAPTED` does
not name the file. This is one of the judgments "A lawyer's read" covers. **Trigger to revisit:** the file taking
code from VS Code, at which point it says "adapted from" and the scan asks for the credit.
