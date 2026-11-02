# Actual signed installed Preview qualification

[App acceptance 41069328528](https://github.com/spankyed/apack/actions/runs/41069328528) passes at
`2558de0d9d8910c611fcaa179c5dadf666b4fbff` on macOS ARM64. [Run metadata](run.json), [job log](job.log)
and [source/native receipts](receipt.json) retain the evidence.

The cold ordinary unsigned Preview build succeeds after dependency-ordered contract generation. Full unsigned
native smoke loads elmdb, SQLite, node-pty and keyring; SQLite trains an actual 4097-row 128D model in a worker,
queries it and reopens read-only. The existing Developer ID certificate signs the same bundle through the new
hook. Its library hash changes from the unsigned to signed value recorded in the receipt before outer sealing.
Strict deep bundle verification, hardened runtime and TeamIdentifier checks pass, followed by full signed
native smoke with the final manifest and hashes for all loaded native addons.

The actual signed executable then runs six app cases with an isolated SQLite profile: the five existing smoke
cases and the mandatory process-boundary witness. Both real managed stores hold SQLite headers and their
native model kernel claims across the actual API process. The workflow's independent JSON verifier refuses
missing/skipped/flaky witnesses. Six tests pass; this is not a source-run or copied-layout claim.

The transient certificate and keychain are cleaned up. Nothing is notarized, released, merged or installed
into the daily profile. This qualifies this exact checkpoint on this host; later managed-publication changes,
other installed architectures, full executable-pack/CLI/SDK flows, large corpus behavior and performance gates
retain separate required qualification. Text logs normalize trailing whitespace; JSON is unchanged.
