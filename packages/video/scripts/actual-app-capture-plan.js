import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(packageDir, '..', '..');
const manifestPath = path.join(packageDir, 'src/agentbuddy-ui/ACTUAL_APP_REFERENCES.md');

const manifest = await fs.readFile(manifestPath, 'utf8');
const rows = manifest
  .split('\n')
  .filter(line => line.startsWith('|') && !line.includes('---'))
  .map(line => line.split('|').map(cell => cell.trim()))
  .filter(cells => cells[1] && cells[1] !== 'Surface');

const missing = [];

for (const cells of rows) {
  const surface = cells[1];
  const evidence = backtickValues(cells[2] ?? '');
  const targets = backtickValues(cells[3] ?? '');
  if (evidence.includes('NO_RENDERER_EQUIVALENT')) continue;

  const unresolved = evidence.filter(ref => ref === 'NEEDS_SCREENSHOT' || ref.startsWith('conversation:'));
  const missingTargets = [];

  for (const target of targets) {
    if (target === 'NO_RENDERER_EQUIVALENT') continue;
    const fullPath = path.join(repoRoot, target);
    if (!(await exists(fullPath))) missingTargets.push(target);
  }

  if (unresolved.length || missingTargets.length) {
    missing.push({surface, unresolved, missingTargets});
  }
}

if (missing.length === 0) {
  console.log('All actual-app captures are present and durable.');
  process.exit(0);
}

console.log(`# Actual App Capture Plan\n`);
console.log(`Strict fidelity still needs ${missing.reduce((sum, item) => sum + item.missingTargets.length, 0)} local capture file(s) across ${missing.length} surface(s).\n`);
console.log(`Capture real AgentBuddy UI as PNG files at these exact paths:\n`);

for (const item of missing) {
  console.log(`## ${item.surface}`);
  if (item.unresolved.length) {
    console.log(`Evidence to replace: ${item.unresolved.join(', ')}`);
  }
  for (const target of item.missingTargets) {
    console.log(`- ${target}`);
  }
  console.log('');
}

console.log('After captures are saved, replace matching `conversation:*` or `NEEDS_SCREENSHOT` entries in `packages/video/src/agentbuddy-ui/ACTUAL_APP_REFERENCES.md` with the local file paths, then run:');
console.log('');
console.log('npm run audit:fidelity:strict --workspace @app/video');

function backtickValues(value) {
  return [...value.matchAll(/`([^`]+)`/g)].map(match => match[1]);
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
