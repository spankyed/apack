# One VT core — evidence

Checkpoints for [goal-one-vt-core](../../archive/goals/goal-one-vt-core.md). Dated, with the source each fact came
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

### Phase B's gate is green, Windows excepted

`cargo xtask pre-push`, 2026-11-09, on `vt-core/conformance`:

```
locked dependencies  passed      tests          passed in 8s
format               passed      doc tests      passed
clippy               passed      npm package    passed
generated protocol   passed      mutants        61 tested: 58 caught, 3 unviable
mutant exclusions    passed      everything passed in 617s
```

**Zero survivors.** `generated protocol` passing is the other half of D6: the protocol's TypeScript is
derived from the broker's Rust types, and it is byte-identical, so swapping the VT core changed no part of
the contract the app compiles against.

So Phase B's exit conditions are met but one: **Windows, which is O2.** Nothing above was run there, no
prebuilt archive exists for it from anyone, and the library has to be built from the signed source and
dependency tarballs before the Job Object ownership, the named-pipe ACL and the ConPTY startup can be
re-proven on the VM.

**`vendor/apack-terminal.rev` is deliberately unmoved.** Bumping it is what makes the monorepo and CI test
this core, and CI's Windows mutation job is the one place `tree.rs` is answered. Pointing it at a core
unproven on Windows would be claiming a platform this evidence does not cover.


### What the mutation gate found, which is the most useful thing in this phase

`cargo xtask pre-push` scopes its mutants to the change, and the change was a new FFI layer. Three runs:

| | mutants | missed |
|---|---|---|
| first | 74 | **25**, every one in `src/vt/` |
| after deleting two dead diagnostics and adding nine cases | 61 | **1** |
| after the refusal case | 61 | **0** |

**Twelve died by deletion rather than by a case.** `total_rows` and `configured_limits` were written to
probe the scrollback bound; the probes are gone and nothing in the broker reads either. A method whose only
caller was a deleted test is gone, not excluded.

**One case exposed a hole this phase's own fix created.** Capping `snapshot` at `HISTORY_LINES` means the
broker's scrollback cases pass whether or not the limit was ever set — the cap hides the setter. The limit
is now observed through `scrollback_rows`, where it cannot be.

**The last survivor taught the sharpest lesson: a case is only as good as the guard it observes.**
Replacing `Failed::check` with `Ok(())` was invisible because the refusal case ran through
`Terminal::new`, which guards twice — on the call's result *and* on a null handle — so dropping the first
left the second reporting the same error. The kill is an over-long terminfo name, which the core refuses at
128 bytes and which reaches only the result check. It earns its place anyway: a broker that accepted one
silently would leave a program's XTGETTCAP query unanswered with nothing said about why.

**One exclusion, with its reason.** A mutant of `Drop` leaks the handle, and a leak is not an answer any
case here can read without a leak checker this repository does not have. What makes the omission small is
that the handle has one owner by construction: `Terminal` has no `Clone` and the pointer never leaves the
type. My first pattern matched no mutant and `check-exclusions` said so — `in <fn>` prints only for a
mutant *inside* a function, which that file already records for `security.rs`.

### One load-sensitive case, reported rather than hidden

`an_alternate_screen_app_survives_a_resize_and_keeps_answering` failed once, in a `pre-push` run started
immediately after a fourteen-minute mutation run. It then passed three times in isolation and twice more in
full parallel runs — 128 of 128 both times. The case drives a real `less` and waits on a 10-second quiet
deadline, so it is load sensitivity rather than a regression: nothing in this phase changed it.

It is named here because this repository holds that a test passing only on a quiet machine is a defect, and
that is not mine to quietly re-run until green. It is a candidate for a progress bound rather than a quiet
deadline, and it is not Phase B's work.


### The scrollback bound: resolved, and my first conclusion was wrong

**Recorded as a correction because the wrong version was committed first.** I measured the core holding
749 to 1,997 rows for asks of 1,000, 2,000 and 3,000 — identical ranges — and concluded from that the ask
was inert and the broker's contract unkeepable. That probe took its minimum and maximum across terminal
widths it had conflated, and the identical figures should have been the tell: a reading that does not move
when its input does is usually the reading that is broken.

Measured again, one width at a time, at 80x24:

| ask | after 2,000 lines | after 6,000 | after 20,000 |
|---|---|---|---|
| 1,000 | 793 | 649 | **441** |
| 2,000 | 1,977 | 1,833 | **1,625** |
| 4,000 | 1,977 | 3,609 | 3,993 |

The ask decides it, and the floor is the ask less about one page. So the contract is kept by asking for
twice it (`SCROLLBACK_ASKED`) and capping the read at it — both halves, because the window is told that
figure in the handshake and must be answered with neither less nor more. `page.std_capacity` is 215 rows
at 215 columns and grows as columns shrink, so one `HISTORY_LINES` of margin clears a page at every width
a terminal is plausibly opened at; `tests/screen.rs` asserts it rather than trusting the arithmetic, with
a case at twenty thousand lines because the floor is what broke and a short case cannot see it.

### Why it looked unkeepable, from the core's own source

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

**O2, which is Windows**, and Phases R and A. Everything above was measured on this Mac; the Windows half
has its own section below.

