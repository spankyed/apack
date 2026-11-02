# Canonical native source on Windows, 2026-10-30

Exact [platform run 40985909864](https://github.com/spankyed/apack/actions/runs/40985909864)
at `1860dd2eb141fc1d3f3b8b5d3e7b0a7a5f2fe332` passes Linux and macOS. Windows executes
all 555 independent membership comparisons and its lifecycle cases but fails the final source-digest
assertion: Git writes CRLF while applying the patch, including with `--no-index`.

The retained actual Windows C source hashes to `9a3ab41535721647537af740e30dd28e8d2b83aef4e910d944d1b696e74556f8`.
Replacing only CRLF with LF makes it byte-identical to the tested Linux source, hash
`5d49d5ea17fbeaa1f22141305a81a5aeac8feb1af652a0d8229ea906bd5c973b`.
The builder now writes canonical LF and asserts that exact source digest **before** compiling.
The platform verifier still requires that same digest; it does not accept a second Windows hash.

A private Linux build under `core.autocrlf=true` reproduces the exact failed Windows hash with the old
builder. The fixed builder emits the canonical digest under the same Git policy, then all 555 independent
comparisons pass on its actual artifact. `control.json`, commands, reports and actual Windows provenance
are retained here. This fixes source reproducibility without changing the C implementation or ANN settings.
A new exact-source Windows/platform run remains required.
