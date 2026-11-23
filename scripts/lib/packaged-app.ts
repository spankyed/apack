import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { readBuildManifest, resolveBuildIdentity } from '../../build/build-metadata.ts';
import { resolveAppEnvironment } from '../../packages/apack-sdk/src/env/index.ts';

export const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
export type Channel = 'production' | 'beta' | 'preview';
export interface Options { channel: Channel; app?: string; dataDir?: string }

export function packagedOptions(args: string[]): Options {
  const options: Options = { channel: 'production' };
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    const value = args[++i];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
    if (flag === '--channel' && ['production', 'beta', 'preview'].includes(value)) options.channel = value as Channel;
    else if (flag === '--app') options.app = path.resolve(value);
    else if (flag === '--data-dir') options.dataDir = path.resolve(value);
    else throw new Error(`Unknown option or channel: ${flag} ${value}`);
  }
  return options;
}

export function selectPackagedApp(options: Options, root = REPO_ROOT, applications = '/Applications') {
  const identity = resolveBuildIdentity(options.channel);
  const output = path.join(root, 'dist', options.channel === 'preview' ? 'preview' : '');
  const candidates = options.app ? [options.app] : [
    path.join(output, process.arch === 'arm64' ? 'mac-arm64' : 'mac', `${identity.productName}.app`),
    path.join(applications, `${identity.productName}.app`),
  ];
  const appPath = candidates.find(candidate => fs.existsSync(candidate));
  if (!appPath) throw new Error(`No ${options.channel} app found. Build it or pass --app <path>. Checked: ${candidates.join(', ')}`);
  const appDir = path.join(appPath, 'Contents/Resources/app');
  const metadata = readBuildManifest(appDir);
  if (metadata.channel !== options.channel || metadata.productName !== identity.productName || metadata.appId !== identity.appId) {
    throw new Error(`App identity does not match requested ${options.channel} channel: ${appPath}`);
  }
  const executable = path.join(appPath, 'Contents/MacOS', metadata.productName);
  if (!fs.statSync(executable).isFile()) throw new Error(`Missing app executable: ${executable}`);
  fs.accessSync(executable, fs.constants.X_OK);
  const profile = options.dataDir || process.env.APACK_USER_DATA_DIR;
  const context = resolveAppEnvironment({ env: options.channel, ...(profile ? { userDataDir: path.resolve(profile) } : {}) });
  const logsDir = profile ? path.join(context.appDir, 'logs') : path.join(os.homedir(), 'Library/Logs', context.appName);
  return { appPath, appDir, executable, metadata, context, logsDir, isolated: Boolean(profile) };
}
export type PackagedApp = ReturnType<typeof selectPackagedApp>;

/** Match this bundle's processes literally; another channel or an unrelated node process stays running. */
export async function stopPackagedApp(app: PackagedApp) {
  const rows = execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' }).split('\n');
  const stopped: number[] = [];
  for (const row of rows) {
    const match = row.trim().match(/^(\d+)\s+(.+)$/);
    if (match && Number(match[1]) !== process.pid && match[2].startsWith(`${app.appPath}/Contents/`)) {
      try { process.kill(Number(match[1]), 'SIGTERM'); stopped.push(Number(match[1])); } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
      }
    }
  }
  const deadline = Date.now() + 5000;
  while (stopped.some(pid => {
    try { process.kill(pid, 0); return true; } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
      return false;
    }
  })) {
    if (Date.now() >= deadline) throw new Error('App processes are still running; close the selected app and retry.');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

export function resetTargets(app: PackagedApp): string[] {
  const targets = [app.context.userDataDir, app.logsDir];
  if (!app.isolated) targets.push(path.join(os.homedir(), 'Library/Preferences', `${app.metadata.appId}.plist`));
  for (const target of targets) {
    const resolved = path.resolve(target);
    if ([path.parse(resolved).root, os.homedir(), REPO_ROOT, app.appPath].some(protectedPath =>
      protectedPath === resolved || protectedPath.startsWith(resolved + path.sep))) {
      throw new Error(`Refusing to reset protected directory: ${target}`);
    }
  }
  return [...new Set(targets)];
}

export async function startPackagedApp(app: PackagedApp, logFile: string): Promise<number> {
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const log = fs.createWriteStream(logFile);
  const env = { ...process.env };
  if (app.isolated) env.APACK_USER_DATA_DIR = app.context.userDataDir;
  else delete env.APACK_USER_DATA_DIR;
  delete env.ELECTRON_RUN_AS_NODE;
  return new Promise((resolve, reject) => {
    const child = spawn(app.executable, [], { env, stdio: ['inherit', 'pipe', 'pipe'] });
    child.stdout.on('data', chunk => { process.stdout.write(chunk); log.write(chunk); });
    child.stderr.on('data', chunk => { process.stderr.write(chunk); log.write(chunk); });
    const forward = () => child.kill('SIGTERM');
    process.once('SIGINT', forward);
    process.once('SIGTERM', forward);
    const cleanup = () => { process.removeListener('SIGINT', forward); process.removeListener('SIGTERM', forward); };
    child.once('error', error => { cleanup(); log.end(); reject(error); });
    child.once('close', (code, signal) => { cleanup(); log.end(() => resolve(code ?? (signal === 'SIGINT' ? 130 : 143))); });
    log.once('error', error => { child.kill('SIGTERM'); reject(error); });
  });
}

/** Run every assessment and retain failures rather than letting a later success hide them. */
export function verifyPackagedSigning(app: PackagedApp,
  run: (command: string, args: string[]) => void = (command, args) => {
    execFileSync(command, args, { stdio: 'inherit', timeout: 30000 });
  }): string[] {
  const failures: string[] = [];
  for (const [label, command, args] of [
    ['Code signature', 'codesign', ['--verify', '--deep', '--strict', '--verbose=2', app.appPath]],
    ['Notarization staple', 'xcrun', ['stapler', 'validate', app.appPath]],
    ['Gatekeeper', 'spctl', ['--assess', '--type', 'exec', '--verbose', app.appPath]],
  ] as const) {
    console.log(label);
    try { run(command, [...args]); }
    catch (error) { failures.push(`${label}: ${String(error)}`); }
  }
  return failures;
}
