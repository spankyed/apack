/**
 * Which workspaces a package imports, read from its own `package.json`.
 *
 * One mechanism, two readers, because they are answering the same question from opposite ends. The chain
 * asks it to build a cache key: a suite compiles its `@apackdev` dependencies from source (the
 * `@apackdev/source` condition), so their source is genuinely that suite's input. `npm run spec` asks it to
 * decide what a change can reach that the *module graph* cannot see — a pack's specs import a dependency's
 * published `dist`, never its source, so no import edge runs from the source you edited to the spec that
 * covers it, and only a rebuild puts one there.
 *
 * Derived rather than listed, so a dependency added later is covered the moment it is declared.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { REPO_ROOT } from '@apackdev/host/build/packages-built';

/**
 * Every workspace, as a directory name under `packages/`, derived so a new one is covered by default.
 *
 * Exported because a spec that asserts *which* packages reach a pack suite has to enumerate all of them or
 * it proves nothing: the first version of that check listed nine of the twelve by hand, looked exhaustive,
 * and missed `apack-host` — which reaches `@app/default-setup` transitively through `@apackdev/testing` and
 * made the count in three doc comments wrong.
 *
 * **Read from the `workspaces` field, not from a listing of `packages/`.** Those agree only while the field
 * is exactly `["packages/*"]`, and seven places in this repo assumed they always would. A walk of a directory
 * cannot name a workspace that is not in it, so the miss would be silent — which is why a glob this cannot
 * represent throws here instead. The names are bare rather than repo-relative because every consumer joins
 * them to `packages/`; the day a workspace lives elsewhere, this refuses rather than dropping it, and that is
 * the change to make then.
 *
 * The refusal is pure and pinned by `workspace-dirs.spec.ts`, which is the only way it gets watched failing:
 * the throw here runs at module load of something the chain and `npm run spec` both import.
 */
export function workspaceDirsFrom(workspaces: readonly string[], root = REPO_ROOT): string[] {
  if (workspaces.length === 0) throw new Error('package.json declares no workspaces, so there is nothing to derive');
  const outside = workspaces.filter((glob) => glob !== 'packages/*');
  if (outside.length > 0) {
    throw new Error(`workspace-deps only reads the glob \`packages/*\`, and package.json declares `
      + `${outside.join(', ')}. Every consumer of PACKAGE_DIRS joins a bare name to packages/, so those `
      + `workspaces would be dropped silently — give it repo-relative paths and migrate the consumers.`);
  }
  return fs.readdirSync(path.join(root, 'packages'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(root, 'packages', entry.name, 'package.json')))
    .map((entry) => entry.name)
    .sort();
}

export const PACKAGE_DIRS = workspaceDirsFrom(
  (JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf-8')) as { workspaces?: readonly string[] })
    .workspaces ?? []);

/** Every workspace package's npm name and where it lives, so a declared dependency can become a path */
/** Package name → its directory under `packages/`, which is how a specifier is recognised as a workspace */
export const DIR_BY_PACKAGE = new Map<string, string>(PACKAGE_DIRS.map((dir) => [
  (JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'packages', dir, 'package.json'), 'utf-8')) as { name: string }).name,
  dir,
]));

/**
 * Workspace dependencies that are **not compile edges**: what a spawned process needs present, not what this
 * package's code imports. Keyed `<dir> <package>`, because the subject is the pair.
 *
 * Electron's main process reaches every other part of the app by literal path —
 * `path.join(process.resourcesPath, 'app', 'packages', 'api')`, a `{path: string}` handed to `WindowManager`
 * for the preload bundle and the renderer — and runs the CLI through a launcher that names
 * `Resources/app/packages/apack-cli/dist/package/bin/apack.mjs`. There is no `require.resolve` in
 * `packages/main/src` at all. So these declarations resolve nothing and compile nothing; what they do is put
 * each spawned process's **own dependency tree** into the packaged app, since electron-builder walks the app
 * manifest's production closure and the app manifest is the repo root's, which depends on `@app/main`.
 *
 * Reading them as compile edges cost `typecheck:main` 195 of its 1868 declared files — against 52 that are
 * main's own source — so a CLI or renderer edit re-ran a leg that compiles neither.
 *
 * **Narrowing a cache key is the dangerous direction, and `findUnimportedDependencies` is what makes it
 * safe** (`scripts/check-import-specifiers.ts`, run by `check:specifiers`). It reads every file in the
 * package and reports both directions from this one map: an entry whose package something has started
 * importing, and an entry no manifest declares any more. That reach is the point — it covers the tests and
 * the root configs, where the alternative does not.
 *
 * The dep file is a second witness and a narrower one, which is worth knowing before leaning on it: an
 * import from `main`'s *source* puts the imported files into `main.tsbuildinfo` and
 * `dep-files.integration.spec.ts` fails, but `packages/main/tsconfig.json` excludes every spec file, so its
 * build info speaks for `src` alone and three of these four entries name a package a dep file lists only as
 * files rather than by name.
 */
export const RUNTIME_ONLY_DEPS = new Map<string, string>([
  ['packages/main @app/api', 'main spawns it as a child process from a path it builds itself; the declaration '
    + "is what puts the API's own dependencies in the packaged app"],
  ['packages/main @app/preload', 'main hands the preload bundle to each window as a path; its tsconfig maps '
    + 'the name for that path and nothing imports it'],
  ['packages/main @app/renderer', "main loads the renderer's built output by path, or a dev-server URL"],
  ['packages/main @apackdev/cli', 'the packaged app ships the CLI, and the launcher runs it from '
    + 'Resources/app/packages rather than from node_modules'],
]);

/**
 * The workspaces a package imports, transitively, as directory names under `packages/`.
 *
 * `root` is a parameter rather than the module's `REPO_ROOT` because `spec-plan.ts` takes one and its whole
 * premise is that the routing is a pure function of its inputs; a helper that silently read a different root
 * than the caller was given is a trap for the first spec that points it at a fixture tree.
 *
 * **devDependencies count.** `@app/default-setup` reaches `@apackdev/testing` that way, and what imports the
 * harness is the pack's own specs, so it is genuinely an input.
 *
 * **So do peerDependencies**, for the same reason read the other way round: `@apackdev/ui` declares
 * `@apackdev/sdk` as a peer, the only workspace package in this repo declared that way, and under the
 * `@apackdev/source` condition its typecheck compiles that source and what the SDK imports behind it. A peer is a
 * statement about who installs the package, not about who compiles it. The dep-file gate is what found
 * this: it read 24 files of the SDK's EARS, then a workspace, in `apack-ui`'s own build info.
 */
export function workspaceDeps(dir: string, root = REPO_ROOT, seen = new Set<string>([dir])): string[] {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'packages', dir, 'package.json'), 'utf-8')) as {
    dependencies?: Record<string, string>; devDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
  };
  const found: string[] = [];
  for (const name of Object.keys({ ...manifest.dependencies, ...manifest.devDependencies, ...manifest.peerDependencies })) {
    const child = DIR_BY_PACKAGE.get(name);
    // A process dependency is not an input: see `RUNTIME_ONLY_DEPS`
    if (RUNTIME_ONLY_DEPS.has(`packages/${dir} ${name}`)) continue;
    if (!child || seen.has(child)) continue;
    seen.add(child);
    found.push(child, ...workspaceDeps(child, root, seen));
  }
  return found;
}

/** A dependency contributes its source; another package's specs are not this suite's input */
export const dependencySource = (pkg: string): string[] => [`packages/${pkg}/src`, `packages/${pkg}/package.json`];
