# Opposite-order lightweight startup comparison

[Run 41370082127](https://github.com/spankyed/apack/actions/runs/41370082127), source `48b5ec9f5d661fd924df80eb3ff5780637bf6f71`, admits all five warmups/twenty fresh-process measured launches per actual backend, with SQLite's entire cohort first. Actual admission reports record that order and lightweight mode. All fifty raw trial byte lengths/hashes, source/native/store/mode manifests and trace fingerprints were checked locally. Original numeric admission/preparation/results/lifecycle reports are gzip-preserved with decompressed SHA-256; raw traces/configuration/logs are omitted.

| Backend | Measured median | Min–max | Seed import outside startup |
| --- | --- | --- | --- |
| elmdb | 7,211.36 ms | 4,484.39–10,795.85 ms | 2,248.51 ms |
| SQLite | 7,291.46 ms | 5,357.81–11,339.22 ms | 9,477.92 ms |

SQLite's median is 1.11% higher in this run, versus 55.69% in the earlier [native-first lightweight run](../startup-374/README.md). The maintained twenty-trial count, five warmups, seed corpus, completion/capture requirements and recording mode remain unchanged. A source diff confirms no EARS/host/SDK/API/main/renderer/default-setup source, package-lock or native-pin changes between these two sources. This comparison predates the later host history-policy fix; normal successful opens show no injected failure here.

The earlier gap is not reproduced, but backend order and runner/run identity change together. This is not proof that order caused the difference or that a particular optimization removed a regression. Both cohorts also drift internally: SQLite first/last ten measured-trial medians are 8,025.97/6,106.71 ms; native 7,683.83/6,193.56 ms. Retain every sample, including slow launches. No new warmup, outlier exclusion, timing threshold or acceptance waiver was added after observing the result.

Both runs use warm filesystems, closed copied populated profiles, backend-default acknowledgments and one three-CPU/about-7-GiB macOS arm64 runner per run. They do not prove interleaved pairing, device/CPU isolation, matched physical flushing, whole-device cold behavior or foreground/resource acceptance. The [detailed diagnostic](../startup-ea775/README.md) is a third separately recorded observation, not a replacement lightweight sample. The observations do not establish a stable engine-only startup penalty; further balanced/representative measurement or an explicit product disposition is still required. SQLite seed import remains materially slower in both lightweight runs and remains separate required work.
