import type { ElectronApplication, Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { availableParallelism, cpus, hostname, release, totalmem } from 'node:os';
import path from 'node:path';
import { manifestSchema, type PerformanceManifest, type PerformanceTrial } from './report.ts';

/** Only untracked records declared by the execution owner may be excluded; tracked edits always count. */
export function classifySourceFiles(trackedDiff: Buffer, untracked: readonly string[], records: readonly string[]) {
  const declared = new Set(records);
  const excludedUntracked = untracked.filter(file => declared.has(file)).sort();
  const authoredUntracked = untracked.filter(file => !declared.has(file)).sort();
  return { dirty: trackedDiff.length > 0 || authoredUntracked.length > 0, authoredUntracked, excludedUntracked };
}

const digest = (input: string | Buffer) => createHash('sha256').update(input).digest('hex');
/** Build identities are hashes of actual output bytes, collected outside the measured interval. */
function treeIdentity(root: string) {
  const hash = createHash('sha256');
  const visit = (relative: string) => {
    const absolute = path.join(root, relative);
    if (statSync(absolute).isDirectory()) {
      for (const name of readdirSync(absolute).sort()) visit(path.join(relative, name));
    } else {
      hash.update(relative).update('\0').update(readFileSync(absolute)).update('\0');
    }
  };
  visit('');
  return { path: root, sha256: hash.digest('hex') };
}

export function performanceIdentity(options: Pick<PerformanceManifest, 'fixture' | 'mode' | 'cache' | 'warmups'> & { runtime?: Record<string, string> }, root = process.cwd()) {
  const records = JSON.parse(process.env.APACK_EXECUTION_RECORDS ?? '{"source":[],"native":[]}') as { source: string[]; native: string[] };
  if (![records.source, records.native].every(paths => Array.isArray(paths) && paths.every(file => typeof file === 'string' && /^\.apack-[a-z0-9.-]+$/.test(file)))) throw new Error('Invalid execution record declarations');
  const git = (args: string[], cwd = root) => execFileSync('git', args, { cwd });
  const diff = git(['diff', '--binary', 'HEAD']);
  const untracked = (cwd: string) => git(['ls-files', '--others', '--exclude-standard', '-z'], cwd).toString().split('\0').filter(Boolean);
  const source = classifySourceFiles(diff, untracked(root), records.source);
  const sourceHash = createHash('sha256').update(diff);
  for (const file of source.authoredUntracked) sourceHash.update(file).update('\0').update(readFileSync(path.join(root, file)));
  const limit = (file: string) => { try { return readFileSync(`/sys/fs/cgroup/${file}`, 'utf8').trim(); } catch { return undefined; } };
  const cpuLimit = limit('cpu.max')?.split(' ');
  const cpuCount = cpuLimit && cpuLimit[0] !== 'max' ? Math.min(availableParallelism(), Number(cpuLimit[0]) / Number(cpuLimit[1])) : availableParallelism();
  const memoryLimit = Number(limit('memory.max'));
  const builds = ['packages/api/dist', 'packages/main/dist', 'packages/preload/dist', 'packages/renderer/dist', 'packages/default-setup/dist']
    .map(directory => ({ ...treeIdentity(path.join(root, directory)), path: directory }));
  const nativeRoot = path.join(root, 'vendor/elmdb');
  const native = path.join(nativeRoot, 'crates/elmdb-node');
  const nativeSource = classifySourceFiles(git(['diff', '--binary', 'HEAD'], nativeRoot), untracked(nativeRoot), records.native);
  const bindings = readdirSync(native).filter(file => file.endsWith('.node')).sort();
  if (bindings.length === 0) throw new Error('No elmdb native binding found for the performance manifest');
  for (const file of bindings) builds.push({ path: `vendor/elmdb/crates/elmdb-node/${file}`, sha256: digest(readFileSync(path.join(native, file))) });
  return manifestSchema.parse({
    format: 1, source: { revision: git(['rev-parse', 'HEAD']).toString().trim(), dirty: source.dirty, excludedUntracked: source.excludedUntracked, diffSha256: sourceHash.digest('hex') },
    builds, ...options, native: { pin: readFileSync(path.join(root, 'vendor/elmdb.rev'), 'utf8').trim(),
      checkoutRevision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: native }).toString().trim(),
      dirty: nativeSource.dirty, excludedUntracked: nativeSource.excludedUntracked },
    runtime: { node: process.versions.node, v8: process.versions.v8, osRelease: release(), ...options.runtime },
    machine: { platform: process.platform, arch: process.arch, cpus: Math.ceil(cpuCount), memoryBytes: Number.isFinite(memoryLimit) && memoryLimit > 0 ? Math.min(totalmem(), memoryLimit) : totalmem(),
      identity: digest(JSON.stringify({ hostname: process.env.APACK_PERFORMANCE_MACHINE_ID ?? hostname(), model: cpus()[0]?.model })) },
    clock: 'Local monotonic durations; cross-process epoch alignment is approximate',
  });
}

/** Actual target identity, sampled outside action timing without starting browser instrumentation. */
export async function rendererProcessId(application: ElectronApplication, page: Page): Promise<number> {
  const window = await application.browserWindow(page);
  try {
    const id = await window.evaluate(window => window.webContents.getOSProcessId());
    if (!Number.isSafeInteger(id) || id <= 0) throw Error('Renderer process identity is unavailable');
    return id;
  } finally { await window.dispose(); }
}

/** Preserve a captured business result when target identity becomes unavailable during teardown. */
export async function attachRendererProcessIdentity(application: ElectronApplication, page: Page, report: Pick<PerformanceTrial['processes'][string], 'processId' | 'complete' | 'rendererResourceFailures'>): Promise<void> {
  try { report.processId = await rendererProcessId(application, page); }
  catch { report.rendererResourceFailures = (report.rendererResourceFailures ?? 0) + 1; report.complete = false; }
}
