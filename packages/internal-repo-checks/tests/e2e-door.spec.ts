// A spec reaches a backend system through the fixture's `app.send` and `app.ask`, never through the renderer's door
// those two call (`window.__e2eSystems`, `packages/renderer/src/transport/e2e-door.ts`).
//
// The door has one caller so that it can change under the suites without any spec noticing. A spec calling it
// declares the door's type again for itself, and loses what the fixture adds: the pack under test's names resolved
// to refs, and an ask's wait lasting as long as the app works rather than a fixed time. The door before this one
// was called from twelve files, five of them declaring its type and three reaching it through `any`, and none
// could receive an answer, which is how a spec came to re-send a request every half second to learn whether it
// had worked.
//
// Here rather than in a suite of the renderer or `@apackdev/testing`, because its subject is every tracked file:
// a spec anywhere in the repo, or in a pack beside it, is what it is about.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from '@apackdev/host/build/packages-built';
import { repoFiles } from './_support/repo-files.ts';

/** What names the door, and why each one may */
const DOOR_OWNERS: Record<string, string> = {
  'packages/renderer/src/transport/e2e-door.ts': 'the door itself',
  'packages/renderer/src/main.ts': 'puts the door on the window',
  'packages/apack-testing/src/index.ts': "the fixture, whose `app.send` and `app.ask` are the door's one caller",
  'packages/internal-repo-checks/tests/e2e-door.spec.ts': 'this check, which names the door to look for it',
};

const DOOR = '__e2eSystems';

/** Source a spec or a module could call the door from; prose about it is not a call */
const CODE = /\.(?:[cm]?[jt]s|tsx|vue)$/;

/** The files among `files` whose text names the door */
function namingTheDoor(files: ReadonlyArray<{ readonly file: string; readonly text: string }>): string[] {
  return files.filter(({ text }) => text.includes(DOOR)).map(({ file }) => file).sort();
}

describe('the E2E door to the backend systems', () => {
  it('is named by its owners and nothing else', () => {
    const files = repoFiles().filter((file) => CODE.test(file) && !file.startsWith('docs/archive/'))
      .map((file) => ({ file, text: fs.readFileSync(path.join(REPO_ROOT, file), 'utf8') }));
    // Equal rather than a subset, so an owner that stopped naming the door — a rename this was not told of — fails
    // here instead of leaving the check comparing against a name nothing uses
    expect(namingTheDoor(files), `a spec sends with app.send and asks with app.ask (@apackdev/testing); `
      + `only ${Object.keys(DOOR_OWNERS).join(', ')} name ${DOOR}`).toEqual(Object.keys(DOOR_OWNERS).sort());
  });

  it('reports a spec that calls the door, and passes one that calls the fixture', () => {
    expect(namingTheDoor([
      { file: 'tests/e2e/ui/reaching-past.spec.ts', text: "await appPage.evaluate(() => (window as any).__e2eSystems.send('default-setup/notes', { type: 'SEND_STATE' }));" },
      { file: 'tests/e2e/ui/through-the-fixture.spec.ts', text: "await app.send('default-setup/notes', { type: 'SEND_STATE' });" },
    ])).toEqual(['tests/e2e/ui/reaching-past.spec.ts']);
  });
});
