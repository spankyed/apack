// The renderer is a shell around @apackdev/host, and its folders are the jobs it does: `boot/` starts the window,
// `runtime/` makes this window's resources and binds the frontend port, `transport/` is the wire to the API,
// `adapters/` implements the ports the host's machines take, and `views/` renders. The API's tree says the same of
// itself (`packages/api/tests/source-layout.spec.ts`), so the two read alike and a concept found in one is
// looked for in the same place in the other.
//
// A folder named for a layer rather than a job — core, shared, lib, utils, common, helpers — takes whatever nobody
// placed, which is how `core/` came to hold the client, the binding, the toast, the types and the layout components
// at once. This says a new file belongs to one of the five jobs, so where it goes is a question with an answer.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { population } from '@apackdev/sdk/testing';

const SRC = path.resolve(import.meta.dirname, '..', 'src');

/** The jobs this package does, one folder each */
const JOBS = ['adapters', 'boot', 'runtime', 'transport', 'views'];

/** What may sit at the root of src/: the entry the window loads, the types, and what a bundler needs there */
const ROOT_FILES = ['main.ts', 'types.ts', 'electron.d.ts', 'web-env.d.ts', 'style.css'];

/**
 * **Every read of the tree goes through a guard**, because each case below filters it for offenders and
 * asserts the result is empty: a folder named for a layer, a spec left in `src/`, a `.vue` where none
 * belongs. That shape passes for nothing when the read found no files, so a renamed or moved `src/` would
 * read as the layout holding rather than as a check with no subject.
 */
const read = <T>(what: string, xs: T[]): T[] => [...population(`${what} in renderer/src`, xs)];

const entries = () => read('entries',
  fs.readdirSync(SRC, { withFileTypes: true }).filter((e) => !e.name.startsWith('.')));

describe('packages/renderer/src', () => {
  it('holds one folder per job, and no folder named for a layer', () => {
    const folders = entries().filter((e) => e.isDirectory()).map((e) => e.name).sort();

    expect(folders, 'a new folder here is a new job: put the file under the job it does').toEqual(JOBS);
  });

  it('keeps at its root only the entry, the types and what a bundler needs there', () => {
    const files = entries().filter((e) => e.isFile()).map((e) => e.name).sort();

    expect(files).toEqual([...ROOT_FILES].sort());
  });

  it('names no folder for a layer, at any depth', () => {
    const dirs = read('paths', fs.readdirSync(SRC, { recursive: true, withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => ({ name: e.name, path: path.relative(SRC, path.join(e.parentPath ?? e.path, e.name)) }));

    // `core/shared/debug/` was three of these deep: the rule is only worth anything below the top level too
    const LAYER_NAMES = ['core', 'shared', 'lib', 'libs', 'utils', 'util', 'common', 'helpers', 'misc'];
    const named = dirs.filter((d) => LAYER_NAMES.includes(d.name)).map((d) => d.path);

    expect(named, 'name a folder for what is in it, not for the layer it sits in').toEqual([]);
  });

  it('keeps its tests in tests/, mirroring src/, as every other package does', () => {
    const inSrc = read('paths', fs.readdirSync(SRC, { recursive: true, encoding: 'utf-8' }))
      .map(String)
      .filter((f) => f.includes('__tests__') || /\.(spec|test)\.[cm]?[jt]sx?$/.test(f));

    expect(inSrc, 'a spec goes in tests/, under the path of what it tests').toEqual([]);
  });

  // A view reads a machine's state (useSelector) and sends it events; the machine itself is the host's, so the app's
  // own behaviour can't drift back here one component at a time
  it('defines no state machine in views/', () => {
    const defined = fs.readdirSync(path.join(SRC, 'views'), { recursive: true }).map(String)
      .filter((f) => /\.(vue|ts)$/.test(f))
      .filter((f) => /createMachine|\bsetup\(\{/.test(fs.readFileSync(path.join(SRC, 'views', f), 'utf8')));

    expect(defined, "a view renders: its machine belongs in @apackdev/host/fe, which every frontend gets").toEqual([]);
  });

  it('renders in views/ only: no .vue outside it', () => {
    const vue = read('paths', fs.readdirSync(SRC, { recursive: true, encoding: 'utf-8' })).map(String).filter((f) => f.endsWith('.vue'));

    expect(vue.filter((f) => !f.startsWith('views/'))).toEqual([]);
  });
});
