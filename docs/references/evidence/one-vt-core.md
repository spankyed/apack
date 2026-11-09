# One VT core — evidence

Checkpoints for [goal-one-vt-core](../../goals/goal-one-vt-core.md). Dated, with the source each fact came
from. Failed checks stay visible.

## 2026-11-09 — the pin, and what upstream actually publishes

Worked in a worktree of `apack-terminal` at `vt-core/conformance`, branched from `93b7de9`, which is what
`vendor/apack-terminal.rev` pins. The main checkout stays detached at the pin so the monorepo's `vendor/`
link keeps resolving to it.

### The release is unambiguous: there is one

`libghostty-vt` has exactly one release. `repos/ghostty-org/ghostty/tags` holds `vt-1.0.0` beside the app's
`v1.4.0` and below, and nothing else on the `vt-` line.

| | |
|---|---|
| version | `1.0.0` |
| tag | `vt-1.0.0` (annotated, object `6b38d55f04e66ebecc472d8be19946edcc6d2e9d`) |
| commit | `0fa3d577a5614150ff8e2c152de5fb9d5c6d2dec` |
| declared | `headers 1.0.0, library 1.0.0` (`PACKAGING-LIBGHOSTTY.md`) |

**The community prebuilt crate is built from this exact commit.** `nklmilojevic/ghostty-vt-rs`'s generated
`prebuilt.rs` pins `PREBUILT_COMMIT = "0fa3d577a5614150ff8e2c152de5fb9d5c6d2dec"` and publishes its archives
under the release tag `ghostty-0fa3d577a561`. That is the same commit `vt-1.0.0` names, so its binaries are
the release's rather than a snapshot of `main`.

### D4 was wrong: upstream publishes no Windows or Linux binary

`SHA256SUMS` for `1.0.0`, which is signed, lists **six** files and no more:

```
libghostty-vt-1.0.0.tar.gz            source
libghostty-vt-1.0.0-deps.tar.gz       the Zig dependency set
ghostty-vt-1.0.0.xcframework.zip      Apple platforms
ghostty-vt-1.0.0.wasm                 WebAssembly, ReleaseFast
ghostty-vt-1.0.0-small.wasm           WebAssembly, ReleaseSmall
libghostty-vt-1.0.0-docs.zip          the C API reference
```

Both tarballs return `200` and every file has a `.minisig` beside it, signed with the same key as Ghostty's
own releases.

**The goal's D4 claimed an upstream Windows zip holding `ghostty-vt-static.lib`. There is no such
artifact.** Two separate things were conflated: the Windows zips at `release.files.ghostty.org` belong to the
*Ghostty application's* releases, and the per-platform file list in `PACKAGING-LIBGHOSTTY.md`
(`bin/ghostty-vt.dll`, `lib/ghostty-vt.lib`, `lib/ghostty-vt-static.lib`) describes **what a build produces**,
not what upstream ships. Read as a publication list it is simply wrong, and D4 rested on it.

So the per-target picture is:

| target | binary |
|---|---|
| `aarch64-apple-darwin` | upstream XCFramework, or the community archive |
| `wasm32` | upstream `.wasm`, two optimization flavours |
| `x86_64`/`aarch64-unknown-linux-gnu` | community archive only — upstream tells Linux packagers to build from source |
| `x86_64-pc-windows-msvc` | **nothing published, by anyone** |

Windows is tier 1 upstream — built and tested in CI, gnu ABI, with MSVC programs linking through the import
library — so the gap is distribution, not support. `aarch64` Windows is tier 3, best effort, not in CI.

**What this costs: Zig, for one artifact.** The broker must run on Windows, so "a target with no published
binary is not a supported target" cannot stand as written. The repair is narrower than it sounds: upstream
publishes a signed **dependency tarball** that makes a source build need no internet access
(`--system`), so a Windows artifact can be produced hermetically, out of band, and published like any other
file. Zig's major and minor must match exactly — `1.0.0` wants Zig 0.17.0, and 0.16 and 0.18 do not work —
and `ZIG_GLOBAL_CACHE_DIR` must be a fresh empty directory or the build can crash.

### The prebuilt mechanism works, proven on this machine