## 2026-11-09 — O3 answered: the renderer takes `ghostty-web`, and D2 is retired

O3 asked whether Phase R takes upstream's raw WebAssembly module (D2 as written) or `ghostty-web`. The
reasoning was recorded with the question; what was missing was the package itself, so it was read rather
than argued about.

| | measured |
|---|---|
| version | `0.4.0` is `latest`, published **2025-12-09**; development is on `next`, `0.4.0-next.21.g640db46`, published **2026-10-28** |
| licence, dependencies | MIT, **zero** runtime dependencies, `coder/ghostty-web` |
| size | 2.17 MB unpacked, of which `ghostty-vt.wasm` is 414 KB |
| provenance | built from Ghostty's source with one patch (`patches/ghostty-wasm-api.patch`) that exposes additional C entry points |

**Its API is xterm.js's, deliberately.** `dist/index.d.ts` is 2,032 lines, and the names are xterm's own:
`ITerminalAddon`, `ITerminalOptions`, `ITheme`, `IDisposable`, `IEvent`, `IBuffer`, `IBufferCell`,
`ILinkProvider`. `Terminal` carries `open`, `write(data, callback)`, `writeln`, `paste`, `input`, `resize`,
`clear`, `reset`, `focus`, `blur`, `loadAddon`, `dispose`, the selection methods, the five `scroll*`
methods, `attachCustomKeyEventHandler`, `attachCustomWheelEventHandler`, `registerLinkProvider`, and
`onData`, `onResize`, `onTitleChange`, `onScroll`, `onRender`, `onCursorMove`, `onBell`, `onKey`,
`onSelectionChange`. So the plan's estimate for Phase R — one file and some CSS — survives contact with the
package, which is the thing O3 needed to establish.

**Three of the four addons are in the package** and the fourth is the app's already: `FitAddon implements
ITerminalAddon`; links are `LinkDetector` with `UrlRegexProvider` and `OSC8LinkProvider`, which is more than
`@xterm/addon-web-links` does, since OSC 8 hyperlinks are a sequence rather than a regex over text;
unicode11 has no equivalent because it needs none, grapheme clustering being what the core does. Clipboard
stays on the app's `openLink`/clipboard paths, where the goal wants it.

**It also answers things xterm.js cannot**, which matters for a window whose screen is a replica of the
broker's: `getMode(mode, isAnsi)`, `hasBracketedPaste()`, `hasFocusEvents()`, `hasMouseTracking()`,
`getScrollbackLine(offset)` and `getScrollbackLength()`. Today those are inferred in the app or simply not
known.

### The wasm is inlined, so Phase R needs none of 0b's asset route

`dist/ghostty-web.js` holds `new URL("data:application/wasm;base64,AGFzbQEAAAAB…")`: the 414 KB module is
base64 in the JavaScript, which is the same Vite library-build behaviour 0b measured from the other side.
**So the default route needs no file, no MIME type, no receipt entry and no `pack://` request** — which is
most of what 0b was worried about, and it is worth saying plainly that 0b's asset work is not wasted but is
also not on Phase R's path. It bought the `application/wasm` MIME entry and the binary-route proof, which a
pack shipping its own module still needs.

The package also exports `./ghostty-vt.wasm` as a file, and `init()`'s own doc describes constructing a
`Ghostty` and handing it to `Terminal`, so loading the external module instead is available if the base64
inflation of the renderer bundle turns out to matter. That is a Phase A measurement, not a Phase R
decision.

### What it costs, stated rather than discovered later

- **Two Ghostty-derived builds in the tree** until `ghostty-web` consumes the official distribution, which
  its README commits to. They share lineage, not bytes.
- **`latest` is eleven months old.** Development is on `next`, twelve days old at the time of writing. A
  prerelease in the app's dependency list is a real cost, and the condition for leaving it is a stable
  release or the official-distribution switch, whichever comes first.
- **The renderer stops being an independent implementation**, which is the point: it replaces a
  hand-written TypeScript emulator with one compiled from the same source as the broker's. That is what
  "one core" was protecting — not identical bytes, but one answer to what a sequence means.

Against those: the alternative is writing a terminal widget — painter, input encoding, selection, IME,
accessibility, scrollbar — none of which is terminal emulation. That is the largest single piece of work in
the goal and the least related to its purpose.


## 2026-11-09 — O2 answered: Windows builds, links and passes, with two findings about the crate

Measured on the [Windows VM](../guides/windows-development-vm.md), `apack-win-dev`:
Windows Server 2025, `x86_64-pc-windows-msvc`, rustc **1.99.1** (the pin, installed from
`rust-toolchain.toml`), Visual Studio Build Tools 2026 at `C:\BuildTools`, the branch
`vt-core/conformance` at `3e47475` in a worktree of its own.

### The library builds from the signed tarballs, offline, with Zig 0.17.0

Nothing is published for Windows by anyone, so it is built. Inputs, both verified against the signed
`SHA256SUMS` before use:

```
libghostty-vt-1.0.0.tar.gz        4a6ef758be721923e1969e7b81b443dcc92d8dd3fb5a39600c03a8817a753676
libghostty-vt-1.0.0-deps.tar.gz   4d5ea5e448e4c7ea8fb55ccbaa8668f2a97d44f438cee831e2b7ecd162d85c29
```

