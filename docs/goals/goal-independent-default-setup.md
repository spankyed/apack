# Goal: ship default-setup from its own repository

**Status — planned.** Phase 0 landed in `spankyed/default-setup` at `bb6ebb3`. The official app still builds its starter from the monorepo. The first implementation PR is **`spankyed/apack:session/starter-release-layout` → `master`**. The owner controls every merge.

## Prompt

```text
# Goal: an interchangeable starter, independently built and released

Implement docs/goals/goal-independent-default-setup.md. Read Current handoff, Branches and review,
Decisions, and the phase you are taking. Follow CLAUDE.md and docs/AGENTS.md.

Start Phase 1 in a separate apack worktree on session/starter-release-layout from the goal commit on the updated local master.
Pack implementation belongs on session/production-starter from default-setup's origin/main. The
rename-server-workspace branch was a survey checkout. Leave it out of the migration.

Once the owner says to start, implement and test one independently testable change per feature
branch. Push that branch and open its PR ready for review. The owner reviews and merges. The agent
may execute a merge only when the owner explicitly names that PR and asks for the merge.
Keep auto-merge off. Tags, publication and releases require a separate instruction.

Finish when the official app ships the verified external release, a user's replacement survives an
upgrade, an alternate or empty distribution builds from the same entry point, and both repositories
pass their closing checks. Record evidence on the tested commits and the owner's merge disposition.
```

## Current handoff

