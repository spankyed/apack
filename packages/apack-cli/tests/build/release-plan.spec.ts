import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import getReleasePlan from '@changesets/get-release-plan';
import { satisfies } from 'semver';
import { afterEach, describe, expect, it } from 'vitest';
import { REPO_ROOT } from '@apackdev/host/build/packages-built';

/** The versions Changesets assigns the published packages, from the repo's manifests and config. */
const PUBLISHED = { 'apack-sdk': '@apackdev/sdk', 'apack-ui': '@apackdev/ui', 'apack-cli': '@apackdev/cli', 'apack-testing': '@apackdev/testing' };

let scratch: string | undefined;
afterEach(() => {
  if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
  scratch = undefined;
});

async function releasePlan(changeset: string): Promise<Record<string, string>> {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-release-plan-'));
  // The scratch repo mirrors this one's `workspaces` rather than restating it: changesets resolves the
  // workspaces from that field, so a fixture that hardcodes it stops being a fixture of this repo the day
  // the field moves — and the copy loop below would then be walking a directory the plan never reads.
  const { workspaces } = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf-8')) as
    { workspaces: string[] };
  fs.writeFileSync(path.join(scratch, 'package.json'), JSON.stringify({ name: 'root', private: true, workspaces }));
  fs.mkdirSync(path.join(scratch, '.changeset'));
  fs.copyFileSync(path.join(REPO_ROOT, '.changeset', 'config.json'), path.join(scratch, '.changeset', 'config.json'));
  fs.writeFileSync(path.join(scratch, '.changeset', 'change.md'), changeset);
  // Every workspace manifest: private workspace packages depend on the published ones too. Walked from the
  // globs above, so the fixture holds whatever the field names.
  for (const glob of workspaces) {
    const under = glob.replace(/\/\*$/, '');
    for (const dir of fs.readdirSync(path.join(REPO_ROOT, under))) {
      if (!fs.existsSync(path.join(REPO_ROOT, under, dir, 'package.json'))) continue;
      fs.mkdirSync(path.join(scratch, under, dir), { recursive: true });
      fs.copyFileSync(path.join(REPO_ROOT, under, dir, 'package.json'), path.join(scratch, under, dir, 'package.json'));
    }
  }
  const plan = await getReleasePlan(scratch);
  return Object.fromEntries(plan.releases.filter((r) => r.name.startsWith('@apackdev/') && r.name !== '@apackdev/host').map((r) => [r.name, r.newVersion]));
}

describe('release plan', () => {
  it("keeps every peer range on a sibling wide enough for the group's next version", () => {
    // Changesets gives a peer dependent a *major* bump when the version its peer moves to falls
    // outside the declared range (onlyUpdatePeerDependentsWhenOutOfRange), and the fixed group
    // then carries that major to all four packages — before 1.0 that is a jump straight to 1.0.0.
    // So a range like "~0.1.0" or "^0.1.0" on a sibling, however right it looks for a 0.x package,
    // turns the group's next minor into a major release. It has to admit that version.
    for (const [dir, name] of Object.entries(PUBLISHED)) {
      const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'packages', dir, 'package.json'), 'utf-8'));
      const [major, minor] = (pkg.version as string).split('.').map(Number);
      for (const [peer, range] of Object.entries(pkg.peerDependencies ?? {} as Record<string, string>)) {
        if (!Object.values(PUBLISHED).includes(peer)) continue;
        const next = major > 0 ? `${major}.${minor + 1}.0` : `0.${minor + 1}.0`;
        expect(
          satisfies(next, range as string),
          `${name}'s peer range on ${peer} ("${range}") excludes ${next}, the version the fixed group moves to next, so a minor change would release all four as ${major + 1}.0.0`,
        ).toBe(true);
      }
    }
  });

  it('a minor SDK change moves the fixed group one minor, not to 1.0.0', async () => {
    const current = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'packages', 'apack-sdk', 'package.json'), 'utf-8')).version as string;
    const [major, minor] = current.split('.').map(Number);
    const next = `${major}.${minor + 1}.0`;
    const versions = await releasePlan(`---\n'@apackdev/sdk': minor\n---\n\nA change\n`);
    expect(versions).toEqual(Object.fromEntries(Object.values(PUBLISHED).map((name) => [name, next])));
  });
});
