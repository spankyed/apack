import { _declarationRevision } from '@apackdev/pack-format';
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { PACK_SNAPSHOT_FORMAT } from '@apackdev/pack-format';
import { findDepFiles, releasesInRange, type GitHubRelease } from '../../src/commands/fetch-deps';

const release = (tag: string): GitHubRelease => ({ tag_name: tag, assets: [] });

describe('releasesInRange', () => {
  it('lists the releases satisfying the range, newest first', () => {
    const releases = [release('v1.0.0'), release('v1.2.0'), release('v2.0.0')];
    expect(releasesInRange(releases, '^1.0.0').map((r) => r.version)).toEqual(['1.2.0', '1.0.0']);
  });

  it('matches prereleases, so a pack whose only releases are betas resolves', () => {
    expect(releasesInRange([release('v0.2.0-beta.0')], '*')[0]?.version).toBe('0.2.0-beta.0');
    expect(releasesInRange([release('v1.1.0-beta.2')], '^1.0.0')[0]?.version).toBe('1.1.0-beta.2');
  });

  it('ignores tags that are not semver, and lists none when nothing matches', () => {
    expect(releasesInRange([release('nightly'), release('v3.0.0')], '^1.0.0')).toEqual([]);
  });
});

describe('dependency build reading', () => {
  it.each(['valid', 'malformed', 'unsafe-name'])('validates snapshot data without loading runtime code: %s', mode => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'snapshot-reader-'));
    try {
      fs.mkdirSync(path.join(dir, 'types'));
      fs.mkdirSync(path.join(dir, 'runtime'));
      fs.writeFileSync(path.join(dir, 'runtime', 'index.cjs'), 'throw new Error("runtime was executed");');
      fs.writeFileSync(path.join(dir, 'types', 'snapshot.json'), JSON.stringify({ declarationRevision: _declarationRevision({ id: 'fixture-pack', name: 'Fixture', version: '1.0.0' }),
        format: PACK_SNAPSHOT_FORMAT,
        manifest: { id: 'fixture-pack', name: 'Fixture', version: '1.0.0' },
        types: { entities: {}, relKinds: {}, roles: {} }, entityDestinations: {}, facades: mode === 'malformed' ? { 'pack-types': false } : mode === 'unsafe-name' ? { '../escape': 'export {};' } : {},
      }));
      const before = fs.readFileSync(path.join(dir, 'types', 'snapshot.json'), 'utf-8');
      if (mode !== 'valid') expect(() => findDepFiles(dir)).toThrow(mode === 'malformed' ? 'facades.pack-types' : 'Facade names');
      else expect(findDepFiles(dir)?.snapshot.manifest.id).toBe('fixture-pack');
      expect(fs.readFileSync(path.join(dir, 'types', 'snapshot.json'), 'utf-8')).toBe(before);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});
