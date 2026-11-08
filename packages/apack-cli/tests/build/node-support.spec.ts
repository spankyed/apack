// The Node the pack compiler needs, and why a number rather than a probe.
//
// The capability is "does this Node's synchronous module-hook validator accept the nullish CommonJS
// `source` the asynchronous default load returns" — and there is no way to ask that without
// registering both kinds of hook and loading a CommonJS module, which is a build. So the floor is a
// version, and what keeps a version honest is this: the refusing case names the exact Node that
// failed, and the manifest case holds the number to what npm is told.
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { COMPILER_NODE_FLOOR, assertNodeSupportsCompiler } from '../../src/build/node-support.ts';

describe('which Node the pack compiler runs on', () => {
  // The firing case, and it is not hypothetical: `apack pack build` on Node 24.11.0 — the floor this
  // repo declared — died with ERR_INVALID_RETURN_PROPERTY_VALUE from inside a captured bundle, on
  // Windows and on a Mac alike. Node 24.12.0 builds the same pack unchanged.
  it('refuses the Node that could not build a pack, naming it and the floor', () => {
    expect(() => assertNodeSupportsCompiler('24.11.0')).toThrow(/needs Node 24\.12\.0 or newer/);
    expect(() => assertNodeSupportsCompiler('24.11.0')).toThrow(/this is Node 24\.11\.0/);
  });

  it('refuses every older line too, however far back', () => {
    for (const version of ['23.11.1', '22.15.0', '24.0.0', '24.11.99']) {
      expect(() => assertNodeSupportsCompiler(version), version).toThrow(/pack compiler needs Node/);
    }
  });

  it('accepts the floor itself and everything after it', () => {
    for (const version of [COMPILER_NODE_FLOOR, '24.12.1', '24.22.2', '25.0.0', '30.1.2']) {
      expect(() => assertNodeSupportsCompiler(version), version).not.toThrow();
    }
  });

  // Nothing else reads `process.versions.node` for this, so the default is the whole of how the guard
  // applies to a real run
  it('asks about this process when given nothing', () => {
    expect(() => assertNodeSupportsCompiler()).not.toThrow();
  });

  /**
   * npm is the other half: `engines.node` is what an external pack author's install reads, and it said
   * `^22.15.0 || >=23.5.0` while the compiler needed 24.12.0 — three whole major lines where the CLI
   * installed cleanly and then failed inside a module hook.
   */
  it('tells npm the same floor it enforces', () => {
    const root = path.join(import.meta.dirname, '..', '..');
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as {
      name: string; engines?: { node?: string };
    };

    expect(manifest.name, 'read the wrong manifest, so the comparison below means nothing').toBe('@apackdev/cli');
    expect(manifest.engines?.node).toBe(`>=${COMPILER_NODE_FLOOR}`);
  });
});
