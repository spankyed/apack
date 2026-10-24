import assert from 'node:assert/strict';
import { access, mkdir, open } from 'node:fs/promises';
assert.equal(process.platform, 'linux', 'Only the owned Linux container may install this fixture');
await access('/.dockerenv');
assert.equal(process.getuid?.(), 0, 'Install before dropping to the owned node user');
const policy = { allowManagedHooksOnly: true, statusLine: { type: 'command', command: "/usr/bin/printf 'Managed OS policy ready\\nManaged source has priority\\n'" } };
await mkdir('/etc/claude-code', { mode: 0o755 });
const file = await open('/etc/claude-code/managed-settings.json', 'wx', 0o644);
try { await file.writeFile(JSON.stringify(policy) + '\n'); } finally { await file.close(); }
