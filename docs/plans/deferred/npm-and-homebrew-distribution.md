# npm and Homebrew distribution

Status: npm publication and Homebrew activation are deferred as of 2026-10-11. The local Homebrew
repository is scaffolded. Resume publication when the public APIs have settled enough to support external
consumers; revisit in a few weeks, rather than treating elapsed time as permission to publish.

## Outcome

Publish the five public packages under `@apackdev`, then distribute the `apack` CLI through a public
GitHub repository named `homebrew-apack`. The application and executable remain named `apack`.

Expected installation, assuming the tap remains under `spankyed`:

```sh
brew install spankyed/apack/apack
```

An upstream tap provides an installation path under our account. It does not reserve the unqualified
`apack` name in Homebrew's official catalog. Submission to `homebrew/core` is a separate future decision.

## Already completed

- Package names, imports, manifests, lockfile, templates, CI and docs use `@apackdev`.
- Changesets versions the five public packages as one fixed group.
- The build produces publishable trees and the consumer tests install their package tarballs.
- The CLI and testing bundles inline required private host code. `@apackdev/host` stays private.
- The built-in pack no longer runs codegen during dependency installation. Clean installation followed
  by package building and explicit codegen was verified in an isolated checkout.
- Publishing documentation points to staged packages rather than workspace directories.
- PR #237 is merged. The repository check chain passed for these changes.
- The local `../homebrew-apack` Git repository is scaffolded with a README, MIT license, activation
  checklist, inactive `templates/apack.rb`, and CI that installs/tests the formula once activated.
  Ruby syntax and workflow YAML were checked. No active formula, GitHub repository or publication exists.

These checks establish the current baseline; rerun them against the code and toolchain at resumption.

The [external-pack release readiness plan](external-pack-release-readiness.md) owns the pack author's
release commands, scaffolded GitHub workflow, upload/recovery behavior and external release smoke check.
Coordinate its public package/host prerequisites with this plan; local tarball consumer tests do not
establish registry availability. Neither public workstream blocks the settings/contracts goal's
required local packaged-authoring and isolated app/runtime acceptance.

## Conditions for resuming

1. Review the public exports, CLI behavior and scaffolded project dependencies. Resolve known API changes
   before creating external consumers; choose and document the first supported package version.
2. Establish a versioning and compatibility policy for published packages. Revisit the root
   `CLAUDE.md` assumption that there are no external consumers before the first npm publication.
3. Verify control of the `@apackdev` npm organization and publishing rights for all five packages.
4. Obtain an explicit decision to publish. This plan records deferred work, not authorization to publish
   later automatically.
5. Publish `elmdb` first. `@apackdev/ears` depends on it as `file:../../vendor/elmdb/crates/elmdb-node`, a
   checkout's link (`vendor/elmdb.rev` pins the commit), and `elmdb` is `0.0.0` on no registry: a published
   `@apackdev/ears` would name a dependency no consumer can install. elmdb's binding needs napi-rs's per-platform
   packages (one prebuilt binary each, as its CI matrix builds them) and a version, and then `@apackdev/ears` and
   `packages/api` depend on that version rather than the link.

## 1. Prepare and verify npm publication

Publish these packages through the existing package publisher:

| Package | Staging directory | Purpose |
|---|---|---|
| `@apackdev/ears` | `packages/apack-ears/publish` | Store engine used by the SDK |
| `@apackdev/sdk` | `packages/apack-sdk/publish` | Pack API; depends on ears |
| `@apackdev/ui` | `packages/apack-ui/publish` | Pack UI components |
| `@apackdev/testing` | `packages/apack-testing/dist/package` | Pack test harness and fixtures |
| `@apackdev/cli` | `packages/apack-cli/dist/package` | The `apack` executable |

Review [the package workflow](../../../.github/workflows/publish-packages.yml),
[the publisher](../../../scripts/publish-packages.ts), and
[the Changesets configuration](../../../.changeset/config.json) against the current toolchain.

- Confirm supported Node/npm versions and package versions are consistent.
- Configure publishing credentials. Prefer trusted publishing once configured; verify the first-publish
  bootstrap procedure at resumption. A GitHub OIDC endpoint being present does not prove npm has authorized
  that workflow. Correct the workflow's credential check and its misleading comments before enabling it.
