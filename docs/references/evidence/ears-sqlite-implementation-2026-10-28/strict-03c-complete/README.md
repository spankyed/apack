# Completed strict predecessor at 03c

[Run 41312762268](https://github.com/spankyed/apack/actions/runs/41312762268), source `03c852400df6e466cc59e7e11a63c8f67158d6e9`, is terminal failure. Complete producer/type/API/lint gates pass. All four integration/native consumers pass:

- Integration-1: 242 cases, 31 files, no exclusions.
- Integration-2: 580 cases, 31 files, one Windows-only dev-server exclusion; all five dependency-graph cases pass in the full shard. The older setup timeout is not reproduced, without a changed deadline.
- Native-1: 26 cases pass; two Linux ELF-library cases are excluded on macOS.
- Native-2: 47 cases pass; 26 Windows PE-library cases are excluded on macOS.

Platform EARS suites retain only the original keyword judgment failure: Linux/macOS 903 pass/one fail/no skips; Windows 899 pass/one fail/four FIFO exclusions. App-and-rest has 6973 unit passes/one keyword failure/88 exclusions and stops later chain work. Its independent six-case app witness has [missing-build setup failures](../strict-03c-app-setup/README.md), not actual app passes. The candidate workflow repairs that prerequisite in a later source; this run cannot qualify it.

Job metadata and four completely inspected small chain summaries are retained unchanged with hashes/lengths. Detailed assertion excerpts are in [integration-2](../strict-03c-integration2/README.md) and app setup evidence; other full logs/artifacts remain in CI/private downloads. Intentional sharding records no cache stamp, which produces a misleading generic warning; it does not establish source drift. No binaries/large producer artifact/private data are copied.

This source predates conditional cosine selection and counter safeguards. Its passing subsets support the predecessor only; final-source full acceptance remains required.
