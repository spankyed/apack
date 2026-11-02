# Final implementation strict producer

Producer job 125476904574 in [run 41503546216](https://github.com/spankyed/apack/actions/runs/41503546216) succeeds at `93ed37e67f40faee3fd25a10f3b897c15e55c858`. The actual chain log records all nineteen stages as `ok` under `--strict --all --cores 2 --job producers`, in 659.0 seconds. The receipt preserves every stage name/time and hashes of the original chain/job logs and job metadata.

Package production, shipped-pack build, external authoring contract, all named source/test typechecks, export/schema/specifier/tier checks and lint pass. This includes EARS tests/bench code containing the probe-option change. Consumer native/integration/app/rest and platform jobs remain separate gates; producer success does not imply overall strict success. Raw logs, private cache paths and process identifiers are omitted.
