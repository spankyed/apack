# Bundled editor gate failure

Strict chain 40842115212 at b25a985c8c failed the bundled UI fixture: after filling the contenteditable editor with `Bundled editor typed`, its Vue-model mirror remained `Bundled editor`. The 27-case external-pack fixture before it passed. Both integration/native shards and SQLite Linux/macOS passed. No causal attribution to SQLite, clock timing, editor initialization or component identity has been established.

The original strict artifact includes only console output, not Playwright results. That retention gap is corrected in 507e92fe85. The relevant editor/fixture paths match pinned master; see `baseline-boundary.json`. This establishes source scope, not a passing/failing baseline comparison.

Focused Linux reproduction uses the same frozen source, immutable display image, read-only original dependency/native seeds, private dependency copies, 2 CPUs/6 GiB/no extra swap, capabilities dropped and a mode-denial preflight. It runs the original fixture assertion and default elmdb. Chromium's sandbox is disabled only through a private copied executable wrapper because this container runs as root; that setup does not qualify packaged Electron security or OS coverage.

The first setup attempt built the shipped pack, API and renderer but failed main's build-time Electron-as-Node probe because the wrapper passed `--no-sandbox` too early. The corrected diagnostic places the wrapper after the complete runtime build. This is a harness failure and supplies no editor behavior result. All logs and both runner versions are retained. The corrected run is pending.
