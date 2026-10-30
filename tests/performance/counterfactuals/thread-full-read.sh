#!/usr/bin/env bash
set -euo pipefail
# Mutate only the runner-owned disposable Linux copy; never the authored checkout.
test "$(pwd)" = /work
scratch=$(mktemp -d /tmp/apack-thread-fault.XXXXXX)
cp tests/performance/thread-open.spec.ts "$scratch/before.ts"
trap 'cp "$scratch/before.ts" tests/performance/thread-open.spec.ts; rm -rf "$scratch"' EXIT
export APACK_FAULT_REPORTS_BEFORE="$scratch/reports.json"
node --input-type=module -e 'import {existsSync,readdirSync,writeFileSync} from "node:fs"; writeFileSync(process.env.APACK_FAULT_REPORTS_BEFORE,JSON.stringify(existsSync(".apack/performance")?readdirSync(".apack/performance"):[]))' 
python3 - <<'PY'
p='tests/performance/thread-open.spec.ts'
s=open(p).read()
a='try { action.within(() => win.applicationState.send('
b="try { action.within(() => (win.applicationState.send({ type: 'SEND_TO_SURFACE', surface: 'default-setup/database', events: [{ type: 'QUERY.EXECUTE', code: 'return query(EARS.Entity.Message).pickAll()' }] }), win.applicationState.send("
assert s.count(a)==1
s=s.replace(a,b,1)
s=s.replace('    for (let index', "    await app.waitForSurface('default-setup/database');\n    await app.navigate('default-setup/database');\n    await app.navigate('default-setup/threads');\n    for (let index",1)
a="events: [{ type: 'OPEN_THREAD_CHAT', threadId: target }] })); }"
b="events: [{ type: 'OPEN_THREAD_CHAT', threadId: target }] }))); }"
assert s.count(a)==1
open(p,'w').write(s.replace(a,b,1))
PY
set +e
APACK_PERFORMANCE_SCENARIO=thread-open APACK_PERFORMANCE_TRIALS=1 xvfb-run -a npm run test:e2e -- --config tests/performance/playwright.config.ts
result=$?
set -e
test "$result" -ne 0
node --input-type=module <<'JS'
import { readdirSync, readFileSync } from 'node:fs';
const root = '.apack/performance';
const before = new Set(JSON.parse(readFileSync(process.env.APACK_FAULT_REPORTS_BEFORE, 'utf8')));
const created = readdirSync(root).filter(name => name.startsWith('thread-open-') && !before.has(name));
if (created.length !== 1) throw Error('Expected exactly one new counterfactual report');
const directory = created[0];
const report = JSON.parse(readFileSync(`${root}/${directory}/results.json`));
const trial = report.trials[0];
if (trial?.outcome !== 'failed' || trial?.failure !== 'app-read-work-bound'
  || !(trial.work.windowAppResponseBytes > trial.work.maxAppResponseBytes)
  || Object.values(trial.processes).some(process => !process.complete)) throw Error('Full-dataset read did not trip the intended work guard');
console.log(JSON.stringify({ counterfactual: 'full-dataset-read', directory, outcome: trial.outcome, work: trial.work }));
JS