from `https://release.files.ghostty.org/libghostty-vt/1.0.0/`, which is where these releases are
published — **not** the GitHub release of the tag, where none of the six files exists. The build:

```
zig build -Demit-lib-vt=true -Doptimize=ReleaseFast -Dapp-runtime=none -Demit-xcframework=false \
          -Dtarget=x86_64-windows-msvc -Dcpu=baseline \
          --system <deps> --prefix <prefix>
```

with `ZIG_GLOBAL_CACHE_DIR` a fresh empty directory. `--system` is what makes it hermetic: Zig resolves
every package from the dependency tarball instead of fetching. It installs the full `include/ghostty/vt/`
header set, cmake and pkg-config files, and two libraries:

| file | bytes |
|---|---|
| `lib/ghostty-vt-static.lib` | 13,079,862 |
| `lib/ghostty-vt.lib` (the DLL import library) | 57,268 |

### It links, and the whole suite passes

`cargo test --locked`, every suite, on the library built above:

| suite | tests | suite | tests |
|---|---|---|---|
| lib | 10 | `markers.rs` | 16 |
| `broker.rs` | 29 | `parser.rs` | 4 |
| `coalescing.rs` | 9 | `screen.rs` | 6 |
| `conformance.rs` | 5 | `security.rs` | 2 |
| `frames.rs` | 11 | `vt.rs` | 5 |

**97 tests, 0 failed.** `candidates.rs`, `channel.rs` and `signals.rs` compile to no cases there, being
POSIX-only. The three things a core swap most easily disturbs were each re-proven by name rather than
inferred from a green total:

- **Job Object tree ownership** — `killing_a_session_takes_the_whole_tree_with_it`.
- **The named-pipe ACL** — `the_pipe_is_the_starting_user_s_and_nobody_broader` and
  `exactly_two_accounts_are_granted_anything`.
- **ConPTY startup, which is the one that fails invisibly on POSIX** —
  `a_keystroke_reaches_a_pty_and_its_output_comes_back`,
  `a_query_the_terminal_answers_itself_is_collected_for_the_pty` and
  `a_program_asking_what_terminal_this_is_is_told_what_the_pty_says`. ConPTY's first act is `ESC [ 6 n`
  and it waits for the answer before initialising, so a core that collects no replies does not start a
  session on Windows at all. It answers.

### Finding 1 — the crate's source build is broken with Zig 0.17.0

`ghostty-vt-rs-sys` 0.3.0's `build.rs` passes `--global-cache-dir` to `zig build` whenever
`GHOSTTY_ZIG_SYSTEM_DIR` is set. Zig 0.17.0's `zig build` does not accept it — it has `--cache-dir`, and
the global cache is `ZIG_GLOBAL_CACHE_DIR` or the driver's `--global-cache`:

```
error: unrecognized argument: --global-cache-dir
```

The two are coupled in the same branch, so **the one route that supplies packages offline is the one that
cannot run**, and `1.0.0` builds with no Zig but 0.17.0. This is worth reporting upstream; it is not in our
way, because we do not build the library during `cargo build`.

### Finding 2 — D4's mechanism is POSIX-shaped, and this is the one that matters to us

D4 says the build is handed an already-unpacked, verified archive so that it "neither downloads nor
compiles". On Windows that hatch does not fit what a Windows build produces:

- `GHOSTTY_VT_RS_SYS_PREBUILT_DIR` asserts `lib/libghostty-vt.a`.
- No Windows build produces that name. Zig installs `ghostty-vt-static.lib`, which is also the name the
  crate's **own** link directive uses there (`static:+verbatim=ghostty-vt-static.lib`, because neither name
  rustc derives from `static=ghostty-vt` finds a Zig archive on Windows).

So the assertion and the link step disagree about the same file on the same target. The measurement above
was taken with a copy of `ghostty-vt-static.lib` placed under the asserted name beside it: the copy is
never a linker input — the verbatim directive names the real library — so what linked is what Zig built,
but it is a file that exists only to satisfy an assertion, and that is not a thing to build on.

**What this means for D4, stated rather than left implicit:** the decision holds — no Zig and no network in
*our* build — and the per-target table is unchanged. What does not hold is the claim that one environment
variable delivers it everywhere. Windows needs either the upstream fix, or our own `vt-prebuilt` task to lay
out a prefix the crate accepts on each platform, which is a Phase A packaging detail rather than a question
about the core.

### What is now true of Phase B

Every exit condition is met: the gate is green with zero mutants missed on POSIX, the protocol's generated
types are byte-identical, and Windows builds, links and passes. **The pin is still not moved.**
`vendor/apack-terminal.rev` names a commit CI clones from the remote, and `vt-core/conformance` has not been
pushed, so moving it now would name a commit nothing can fetch. That is the one remaining action and it is
not a measurement.


## 2026-11-09 — Phase R is bigger than "one import": three findings from reading the package

O3 chose `ghostty-web` and the plan sized Phase R as one file plus roughly 35 lines of CSS. Reading the
package against what `terminal-pool.ts` actually calls, that holds for most of it and not for one part.
**The deliverable has not changed; the estimate has.** These are recorded before any code is written,
because the third one changes the shape of the change rather than its size.

### What maps straight across

