#!/usr/bin/env bash
set -euo pipefail
# Diagnostic only: prove capture refusal remains incomplete and isolate its ongoing action cost.
# No report from this deliberate fault is admissible as qualification evidence.
test "$PWD" = /work
scratch=$(mktemp -d)
cp tests/performance/search.spec.ts "$scratch/before.ts"
trap 'cp "$scratch/before.ts" tests/performance/search.spec.ts; rm -rf "$scratch"' EXIT
python3 - <<'PY'
p='tests/performance/search.spec.ts'
s=open(p).read()
a='    for (const entry of schedule) {'
assert s.count(a)==1
s=s.replace(a, """    await electronApp.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('performance:renderer:start');
      ipcMain.handle('performance:renderer:start', () => { throw Error('Injected renderer resource refusal'); });
    });
"""+a,1)
a="      expect(trial.outcome, `Preserved evidence: ${output}`).toBe('passed');"
assert s.count(a)==1
s=s.replace(a,"""      expect(trial.correct).toBe(true);
      expect(trial.completion).toBe('view-ready');
      if (mode === 'lightweight') {
        expect(trial.processes.renderer?.rendererResourceFailures).toBe(1);
        expect(trial.processes.backend?.complete).toBe(true);
      }
      expect(trial.outcome).toBe(mode === 'lightweight' ? 'incomplete' : 'passed');""",1)
open(p,'w').write(s)
PY
export APACK_PERFORMANCE_RUN_OUTPUT="/work/.apack/performance/search-resource-refusal-$(date +%s)"
APACK_PERFORMANCE_SCENARIO=search APACK_PERFORMANCE_MODE=disabled APACK_PERFORMANCE_COMPARE_MODE=lightweight APACK_PERFORMANCE_TRIALS=20 xvfb-run -a npm run test:e2e -- --config tests/performance/playwright.config.ts
node --input-type=module <<'JS'
import fs from 'node:fs';
const root=process.env.APACK_PERFORMANCE_RUN_OUTPUT;
const samples={};
for(const variant of ['A','B']) {
  const index=JSON.parse(fs.readFileSync(`${root}/${variant}/results.json`));
  if(index.records.length!==25) throw Error('Incomplete diagnostic run');
  const trials=index.records.map(record=>JSON.parse(fs.readFileSync(`${root}/${variant}/${record.file}`)));
  if(trials.some(trial=>!trial.correct || trial.completion!=='view-ready' || (variant==='B' && (trial.outcome!=='incomplete' || trial.processes.renderer.rendererResourceFailures!==1)))) throw Error('Incorrect refusal diagnostic');
  samples[variant]=trials.filter(trial=>!trial.warmup).map(trial=>trial.durationMs);
}
const median=values=>{const sorted=[...values].sort((a,b)=>a-b);return (sorted[9]+sorted[10])/2};
const evidence={kind:'unqualified-resource-refusal-diagnostic',samples,baselineMedianMs:median(samples.A),refusedMedianMs:median(samples.B),limitation:'Deliberate missing renderer resources; these incomplete captures cannot qualify overhead'};
fs.writeFileSync(`${root}/diagnostic.json`,JSON.stringify(evidence,null,2));
console.log(JSON.stringify({root,...evidence}));
JS
