# Current SQLite search-feature contracts

The original three-platform EARS reports from [strict attempt 1, run 41391989615](https://github.com/spankyed/apack/actions/runs/41391989615/attempts/1), source `06106d18ddc61e0792b9faa1f64a302ffe1f7fdd`, contain the same 80 selected passing feature/refusal cases per platform, with no failures or exclusions among those cases. This is SQLite execution; it does not claim a fresh full native-baseline search replay. The compressed original reports and their hashes remain in [platform-061](../platform-061/README.md); this receipt derives named outcomes without rerunning or changing tests.

| Selected scope | Passing cases per OS | Evidence scope |
| --- | ---: | --- |
| Literal multilingual/highlights | 8 | Spanish, German, Greek, Cyrillic, Arabic, Chinese, Japanese and Korean literals; UTF-16 source spans following an astral character |
| Repository-domain relevance features | 36 | Identifier components, accents, phrases/list boundaries, fields/weights, boolean forms, recency, prefix/fuzzy interaction, literal languages and English morphology |
| API/pipeline/lifecycle | 13 | Ranking and scope around other steps, trash, transaction freshness, paging, selected fields, frozen rows, highlights and trigram/pattern refusals |
| Bounded typo matching | 20 | One-edit/transposition behavior, explicit alphabet/length limits, literal fallback, scope, units/rollback/watch/reopen, snapshot consistency and unchanged candidate/presence-query shape after unrelated vocabulary growth |
| Schema feature refusals | 3 | Unsupported root language option, exact analyzer and non-English stemming refuse before changing data/layouts/indexes/revision |

The implemented candidate admits the standard analyzer with no stemming or English Porter stemming. Literal Unicode retrieval is exercised; these small fixtures do not establish multilingual morphology, CJK word segmentation, broad natural-language usefulness or typo correction outside the explicit ASCII-alphanumeric 5–32-character regime. Unsupported typo tokens retain literal matching. General usefulness/provider/model/UI coverage remains independent. The frozen real-content keyword judgment remains 24/25, and hybrid is separately 25/25 with one pinned English model; this receipt does not waive that miss or infer semantic quality from syntactic feature passes.