Every method the pool uses exists with the same name and meaning: `write` (with the completion callback
`syncViewport` uses as its wait primitive), `paste`, `getSelection`, `selectAll`, `clear`, `focus`,
`resize`, `open`, `dispose`, `cols`, `rows`, `element`, `attachCustomKeyEventHandler`, `onData`,
`onResize`, `onSelectionChange`. `FitAddon` is in the package. `onWriteParsed` has no twin, and `onRender`
is the one to use — the subscription exists to keep a pinned view at the bottom after a write, which is
what `onRender` fires for.

Three of the five addons stop being dependencies at all: `WebglAddon` because rendering is the package's
own, `Unicode11Addon` because grapheme clustering is what the core does, and `WebLinksAddon` because
`LinkDetector` with `UrlRegexProvider` and `OSC8LinkProvider` is better — OSC 8 hyperlinks are a sequence
rather than a regex over drawn text.

### Finding 1 — there is no DOM scroller, and the pool's scroll half is built on one

This is the one that matters. `ghostty-web` draws to a `<canvas>` and renders its own scrollbar; scrolling
is `viewportY`, `onScroll`, `scrollLines`/`scrollPages`/`scrollToLine`/`scrollToBottom` and a wheel
handler. **Nothing in it has a scrolling DOM element.**

The pool's scroll ownership is written against one: `findScroller` walks the emulator's DOM for an element
whose computed `overflow-y` scrolls, `getViewport` caches it, `report` derives "is the user following the
output" from `scrollTop + clientHeight >= scrollHeight - 10`, `detach` saves a `savedScrollFraction` of
`scrollTop / scrollHeight`, and `syncViewport` writes `scrollTop` directly.

`getViewport`'s own comment says the rule is "an element whose computed `overflow-y` scrolls, which is true
of whichever emulator draws here". That was the assumption, and it is the one that breaks — which is worth
saying plainly, because the comment was written to make the file emulator-agnostic and it chose the wrong
invariant.

**The replacement is smaller and exact, which is why this is not bad news.** `viewportY` is documented as
the scroll offset with `0` at the bottom of the scrollback, so "following the output" is `viewportY === 0`
rather than a measurement with a ten-pixel tolerance; a saved position is a line offset rather than a
fraction of a changing `scrollHeight`; and three of the file's standing complaints disappear with the DOM
dependency that caused them — Chromium zeroing `scrollTop` on `remove()`, `scrollToBottom` being a no-op
when `ydisp === ybase`, and having to force layout by reading `scrollHeight` before writing `scrollTop`.
`findScroller` and its specs go with it.

### Finding 2 — OSC 52 is not surfaced, and the app has it today

`@xterm/addon-clipboard` is loaded in the pool today, which is what makes a program's OSC 52 write reach
the system clipboard. `ghostty-web` exposes no OSC 52: its clipboard members are the selection copy and
the paste handler, and its only OSC provider is the OSC 8 one. Dropping the addon without a replacement is
a regression in a behaviour that works now, so it is named here rather than discovered by whoever first
runs `tmux save-buffer`.

It is also the one gap with an architecturally better home than the window. The broker owns the screen and
already routes the shell-integration OSC families, so a clipboard request is a fact for it to report rather
than something the replica should act on by itself. That is work in two repositories and it is not in
Phase R's scope as written, so it is a finding for the goal's owner and not a thing to slip in.

### Finding 3 — title changes are a scan, not a parse

`ghostty-web`'s own doc for its title handling says "Check for title changes in written data (OSC
sequences) / Simplified implementation - looks for OSC 0, 1, 2". The core parses OSC properly; this
particular path does not use it. The pool does not read `onTitleChange` today, so nothing regresses — it is
recorded because it is the kind of thing that looks like a core guarantee and is not.


## 2026-11-09 — Phase R: the window is on the core, and what it cost

`terminal-pool.ts` constructs `ghostty-web`; the six `@xterm/*` packages are gone from the pack's manifest
and the lockfile. `npm run typecheck` passes whole (twenty legs, `api:check` and `facade:check` among them),
`apack pack build` produces the pack, `check:specifiers` passes — which is the emulator rule answering in
both directions, an import outside the seam and the seam having stopped importing one — and the code
surface's sixteen frontend spec files pass, 104 cases.

### The size of it, attributed from the sourcemaps

The same instrument the ownership goal used, so the two figures are comparable:

| | KiB of source attributed into the pack's frontend |
|---|---|
| the six `@xterm/*` packages (measured 2026-11-07) | **502** |
| `ghostty-web` | **686** |

**That reads as a regression and is the opposite.** 552 KiB of the 686 is the WebAssembly module, inlined as
a base64 data URL by the package's own library build; its JavaScript is **134 KiB**. So the emulator's code
shrank by 368 KiB and the bundle grew by 184, because a 414 KiB binary is now carried as 552 KiB of string
literal.

**Which makes 0b's asset route the obvious next move, and it was already proven.** The package also exports
`./ghostty-vt.wasm` as a file, and `init`'s own documentation describes constructing a `Ghostty` and handing
it to `Terminal`, so the module can be fetched over `pack://` instead — the route 0b followed end to end,
down to the `application/wasm` MIME entry it added for exactly this. That would leave 134 KiB in the
JavaScript the window parses and 414 KiB fetched as a file. It is a Phase A measurement rather than a Phase
R decision, and it is the one optimisation here with a number already attached to it.

