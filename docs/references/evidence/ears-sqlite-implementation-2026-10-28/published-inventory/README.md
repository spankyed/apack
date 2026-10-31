# Published inventory after consumer dependency installation

[Strict integration-1 job 123999240033](https://github.com/spankyed/apack/actions/runs/41034746897/job/123999240033)
failed at exact source `3cccc4dfa9` because the SDK inventory assertion enumerated an installed consumer
package after the fixture linked its owner-specific dependencies. The added `node_modules` directory
was counted as shipped SDK content. A complete local file run exposed the same assertion for EARS
under this platform's dependency layout (`initial-full/`). Runtime SDK/EARS imports themselves passed.

Both root-inventory assertions now read npm's real tarball file list, retaining strict expected package
roots while installed consumers continue resolving their required private dependency overrides.

All **10 published SDK consumer cases pass**, including both supported TypeScript versions, node16/bundler,
inference library checking and the actual plain-Node SDK/EARS/regex load. Publish-check package types and
changed-test correctness lint pass. Restoring the original installed-directory SDK assertion fails exactly
one selected case, reproducing the CI defect; `check.py` restores the source after that control. Source
hashes, commands and disposable image/resources are in `source.json`. Full checks used private Linux,
2 CPU / 6 GiB and no swap/network; the initial focused positive/control also passed at 0.5 CPU / 768 MiB.

These results fix the identified assertion defect, not the entire original strict run. Its other jobs
must be inspected independently, and a full strict run on the final candidate remains required.

Retained log files normalize trailing whitespace and blank EOF lines for review; JSON reports are preserved.
