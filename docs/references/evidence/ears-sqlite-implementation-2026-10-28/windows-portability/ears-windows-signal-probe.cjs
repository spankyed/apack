const assert = require('node:assert/strict');
const fs = require('node:fs');
const { spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');
const { createInterface } = require('node:readline');
(async () => {
  const self = spawnSync(process.execPath, ['-e', "require('node:fs').writeSync(1,'cursor-ready\\n');process.kill(process.pid,'SIGKILL')"], { encoding: 'utf8', timeout: 10000 });
  const report = { node: process.version, platform: process.platform, release: require('node:os').release(),
    scriptSha256: require('node:crypto').createHash('sha256').update(fs.readFileSync(__filename)).digest('hex'),
    selfKill: { status: self.status, signal: self.signal, stdout: self.stdout, stderr: self.stderr } };
  const child = spawn(process.execPath, ['-e', "require('node:fs').writeSync(1,'cursor-ready\\n');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10000);process.exit(2)"], { timeout: 10000, killSignal: 'SIGKILL' });
  const exited = once(child, 'exit'), lines = createInterface({ input: child.stdout });
  try {
    const [line] = await Promise.race([once(lines, 'line'), exited.then(args => { throw Error('Child exited before readiness: ' + JSON.stringify(args)); })]);
    assert.equal(line, 'cursor-ready');
    const killed = child.kill('SIGKILL'), [status, signal] = await exited;
    report.parentKill = { killed, status, signal, witness: line };
    assert.equal(killed, true); assert.equal(signal, 'SIGKILL');
  } finally {
    lines.close();
    if (child.pid && child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await exited; }
    fs.writeFileSync(__filename + '.json', JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