- Check publication order: dependencies must be available before dependent packages. A partial failure
  must be recoverable without overwriting an already published version.
- Run `npm run chain`, then exercise the existing workflow with publication disabled. Inspect the packed
  file lists, exports, executable, templates, license and dependency versions.
- Verify installation outside this repository: `apack --help`, `apack --version`, scaffold a pack,
  install its dependencies, build it, and run its generated tests. Verify project-local CLI handoff.

After the publication decision, publish the five packages and repeat the consumer checks using npm
registry packages rather than local tarballs. Record the published versions and corresponding source
revision. Do not publish the private host or application workspaces.

## 2. Activate the existing Homebrew scaffold

The local Git repository already exists at `/Users/spankyed/Develop/Projects/homebrew-apack`.
Continue there rather than creating another scaffold. Its current contents are:

```text
Formula/.gitkeep
templates/apack.rb
README.md
ACTIVATION.md
LICENSE
.gitignore
.github/workflows/test.yml
```

The files are uncommitted, with no remote configured. `Formula/` deliberately contains no active formula.
The template carries `RELEASE_VERSION` and `RELEASE_SHA256` placeholders. CI checks template syntax now;
installation, audit and formula tests only run after `Formula/apack.rb` exists. Syntax validation does not
establish that installation works.

The scaffold README, MIT license, activation checklist and CI are complete. Initial CI targets Apple
Silicon macOS (`macos-14`); installation support remains unverified. No GitHub repository, npm package
or Homebrew formula was published during scaffolding.

### Remaining activation work

Use the tap's `ACTIVATION.md` as the detailed checklist. After npm publication:

1. Retrieve the exact published CLI tarball and calculate its SHA-256.
2. Resolve dependency locking and native installation as described below.
3. Copy `templates/apack.rb` to `Formula/apack.rb`, replace release placeholders, and complete the
   installation recipe. Its current `std_npm_args` recipe is provisional.
4. Run style/audit checks, install locally, and run formula and external consumer tests.
5. Update the README to reflect activation and verified platforms. Commit the reviewed files, create
   the public `spankyed/homebrew-apack` GitHub repository, and push when publication is authorized.
6. Verify installation from the hosted tap and an upgrade/uninstall cycle. Add other platforms only
   after their checks pass.

The activated formula must install a specific published `@apackdev/cli` version into Homebrew's private `libexec`,
declares its Node runtime dependency, and exposes only `apack` on PATH. Keep CLI source and package
building in this repository; the tap contains the formula and its validation.

Before activating the formula, check Homebrew's current Node packaging guidance. Pin the release
archive and SHA-256, and use a reproducible dependency installation procedure. Pinning only the top-level
CLI version is insufficient when its transitive dependency ranges can resolve differently later.
Determine how the formula records the dependency lock and handles native dependencies such as `lmdb`
and `esbuild` on the platforms we support. Prefer an upstream `npm-shrinkwrap.json` shipped in the CLI
tarball; otherwise design and verify a checksummed dependency-lock resource. Review any lifecycle
scripts required by native dependencies before enabling them, and declare required build tools.

The template currently tests version/help output and scaffolding with the correct dependency names.
Add a functional check that exercises native-backed behavior before declaring Node/runtime compatibility.

Test installation from the tap, executable/version output, a scaffold-and-build consumer flow, upgrade
and uninstall behavior. Start with the macOS architectures we actually verify; add Linux support when
its installation and consumer tests pass. Document the supported platforms in the tap README.

The README should show installation and `brew upgrade` instructions. The formula test and CI must fail
on broken installation. The CLI must not replace its own Homebrew-managed installation; the existing
command that upgrades the desktop application is a separate operation.

## 3. Maintain releases

Initially, update the formula's version, archive URL, checksum and dependency lock through a reviewed
PR after each npm release passes registry consumer checks. Add automatic tap PR creation only after the
first manual update succeeds. A failed tap update should be retryable without republishing npm packages.

Keep native executable compilation, independent CLI versioning, additional registries and official
Homebrew catalog submission outside this first delivery.

## Completion criteria

- All five public packages install from npm at the intended version.
- A fresh external project can scaffold, build and test using those packages.
- `brew install spankyed/apack/apack` works on documented platforms and exposes the intended version.
- A subsequent verified CLI version can be distributed through a formula update.
- Publishing access, supported versions, compatibility expectations and update steps are documented.
