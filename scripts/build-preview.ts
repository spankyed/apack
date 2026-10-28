#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBuildSession, readBuildManifest } from '../build/build-metadata.ts';
import { boundedSpawn } from './lib/bounded-spawn.ts';
import { TIMEOUT_MS } from './lib/step-timeouts.ts';
import { previewEnvironment, previewVersion } from './lib/preview-build.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (process.argv.includes('--help')) {
  console.log('Usage: npm run build:preview -- --version <x.y.z>\nBuilds unsigned apack Preview locally in dist/preview, without publishing or changing release metadata.');
} else {
  const env = previewEnvironment(previewVersion(process.argv.slice(2)), process.env);
  env.APACK_BUILD_ROOT = createBuildSession(env);
  const metadata = readBuildManifest(env.APACK_BUILD_ROOT);
  const platform = process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'win' : 'linux';
  const commands: [string, string[]][] = [
    ['npm', ['run', 'generate:entries', '-w', '@app/default-setup']],
    ['npm', ['run', 'build:default-setup']],
    ['npm', ['run', 'build:runtime']],
  ];
  if (process.platform === 'darwin') commands.push(['npm', ['run', 'build:speech-macos']]);
  commands.push(
    ['npx', ['electron-rebuild', '--only', 'node-pty']],
    ['npx', ['electron-builder', 'build', '--config', 'electron-builder.mjs', '--dir', '--publish', 'never', `--${platform}`, `--${process.arch}`]],
  );
  console.log(`Building ${metadata.productName} ${metadata.version}`);
  for (const [command, args] of commands) {
    console.log(`\n${command} ${args.join(' ')}`);
    const result = await boundedSpawn(command, args, TIMEOUT_MS.scenario.ms, { cwd: root, env, stream: true });
    if (result.code !== 0) throw new Error(`${command} ${args.join(' ')} failed${result.timedOut ? ' (timed out)' : ''}`);
  }
  console.log('\nPreview built in dist/preview. It keeps its own data in apack-preview.');
}