- **Source.** The initial survey used apack `19adecce0d` on `rename-server-workspace`. Phase 1 branches from this goal commit on top of `origin/master` at `3d9e9a4c78`. Boot lives in `packages/server` on this base. [Server boot](../../packages/server/src/runtime/index.ts)
- **Proven.** The Phase 0 scaffold passed a clean local install, validation, typecheck, registration test, facade check, build and archive creation. The archive digest and all seven receipt entries verified. It has zero features and the production ID. Use disposable profiles for experiments. Its toolchain still comes from a prepared app checkout. [Scaffold and bootstrap instructions at bb6ebb3](https://github.com/spankyed/default-setup/blob/bb6ebb3/README.md)
- **Next.** Build the full in-tree starter once, package its ordinary archive in a preview, then build a dependent pack against that installed preview. This tests the riskiest assumption while both source trees are available for diagnosis. No external pack release is needed for this PR. Phases 1–5 have no implementation or integrated acceptance recorded here.

## Branches and review

The owner approved one branch and one ready-for-review PR per independently testable change. The table gives the planned split. If a phase yields two independently testable changes, give each its own branch and PR. The instruction to start implementation covers testing, pushing those feature branches and opening their PRs in both repositories.

| Work | Repository and head branch | PR base |
|---|---|---|
| 1. Consume the release layout | `spankyed/apack` · `session/starter-release-layout` | `master` |
| 2. Move CLI provider settings to Code | `spankyed/apack` · `session/starter-code-settings` | `master` |
| 2. Preserve replacement choices | `spankyed/apack` · `session/starter-replacement` | `master` |
| 3a. Supply retrievable authoring packages, if producer-side changes are needed | `spankyed/apack` · `session/starter-toolchain` | `master` |
| 3b. Transfer the production pack | `spankyed/default-setup` · `session/production-starter` | `main` |
| 4. Pin the first external release | `spankyed/apack` · `session/starter-release-pin` | `master` |
| 5. Remove the workspace | `spankyed/apack` · `session/starter-remove-workspace` | `master` |

For Phase 1, run the following from the apack checkout **when implementation starts**. The second argument matters because the helper otherwise branches from the current HEAD. Resume an existing phase worktree if one already exists. [Session helper](../../scripts/session.mjs)

```sh
git fetch origin
npm run session:new -- starter-release-layout master
```

For Phase 3b, run these commands from the `default-setup` checkout. Keep its dependencies and generated files in its own worktree.

```sh
git fetch origin
git worktree add -b session/production-starter ../default-setup-production-starter origin/main
```

Cut dependent branches from the updated base after the prerequisite lands. Independent producer work can proceed during app review. Each handoff names the repository, PR, base and head commits, checks run, and any remaining release dependency. Leave the PR open for the owner to review and merge. If review changes the head, validate the changed result and return it for review.

## Decisions

1. **The distributor chooses the starter in one lockfile.** The proposed `build/shipped-packs.lock.json` supports zero, one or several packs. An entry pins the ID, exact version, asset location, SHA-256 and digest of any separately retrieved redistribution evidence. A pin change shows the versions, digests and upstream source diff. Official-product docs and tests may name `default-setup`. Runtime behavior uses pack IDs supplied as data, registered roles and user installation records.
2. **The app embeds the same archive a user installs.** The producer owns the CLI-generated archive, checksum, integrity metadata, component inventory and license texts. The build retrieves pinned bytes into a digest-keyed cache, checks cache hits, extracts into fresh staging, verifies the receipt, identity, host range, format, unique IDs and dependency closure, then publishes the complete selection to the build session. Package the verified layouts under `resources/app/shipped-packs/<id>/`. First launch installs from disk. A missing selected asset fails the build; an explicit empty list succeeds. Keep the download digest separate from the published-file revision used to decide profile refresh. [Archive producer](../../packages/apack-cli/src/commands/archive.ts) · [Pack layout and revision](../../packages/apack-host/src/packs/layout.ts)
3. **The profile owns its choices.** The owner approved this rule for a change of official starter from A to B. Fresh profiles get B. Existing profiles keep their setup and are offered B for explicit opt-in. This includes people who disabled A, removed A, or installed a fork at A's ID. Seed a fresh profile once, including an empty selection. Continue refreshing eligible app-managed IDs while preserving disablement. If a distribution drops an ID, retain its installed copy and data and show its update status. Explicit Restore resumes app management for an offered ID. Existing tests cover several per-ID cases. Phase 2 owns the A-to-B transition. [Installer](../../packages/apack-host/src/packs/installer.ts) · [Shipped-pack tests](../../packages/apack-host/tests/packs/shipped-packs.spec.ts)
4. **A role can move between IDs. Data and named dependencies have owners.** Preserve entities, settings overrides, applied-content history and migration progress. A fork taking the same ID takes responsibility for understanding that data. A different-ID pack owns its explicit import or conversion. A pack declaring a dependency on the old ID still needs a compatible provider of that ID. Surface missing dependencies and conflicting roles so the user can recover. Reverting a pin requires a separate assessment of any data migration already applied. [Role registry](../../packages/apack-host/src/packs/extensions.ts) · [Persistent app state](../../packages/apack-host/src/app-state/index.ts)
5. **An independent pack can build against an independently obtainable toolchain.** Use versioned SDK, UI, CLI and testing packages, with immutable release tarballs as an interim source if needed. For a breaking change, build the candidate toolchain and an empty-selection host first. Build the candidate pack, test that exact host/pack pair, then promote the tested inputs. Exercise routine host changes against the currently released starter. Reuse the existing package and pack publishers. [Toolchain distribution plan](../plans/deferred/npm-and-homebrew-distribution.md) · [Pack release plan](../plans/deferred/external-pack-release-readiness.md)

## Phases

### Phase 1. Prove an archive can serve the desktop app and pack authors

Today the shipped catalog reads an authoring root with nested `dist/`; the ordinary installer already reads a flat release layout. Feed the full in-tree starter archive into preview staging. Teach the shipped catalog and CLI host lookup to locate the staged packs. Compare the files in the finished app with the receipt after Electron applies its filters. The existing production build can keep using the workspace during this PR. [Catalog](../../packages/apack-host/src/packs/app-sources.ts) · [Preview](../../scripts/build-preview.ts) · [Packaged host lookup](../../packages/apack-cli/src/app/pack-host.ts) · [Build verification](../../build/build-metadata.ts)

**Done when** a packaged preview starts offline on fresh data and exercises backend, frontend, styles and compiled content. Build a dependent fixture against that preview with sibling source, installed-profile fallback and warm dependency cache unavailable. Show the resolved revision and exercise its build facets. Corrupt a selected archive and supply an incompatible one; each must fail preparation before a usable installer is produced.

### Phase 2. Prove a replacement survives an app upgrade

Use the Phase 1 build with a differently named starter and with no starter. Move CLI path settings and their test action to the Code feature. Today General Settings saves to a literal pack ID while the test action resolves a role. Give generic testing helpers an explicit feature target. Packs and Settings are host-owned and must remain reachable. [Settings writes](../../packages/renderer/src/views/settings/canvas/components/GeneralSettings/CliProviders.vue) · [Test action dispatch](../../packages/apack-host/src/features/settings/fe/machine.ts) · [Testing helper](../../packages/apack-testing/src/engine/session.ts) · [Host surfaces](../../packages/apack-host/src/features/declaration.ts)

**Done when** two packaged app versions establish the following on disposable profiles:

- An app-managed starter refreshes. A same-ID fork, disabled pack and deliberately removed pack each retain their respective choices. Explicit Restore works.
- A user switches to another ID that provides the same role, restarts and upgrades. A conflicting candidate identifies the owners, a broken named dependency is reported, and the user can recover the incumbent. Check installed ownership, settings and retained data.
- Change the official selection from A in version 1 to B in version 2. A fresh version 2 profile gets B. Upgrade profiles with A active, disabled, removed or replaced by a same-ID fork. In each case verify the prior choice and data survive a restart, B is offered, and B is installed only after the user accepts.
- A fresh empty profile and an existing profile whose last surface disappeared can both open Packs and install a pack.

### Phase 3. Make the external repository the production pack's authoring home

Establish locked, retrievable build inputs on a clean runner. Choose a monorepo source commit and record who owns edits during the transfer so intervening fixes land in the external pack. Transfer the manifest, features, step types, content, tests, facade report, content goldens and redistribution credits. The survey counted 11 features and 13 step types; inventory the actual transfer commit. Keep official-product integration tests in the app repo. [Production manifest](../../packages/default-setup/apack.json) · [Packaged authoring acceptance](../../tests/acceptance/packaged-authoring/test-packaged-authoring-author.sh)

**Done when** the pack builds and tests outside the workspace without a global CLI, prepared sibling or accidental installed host. Compare declarations, facade, content and representative runtime behavior to the transfer baseline. Run the exact archive against the named host. Verify the notice inventory against the producer's lock and bundled components. Prove an interrupted release upload can be retried before a complete release becomes visible. Prepare the release candidate for the owner's publication decision. [Existing release upload sequence](../../packages/apack-cli/src/commands/release.ts)

### Phase 4. Pin a released pack in the official distribution

The input to this PR is an **owner-authorized, published** pack release. Download and install it through the ordinary consumer path, then pin the verified archive in the app. Route dev, preview, test and release through the lock. Include the selection and digests in build and performance cache identities. Collect notices and SBOM entries from the same release. [Production build](../../build/build.sh) · [Electron packaging](../../electron-builder.mjs) · [Notice collector](../../scripts/lib/third-party-notices.ts) · [Chain graph](../../scripts/lib/chain-steps.ts)

**Done when** clean macOS, Windows and Linux builds ship the pinned inventory, complete notices and working host-provided executables. Verify offline boot and upgrade from the preceding official build. Run the strict chain with the in-tree starter source unavailable. Record the platform runs, host and producer commits, and release digest in the PR. Keep workspace deletion in its own review.

### Phase 5. Remove the workspace and finish the handoff

Start from the merged release pin and its Phase 4 evidence. Remove the workspace and lock entries, hardcoded watcher, source-copy fixtures and obsolete build legs. Move any remaining pack-owned checks upstream. Update repo guidance and the maintained release, authoring and testing docs. [Dev startup](../../packages/dev-mode.js) · [Fork fixture](../../tests/acceptance/external-pack/prepare-default-pack-fork.ts) · [Release reference](../references/RELEASE.md) · [Authoring guide](../public-facing/getting-started.md) · [Testing guide](../public-facing/testing.md)

**Done when** an app-only clone starts with its pinned pack, a developer can edit another pack with the supported dev command and see backend and frontend changes in an isolated profile, and a downstream distributor can select another starter by changing the distribution configuration alone. Demonstrate a pack-only release followed by a reviewed pin update. Record the final strict app chain, corresponding pack release checks and platform evidence on the tested commits.

## Closing

Keep Current handoff as the single resume point. Record source pairs, commands, outcomes and outstanding failures in checkpoint evidence under `docs/references/evidence/`. A ready-for-review PR awaiting its owner remains open work. After the required changes have landed and integrated acceptance passes, record Outcome, archive the goal and repair links, including references to files transferred to the pack repo. Route closure through the same review process.
