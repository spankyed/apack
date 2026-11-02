# Early MSVC environment and Rust linker selection

2026-10-30. [Platform run 41012481990](https://github.com/spankyed/apack/actions/runs/41012481990),
source `38aecfe554134374be79621d971bf8e83a659d01`, Windows job `123921247698` fails in
native dependency setup before ordinary EARS package production. The original job log is retained
with compressed/raw checksums in `source.json`; Linux/macOS siblings continue unchanged.

Moving MSVC setup earlier establishes `VCToolsInstallDir` before Rust compilation. A subsequent
bash step prepends Git's Unix tools, and rustc resolves Git's unrelated `usr/bin/link.exe` instead
of Microsoft's linker. Both quote/proc-macro2 build-script links fail. The recorded prepared host
and target are x64, and VCToolsInstallDir names MSVC 14.51.36231. This is a demonstrated setup
regression, not evidence of a failed vector library, functional contract or package test.

Shared setup now derives the absolute Microsoft linker from the prepared host/target directories,
checks that the file exists and exports the corresponding Cargo target linker through GITHUB_ENV
before dependency setup. It supports the prepared x64/arm64 targets and refuses a missing linker.
It preserves MSVC setup needed for ordinary native package production. The existing later Windows
linker verification remains. Exact Windows CI must validate the fix; no passing result is claimed here.