Downloaded `ghostty-vt-0fa3d577a561-aarch64-apple-darwin.tar.gz`, checked it against the SHA-256 pinned in
the crate's `prebuilt.rs` (`9ad9a7e5…`): **OK**. It unpacks to exactly the layout the `-sys` crate's
prebuilt-directory variable expects, and nothing else:

```
lib/libghostty-vt.a      12 MB
include/ghostty/vt.h     plus 33 headers under include/ghostty/vt/
LICENSE-ghostty
```

So D4's mechanism — fetch and verify in one place, point the build at an unpacked archive, never download or
compile inside it — is available for every target that has an archive at all.

### O1 answered: yes, for every fact the broker derives

**Corrected the same day it was first written, and the cause is worth recording.** The first answer here
said no payload accessor existed for the reported directory or the progress value, and concluded "mixed".
That was wrong, and it was wrong because the sweep that produced it ended in `head -20`: the matches are
listed by filename, `terminal.h` sorts last, and the file that holds the answer was cut off. This repo
states the trap — *a check that reports nothing may have looked at nothing* — and the check in question was
my own grep. Both re-reads below are counted rather than truncated.

`terminal.h` declares **44 read keys** (`ghostty_terminal_get`) and **50 options**
(`ghostty_terminal_set`). The ones this broker needs:

| What `screen.rs` or `markers.rs` holds | The core's source |
|---|---|
| `Snapshot.cursor_row` / `cursor_column` | `DATA_CURSOR_X`, `DATA_CURSOR_Y` |
| `Snapshot.alt_screen` | `DATA_ACTIVE_SCREEN` |
| the grid and its history | `screen.h`'s row and cell reads; `DATA_TOTAL_ROWS`, `DATA_SCROLLBACK_ROWS` |
| `Facts.cwd` | `OPT_PWD_CHANGED` (callback), `DATA_PWD` |
| `Facts.command`, `Facts.exit_status` | `OPT_SEMANTIC_PROMPT` (OSC 133, carrying a finished command's status) |
| `Facts.running` | the same callback, with `DATA_CURSOR_AT_PROMPT` beside it |
| `take_replies()` | `OPT_WRITE_PTY`, with `OPT_DEVICE_ATTRIBUTES` and `OPT_ENQUIRY` |
| the scrollback ceiling | `OPT_SCROLLBACK_MAX_LINES`, `OPT_SCROLLBACK_MAX_BYTES` |
| the advertised terminal | `OPT_TERMINFO_NAME` |
| OSC 9;4 progress | `OPT_PROGRESS_REPORT` |

**What the OSC parser alone does not give you, which is what misled the first read.**
`ghostty_osc_command_data` takes a `GhosttyOscCommandData` whose entire enum is `CHANGE_WINDOW_TITLE_STR`
and three `UNKNOWN_*` members, and `osc.h` says so for the one case it matters most:

> The OSC parser only identifies this command. To receive the report's contents, use a terminal with
> `GHOSTTY_TERMINAL_OPT_PROGRAM_STATUS` instead.

So the sequences are recognised by the parser and **answered by the terminal**. Reading the parser and
concluding the payloads were unreachable was reading the wrong half of the API.

**Two further mechanisms, worth knowing even though the options above cover the broker's needs.** OSC 133
is applied to the model, not merely parsed: `screen.h` carries `GHOSTTY_CELL_SEMANTIC_{OUTPUT,INPUT,
PROMPT}` per cell and `GhosttyRowSemanticPrompt` per row, so prompt boundaries are readable as terminal
state rather than re-derived from bytes. And a raw sequence is reachable by writing up to a boundary —
`ghostty_terminal_vt_write_until` with `BOUNDARY_OSC_START`/`BOUNDARY_OSC_END`, and
`STRING_KIND_OSC` naming what was found — which is the escape hatch for a sequence the core has no typed
answer for.

**What this means for D5.** The collapse is larger than its first correction claimed: `markers.rs` loses
its scanning **and** its payload parsing. What it keeps is what was always the valuable part — the state
machine, and the contract that every field is a claim some program made rather than a measurement, except
`foreground`, which the broker measures for itself and the core has no business answering.


## 2026-11-09 — Phase 0a passes: the two parsers agree, with three decided differences

Driven in the `vt-core/conformance` worktree of `apack-terminal`, branched from `93b7de9`.
`apack-terminal/tests/conformance.rs`, ten cases, behind the non-default `ghostty` feature.
`libghostty-vt` 1.0.0 via `ghostty-vt-rs-sys` 0.3.0 from crates.io — published the day after the release,
and its manifest's `[package.metadata.ghostty]` names the same commit this record resolved from the tag
independently.

### The four exit conditions

| | |
|---|---|
| the link is proven by a running binary | `the_library_is_linked_and_answers`: construct, write text with a CSI move and an SGR reset, read the width back |
| the eight grids agree textually | `the_two_parsers_produce_the_same_grid`, and again `..._byte_by_byte`. **No difference in any row, the cursor or the active screen** |
| the new wrapper agrees with itself at every byte boundary | `ghostty_agrees_with_itself_at_every_boundary`, exhaustive over every split of every stream |
| every `Facts` and reply difference carries a decision | the three below |

**The result was too clean to take at face value**, so two cases exist to make it mean something. Two
implementations that both answered an empty grid would agree perfectly, so the corpus is asserted to draw
text — at least eight non-blank rows, and more rows than eight viewports, which is what proves history is
read rather than skipped. And the comparison is proven to fire by planting a difference in each of the
three fields it reads.

### The three configuration matches, one of them the opposite of the guess

Set in `GhosttyScreen::new`, and none is a preference: each is a default the two do not share, so leaving
any of them would have reported a configuration mismatch as a parser difference.

- **Scrollback lines.** The core keeps **no limit** by default — the option's own documentation says so —
  where this broker declares `HISTORY_LINES` as a memory ceiling per session. The `scrolling` stream would
  have differed on history depth.
- **Scrollback bytes.** The core has a byte ceiling `alacritty_terminal` has no equivalent for. Left
  unlimited so the line limit is the only rule bounding either.
- **The advertised terminal**, `xterm-256color`, since a program decides what to emit from `TERM`.

### Finding 1 — device attributes, where the core is right

`CSI c`. `alacritty_terminal` answers `CSI ?6c`, a VT102; the core answers `CSI ?62;22c`, a VT220 with
ANSI colour. The broker advertises `TERM=xterm-256color`, so a program that asks what it is talking to and
hears "VT102" may turn off features the terminal has. **Decision: adopt the core's.** Recorded in the suite
as a rewrite rather than a skipped case, so the rest of the same answer is still compared, with a case
asserting both parsers still say what the entry claims — an entry that stopped describing either side would
be dead text.

The cursor position report (`CSI 6n`) is identical.

### Finding 2 — the two read different shell-integration families, and this is the important one

Measured over seven streams, each side driven with both families:

| stream | `markers.rs` | `libghostty-vt` 1.0 |
|---|---|---|
| `OSC 133;C` then `133;D;0` | nothing | `running`, then `exit_status: Some(0)` |
| `OSC 633;C` then `633;D;0` | `running`, then `exit_status: Some(0)` | nothing |
| `OSC 133;C;cmdline=ls` | nothing | `command: "ls"`, `running` |
| `OSC 633;E;ls -la` | `command: "ls -la"` | nothing |
| `OSC 633;P;Cwd=/tmp` | `cwd: "/tmp"` | nothing |

**`markers.rs` reads OSC 633 only** — VS Code's shell integration; it strips the prefix `633;` and nothing
else. **The core reads OSC 133 only** — the FinalTerm sequence iTerm2, Ghostty's own integration and most
shell-integration scripts emit.

Two consequences, neither visible before this phase:

- **The broker misses standard OSC 133 today.** A shell with ordinary integration installed reports nothing
  to it. That is a defect in current behaviour, not something this goal introduced, and it is the strongest
  argument the goal has acquired for proceeding.
- **D5 was wrong twice and is corrected a third time.** Phase B cannot delete `markers.rs`' scanning: the
  core would drop the 633 family with it. The union is strictly better than either, so the scanning stays
  for 633 and 133 arrives from the core.

### Finding 3 — the division of labour on payloads

The core **decodes** the command line for us (`TerminalSemanticPrompt.command`: "the shell sends it
encoded, and this is the decoded text") and **does not** parse the working directory, storing whatever
bytes the shell emitted — which for OSC 7 is a `file://` URI. So `cwd_from_url` is the broker's either way
and is now shared with the `vt` path rather than written twice. OSC 7 is the one sequence both read, and
they agree once it is decoded.

### Two mistakes of mine, recorded because each cost a false result

- **A sweep that ended in `head -20`** produced the first O1 answer, which said the payloads were
  unreachable. The matches sort by filename and `terminal.h` sorts last, so the file holding the answer was
  cut off. Corrected above.
- **A callback passed by pointer rather than by value.** A callback option takes the function pointer
  itself, which the header says; passing `&callback` had the library call the address of a stack local.
  SIGBUS, not a wrong answer.
- And a third worth naming: **the first check of D4's no-network claim passed because cargo had cached the
  build script.** The property that actually holds is that with `GHOSTTY_VT_RS_SYS_PREBUILT_DIR` set, a
  fresh build of the sys crate creates no `out/prebuilt` directory — verified after deleting the crate's
  build directory, not before.

### What 0a does not cover

- **`search`.** `screen::Screen::search` runs over its own snapshot, so it is compared only as far as the
  snapshot is; the core's `search.h` is untouched. Phase B decides whether to move onto it.
- **Reflow beyond one case.** The alternate-screen enter, resize and leave agree; the eight streams never
  resize, so wrap-and-reflow on the primary screen at other sizes is unmeasured.
- **Windows.** Everything above is this Mac. The toolchain, the archive and the link are unproven there,
  and no Windows archive exists to link — which is O2.


## 2026-11-09 — Phase 0b: three of the four static risks are answered, one needed a line

Read before building anything, because each of these fails for a different reason and three of them are
settled by reading the tree.

| Risk the phase named | Answer |
|---|---|
| **Does the pack layout carry a non-code binary at all?** | **Yes, unchanged.** `listPackFiles` (`apack-host/src/packs/assets.ts`) walks the layout's sections and filters by nothing — no extension list anywhere — so `integrity.json` hashes a `.wasm` like any other file and `verifyPack` accepts it. Nothing to change |
| **Does `pack://` serve it with a type the browser accepts?** | **No, and it needed one line.** `MIME_TYPES` had no `.wasm`, so it fell to `application/octet-stream`, which `WebAssembly.instantiateStreaming` refuses outright. Added `application/wasm` with the reason, and the existing spec asserts it |
| **Does the content security policy admit WebAssembly?** | **There is no policy.** No `Content-Security-Policy` header, no `http-equiv` meta, nothing in the renderer or in main. So the phase's stop rule — *if the CSP needs widening, stop and report* — has no subject, and the biggest risk 0b carried does not exist. Worth knowing on its own terms: an Electron app that loads pack-authored frontend code ships no CSP |
| **Does the installer place it?** | Follows from the first: placement copies what the receipt lists |

`npm run spec` on the protocol's suite: 13 cases green.

### The asset route works, and an imported module is the wrong mechanism

Measured on `tests/packs/external-pack` rather than the shipping pack — the same `apack pack build`, no
risk to default-setup — with upstream's `ghostty-vt-1.0.0-small.wasm`, 844,279 bytes, verified against the
signed `SHA256SUMS`.

**An `import … from './x.wasm?url'` does not produce an asset.** The pack's frontend phase is a Vite
*library* build, which has no asset base, so Vite inlines it as a base64 data URL:

| | bundle |
|---|---|
| the module imported | **1,135,834 bytes**, of which a 1,125,737-character `data:application/wasm;base64,…` string — 99.1% of the bundle |
| `assetsInlineLimit: 0` | **byte-identical.** Library mode ignores it, which is Vite's documented behaviour, so this is not a one-option fix |
| the module as a public asset | **10,039 bytes** |

So an inlined module is never a `pack://` request at all, every window parses it as JavaScript source, and
the `application/wasm` entry above would never apply to it.

**The route that works needs no build change**, because the mechanism is already there:
`fe-bundler.ts`'s `captured-public-files` plugin copies `<pack>/public/` into the frontend's output
directory. `public/ghostty-vt.wasm` therefore lands at `dist/runtime/ghostty-vt.wasm` at its original
844,279 bytes, and `integrity.json` records it as `dad8e14ce8da57db3864…` — **which is upstream's own
published checksum for that file**, so the receipt independently confirms it travelled unmodified through
compilation and sealing.

That closes the pipeline to the protocol boundary: public asset → `dist/runtime/` → the receipt →
the installer places what the receipt lists → `pack://<id>/builds/<revision>/runtime/ghostty-vt.wasm`,
served as `application/wasm`. `packages/main/tests/pack-protocol.spec.ts` now carries a case for the last
hop with bytes a text path would mangle, since every existing case there reads a string.

The fixture was restored: no 828 KB binary is committed, and the probe import is gone.

### The module instantiates in the app, from the revision the app installed

`tests/packs/external-pack/tests/e2e/wasm-asset.spec.ts`, run through `apack pack test` against this
checkout's built app. **Passed**, 4.7s.

What the run did, in order, with nothing stubbed: the real installer placed the fixture pack into an
isolated data dir (`[pack-installer] Installed "E2E Fixture" v0.1.0`), Electron launched and reached
`connected`, and the renderer then

- read the accepted build revision **out of the document** — the pack's stylesheet is loaded from
  `pack://e2e-fixture/builds/<revision>/runtime/fe.css`, so the base is the one the app is actually
  serving rather than one constructed from a build read off disk;
- fetched `…/runtime/answer.wasm` through the `pack://` handler and got `application/wasm`;
- instantiated it with **`WebAssembly.instantiateStreaming`**, the path the MIME type exists for, and the
  exported function returned 42;
- instantiated it again from an `ArrayBuffer`, which is the fallback if streaming is ever refused, and got
  42.

No network is involved anywhere in that: the bytes come from the installed pack directory through a custom
protocol.

The module is 39 bytes, hand-assembled — `(func (export "answer") (result i32) i32.const 42)`. Its
capabilities are not the subject; the route is, and a real 828 KB core would prove nothing more about the
route while putting a binary in the repository. The asset and the spec are **kept rather than discarded**:
the `application/wasm` entry is a product change, and without this it is a line nothing exercises end to
end.

**What this does not prove, stated rather than implied: `app.isPackaged`.** The run is a built app launched
from this checkout, not a packaged bundle. The reason I take it as answering the phase is that nothing the
route touches differs between the two — a pack is installed into the **data dir** either way, so ASAR never
holds it; the protocol handler is the same module with the same MIME table; and there is no content
security policy in either build. A packaged run would exercise the same four hops. It remains unexercised,
and that is the honest residual.

### The capability matrix is Phase R's, not 0b's

0b's eleven rows ask what the *emulator* can do — construction options, write completion, input, events,
viewport, the four addon equivalents, rendering lifecycle, accessibility, progress, inline images,
ligatures. Every one of them needs the real core loaded and driven in a window, which is Phase R's
deliverable rather than a spike's. What 0b owed and has now paid is the question those rows all depend on:
whether a module a pack ships can be fetched and instantiated from an installed revision at all.


## 2026-11-09 — Phase B: `Screen` is on the core, and one case is red on purpose

`vt-core/conformance`. `screen.rs` is `libghostty-vt` behind an unchanged public API —
`new`/`feed`/`facts`/`take_replies`/`resize`/`snapshot`/`search`, the seven `session.rs` and `main.rs`
call — and `alacritty_terminal` is out of `Cargo.toml` and `Cargo.lock`.

**The guarantee that nothing observable moved is the corpus, not a claim.** `tests/parser.rs`'s eight
`insta` snapshots were recorded from the old parser and are **unchanged**; they pass against the core, as
do the exhaustive single-byte-boundary property and the proptest over arbitrary chunking. The whole broker
suite passes but for one case: 47 broker cases driving real shells, the markers, coalescing, channel,
frames, signals, security and candidates suites, ~110 cases in all.

`search` stays ours: it is a string search over the text `snapshot` already produced, so the core's
`search.h` buys nothing and adding it would be a second implementation of a function that is not parsing.
The `candidates.rs` probe for the VT core was rewritten rather than deleted — that suite's purpose is that
each chosen crate still does the one thing it was picked for.

### The blocker: the core does not honour its own scrollback line bound

`a_session_keeps_its_declared_scrollback_and_not_more` is **red, and left red.** The broker declares
`HISTORY_LINES = 1_000`, and that number is not decoration: the ownership goal made it *the* scrollback
figure, answered to the window in the broker's handshake, exactly so a window never draws lines a reattach
cannot reproduce.

Measured with the limits read back off each terminal, so there is no doubt they were set:

| lines fed | configured | scrollback rows held |
|---|---|---|
| 1,054 | `lines = 1000`, `bytes = ∞` | **1,051** — 5% over |
| 6,004 | `lines = 1000`, `bytes = ∞` | **1,433** — 43% over |
| 51,004 | `lines = 1000`, `bytes = ∞` | **753** — 25% **under** |

Non-monotonic, and wrong in both directions. The under-hold is the one that matters: a session that has
written 51,000 lines answers a reattach with 753 while the window has been told it may scroll back 1,000.

**Two of my own errors were found on the way to this and are fixed**, and neither is the finding above:

- The core's default scrollback ceiling is **10,000 bytes** — tiny — and I had not set the byte option at
  all at first, so a session held 757 lines of short output and fewer as lines got longer.
- `SCROLLBACK_MAX_BYTES = NULL` does **not** remove that ceiling. I generalised it from the *line* option,
  whose documentation says a null removes its limit. Reading the limits back after setting them is what
  showed it; `usize::MAX` does work, and the option then reads as unlimited.

Fixing both changed the numbers not at all, which is what makes the remaining behaviour the core's rather
than the configuration's.

**Not resolved here, deliberately.** The assertion was not loosened to get a pass: a ceiling that reports
1,000 and delivers between 753 and 1,433 is not a tighter test's problem. What it needs is the core's own
source or its maintainers — whether `SCROLLBACK_MAX_LINES` is advisory, page-granular, or interacts with
an allocator budget that an unlimited byte ceiling does not disable. Capping the figure in `snapshot`
would fix the over-hold and leave the under-hold, which is the half that breaks the promise.


### The scrollback bound explained, from the core's own source

Fetched `libghostty-vt-1.0.0.tar.gz` and checked it against the signed `SHA256SUMS`. The behaviour is
documented and deliberate, so this is a contract mismatch rather than a defect to report upstream.

`PageList.init`'s own doc:

> `max_lines` is the maximum number of physical rows retained as scrollback, excluding the active area.
> **It is a page-granular heuristic**: at least one standard page worth of rows is permitted and only
> complete historical pages are removed.

And `Limits.enforce`, which is what `setScrollbackMaxLines` reaches:

```zig
// The page containing the active top may also contain history. Keep
// that boundary page whole even if its history exceeds the heuristic.
if (first == pagelist.getTopLeft(.active).node) break;
```

So eviction removes whole historical pages and **never the page holding the active area's top**. A page
holds on the order of a thousand rows at 20 columns, so for this broker's figure the limit can barely
bind: measured across five volumes, the rows held ranged **749 to 1,997 and were identical for
`max_lines` of 1,000, 2,000 and 3,000** — the ask is not what decides it. `max_lines` is a heuristic by
name and by implementation.

**What this means is not that the core is wrong; it is that `HISTORY_LINES` cannot be expressed as
`max_lines`.** The broker advertises that number to the window in its handshake so a window never draws
lines a reattach cannot reproduce, which needs a *floor*. The core offers a page-granular ceiling and no
floor above one page.

Worth noting against the broker's own words: `HISTORY_LINES`' doc says it "is a ceiling on memory per
session: 1,000 lines of 80 columns is about 80k cells, and a cell is wider than a byte." The intent was
always memory, and `max_size` is the dimension the core enforces tightly — its doc says it is "always
rounded down to the nearest terminal page size, otherwise we would always slightly exceed max_size". So
the broker's intent and the core's tight dimension are the same one, and it is not the one the figure is
written in.


### What is not done

The both-parsers diff harness, which is the rest of Phase 0a. The link is not yet proven: nothing has been
compiled against `libghostty-vt.a` from this repository, so every statement above is from headers, signed
checksums and the published file list rather than from a running binary.
