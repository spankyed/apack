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


### What is not done

The both-parsers diff harness, which is the rest of Phase 0a. The link is not yet proven: nothing has been
compiled against `libghostty-vt.a` from this repository, so every statement above is from headers, signed
checksums and the published file list rather than from a running binary.
