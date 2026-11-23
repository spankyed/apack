import { spawnSync } from 'node:child_process';

// A full run uses fresh app builds and bypasses the integration pool's cache.
// Keep suites serial: each runner owns its worker budget and app fixtures.
const steps = [
  ['packages:ensure'],
  ['packs:stage'],
  ['build:runtime'],
  ['test:unit'],
  ['test:integration', '--', '--all'],
  ['test:e2e'],
  ['test:external-pack'],
  ['test:packaged-authoring'],
];

if (process.argv.length > 2) {
  console.error('npm test runs every suite. For filters, use npm run test:e2e -- <filter> or npm run spec -- <target>.');
  process.exitCode = 1;
} else {
  for (const args of steps) {
    console.log(`\n→ npm run ${args.join(' ')}`);
    const result = spawnSync('npm', ['run', ...args], {
      cwd: new URL('..', import.meta.url),
      stdio: 'inherit',
    });
    if (result.error) console.error(result.error.message);
    if (result.status !== 0) {
      process.exitCode = result.status ?? 1;
      break;
    }
  }
}
