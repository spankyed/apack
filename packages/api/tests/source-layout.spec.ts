// The API is a shell around @apackdev/host, and its folders are the jobs it does: `boot/` starts the process,
// `runtime/` opens this process's resources and binds the app, `transport/` is the wire to the renderer, and
// `adapters/` implements what the host's code is given. The renderer's tree says the same of itself
// (`packages/renderer/tests/source-layout.spec.ts`), with `views/` added, so the two read alike and a concept found
// in one is looked for in the same place in the other.
//
// A folder named for a layer rather than a job — core, shared, lib, utils, common, helpers — takes whatever nobody
// placed: `core/shared/debug/` held the log output, three words deep, for one importer. This says a new file belongs
// to one of the jobs, and that app runtime belongs in @apackdev/host rather than here at all.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { population } from '@apackdev/sdk/testing';

const SRC = path.resolve(__dirname, '..', 'src');

/** The jobs this package does, one folder each */
const JOBS = ['adapters', 'boot', 'runtime', 'transport'];

/** What may sit at the root of src/: the entry node runs, and the types entry */
const ROOT_FILES = ['server.ts', 'types.ts'];

/**
 * **Every read of the tree goes through a guard**, because each case below filters it for offenders and
 * asserts the result is empty: a folder named for a layer, a spec left in `src/`, a `.vue` where none
 * belongs. That shape passes for nothing when the read found no files, so a renamed or moved `src/` would
 * read as the layout holding rather than as a check with no subject.
 */
const read = <T>(what: string, xs: T[]): T[] => [...population(`${what} in api/src`, xs)];

const entries = () => read('entries',
  fs.readdirSync(SRC, { withFileTypes: true }).filter((e) => !e.name.startsWith('.')));

describe('packages/api/src', () => {
  it('holds one folder per job, and no folder named for a layer', () => {
    const folders = entries().filter((e) => e.isDirectory()).map((e) => e.name).sort();

    expect(folders, 'app runtime belongs in @apackdev/host; a new folder here is a new job').toEqual(JOBS);
  });

  it('keeps at its root only the entry and the types entry', () => {
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

  it('keeps its tests in tests/, as every other package does', () => {
    const inSrc = read('paths', fs.readdirSync(SRC, { recursive: true, encoding: 'utf-8' }))
      .map(String)
      .filter((f) => f.includes('__tests__') || /\.(spec|test)\.[cm]?[jt]sx?$/.test(f));

    expect(inSrc).toEqual([]);
  });

  it('renders nothing: no .vue here', () => {
    const vue = read('paths', fs.readdirSync(SRC, { recursive: true, encoding: 'utf-8' })).map(String).filter((f) => f.endsWith('.vue'));

    expect(vue, 'views are the renderer\'s').toEqual([]);
  });
});