### What the asynchronous constructor cost, which was the real work

The module is loaded on demand, so construction cannot be synchronous. It is deliberately **not** awaited at
module scope: that would block all eleven of this pack's features on the terminal's module. `ensure` awaits
it and both hosts await `ensure`, and then every assumption that rested on a synchronous constructor had to
be made true again:

| what can happen during the load | what answers it |
|---|---|
| two hosts mount together | one build per session, keyed by id; the second awaits the first |
| the host unmounts | `TerminalView` drops the attach, the panel supersedes it by generation |
| the user clicks another terminal | the panel's generation counter; the later attach wins |
| the session is closed | `dispose` records the id and the build throws away what it made |

The last is the one with teeth: registering it would leave an emulator for a finished session in the pool,
holding its WebAssembly state and subscribed to a bus nothing writes to, until the whole frontend went.
Three cases drive a **held** module load to cover them, and two mutants each fail exactly one — the discard
(`if (this.discarded.delete(info.id))`) fails "registers nothing for a session closed while it was opening",
and the dedupe (`if (building) return building`) fails "builds one emulator for two mounts that arrive
together". Neither case was possible while construction was synchronous, which is why they are cases rather
than a claim about the shape of the code.

### The scroll rewrite, and the invariant that was wrong

`getViewport` found the emulator's scrolling element by computed `overflow-y`, and its comment said the rule
was "an element whose computed `overflow-y` scrolls, which is true of whichever emulator draws here". It is
not: this one draws its own scrollbar onto its canvas, and has no scrolling element at all. The comment was
written to keep the file emulator-agnostic and picked the wrong invariant, which is worth recording because
the replacement could make the same mistake.

What replaces it is smaller and exact. `scrollToBottom()` sets `viewportY = 0` and `scrollToTop()` sets it
to `getScrollbackLength()` — read out of the shipped bundle rather than inferred, because `scrollToLine`'s
own documentation uses the opposite convention — so `viewportY` counts lines up from the bottom, following
the output is `viewportY === 0`, and a saved position is a line restored with `scrollLines`. Three standing
workarounds go with the DOM element that caused them: a `scrollTop` Chromium zeroes on `remove()`, a
`scrollHeight` read to force layout, and a `scrollToBottom` that did nothing when the buffer pointers were
equal.

`findScroller` and its five cases are deleted. In their place, five cases over `openedByTheApp`, which is
the other half of the same lesson: the library's providers build each link's `activate` themselves, and
that is the one part not theirs to decide, since the text they matched is whatever a program printed into a
terminal.

### `open(parent)` takes the element it is given, which decided the CSS

It sets `element` to the parent, appends a `<canvas>` and a `<textarea>`, and sets `tabindex`,
`contenteditable`, `role="textbox"`, `aria-label` and `aria-multiline` on it — so accessibility is the
library's, and there is no `.xterm` or `.xterm-viewport` to reach into. The ~35 lines of CSS duplicated in
both hosts matched nothing and are deleted; the inset they carried is each host's own padding, which is
where it belonged, the two hosts having always wanted different values (8px and 4px 8px).

The wrapper now carries `data-apack-terminal`. The performance scenarios found a drawn terminal by
`.xterm` and counted `[class*="xterm"]` elements; they ask for the app's own name for it now, which is the
mistake `findScroller` made, not repeated.

### What is not done, and is a regression rather than a parity gap

**OSC 52.** `@xterm/addon-clipboard` is loaded today, so a program writing OSC 52 reaches the system
clipboard; `ghostty-web` surfaces no OSC 52 at all, its only OSC provider being the OSC 8 one. This phase
does not replace it, so that behaviour is gone until something does.

Its better home is the broker rather than the window: the broker owns the screen and already routes the
shell-integration OSC families, so a clipboard request is a fact for it to report rather than something a
replica should act on by itself. That is work in two repositories and outside Phase R as written, so it is
named here and in the goal rather than slipped in.

**And nothing here has been run in the app.** Every statement above is a typecheck, a build, a spec or a
reading of the shipped bundle. `open()` requires a real 2D canvas context, which jsdom does not implement,
so the one thing no spec in this repository can answer is whether this emulator opens into the pool's
**detached** wrapper and survives being re-parented — which is the whole of what makes a tab switch cost
no replay. That is Phase A's first question, and it needs the running app.


## 2026-11-09 — Phase A: the app draws with it, and the detached wrapper survives

Driven against the **built** app (`npm run dev:drive`, a disposable profile) on this Mac, by
`drive/terminal-core-swap.ts`. That script is not committed — `drive/.gitignore` keeps everything but the
README and the Playwright config, which is the directory's own rule — so what it asked is recorded here
rather than referred to.

### The app found a defect no spec could

The first run drew no terminal at all. The code surface showed its own error, which is the first useful
fact: a failure in the emulator reaches the UI rather than leaving a blank rectangle.

```
default-setup/code: canvas couldn't be displayed.
Terminal must be opened before registering link providers
```

