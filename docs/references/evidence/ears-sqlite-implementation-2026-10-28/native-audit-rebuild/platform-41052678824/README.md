# Native audit/rebuild platform and full-strict qualification

[41052678824](https://github.com/spankyed/apack/actions/runs/41052678824) completes successfully at
`212b819db6f505a87e44cc93cb3d3d0967c424e8`, integrated master `5e81dda7c2` and native `95615ed8d4`.
Every required strict job passes: producers, both native shards, both integration shards, app-and-rest
and the three SQLite platforms. Optional separately dispatched jobs remain skipped as configured.

Retained downloaded JSON is byte-for-byte with SHA-256 receipts. The actual EARS assertion records are
independently counted: ten native audit/rebuild cases and 35 model cases pass on every host. Linux/macOS
pass 676 EARS cases; Windows passes 675 with its existing POSIX-only omission. Selected host contracts
pass 145 on Linux/macOS and 132 on Windows. Each host performs 555 independent membership comparisons;
the Linux report also records the complete SDK and managed API coverage.

This qualifies the audit/rebuild checkpoint, before transactional damaged-group repair and later packaging
test changes. It does not certify arbitrary filesystems, real signed installation, performance or adoption.
The earlier bundled-editor failure is not erased by this later green run; its cause remains unproven.
