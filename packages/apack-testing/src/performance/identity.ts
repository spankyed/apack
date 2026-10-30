import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { availableParallelism, cpus, hostname, release, totalmem } from 'node:os';
import path from 'node:path';
import { manifestSchema, type PerformanceManifest } from './report.ts';

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
  const git = (args: string[]) => execFileSync('git', args, { cwd: root });
  const diff = git(['diff', '--binary', 'HEAD']);
  const untracked = git(['ls-files', '--others', '--exclude-standard']).toString().trim().split('\n').filter(Boolean).sort();
  const sourceHash = createHash('sha256').update(diff);
  for (const file of untracked) sourceHash.update(file).update('\0').update(readFileSync(path.join(root, file)));
  const limit = (file: string) => { try { return readFileSync(`/sys/fs/cgroup/${file}`, 'utf8').trim(); } catch { return undefined; } };
  const cpuLimit = limit('cpu.max')?.split(' ');
  const cpuCount = cpuLimit && cpuLimit[0] !== 'max' ? Math.min(availableParallelism(), Number(cpuLimit[0]) / Number(cpuLimit[1])) : availableParallelism();
  const memoryLimit = Number(limit('memory.max'));
  const builds = ['packages/api/dist', 'packages/main/dist', 'packages/preload/dist', 'packages/renderer/dist', 'packages/default-setup/dist']
    .map(directory => ({ ...treeIdentity(path.join(root, directory)), path: directory }));
  const native = path.join(root, 'vendor/elmdb/crates/elmdb-node');
  const bindings = readdirSync(native).filter(file => file.endsWith('.node')).sort();
  if (bindings.length === 0) throw new Error('No elmdb native binding found for the performance manifest');
  for (const file of bindings) builds.push({ path: `vendor/elmdb/crates/elmdb-node/${file}`, sha256: digest(readFileSync(path.join(native, file))) });
  return manifestSchema.parse({
    format: 1, source: { revision: git(['rev-parse', 'HEAD']).toString().trim(), dirty: diff.length > 0 || untracked.length > 0, diffSha256: sourceHash.digest('hex') },
    builds, ...options, native: { pin: readFileSync(path.join(root, 'vendor/elmdb.rev'), 'utf8').trim(),
      checkoutRevision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: native }).toString().trim(),
      dirty: execFileSync('git', ['status', '--porcelain'], { cwd: native }).length > 0 },
    runtime: { node: process.versions.node, v8: process.versions.v8, osRelease: release(), ...options.runtime },
    machine: { platform: process.platform, arch: process.arch, cpus: Math.ceil(cpuCount), memoryBytes: Number.isFinite(memoryLimit) && memoryLimit > 0 ? Math.min(totalmem(), memoryLimit) : totalmem(),
      identity: digest(JSON.stringify({ hostname: process.env.APACK_PERFORMANCE_MACHINE_ID ?? hostname(), model: cpus()[0]?.model })) },
    clock: 'Local monotonic durations; cross-process epoch alignment is approximate',
  });
}