The pool registered its two link providers during construction. The emulator refuses **almost everything**
before `open` and names it — `write`, `clear`, `paste`, `input`, `reset`, `scrollLines` and
`registerLinkProvider` each throw — and the registration had been written next to `loadAddon`, which does
not.

**The specs passed anyway, and that is the part worth keeping.** The stand-ins accepted an ordering the
real emulator refuses, so on this point they were a check that could not fail. They refuse what it refuses
now, and the old ordering fails **30 cases** across the three files. This is the repository's own rule
about a check that may have looked at nothing, met in the one place it was not being applied: the
stand-in.

### What the second run answered

| question | answer |
|---|---|
| does it open into the pool's **detached** wrapper? | yes — `[data-apack-terminal]` holds a 2718×930 canvas, in the document |
| does it draw? | 16 of 158,440 sampled pixels differ from the background at the prompt; **3,400** after the shell printed 31 lines |
| what happens while the tab is away? | the element is absent — the host unmounted and the wrapper is detached, which is the design |
| does it survive being re-parented? | yes — back after the tab switch with the **same 3,400**, the same session id and the same pid |
| did it fit to its host? | 80×24 at creation, 151×31 after the return |
| anything in the app's log? | no error matching terminal, broker, ghostty or wasm |

That is the question Phase R could not answer and no spec in this repository can: `open()` needs a 2D
canvas context, which jsdom does not implement. **The pool's shape is right for this emulator** — open
detached, re-parent per host, no replay.

### A capability this change bought, which the previous engine made impossible

The terminal-ownership evidence recorded, more than once, that whether the screen was intact could only be
judged by eye from screenshots: the old engine drew through WebGL and left no text in the DOM. This one
draws to a **2D** canvas, so a page can read its pixels — and "there are pixels that are not the background
colour" is an assertion where there used to be a screenshot. It says nothing about *what* is on the screen,
which is still the screenshots' job, but "the terminal is blank" stops being a thing only a human can
notice.

### One thing the run did not establish

The script also asked the shell to write a marker file and checked for it from the test process; that check
did not pass, and **why is not established**. What the run does show is that input reaches the shell: the
canvas went from 16 drawn pixels to 3,400 in response to a typed command, and the screenshots show the
output. The marker is the script's own plumbing rather than a statement about the app, so it is recorded as
unresolved rather than explained away, and the fuller acceptance pass should write it somewhere outside a
profile directory that the run removes.


## 2026-11-09 — Moving the pin broke the app, and the cause was not the core

The pin moved to the merged broker, the vendored checkout was fast-forwarded to it and
`cargo xtask package` rebuilt `node/apack-terminal` — 1.6 MB to 2.7 MB, the core now linked in. The next
driven run could not open a terminal at all: `terminal.CREATE` timed out after 60 seconds, and the app's
log said

```
[terminal] the broker exited with null before it was listening
```

**Exit code 137 — SIGKILL — for every argument**, including ones the broker never parses.

### What it was not

Not the core, not the link and not the binary. The decisive measurement is that
`target/release/apack-terminal` and `node/apack-terminal` had the **same SHA-256**, no extended attributes
on either, and both passed `codesign -v` — and the first ran while the second was killed. Copying those
same bytes to a new path ran too, far enough to report a real error of its own (a socket path longer than
`sun_path` allows, which is this scratchpad's fault and not the broker's).

So the bytes were fine and the **path** was not.

### What it was

macOS caches a binary's code signature against the file it executed. `cargo xtask package` staged with
`std::fs::copy`, which writes **in place** — so a path the app had already spawned kept a cache entry
pointing at bytes that were no longer there, and AMFI killed every later `exec` of it before `main`.

Nothing about it presents as a signature problem, which is why it took the byte-identical comparison to
find: the file verifies, `codesign -v` passes, and the app reports only that the broker exited before
listening.

The fix is a rename rather than an overwrite, so the path gets a new inode and there is no stale entry to
match against. The temporary is placed beside the destination deliberately: a rename across filesystems is
not atomic and falls back to a copy, which is the thing being avoided.

### Why it is worth a section

**This was not caused by the VT core and it was not new.** Any contributor whose app had spawned the
broker before they rebuilt it would have met it, on any change at all. What the core swap did was make it
certain — the pin moving is exactly the event that rebuilds that binary — and what found it was running
the app rather than trusting that a green gate in the broker's own repository meant the app could start
one. A broker that passes 135 tests and 61 mutants still exits 137 when the app spawns it.

**A mistake of mine, recorded because it nearly hid this.** The first probe was
`./node/apack-terminal --help | head -10`, and I read the exit status of `head`. It printed 0, so the
binary looked healthy and the hunt went to the app. The binary had been dying from the first run.


## 2026-11-09 — OSC 52 is closed, which is what Phase R left open

Phase R recorded the loss of `@xterm/addon-clipboard` as a **regression** rather than a parity gap: a
program's `ESC ] 52` reached the system clipboard before and did not after, and `ghostty-web` surfaces no
OSC 52 at all. The repository's documentation rule is that archiving or recording never defers an unmet
requirement, and Phase R's own text says to *test* OSC clipboard behaviour rather than widen a permission
to reach it — so it is implemented rather than carried.

**The pool reads it out of the output it already receives.** The bytes still go to the emulator, which
ignores them, so nothing is consumed and the order of the two does not matter.

