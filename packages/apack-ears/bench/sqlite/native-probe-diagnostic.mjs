// Benchmark-only matched nprobe comparison; ordinary policy and model training stay unchanged.
import assert from 'node:assert/strict';

export function compareNativeProbes(db, cohorts, inputs, independentAnswers, size, exactLimit) {
  const samples = [], ordinaryAll = db.all;
  let activeProbe, nativeCalls = 0, nativePages = [], bqFallback = false;
  db.all = function (sql, parameters = []) {
    const native = activeProbe !== undefined && /^SELECT owner FROM ann_[0-9]+\(\?,\?\) WHERE /.test(sql);
    if (native) {
      const options = JSON.parse(parameters[1]);
      assert.equal(options.nprobe, 32);
      nativeCalls++;
      parameters = [...parameters];
      parameters[1] = JSON.stringify({ ...options, nprobe: activeProbe });
    }
    if (activeProbe !== undefined && sql.startsWith('WITH candidates AS MATERIALIZED')) bqFallback = true;
    const rows = ordinaryAll.call(this, sql, parameters);
    if (native) nativePages.push({ limit: JSON.parse(parameters[1]).K, returned: rows.length });
    return rows;
  };
  try {
    for (const cohort of cohorts) {
      if ((cohort.ids?.length ?? size) <= exactLimit) continue;
      for (const input of inputs.filter(input => input.ordinal % 10 === 0)) {
        const variants = [8, 16, 32], rotation = input.ordinal / 10 % variants.length;
        const order = [...variants.slice(rotation), ...variants.slice(0, rotation)];
        for (const nprobe of order) for (const k of [10, 40, 64]) {
          activeProbe = nprobe; nativeCalls = 0; nativePages = []; bqFallback = false;
          const at = performance.now(), selected = cohort.query().near(input.embedding, { k }).ids();
          const ms = performance.now() - at;
          assert(nativeCalls > 0, 'Probe diagnostic must execute actual native candidate selection');
          const wanted = new Set(independentAnswers.get(`${cohort.name}/${input.family}/${input.ordinal}`).slice(0, k));
          assert.equal(selected.length, wanted.size);
          samples.push({ cohort: cohort.name, family: input.family, query: input.ordinal, nprobe, k,
            nativeCalls, nativePages, bqFallback, returned: selected.length, recall: selected.filter(id => wanted.has(id)).length / wanted.size, ms });
        }
      }
    }
    return samples;
  } finally { db.all = ordinaryAll; }
}
