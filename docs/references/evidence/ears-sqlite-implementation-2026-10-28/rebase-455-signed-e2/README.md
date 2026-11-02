# Rebased production/API and preceding signed macOS qualification

[41222851237](https://github.com/spankyed/apack/actions/runs/41222851237) succeeds at rebased `455cdb9275b574bcb4ead28e431c9bb5333f3221`. Actual published package production builds the pinned portable graph core; independent modularity remains 0.41978961209730437, repeatability and two refusal cases pass. All three EARS API reports are current and the regenerated patch is empty. This predates topological/similarity implementation bb1fd58a66 and is not full current-source acceptance.

[Signed macOS 41218619605](https://github.com/spankyed/apack/actions/runs/41218619605) succeeds at preceding `e2f569fa252e84c50ac5550477da1a92227c6cd6`. The real signed app has six expected passes, zero skipped/unexpected/flaky cases and the packaged SQLite ownership witness. Raw signing, native-runtime, build and renderer/app reports accompany this note. This source predates the rebase; final integrated signing/distribution qualification remains required.

Compressed raw reports and uncompressed-byte receipts preserve scope and source; no compiled binaries or private database contents are committed.
