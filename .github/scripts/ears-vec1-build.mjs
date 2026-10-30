// Platform qualification delegates to the candidate's ordinary native source build.
// This does not certify packaged loading, signing or performance acceptance.
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(process.argv[2] ?? '.temp/sqlite-platform/native-generation');
const builder = fileURLToPath(new URL('../../native/vectors/build.mjs', import.meta.url));
execFileSync(process.execPath, [builder, root, ...process.argv.slice(3)], { stdio: 'inherit' });
const file = join(root, 'provenance.json');
const result = JSON.parse(readFileSync(file, 'utf8'));
result.source = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
result.patchApplied = true;
result.qualification = 'Pinned membership patch for the SQLite candidate; packaging, signing and performance remain separate gates';
writeFileSync(file, JSON.stringify(result, null, 2) + '\n');
if (process.env.GITHUB_ENV) appendFileSync(process.env.GITHUB_ENV, 'EARS_VEC1_EXTENSION=' + result.extension + '\n');
