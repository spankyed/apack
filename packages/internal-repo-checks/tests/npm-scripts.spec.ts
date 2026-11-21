// What a step's command reaches, which is read by a cache key and by a safety scan.
//
// `reachableText` has two consumers and they fail differently: `commandText` turns its `invoked` set into
// part of every step's fingerprint, where being wrong is **silent**, and `check:tiers` searches its `text`
// for the ways this repo launches the app, where being wrong is a finding someone reads. So the set it
// returns is worth asserting directly rather than through either.
//
// The scanner is given synthetic script maps here. `workspaceScripts` reads the real `packages/` tree, so a
// made-up workspace resolves to no body — which is immaterial: what these cases are about is *which* script
// each call is attributed to, and that is `invoked`.
import { describe, expect, it } from 'vitest';
import { population } from '@apackdev/sdk/testing';
import { CHAIN_STEPS } from '../../../scripts/lib/chain-steps.ts';
import { reachableText, rootScripts, workspaceScripts } from '../../../scripts/lib/npm-scripts.ts';

describe('reachableText', () => {
  it('attributes a workspace call to the workspace, and reads every flag in its tail', () => {
    const all = { a: 'npm run t --workspace @apackdev/cli --workspace @apackdev/testing' };
    expect([...reachableText('a', all).invoked]).toEqual(['a', '@apackdev/cli:t', '@apackdev/testing:t']);
  });

  /**
   * The firing case: a call's tail stops at a command separator.
   *
   * A shell line holds several commands, and a tail that ran to the newline read one command's `-w` as
   * belonging to an earlier command's script name — so `npm run b && npm run c -w ws` reported `ws:b`,
   * never walked root `b`, and never found `ws:c`. Both halves of that reach a cache key.
   */
  it('does not read one command\'s workspace flag as another command\'s', () => {
    const all = { a: 'npm run b && npm run c -w @app/renderer', b: 'echo b', c: 'echo c' };
    expect([...reachableText('a', all).invoked]).toEqual(['a', 'b', '@app/renderer:c']);
  });

  it('walks a root call, which is one with no workspace in its tail', () => {
    const all = { a: 'npm run b', b: 'echo b' };
    expect([...reachableText('a', all).invoked]).toEqual(['a', 'b']);
  });

  /**
   * And over the real manifest: every workspace-scoped entry names a script that workspace **has**.
   *
   * This is the case that would have caught the separator bug without anyone looking for it — a
   * misattributed call produces a `<workspace>:<script>` pair for a script that exists nowhere, and a
   * fingerprint built from it names work the step does not do while omitting work it does.
   */
  it('names only workspace scripts that exist', () => {
    const all = rootScripts();
    const scoped = CHAIN_STEPS.flatMap((step) => [...reachableText(step.name, all).invoked]
      .filter((entry) => entry.includes(':@') || /^@[\w/-]+:/.test(entry))
      .map((entry) => ({ step: step.name, entry })));

    expect(population('workspace-scoped invocations', scoped).length).toBeGreaterThan(2);
    const absent = scoped.filter(({ entry }) => {
      const at = entry.indexOf(':');
      const workspace = entry.slice(0, at);
      const script = entry.slice(at + 1);
      return workspaceScripts(workspace)?.[script] === undefined;
    });
    expect(absent, 'a step\'s key names a workspace script that does not exist, so the call was misread')
      .toEqual([]);
  });
});
