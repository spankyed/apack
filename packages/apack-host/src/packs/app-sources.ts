import * as fs from 'node:fs';
import * as path from 'node:path';
import { PACK_ID_PATTERN } from '@apackdev/sdk/ids';
import { errorMessage } from '@apackdev/sdk/utils/pure';
import { PACK_LAYOUT, readBuiltPackSource } from './layout.ts';
import type { AppPackSource, AppPackSourceProblem, AppPackSources } from './catalog-types.ts';

export type { AppPackSource, AppPackSourceProblem, AppPackSources } from './catalog-types.ts';

/** Read all app-shipped advertisements without activation or writes; ambiguous ids have no winner. */
export function readAppPackSources(root: string): AppPackSources {
  if (!fs.existsSync(root)) return { sources: [], problems: [] };
  const sources: AppPackSource[] = [];
  const problems: AppPackSourceProblem[] = [];
  const claims = new Map<string, string[]>();
  for (const entry of fs.readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const dir = path.join(root, entry.name);
    const manifest = path.join(dir, PACK_LAYOUT.manifest);
    if (!fs.existsSync(manifest)) continue;
    let id = entry.name;
    try {
      const hint: unknown = JSON.parse(fs.readFileSync(manifest, 'utf8'));
      if (hint && typeof hint === 'object' && 'id' in hint && typeof hint.id === 'string' && PACK_ID_PATTERN.test(hint.id)) id = hint.id;
      const captured = readBuiltPackSource(dir);
      id = captured.snapshot.manifest.id;
      sources.push({ id, dir, ...captured });
    } catch (error) {
      problems.push({ id, dir, message: errorMessage(error) });
    }
    claims.set(id, [...claims.get(id) ?? [], dir]);
  }
  const ambiguous = new Set<string>();
  for (const [id, dirs] of claims) {
    if (dirs.length < 2) continue;
    ambiguous.add(id);
    for (const dir of dirs) problems.push({ id, dir, message: `Duplicate app-shipped pack "${id}" in ${dirs.join(' and ')}` });
  }
  return { sources: sources.filter(source => !ambiguous.has(source.id)), problems };
}
