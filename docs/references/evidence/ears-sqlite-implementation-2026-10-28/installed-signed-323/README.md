# Signed installed macOS SQLite candidate

[Run 41195510812](https://github.com/spankyed/apack/actions/runs/41195510812) succeeds at source `3230b4f5fe2ac265227a3da32521f74e5d2f73ae`. The normal Preview build, installed native probe, Developer ID signing/provenance verification, typecheck and installed lifecycle steps succeeded on disposable macOS arm64.

Raw Playwright results contain six expected passes, zero skips, failures or flaky cases, and exactly one attempt per case. The storage witness exercises model claims through the real packaged API process; the other five cases cover launch, connection, loaded surfaces, isolated profile and session publication. These are installed smoke/lifecycle checks, not the full source app suite, arbitrary filesystem certification, notarization/distribution approval, physical durability or performance acceptance.

The compressed original JSON and logs accompany this note. `receipts.json` hashes uncompressed bytes. This source predates the API cross-env follow-up; Windows packaging remains separately unqualified after its observed environment-assignment refusal.
