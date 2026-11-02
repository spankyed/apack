# Separate passages: unstemmed pass, English regression

[Run 41473096670](https://github.com/spankyed/apack/actions/runs/41473096670), source `373bf288c6b9858e69db90feb14fafe629b6bda4`, failed the unchanged keyword hard gate. SQLite unstemmed passes all 25 original judgments; English passes 24, with the required case 6 result at rank 13. Stem-only matches now outrank the literal compound. The fixture, targets and top-five threshold are unchanged. The next correction distinguishes literal compounds from stem-only matches using a native unstemmed companion index sharing the stored text.

The EARS production build passed. Because the keyword assertion failed first, contracts, counterfactuals, upgrade/audit tests and inference did not run. Original numeric reports are gzip-preserved; SHA256SUMS refers to decompressed bytes. This is failed evidence, not completed qualification.
