import * as fs from 'node:fs';
import * as path from 'node:path';
import { connect } from 'node:net';
import { resolveAppEnvironment, appDataDirFor, type AppChannel } from '@apackdev/sdk/env';
import { findRunningApp } from '@apackdev/host/database';
import { readApiEndpoint } from '@apackdev/host/process-liveness';
import { API_HOST, errorMessage } from '@apackdev/sdk/utils/pure';
import { parseAppChannel } from '../utils';
import { validateAppBundle } from '../app/installed-app';
import { PRODUCT_NAMES } from '../app/channels';

export function doctorChannel(args: string[]): AppChannel {
  const { channel, args: rest } = parseAppChannel(args);
  if (rest.length) throw new Error('Usage: apack doctor [--channel production|beta|preview] [--json]');
  return channel;
}

function reachable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const socket = connect({ host: API_HOST, port });
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
  probe?: (port: number) => Promise<boolean>;
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
    const running = findRunningApp(context);
    const endpoint = readApiEndpoint(context.apiPortFile);
    if (!running && !endpoint) return 'app is closed; API check skipped';
    if (!endpoint) throw new Error(`${running?.why}; no live API endpoint`);
    if (!await (options.probe ?? reachable)(endpoint.port)) throw new Error(`API port ${endpoint.port} is unreachable`);
    return `API listener reachable on port ${endpoint.port} (pid ${endpoint.pid})`;
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
    console.log('Usage: apack doctor [--channel production|beta|preview] [--json]\n\nInspect the installed production app, its data directory, and its API listener if running. --channel beta selects beta. Nothing is launched or modified. Pack checks are apack pack doctor.');
    return;
  }
  const jsonFlags = args.filter(arg => arg === '--json');
  if (jsonFlags.length > 1) throw new Error('Specify --json once.');
  const channel = doctorChannel(args.filter(arg => arg !== '--json'));
  if (process.platform !== 'darwin') throw new Error('Installed app diagnostics currently support macOS only.');
  await inspectApp(channel, { json: jsonFlags.length === 1 });
}
