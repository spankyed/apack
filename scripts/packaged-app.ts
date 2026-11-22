import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { packagedOptions, selectPackagedApp, stopPackagedApp, resetTargets, startPackagedApp, verifyPackagedSigning, REPO_ROOT } from './lib/packaged-app.ts';

const [action, ...args] = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('Usage: npm run <start|reset|diagnostics>:packaged -- [--channel production|beta|preview] [--app <bundle.app>] [--data-dir <directory>]\nmacOS only. Defaults to production; prefers the local build over /Applications. Reset removes runtime data and logs only. Signing checks: npm run verify-signing -- [same options].');
} else {
  if (process.platform !== 'darwin') throw new Error('Packaged app tools currently support macOS only.');
  if (!['start', 'reset', 'diagnostics', 'verify-signing'].includes(action)) throw new Error(`Unknown action: ${action}`);
  const app = selectPackagedApp(packagedOptions(args));
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  console.log(`${app.metadata.productName} ${app.metadata.version}: ${app.appPath}`);
  if (action === 'start') {
    await stopPackagedApp(app);
    process.exitCode = await startPackagedApp(app, path.join(REPO_ROOT, 'diagnostics', app.metadata.channel, `session-${stamp}.log`));
  } else if (action === 'reset') {
    const targets = resetTargets(app);
    await stopPackagedApp(app);
    for (const target of targets) { fs.rmSync(target, { recursive: true, force: true }); console.log(`Removed ${target}`); }
  } else if (action === 'verify-signing') {
    const failures = verifyPackagedSigning(app);
    for (const failure of failures) console.error(failure);
    process.exitCode = failures.length ? 1 : 0;
  } else {
    const out = path.join(REPO_ROOT, 'diagnostics', app.metadata.channel, stamp);
    fs.mkdirSync(out, { recursive: true });
    if (fs.existsSync(app.logsDir)) fs.cpSync(app.logsDir, path.join(out, 'logs'), { recursive: true });
    fs.copyFileSync(path.join(app.appPath, 'Contents/Info.plist'), path.join(out, 'Info.plist'));
    fs.copyFileSync(path.join(app.appDir, 'build-manifest.json'), path.join(out, 'build-manifest.json'));
    const server = path.join(app.appDir, 'packages/server/dist/server.js');
    fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify({ appPath: app.appPath, metadata: app.metadata,
      userDataDir: app.context.userDataDir, logsDir: app.logsDir,
      apiSha256: createHash('sha256').update(fs.readFileSync(server)).digest('hex') }, null, 2));
    for (const [name, command, argv] of [
      ['processes.txt', 'ps', ['-axo', 'pid,ppid,stat,lstart,command']],
      ['git-status.txt', 'git', ['status', '--short']],
    ] as const) {
      try { fs.writeFileSync(path.join(out, name), execFileSync(command, [...argv], { cwd: REPO_ROOT, timeout: 10000 })); }
      catch (error) { fs.writeFileSync(path.join(out, name), String(error)); }
    }
    const reports = path.join(os.homedir(), 'Library/Logs/DiagnosticReports');
    if (fs.existsSync(reports)) {
      const recent = fs.readdirSync(reports).filter(name => name.startsWith(app.metadata.productName + '-') || name.startsWith(app.metadata.productName + '_'))
        .map(name => ({ name, time: fs.statSync(path.join(reports, name)).mtimeMs }))
        .sort((a, b) => b.time - a.time).slice(0, 10);
      for (const report of recent) fs.copyFileSync(path.join(reports, report.name), path.join(out, report.name));
    }
    console.log(out);
  }
}
