# Model ownership platform qualification

[Run 41019274148](https://github.com/spankyed/apack/actions/runs/41019274148) passed on
source `1d16d85c8104859932a555d09d4b4f00600f8b1a` on Linux x64, macOS arm64 and Windows x64.
The retained raw reports were downloaded and independently checked for source identity,
zero failed EARS cases, and execution of all 3 kernel ownership, 5 package, 8 generation,
5 worker and 17 model admission cases on each host. Each host also passed 555 native
membership comparisons. Linux/macOS passed 646 EARS cases; Windows passed 645 with the
existing explicit POSIX omission. Checksums identify the copied reports.

This qualifies the pinned ownership dependency and service lifetime implementation at
that checkpoint. It does not qualify subsequent logical/native readiness or app owner
activation changes, installed/signed Electron builds, arbitrary filesystems, performance
budgets, or the complete strict chain. See the parent evidence and goal for outstanding gates.