`takeClipboardWrites(pending, chunk)` is pure and carries its own tail. **The case that feeds it a byte at
a time is what earned that shape**: an implementation that only looks at whole chunks loses a sequence
whose introducer is split, because `\x1b`, then `]`, then `5` each match nothing and are dropped
individually. It holds the longest tail that could still become an introducer, and that case failed until
it did.

Nine cases, each a decision rather than a restatement:

| | |
|---|---|
| both terminators | BEL and ST, since programs use both |
| a byte at a time | the split-introducer bug above |
| several in one chunk | not only the first |
| non-ASCII | base64 of UTF-8, which a latin1 decode gets wrong |
| `ESC ] 52 ; c ; ?` | **answered with nothing, deliberately** — it asks the terminal to send the clipboard *to the program*, including one at the far end of an ssh connection |
| not base64 | not a clipboard write |
| ordinary output | nothing held, so the carry cannot grow on normal traffic |
| never terminated | given up on at a megabyte rather than held forever |
| through the pool | a terminal receiving the sequence puts the text on the clipboard |


## 2026-11-09 — Phase A: the behaviour pass, and a second defect the app found

`drive/terminal-journeys.ts` against the built app, on the new broker and the new renderer together. The
script is the one the terminal complaint produced — the journeys named there, driven and looked at — and
it passed in 44.1s. What its report answers, each machine-checked rather than judged from a screenshot:

| | |
|---|---|
| a crashed shell | keeps its terminal, and the restart draws one seam, not two |
| a restarted shell | second generation recorded, restarted in place |
| **the API process restarting under it** | the shell survived it and the terminal came back |
| switching tabs away and back | came back and still works |
| **an alternate-screen program** | `vim` ran, quit, and the shell worked after it |
| **the working directory** | followed a `cd` — `{ cwd: "/tmp", title: "tmp" }` |
| the environment | the shell inherited none of the app's own variables |
| killing a terminal | its children were gone, none left running |
| a renderer reload | the build terminal survived it |

**Two of those are the core's own work reaching the app.** The cwd following is OSC 7 parsed by
`libghostty-vt` in the broker, surfaced through the facts the broker reports — the path Phase B rebuilt —
and the alternate-screen program is the parse that Phase 0a compared the two implementations over. Neither
is a claim about the renderer; both are the broker's core answering, with the window drawing it.

### The defect it found

The run logged `RangeError: offset is out of bounds` from `Uint8Array.set`, twice per attach — once from
`syncViewport` and once from the resize observer that calls it.

`syncViewport` positioned the view inside `term.write('', callback)`. That idiom is the previous
emulator's: it parsed writes on a queue, so the callback was how you got behind a burst of live output
still being parsed. **This one parses inside `write`** — read out of the shipped bundle, `write` calls
`wasmTerm.write` synchronously and its callback is nothing but a `requestAnimationFrame` — so the frame
was all that was ever being bought, and the empty write that bought it raises on an offset past the end of
a zero-length array.

Asking for the frame directly is both what the callback did and the thing that does not crash. **No spec
caught it and none could have**: the stand-ins accept an empty write because the previous emulator did.
That is the second time in this phase that the stand-in was the thing that was wrong, after the
open-before-use ordering, and both times the running app is what said so.


## 2026-11-09 — The emulator snaps to the bottom on every write, and the window undoes it

**The third defect the app found, and the only one that is a behaviour rather than a mistake.**

`ghostty-web`'s `writeInternal` ends with `this.viewportY !== 0 && this.scrollToBottom()`: once the user
has scrolled back, *every* write drags the view to the end. A session reading its own history is pulled
away from it by output it is not looking at — and "a long stream, with the user scrolling back while it
arrives: the terminal must stay where they put it" is one of the journeys the original terminal complaint
was about.

### How it was established

Read out of the shipped bundle first, then asked of the app rather than trusted. The screen's text cannot
be read — the emulator draws to a canvas and writes nothing into the DOM — so the check is a **fingerprint
of the canvas**: sample its pixels, hash them, compare. If the view held, a write landing below the
visible region changes no pixel in it and the two hashes are equal; if it snapped, nearly every pixel
moved.

```
before the fix   scrolled back 367765107   after one more line 1995027964   held: false
after it         scrolled back 367765107   after one more line  367765107   held: true
```

Different, so the screen had moved; identical afterwards, so it does not. That measurement is itself only possible because this engine draws to
a 2D canvas; against the previous one it would have been a screenshot and an opinion.

### What was done about it

The behaviour is a dependency's, so the window undoes it: the view goes back to where it was **plus
however many lines the write added**. The user is reading content, and what grew is the distance from the
bottom to that content, so restoring the old `viewportY` alone would still drift by one line per line of
output.

Both the snap and the correction happen inside the same synchronous turn, before the frame that paints, so
nothing flickers. Neither is reported to the host: the emulator raises a scroll for each, and passing them
on would tell a scroll control that the session stopped following and started again twice per chunk.

The stand-in had to be taught the snap before any of this could be tested — a stand-in that simply
appended would have let a pool with no correction pass. Deleting the correction fails
"keeps the user where they were, allowing for what the write added", and nothing else.

### Why it is a finding and not only a fix

