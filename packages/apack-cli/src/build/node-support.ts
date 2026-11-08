import { compareVersions } from '@apackdev/sdk/utils/compare-versions';

/**
 * The oldest Node the pack compiler runs on, and the one fact behind the number.
 *
 * A build installs both kinds of module hook at once: `module.register()` for the off-thread source
 * hooks that serve captured bytes, and `module.registerHooks()` for the owned resolver that keeps
 * resolution inside the captured tree. Node's asynchronous default `load` returns a nullish `source`
 * for a CommonJS module deliberately, so that the CommonJS loader fetches it again — and before
 * 24.12.0 the synchronous hook chain's validator rejected that result, blaming whichever
 * `registerHooks` hook passed it through. What a pack author saw was
 * `ERR_INVALID_RETURN_PROPERTY_VALUE: Expected a string, an ArrayBuffer, or a TypedArray to be
 * returned for the "source" from the "load" hook but got undefined`, thrown from inside a captured
 * bundle, naming no pack, no file and nothing to do. 24.12.0 accepts it
 * (Node's `validateSourcePermissive`), which is the whole of the difference.
 *
 * `@apackdev/cli`'s `engines.node` says the same thing to npm, and
 * `tests/build/node-support.spec.ts` holds the two to each other.
 */
export const COMPILER_NODE_FLOOR = '24.12.0';

/**
 * Refuses a Node the compiler cannot run on, naming the version and the fix.
 *
 * It is here rather than in the bin because this is what needs it: a command that reads a manifest or
 * lists packs works on any Node the CLI installs on, and refusing those too would be a floor nothing
 * measured.
 */
export function assertNodeSupportsCompiler(version: string = process.versions.node): void {
  if (compareVersions(version, COMPILER_NODE_FLOOR) >= 0) return;
  throw new Error(
    `The pack compiler needs Node ${COMPILER_NODE_FLOOR} or newer; this is Node ${version}. `
    + 'Older module hooks reject the CommonJS load result the compiler\'s own hooks pass through, '
    + 'which fails the build from inside a module hook rather than in your pack. '
    + 'Install Node 24 LTS and build again.',
  );
}
