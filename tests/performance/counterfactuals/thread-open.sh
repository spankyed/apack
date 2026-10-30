#!/usr/bin/env bash
set -euo pipefail
# Mutate only the runner-owned disposable Linux copy; never the authored checkout.
test "$(pwd)" = /work
export APACK_THREAD_FAULT="${1:-full-read}"
case "$APACK_THREAD_FAULT" in full-read|missing-completion) ;; *) exit 2 ;; esac
scratch=$(mktemp -d /tmp/apack-thread-fault.XXXXXX)
cp tests/performance/thread-open.spec.ts "$scratch/before.ts"
trap 'cp "$scratch/before.ts" tests/performance/thread-open.spec.ts; rm -rf "$scratch"' EXIT
export APACK_FAULT_REPORTS_BEFORE="$scratch/reports.json"
node --input-type=module -e 'import {existsSync,readdirSync,writeFileSync} from "node:fs"; writeFileSync(process.env.APACK_FAULT_REPORTS_BEFORE,JSON.stringify(existsSync(".apack/performance")?readdirSync(".apack/performance"):[]))'
python3 - <<'PY'
p='tests/performance/thread-open.spec.ts'
s=open(p).read()
import os
if os.environ['APACK_THREAD_FAULT'] == 'missing-completion':
    assert s.count('delivered = true;') == 1
    s = s.replace('delivered = true;', 'delivered = false;', 1)
    a = 'return { completed, durationMs, reports, failure, lastDelivery, work };'
    assert s.count(a) == 1
    s = s.replace(a, "work.faultObservedMessages = win.applicationState.system.get('default-setup/threads').getSnapshot().context.chatMessageIds.length;\n        " + a, 1)
    open(p, 'w').write(s)
else:
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
APACK_PERFORMANCE_SCENARIO=thread-open APACK_PERFORMANCE_MODE=lightweight APACK_PERFORMANCE_TRIALS=1 xvfb-run -a npm run test:e2e -- --config tests/performance/playwright.config.ts
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
const fault = process.env.APACK_THREAD_FAULT;
if (Object.keys(trial?.processes ?? {}).length !== 2 || Object.values(trial?.processes ?? {}).some(process => !process.complete)) throw Error('Counterfactual capture is incomplete');
if (fault === 'full-read') {
  if (trial?.outcome !== 'failed' || trial.failure !== 'app-read-work-bound'
    || !(trial.work.windowAppResponseBytes > trial.work.maxAppResponseBytes)) throw Error('Full-dataset read did not trip the work guard');
} else if (trial?.outcome !== 'incomplete' || trial.failure !== 'missing-view-ready' || trial.completion !== 'missing'
  || trial.correct || trial.durationMs !== undefined || trial.work.faultObservedMessages !== 50) throw Error('Missing finish marker passed or lost the actual populated view');
console.log(JSON.stringify({ counterfactual: fault, directory, outcome: trial.outcome, work: trial.work }));
JS
