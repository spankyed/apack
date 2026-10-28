# Compiled CLI asset loading — Linux arm64 / Node 23.11.1

Tracked functional source: 846dfb4ef99893cede83bc3cd5bf176e756ff018; app master 98386b36a1,
native engine 6ab2f69. The published 3f4651b009 descendant only changes comments and documentation.
Owned Linux image apack-linux-test:74d4b8cfe839, 2 CPUs / 6 GiB; checked-in lockfile installed
before all five normal package builds. Seed creation uses source/tsx on a synthetic isolated profile.
The actual compiled CLI then runs plain Node with NO source condition or transpiler.

Regex, exact substring and vector-nearest queries return the independently specified IDs.
Moving the owned WASM asset aside causes the compiled regex command to refuse; restoring the same
asset restores the expected answer. Logs and built CLI/EARS/WASM SHA-256 values are retained.
Only logs and hashes leave Linux; no built runtime or native/target tree is copied to the daily Mac.

The first harness incorrectly merged stderr profile diagnostics into stdout before JSON parsing.
It passed the regex process exit check but failed the harness parser; that attempt is retained separately.
The corrected harness keeps both streams and parses stdout only. Neither attempt is a performance,
relevance or real-vector recall qualification. This does not qualify Electron ABI, asar unpacking,
signing or other OS/architectures. No production source change was needed for these cases.
