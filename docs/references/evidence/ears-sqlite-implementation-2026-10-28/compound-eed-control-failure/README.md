# Compound patch: 92 search passes and an invalid counterfactual setup

[Run 41462773196](https://github.com/spankyed/apack/actions/runs/41462773196), source `eed73e40714118a9a60d17fe6ab30bb3219ed0ec`, passes candidate source/test typecheck and all 92 selected search contracts without failures or exclusions, including the two new compound/phrase/stemming regressions.

The next step fails before executing its tests: `git show` cannot find historical commit 0a9892907b in the shallow checkout and exits 128. This is a CI-control setup error, not evidence that old code was rejected. The workflow correction fetches the exact full historical commit before source replacement. No old-code control or relevance result is claimed from this run; inference and original judgments were skipped after that failure.

The original numeric contract report is gzip-preserved with decompressed SHA-256. The minimized receipt retains original job/failure-log hashes without raw logs. This source predates the subsequent ASCII-only tokenizer guard/private-use regression, which still requires its own closing checks.
