# Packaged Windows and Linux native runtime passes

[Run 41206483232](https://github.com/spankyed/apack/actions/runs/41206483232), source `dcbb289e5625a7626e917caba3a251e6086c8f38`, succeeds on Windows x64 and Linux x64. Both raw platform reports identify the source and report `completed: true`. Normal unsigned Preview builds load the actual Electron 37.2.4 native bindings, train a 4097-vector model in a worker, query and reopen SQLite read-only, exercise FTS/regex, reopen elmdb, verify PTY output and exit zero, and load keyring. Reports retain addon/extension hashes, driver 13.0.3 and SQLite 3.53.4 provenance.

Windows now exits successfully after the owned PTY cleanup; the original 60-second deadline and natural process exit remain intact. This closes the packaged probe shutdown failure preserved in [windows-probe-92](../windows-probe-92/README.md). It does not fix the separately identified natural-exit cleanup concern in the production terminal service.

Scope remains unpacked unsigned native/API-module compatibility, not renderer, installer, signature or physical power-loss qualification. This checkpoint does not waive the remaining goal gates or certify arbitrary filesystems.

Compressed raw reports, logs, Preview test reports and run metadata are accompanied by uncompressed-byte SHA-256 receipts. The separate frozen-source cleanup receipt verifies all 1602 original source hashes before and after removing only three owned empty source-overlay mount points; no database files were touched.
