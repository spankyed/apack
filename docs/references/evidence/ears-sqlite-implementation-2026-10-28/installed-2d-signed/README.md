# Current-source signed macOS installed runtime

[Run 41338613335](https://github.com/spankyed/apack/actions/runs/41338613335), source `2d1307c672fd3b86aaa4f1667d739e337d68031d`, completes successfully on macOS arm64. It builds the normal private Preview, typechecks the installed contracts, uses the existing Developer ID/hardened-runtime signing path, verifies `codesign --verify --deep --strict`, reruns native smoke after signing, and removes its temporary signing keychain. Both signing and cleanup steps are confirmed successful.

The actual signed Electron 37.2.4 runtime records six native addon hashes, SQLite 3.53.4 and vec1/Leiden provenance. All six selected installed lifecycle/smoke cases pass once without failures/exclusions/flakes/retries, including `packaged SQLite stores hold their model claims across the real API process`. This test signing uses no timestamp and performs no notarization or release publication. It is not distribution/Gatekeeper, corpus/performance or full adoption qualification.

The original numeric verification report is compressed unchanged with its decompressed SHA-256. The derived receipt retains only source/run, minimal case/result statistics, post-sign native provenance and original report/log hashes. Certificate/signing identity details, private key material, full logs, app configuration, profiles and trace attachments are omitted.
