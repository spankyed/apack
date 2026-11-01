# Default typo growth cohort — 2026-10-29

The protocol/fixture was committed before execution at 610f84bfd9, with actual loaded-JS hashes added at
0ba7b955b8 before the first run. Pinned source is vocabulary scan e452d67ae1 versus bounded alternatives
9beb23ebc9, order **scan / bounded / bounded / scan**, four fresh processes, each with fresh 1k/10k/100k
profiles. All expected answers pass, including the mandatory maximum eligible token and 100k profile.
Each trial completes inside its unchanged 180-second bound; no retries, failures or samples are discarded.
One owned disposable Linux arm64 container uses two CPUs/6 GiB and dropped capabilities. Both source trees
have independent dependencies/builds; only the identical fixture is copied into each after its EARS build.
Syntax/lint pass. Source archives, fixture and actual loaded JS/native hashes identify the measured code.

## Result: not accepted

At 100k, warm median exact queries improve from **138 / 149 ms** to **14.6 / 14.1 ms**; deletion/transposition
from roughly **133–142** to **12.8–14.1 ms**, absent queries **142–148** to **10.5–10.6 ms**. Literal phrase,
prefix and Unicode paths avoid dictionary enumeration and improve from roughly **41–44** to **0.12 ms**.
But broad queries regress from **300 / 311** to **1315 / 1326 ms**, despite the same useful answers. At 1k,
exact queries regress from **1.9** to **9.6–9.8 ms** and maximum-token queries from **0.56–0.59** to
**33–34 ms**. At 10k, maximum-token queries regress from **4.4–4.6** to **41–42 ms**. Selective highlighted
queries at 100k improve **137–141** to **27 ms**, but regress at small sizes. Every path, first invocation,
warm sample, tail, memory/heap, heartbeat, file/WAL byte and binding observation remains in the raw reports.

The generated query-work bound and correctness proof stand; they do not make this execution strategy
acceptable. Before claiming a cause, isolate the large native MATCH expression on the same profile:
compare full versus presence-pruned alternatives for native unscored match count and the actual scored
limited facade SQL, retaining the plans, expressions, answer equality and all timing samples. Native
presence probes must use FTS MATCH and preserve optional stemming/alias behavior; replacing full vocabulary
enumeration with another full scan is not a solution. No production correction is selected by this cohort.

These are SQLite revision diagnostics with fuzzy enabled, OFF commits and warm OS/database caches.
First invocation is not cold storage. Process resource totals/maxRSS are cumulative across profile sizes,
not independent per-profile peaks. This does not compare elmdb, qualify a real corpus/language, prove a
memory bound or replace phase 3's failed 100k admission/FULL and complete app/platform criteria.
