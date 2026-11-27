import * as fs from 'node:fs';
import * as path from 'node:path';
import { connect } from 'node:net';
import { resolveAppEnvironment, appDataDirFor, type AppChannel } from '@apackdev/sdk/env';
import { findRunningApp } from '@apackdev/host/database';
import { inspectApiRuntime } from '@apackdev/host/transport/tool-client';
import { runtimeFilePath } from '@apackdev/host/transport/tool-socket';
import { errorMessage } from '@apackdev/sdk/utils/pure';
import { parseAppChannel } from '../utils';
import { validateAppBundle } from '../app/installed-app';
import { PRODUCT_NAMES } from '../app/channels';

export function doctorChannel(args: string[]): AppChannel {
  const { channel, args: rest } = parseAppChannel(args);
  if (rest.length) throw new Error('Usage: apack doctor [--channel production|beta|preview] [--json]');
  return channel;
}

function socketReachable(socketPath: string): Promise<boolean> {
  return new Promise(resolve => {
    const socket = connect(socketPath);
    const finish = (ok: boolean) => { socket.destroy(); resolve(ok); };
    socket.setTimeout(2_000, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

/** Read-only diagnostics. Tests supply temporary installation and data paths. */
export async function inspectApp(channel: AppChannel, options: {
  applications?: string;
  dataDir?: string;
  probeSocket?: (socket: string) => Promise<boolean>;
  json?: boolean;
} = {}): Promise<void> {
  const product = PRODUCT_NAMES[channel];
  const bundle = path.join(options.applications ?? '/Applications', `${product}.app`);
  const context = resolveAppEnvironment({ env: channel, userDataDir: options.dataDir ?? appDataDirFor(channel) });
  const checks: { label: string; ok: boolean; message: string }[] = [];
  const check = async (label: string, run: () => string | Promise<string>) => {
    try { checks.push({ label, ok: true, message: await run() }); }
    catch (error) { checks.push({ label, ok: false, message: errorMessage(error) }); }
  };

  await check('Installation', () => {
    const version = validateAppBundle(bundle, channel);
    return `${version} — ${bundle}`;
  });
  await check('Data directory', () => {
    if (!fs.existsSync(context.userDataDir)) return `${context.userDataDir} (not created yet)`;
    if (!fs.statSync(context.userDataDir).isDirectory()) throw new Error(`Not a directory: ${context.userDataDir}`);
    fs.accessSync(context.userDataDir, fs.constants.R_OK | fs.constants.W_OK | fs.constants.X_OK);
    return context.userDataDir;
  });
  await check('Runtime', async () => {
    const runtime = inspectApiRuntime(context.appDir);
    if (runtime.status === 'live') {
      const { pid, socket } = runtime.record;
      if (socket !== undefined) {
        if (!await (options.probeSocket ?? socketReachable)(socket)) {
          throw new Error(`API tool socket ${socket} is unreachable`);
        }
        return `API tool socket reachable at ${socket} (pid ${pid})`;
      }
      return `API running (pid ${pid}; no local socket)`;
    }
    if (runtime.status === 'corrupt') {
      throw new Error(`API runtime record (${runtimeFilePath(context.appDir)}) is unreadable`);
    }
    const running = findRunningApp(context);
    if (!running) return 'app is closed; API check skipped';
    if (runtime.status === 'stale') {
      throw new Error(`${running.why}; stale API runtime record (pid ${runtime.record.pid})`);
    }
    throw new Error(`${running.why}; no live API runtime record`);
  });
  const failures = checks.filter(check => !check.ok).length;
  if (options.json) console.log(JSON.stringify({ channel, healthy: failures === 0, checks }));
  else {
    console.log(`${product} health check\n`);
    for (const check of checks) console.log(`  ${check.ok ? '✓' : '✗'} ${check.label}: ${check.message}`);
  }
  if (failures) throw new Error(`App health check failed: ${failures} check(s).`);
}

export async function doctor(args: string[]): Promise<void> {
  if (args.includes('--help') || args.includes('-h')) {
    console.log('Usage: apack doctor [--channel production|beta|preview] [--json]\n\nInspect the installed production app, its data directory, and its API runtime if running. --channel beta selects beta. Nothing is launched or modified. Pack checks are apack pack doctor.');
    return;
  }
  const jsonFlags = args.filter(arg => arg === '--json');
  if (jsonFlags.length > 1) throw new Error('Specify --json once.');
  const channel = doctorChannel(args.filter(arg => arg !== '--json'));
  if (process.platform !== 'darwin') throw new Error('Installed app diagnostics currently support macOS only.');
  await inspectApp(channel, { json: jsonFlags.length === 1 });
}
