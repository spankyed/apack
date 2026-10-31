#!/usr/bin/env bash
set -euo pipefail
# Diagnostic only: one CPU-only session across a batch, without heap-export GC in every action.
test "$PWD" = /work
scratch=$(mktemp -d)
cp tests/performance/search.spec.ts "$scratch/before.ts"
trap 'cp "$scratch/before.ts" tests/performance/search.spec.ts; rm -rf "$scratch"' EXIT
python3 - <<'PY'
p='tests/performance/search.spec.ts'
s=open(p).read()
s = "import { writeFileSync } from 'node:fs';\nimport path from 'node:path';\n" + s
s = s.replace('const { fixture, schedule } = run;', 'const { fixture, schedule, output } = run;')
a='    for (const entry of schedule) {'
assert s.count(a)==1
s=s.replace(a,"""    const writeCpu = (name: string, profile: unknown) => {
      const encoded = JSON.stringify(profile);
      if (Buffer.byteLength(encoded) > 16 * 1024 * 1024) throw Error('CPU diagnostic exceeds 16 MiB');
      writeFileSync(path.join(output, name), encoded);
    };
    const cpu = await appPage.context().newCDPSession(appPage);
    await cpu.send('Profiler.enable');
    await cpu.send('Profiler.setSamplingInterval', { interval: 100 });
    await cpu.send('Profiler.start');
    await app.waitForSurface('default-setup/database');
    await app.navigate('default-setup/database');
    await appPage.evaluate(() => (window as unknown as PerformanceWindow).applicationState.send({ type: 'SEND_TO_SURFACE', surface: 'default-setup/database', events: [{
      type: 'QUERY.EXECUTE', code: `return import('node:inspector').then(({ Session }) => new Promise((resolve, reject) => {
        const session = new Session(); session.connect(); globalThis.__apackSearchCpu = session;
        session.post('Profiler.enable', () => session.post('Profiler.setSamplingInterval', { interval: 100 }, () => session.post('Profiler.start', error => error ? reject(error) : resolve({ marker: 'search-cpu-started' }))));
      }));`,
    }] }));
    await expect.poll(() => appPage.evaluate(() => ((window as unknown as PerformanceWindow).applicationState.system.get('default-setup/database').getSnapshot().context as unknown as { queryResult?: { marker?: string } }).queryResult?.marker)).toBe('search-cpu-started');
    await app.navigate('default-setup/threads');
"""+a,1)
a="  } finally { run.close(); }"
assert s.count(a)==1
s=s.replace(a,"""    const rendererCpu = await cpu.send('Profiler.stop'); await cpu.detach();
    writeCpu('renderer-batch.cpuprofile', rendererCpu.profile);
    await app.navigate('default-setup/database');
    await appPage.evaluate(() => (window as unknown as PerformanceWindow).applicationState.send({ type: 'SEND_TO_SURFACE', surface: 'default-setup/database', events: [{
      type: 'QUERY.EXECUTE', code: `return new Promise((resolve, reject) => {
        const session = globalThis.__apackSearchCpu; delete globalThis.__apackSearchCpu;
        session.post('Profiler.stop', (error, result) => { session.disconnect(); error ? reject(error) : resolve({ marker: 'search-cpu-stopped', profile: result.profile }); });
      });`,
    }] }));
    await expect.poll(() => appPage.evaluate(() => ((window as unknown as PerformanceWindow).applicationState.system.get('default-setup/database').getSnapshot().context as unknown as { queryResult?: { marker?: string } }).queryResult?.marker)).toBe('search-cpu-stopped');
    const backendCpu = await appPage.evaluate(() => ((window as unknown as PerformanceWindow).applicationState.system.get('default-setup/database').getSnapshot().context as unknown as { queryResult: { profile: unknown } }).queryResult.profile);
    writeCpu('backend-batch.cpuprofile', backendCpu);
    writeFileSync(path.join(output, 'diagnostic.json'), JSON.stringify({ kind: 'unqualified-cpu-only-diagnostic', scope: 'Whole search batch, warmups and recording setup/export included; no heap profiler' }));
"""+a,1)
open(p,'w').write(s)
PY
export APACK_PERFORMANCE_RUN_OUTPUT="/work/.apack/performance/search-cpu-diagnostic-$(date +%s)"
APACK_PERFORMANCE_SCENARIO=search APACK_PERFORMANCE_MODE=disabled APACK_PERFORMANCE_COMPARE_MODE=lightweight APACK_PERFORMANCE_TRIALS=20 xvfb-run -a npm run test:e2e -- --config tests/performance/playwright.config.ts