It is worth stating plainly that **this is a place where `ghostty-web` is less capable than what it
replaced**, and the compensation lives in this app rather than upstream. If the package later takes the
official distribution, or fixes this, the correction here should be re-measured rather than assumed still
needed — the canvas fingerprint is how.


## 2026-11-09 — Phase A's gates

```
chain passed in 361.0s (28 of 32 cached) on a 10-core budget
```

All four of the gates Phase A names:

| gate | result |
|---|---|
| `npm run chain` | **passed**, 32 steps |
| `test:smoke` | passed, as a chain step |
| the packaged install path | `test:packaged-authoring:author` and `:app` passed |
| `cargo xtask pre-push` on the broker | passed: 135 tests in 7.3s, 61 mutants, none missed |

`test:native` passed in the Linux container (2876.8s) and `test:integration` in 681.7s, both on the run
before this one; this run found their inputs unmoved and cached them, which is what the 28-of-32 is.

### Two things the chain said that are worth reading

**It did not build what CI clones.** Its result line says so by name: `vendor/apack-terminal at 26e6583
rather than 80ffdb3`. One commit sits past the pin — the packaging fix that stages the binary by rename —
because the pin cannot advance to a commit that has not been pushed. A local chain tests the sibling's
working tree and CI clones the `.rev`, which is exactly the drift that line exists to surface.
(`vendor/elmdb` is drifted too, from other work.)

**A first run failed, and one of the two reasons was mine.** It failed at `test:unit:host` on
`progress.spec.ts`'s *"reads a worker thread's own CPU from the first reading"* — `expected 105.321 to be
greater than 200`, a CPU measurement starved by the chain's own worker concurrency, in a package this goal
does not touch. It passes 32 of 32 alone, at a load average of 99.

The other was self-inflicted and is the more useful note: the chain reported

```
test:integration  docs/goals/goal-one-vt-core.md  changed while it ran
test:integration's result does not describe this tree: it read files that changed while it ran.
```

Documentation was being written during the run, and that step declares the tree it read. The result was
therefore not cacheable and, under `--strict`, would have failed the run. **A chain run wants a quiescent
tree**, including from whoever is writing the prose about it — which is why the figure above comes from a
second run that touched nothing.


## 2026-11-09 — The figures, and what they will and will not support

### There is a baseline, and it is the same scenario on the same machine

The ownership goal measured `terminal-open` before any of this, and its record carries the conditions:
median **20.7 ms**, range **18–25**, 20 measured trials, `lightweight`, five warmups, machine identity
`d74b1b3a…`. Four runs were taken here with the same scenario, the same mode, the same trial count, the
same fixture generator (`terminal-open-v1`), the same Electron 44.9.3 and Chromium 152.0.7977.167 — and
the manifest says the same machine identity, `d74b1b3a…`. So the comparison is like for like in
everything a manifest records.

### What four runs of it said

| run | median | min | max |
|---|---|---|---|
| 1 | 17.1 | 15.8 | 22.9 |
| 2 | 30.8 | 19.5 | 57.0 |
| 3 | 19.5 | 16.5 | 68.6 |
| 4 | 26.8 | 16.9 | 83.9 |

**The median is not citable and this record will not cite one.** Four runs of an identical configuration
produced medians from 17.1 to 30.8 — an eighty per cent spread — which is a reading that moves while its
input does not. `npm run check:idle` passed at the 70% floor before run 2, and runs 2 to 4 still carry
maxima of 57, 69 and 84 ms against the baseline's 25. What differs from the baseline is not the hardware
or the build but what else this machine was doing, and that is not something a figure can be corrected
for.

### What they do support, which is a floor

The minima are tight where the maxima are wild: **15.8, 16.5, 16.9 and 19.5 ms** across eighty measured
trials, against the baseline's minimum of 18 ms taken on a verified-idle machine.

This repository's own rule is what makes that usable: *load inflates a duration and cannot deflate it*, so
a measurement is an upper bound on the true cost and never an under-estimate. The new engine therefore
attaches in **at most 15.8 ms** where the old one's best observed was 18, and the comparison runs in the
one direction load cannot have manufactured.

**So: attaching a terminal did not get slower, and its floor is a little lower.** That is the whole of the
claim. It is not a median improvement, and nobody should quote one from here.

### The other figures Phase A lists were not taken

Sustained-output responsiveness, large-history behaviour, memory with several hidden sessions and resize
all have scenarios in `tests/performance/`, and none was run to a citable figure for the same reason the
median is not citable: the machine would not hold still. They are named here rather than quietly dropped.

**And the measurement acceptance as the plan wrote it cannot be met at all**, which is worth stating
plainly rather than working around: it says the limits are agreed from the baseline *before* cutover, and
no limits were agreed. What exists instead is the ownership goal's recorded figure, which is why the one
comparison above was possible at all — a reminder that the value of recording a measurement with its
conditions is mostly paid to whoever comes next.

### The one figure that is solid

The bundle attribution, because it is a property of the artifact rather than of the machine: 502 KiB of
`@xterm/*` became 134 KiB of `ghostty-web` JavaScript, and the pack's frontend grew 184 KiB because a 414
KiB WebAssembly module is carried as 552 KiB of base64. Sourcemap attribution, the same instrument the
ownership goal used, so the two are comparable.
