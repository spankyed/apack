# Unchanged dependency-publication test: focused result

[Run 41397716324](https://github.com/spankyed/apack/actions/runs/41397716324), source `733294618a140ed5fa3fe173f2d22c2af335a46b`, succeeds. The exact dependency-publication test that timed out in the strict shard passes alone in 61,063.77 ms under its unchanged 200,000 ms deadline. There are no failed or excluded tests. Git confirms only documentation differs from the strict failure source `06106d18dd`; the test, production code and dependency pins are unchanged. No assertion or timeout was relaxed.

This does not establish why the full shard timed out, nor does it pass its three uncompleted files. The original [failed strict attempt](../strict-061-consumers/README.md) and [timeout](../integration-061-timeout/README.md) remain evidence. Only the original failed integration-1 job is rerunning at its original source in attempt 2 of run 41391989615. No other failed job is repeated merely to change its recorded outcome.

The original single-case JSON report is compressed unchanged with decompressed SHA-256. The minimized receipt records source, exact case, duration and limitations. Compiler/app logs and fixture payloads are omitted.
