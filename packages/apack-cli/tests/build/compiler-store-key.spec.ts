// Which store entry a captured compiler installation belongs in.
//
// The store is machine-wide and shared on purpose: one copy per input means macOS assesses the runtime and
// the compiler's executables once rather than per build. What it cannot be shared across is *checkouts*,
// because a capture files every source under its absolute path (`capturedPathIn`) and the replay resolves it
// there. So the key has to name the checkout, and these cases are about the one axis that nearly went
// missing: two trees whose contents agree.
import { describe, expect, it } from 'vitest';
import { compilerStoreKey } from '../../src/build/compiler-installation.ts';

const parts = {
  directory: '/Users/me/Develop/apack/monorepo/packages/apack-cli',
  inputsHash: 'graph-hash',
  runtimeHash: 'runtime-hash',
  executableId: '{"esbuild":"0.25.0"}',
};

describe('the compiler store entry a capture belongs in', () => {
  it('is the same for the same checkout and the same inputs, which is what sharing one copy means', () => {
    expect(compilerStoreKey(parts)).toBe(compilerStoreKey({ ...parts }));
  });

  // The firing case. Two worktrees of one repository have the same `package-lock.json`, so the graph, the
  // runtime and the esbuild selection all agree — and keyed on those alone they agreed on the entry too.
  // The second then replayed a tree holding the first one's paths and the build failed on a module it could
  // see on disk and not in the capture, naming neither checkout.
  it('differs between two checkouts whose inputs are identical', () => {
    const other = { ...parts, directory: '/Users/me/Develop/apack/worktrees/other/packages/apack-cli' };

    expect(compilerStoreKey(other)).not.toBe(compilerStoreKey(parts));
  });

  it('still differs when any one input moves', () => {
    const keys = [
      compilerStoreKey(parts),
      compilerStoreKey({ ...parts, inputsHash: 'another graph' }),
      compilerStoreKey({ ...parts, runtimeHash: 'another runtime' }),
      compilerStoreKey({ ...parts, executableId: '{"esbuild":"0.25.1"}' }),
    ];

    expect(new Set(keys).size, 'two inputs share an entry, so one would replay the other').toBe(keys.length);
  });

  it('is a store entry name, which the store recognises as one', () => {
    // `isStoreEntry` reads a directory in the store by this shape, and the prune walks what it answers
    expect(compilerStoreKey(parts)).toMatch(/^[0-9a-f]{16}$/);
  });
});
