# Goal: ship default-setup from its own repository

**Status — active.** The standalone pack is published. The app cutover has merged into
`separate-default-setup`, and the workspace removal is the final feature-branch change.

## Prompt

```text
Finish the default-setup migration in docs/goals/goal-independent-default-setup.md.
Follow CLAUDE.md and docs/AGENTS.md. Use the current handoff and feature-branch worktrees.
Ship a verified external starter, preserve profile choices, and support an alternate or empty
distribution. Run focused checks while working and the strict chain after cleanup. Leave
separate-default-setup ready for the owner’s final PR to master.
```

## Current handoff

- The standalone [default-setup v0.1.0 release](https://github.com/spankyed/default-setup/releases/tag/v0.1.0)
  came from [default-setup #1](https://github.com/spankyed/default-setup/pull/1) and used the
  [authoring toolchain from apack #622](https://github.com/spankyed/apack/releases/tag/toolchain-4d3ad7b9a43355cda3c0d6d33b859048895d7cca).
- [apack #624](https://github.com/spankyed/apack/pull/624) pins the release. The pinned payload
  passed macOS beta, Linux production, and Windows production packaging checks. The macOS preview
  loaded the starter offline. The preceding pack-aware build supplied the disposable upgrade profiles.
- The cleanup branch removes the old workspace and its build steps. Its closing check is the strict
  chain on the app-only tree. Keep release pins and the workspace removal separately reviewable.

## Branches and review

| Work | Repository | PR base |
|---|---|---|
| App packaging and host changes | [apack #610–617](https://github.com/spankyed/apack/pulls?q=is%3Apr+base%3Aseparate-default-setup) | `separate-default-setup` |
| Standalone release toolchain | [apack #622](https://github.com/spankyed/apack/pull/622) | `separate-default-setup` |
| Production pack transfer | [default-setup #1](https://github.com/spankyed/default-setup/pull/1) | `main` |
| Published release pin | [apack #624](https://github.com/spankyed/apack/pull/624) | `separate-default-setup` |
| Workspace removal | apack · `session/starter-remove-workspace` | `separate-default-setup` |
| Integrated migration | apack · `separate-default-setup` | `master` |

The owner authorized merging #622, default-setup #1, the cutover and the cleanup after their
checks pass, and authorized publishing the toolchain and first standalone release. The owner
controls the final PR to `master`.

## Decisions

1. **The distributor chooses the starter in one lockfile.** The proposed `build/shipped-packs.lock.json` supports zero, one or several packs. An entry pins the ID, exact version, asset location, SHA-256 and digest of any separately retrieved redistribution evidence. A pin change shows the versions, digests and upstream source diff. Official-product docs and tests may name `default-setup`. Runtime behavior uses pack IDs supplied as data, registered roles and user installation records.
2. **The app embeds the same archive a user installs.** The producer owns the CLI-generated archive, checksum, integrity metadata, component inventory and license texts. The build retrieves pinned bytes into a digest-keyed cache, checks cache hits, extracts into fresh staging, verifies the receipt, identity, host range, format, unique IDs and dependency closure, then publishes the complete selection to the build session. Package the verified layouts under `resources/app/shipped-packs/<id>/`. First launch installs from disk. A missing selected asset fails the build; an explicit empty list succeeds. Keep the download digest separate from the published-file revision used to decide profile refresh. [Archive producer](../../packages/apack-cli/src/commands/archive.ts) · [Pack layout and revision](../../packages/apack-host/src/packs/layout.ts)
3. **The profile owns its choices.** The owner approved this rule for a change of official starter from A to B. Fresh profiles get B. Existing profiles keep their setup and are offered B for explicit opt-in. This includes people who disabled A, removed A, or installed a fork at A's ID. Seed a fresh profile once, including an empty selection. Continue refreshing eligible app-managed IDs while preserving disablement. If a distribution drops an ID, retain its installed copy and data and show its update status. Explicit Restore resumes app management for an offered ID. Existing tests cover several per-ID cases. Phase 2 owns the A-to-B transition. [Installer](../../packages/apack-host/src/packs/installer.ts) · [Shipped-pack tests](../../packages/apack-host/tests/packs/shipped-packs.spec.ts)
4. **A role can move between IDs. Data and named dependencies have owners.** Preserve entities, settings overrides, applied-content history and migration progress. A fork taking the same ID takes responsibility for understanding that data. A different-ID pack owns its explicit import or conversion. A pack declaring a dependency on the old ID still needs a compatible provider of that ID. Surface missing dependencies and conflicting roles so the user can recover. Reverting a pin requires a separate assessment of any data migration already applied. [Role registry](../../packages/apack-host/src/packs/extensions.ts) · [Persistent app state](../../packages/apack-host/src/app-state/index.ts)
5. **An independent pack can build against an independently obtainable toolchain.** Use versioned SDK, UI, CLI and testing packages, with immutable release tarballs as an interim source if needed. For a breaking change, build the candidate toolchain and an empty-selection host first. Build the candidate pack, test that exact host/pack pair, then promote the tested inputs. Exercise routine host changes against the currently released starter. Reuse the existing package and pack publishers. [Toolchain distribution plan](../plans/deferred/npm-and-homebrew-distribution.md) · [Pack release plan](../plans/deferred/external-pack-release-readiness.md)

## Phases

### Phase 1. Prove an archive can serve the desktop app and pack authors

Package the in-tree starter as an ordinary archive for preview, beta, and production. Each channel calls the same staging command before Electron packages the app. The shipped catalog and CLI read the staged layout, with support for older installed hosts. Compare the files in the finished app with the sealed build receipt. The later release-pin phase replaces the archive source. [Catalog](../../packages/apack-host/src/packs/app-sources.ts) · [Preview](../../scripts/build-preview.ts) · [Packaged host lookup](../../packages/apack-cli/src/app/pack-host.ts) · [Build verification](../../build/build-metadata.ts)

**Done when** unsigned local beta, production, and preview builds package the same verified layout. A packaged preview starts offline on fresh data and exercises backend, frontend, styles and compiled content. Build a dependent fixture against that preview with sibling source, installed-profile fallback and warm dependency cache unavailable. Show the resolved revision and exercise its build facets. Corrupt a selected archive and supply an incompatible one; each must fail preparation before a usable installer is produced.

### Phase 2. Prove a replacement survives an app upgrade

Use the Phase 1 build with a differently named starter and with no starter. The Code feature owns CLI path settings and their test action. Give generic testing helpers an explicit feature target. Packs and Settings are host-owned and must remain reachable. [Code settings](https://github.com/spankyed/default-setup/blob/a8ed8103f5c6b6143b37cf827f5b7838b9c7ea8a/src/features/code/fe/components/CliProviders.vue) · [Code test action](https://github.com/spankyed/default-setup/blob/a8ed8103f5c6b6143b37cf827f5b7838b9c7ea8a/src/features/code/be/system.ts) · [Testing helper](../../packages/apack-testing/src/engine/session.ts) · [Host surfaces](../../packages/apack-host/src/features/declaration.ts)

**Done when** two packaged app versions establish the following on disposable profiles:

- An app-managed starter refreshes. A same-ID fork, disabled pack and deliberately removed pack each retain their respective choices. Explicit Restore works.
- A user switches to another ID that provides the same role, restarts and upgrades. A conflicting candidate identifies the owners, a broken named dependency is reported, and the user can recover the incumbent. Check installed ownership, settings and retained data.
  [Named dependency diagnostics](../references/evidence/starter-dependency-diagnostics.md)
- Change the official selection from A in version 1 to B in version 2. A fresh version 2 profile gets B. Upgrade profiles with A active, disabled, removed or replaced by a same-ID fork. In each case verify the prior choice and data survive a restart, B is offered, and B is installed only after the user accepts.
  [Boot policy and two-version smoke evidence](../references/evidence/starter-profile-seeding.md)
- A fresh empty profile and an existing profile whose last surface disappeared can both open Packs and install a pack.

The packaged baseline reproduced both the empty-profile onboarding trap and silent installation of a newly shipped ID. [Starter onboarding and selection baseline](../references/evidence/starter-optional-onboarding.md)

### Phase 3. Make the external repository the production pack's authoring home

Establish locked, retrievable build inputs on a clean runner. Choose a monorepo source commit and record who owns edits during the transfer so intervening fixes land in the external pack. Transfer the manifest, features, step types, content, tests, facade report, content goldens and redistribution credits. The survey counted 11 features and 13 step types; inventory the actual transfer commit. Keep official-product integration tests in the app repo. [Production manifest](https://github.com/spankyed/default-setup/blob/a8ed8103f5c6b6143b37cf827f5b7838b9c7ea8a/apack.json) · [Packaged authoring acceptance](../../tests/acceptance/packaged-authoring/test-packaged-authoring-author.sh)

**Done when** the pack builds and tests outside the workspace without a global CLI, prepared sibling or accidental installed host. Compare declarations, facade, content and representative runtime behavior to the transfer baseline. Run the exact archive against the named host. Verify the notice inventory against the producer's lock and bundled components. Prove an interrupted release upload can be retried before a complete release becomes visible. Prepare the release candidate for the owner's publication decision. [Existing release upload sequence](../../packages/apack-cli/src/commands/release.ts)

The standalone build exposed a notice scanner assumption about the pack’s npm name. The producer probe matched all 36 bundled dependency entries to the standalone lock. [Starter notice inventory](../references/evidence/starter-notice-inventory.md)

### Phase 4. Pin a released pack in the official distribution

The input to this PR is an **owner-authorized, published** pack release. Download and install it through the ordinary consumer path, then pin the verified archive in the app. Route dev, preview, test and release through the lock. Include the selection and digests in build and performance cache identities. Collect notices and SBOM entries from the same release. [Production build](../../build/build.sh) · [Electron packaging](../../electron-builder.mjs) · [Notice collector](../../scripts/lib/third-party-notices.ts) · [Chain graph](../../scripts/lib/chain-steps.ts)

**Done when** clean macOS, Windows and Linux builds ship the pinned inventory, complete notices and working host-provided executables. Verify offline boot and upgrade from the preceding official build. Run the strict chain with the in-tree starter source unavailable. Record the platform runs, host and producer commits, and release digest in the PR. Keep workspace deletion in its own review.

### Phase 5. Remove the workspace and finish the handoff

Start from the merged release pin and its Phase 4 evidence. Remove the workspace and lock entries, hardcoded watcher, source-copy fixtures and obsolete build legs. Move any remaining pack-owned checks upstream. Update repo guidance and the maintained release, authoring and testing docs. [Dev startup](../../packages/dev-mode.js) · [Fork fixture](../../tests/acceptance/external-pack/prepare-default-pack-fork.ts) · [Release reference](../references/RELEASE.md) · [Authoring guide](../public-facing/getting-started.md) · [Testing guide](../public-facing/testing.md)

**Done when** an app-only clone starts with its pinned pack, a developer can edit another pack with the supported dev command and see backend and frontend changes in an isolated profile, and a downstream distributor can select another starter by changing the distribution configuration alone. Demonstrate a pack-only release followed by a reviewed pin update. Record the final strict app chain, corresponding pack release checks and platform evidence on the tested commits.

## Closing

Keep Current handoff as the single resume point. Record source pairs, commands, outcomes and outstanding failures in checkpoint evidence under `docs/references/evidence/`. A ready-for-review PR awaiting its owner remains open work. After the required changes have landed and integrated acceptance passes, record Outcome, archive the goal and repair links, including references to files transferred to the pack repo. Route closure through the same review process.
