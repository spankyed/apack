# Empty-store native cursor preparation

2026-10-30. Integration base `edf17cd0dcfb185379ceb6b0e1fee5780221f7ac` combines the
candidate `23a1e941c7` with committed master `59ed33cdb9`, including native pin `006d6cec88`.
`inputs.json` identifies the tested overlay; reports and commands are retained with checksums.

Ordinary search-storage creation prepares `chunk_native_admission` while chunks are empty,
before ordinary writes or logical-stage ingestion. A later native owner can therefore attach to
that populated store without building a foreground index. The shared preparation helper holds
writer ownership across the empty check and DDL, reuses an existing admission transaction,
and rolls back a refused standalone creation. Native loading still refuses a populated store
missing the index with `MAINTENANCE_REQUIRED`; a read-only native attachment still refuses it
as `CORRUPT`. Plain opens do not silently build this optional index over populated chunks.
The index adds normal per-chunk write/storage cost; this does not requalify resource budgets.

All **635 SQLite EARS cases pass**, zero skips, including ordinary ingestion/close/reopen,
absence of new cursor DDL during populated native attachment, actual logical-stage/read-only
reopen, explicit populated refusal, and transactional DDL failure/retry. Types and changed-source
correctness lint pass. Removing the empty-store preparation causes exactly the intended new
ordinary-store assertion to fail; original candidate bytes are restored and checked.
The platform verifier now requires all eight native generation cases instead of six.

Validation used one private Linux ARM64 container: image
`sha256:0146a4490634fe153ec35c63e7075a4b3e31b1d1a2996d29c77506c5d07b6507`,
`--cpus 2 --memory 6g --memory-swap 6g --cap-drop ALL`. The runner resumes the private
`ears-auto-admission-work` volume with copied dependencies, mounts the previously qualified
vec1 extension and native binding read-only, applies the recorded overlay and checks hashes.
No Mac compiler, daily profile or working-agent output is used.

**Qualification scope:** the SQLite source suite uses the recorded older base-plus-own-unit-patch
elmdb binding as an unused backend dependency; it does not qualify the new `006d6cec88` native pin.
Master's exact native check run [41001101340](https://github.com/spankyed/elmdb/actions/runs/41001101340)
passes Linux checks while other matrix jobs are skipped. Earlier all-platform evidence remains tied
to its earlier exact inputs. Current combined platform/full Strict qualification remains required.
This change supplies empty-stage preparation, not trusted artifact distribution, normal app model
owner creation, read-only candidate loading, physical refresh, host drain or performance acceptance.
