// Packages the app's install holds exactly one copy of, and the refusal when it holds more.
//
// **EARS is reached through the SDK, and the SDK is shared**, so one SDK loads one EARS — as long as the install has
// one. Two copies are two modules: an `EarsError` one throws is not an instance of the other's, and the engine the app
// binds is reached through one while a package that brought its own reads the other. `elmdb` is EARS' exact peer and
// the native binding under it, which two copies would load twice. Nothing a bundler decides keeps a second copy out:
// npm does, by how it lays out the install. So this is asked of installs, both the checkout's
// (`scripts/lib/installed-dependencies.ts`, before the chain runs) and a packaged app's (`verify-node-modules.mjs`).

/** Packages the app's install must hold one copy of */
export const SINGLE_COPY_PACKAGES = ['@elmdb/ears', 'elmdb'];

/**
 * One refusal per single-copy package `copies` holds more than one of. `copies` is each installed package's name and
 * what identifies its copy (its real directory, or the target a link points at), so two links to one directory are one
 * copy; `where` names each place it was found, as the refusal lists them.
 *
 * @param {ReadonlyArray<{ name: string; copy: string; where: string }>} copies
 * @returns {string[]}
 */
export function extraCopies(copies) {
  return SINGLE_COPY_PACKAGES.flatMap((name) => {
    const found = copies.filter((entry) => entry.name === name);
    const distinct = new Set(found.map((entry) => entry.copy));
    if (distinct.size <= 1) return [];
    return [`${name} is installed ${distinct.size} times (${found.map((entry) => entry.where).join(', ')}): the app loads `
      + 'one through @apackdev/sdk, and a second is a second module whose errors and engine the first does not know. '
      + 'Make every range that names it resolve to the one copy (npm dedupe, or align the ranges npm split it over)'];
  });
}
