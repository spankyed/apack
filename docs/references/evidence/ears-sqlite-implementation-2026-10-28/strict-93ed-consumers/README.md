# Corrected-source strict consumer evidence

Native-2 job 125488939884 in [run 41503546216](https://github.com/spankyed/apack/actions/runs/41503546216), source 93ed, succeeds. All eight repository files complete: seven passed and one existing skipped file. The reporter records files, so individual assertion/exclusion counts are not inferred. Normalized progress uses public repository paths; original progress/log/job hashes are preserved without raw logs or private paths.

Integration-2 separately passes all 31 repository files; [integration-1 first-attempt timeout](../strict-93ed-integration/README.md) remains an unmet gate with 23 unexecuted files. Native-1 remains live at this checkpoint; app/rest now succeeds, as detailed below. This directory is not an overall strict completion claim.

## Complete app/rest

App/rest job 125488940066 succeeds on the same implementation. Host has 7,040 passing assertions/95 existing exclusions; pack has 989/two exclusions. Published authoring has seven producer cases and two app cases, external-app groups total 32, the independent fork step succeeds and all five smoke cases pass. Six explicit source SQLite app/storage witnesses pass once, zero failures/exclusions/flakes/retries; their public outcomes and original report hash are retained in app-and-rest.json.

Host pool time is 489.9 seconds under the unchanged 600-second limit. One individual 15-second size-budget warning remains a diagnostic; no actual deadline was relaxed. Current observed timings do not isolate a source effect or guarantee future CI stability. Normalized per-file progress and original report/log/job hashes are preserved without raw logs/private configuration/profiles. The integration-1 first-attempt timeout remains unqualified pending the full original-job replay; this is not an overall strict pass.
