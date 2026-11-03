# External-pack release readiness

Status: deferred, 2026-10-18. Resume when the owner schedules this work; public execution requires
separate authorization. This plan is not a prerequisite for completing the
[settings and pack contracts goal](../../archive/goals/goal-settings-and-pack-contracts.md).

## Outcome and ownership

An outside pack author can use the supported CLI and scaffold to prepare a release, understand
whether it is ready to ship, publish complete verified files, and recover from an interrupted attempt.
The documented path must work outside the monorepo without undeclared workspace or machine state.

This plan owns external-pack release behavior and its scaffolded workflow. The
[npm/Homebrew distribution plan](npm-and-homebrew-distribution.md) owns publishing our five public
packages, distribution credentials, registry consumer checks and Homebrew activation. Do not create a
second publisher, package registry, tap or package-versioning system here.

The current settings/contracts goal retains real local package-consumer, archive, installation and
runtime acceptance. This plan does not absorb, waive or postpone any of those requirements, nor its
compiler freshness/publication guarantees. In that goal, build publication means accepting a completed
local build/output record; it does not require uploading a public release.

## Inspected baseline

- [release.ts](../../../packages/apack-cli/src/commands/release.ts) implements `apack pack release`,
  `release publish`, dry-run preparation and partial local-release state reporting.
- [The scaffolded workflow](../../../packages/apack-cli/templates/pack/github/workflows/release.yml)
  installs dependencies with `npm ci`, uses `APACK_HOST=beta` on macOS ARM64, checks/builds/archives
  the pack and uploads a GitHub release with provenance attestation.
- [init.ts](../../../packages/apack-cli/src/commands/init.ts) scaffolds dependencies on versioned public
  `@apackdev` packages. A local-tarball consumer test substitutes these packages; it does not prove
  that a fresh public workflow can resolve them or obtain its selected host.
- Release dry-run continues after preflight errors and reports them as problems that would stop a
  real release. It builds/verifies an archive at the version on disk. Its success is not a passing
  release preflight. The help's broad claim of no Git operations also needs review: preflight can
  fetch origin and inspect remote tags.
- Publishing currently creates a public GitHub release before uploading its files. An interrupted
  upload can therefore expose an incomplete release. Review the existing retry behavior before
  choosing the smallest repair.
- [Release integration tests](../../../packages/apack-cli/tests/commands/release.integration.spec.ts)
  include injected Git commands, a build stand-in, verified archives and mocked GitHub API calls.
  Their evidence must distinguish those seams from an actual compiler or remote release execution.
- [Packaged authoring](../../../tests/acceptance/packaged-authoring/test-packaged-authoring-author.sh) installs real local npm
  tarballs outside the monorepo, scaffolds a pack and exercises release dry-run/archive installation.
  [Its app half](../../../tests/acceptance/packaged-authoring/test-packaged-authoring-app.sh) runs the exact archive against an
  isolated built host and compares installed integrity metadata.

These are source observations, not newly executed acceptance. Reinspect current code before each
implementation checkpoint. No public release, external repository or distribution credential is
created by writing this plan.

## 1. Make release results precise

Keep build/archive preparation separate from readiness to ship. Define and document the guarantees of
the existing commands before choosing whether a behavior change or an additional interface is needed.

- An archive can verify while origin, credentials, branch or workflow prerequisites are missing.
  Report both outcomes clearly; automation must be able to distinguish them without treating a
  successful preparatory build as permission or readiness to publish.
- Preserve useful credential-free local preparation. Do not require an npm publication, GitHub
  repository, production app or release token just to build and verify a candidate archive.
- Make dry-run side effects honest: distinguish generated local output from authored/version changes,
  commits/tags/pushes, remote metadata checks and local Git-ref updates. Do not promise no file/Git
  changes while performing them, or silently turn a dry run into an upload.
- Reconcile CLI help, public docs, scaffold README and tests with the selected behavior. Do not add
  speculative command variants or use `--skip-tests` as the normal readiness path.

Acceptance: exercise a valid preparation with blocked shipping prerequisites and a genuinely ready
preflight. Both produce explicit, correctly attributed results. Dry-run does not bump authored
versions, create release commits/tags, push or upload. Its documented local/network effects match
observation. Existing preparation and integrity/refusal coverage remains intact.

## 2. Establish the fresh external workflow's prerequisites

Use the existing scaffold and CLI. Audit the actual package and host resolution path before changing
the workflow; do not assume a workflow YAML file establishes a usable release system.

- Coordinate package/version availability with the npm distribution plan. The CLI installed by the
  pack must be the intended project-local version, not an accidental global CLI or implicit `npx`
  download used to conceal a missing dependency.
- Decide and document how a clean runner obtains a compatible host and any app-shipped pack
  dependencies. Audit `APACK_HOST=beta`: establish which packs need a host, whether the requested
  host exists for the selected platform, and how its version/content is recorded. Local explicit
  checkout tests do not establish the beta download path.
- Keep dependency/provider selection explainable across preparation, workflow build and installation.
  Reuse existing provenance and version checks. Introduce no frozen-resolution mechanism without a
  demonstrated distribution requirement.
- Verify the current `facade:check`, typecheck, test, build/archive and attestation steps on the pack
  produced by the scaffold. If a required baseline is absent, the author must receive an actionable
  setup step instead of discovering it after pushing a tag.
- Declare supported release platforms. Verify Windows process invocation (`npm`/`npx`, command shims
  and shell assumptions) if Windows release preparation is supported; do not infer it from macOS
  workflow acceptance or unrelated Windows compiler checks.

Acceptance before public bootstrap: fresh outside-monorepo consumer using locally packed packages
and an explicitly selected built host passes the applicable preparation path. Record this as local
acceptance, not registry/workflow acceptance. After package/host distribution is authorized and
available, repeat the scaffolded path on a clean runner without workspace imports, local package
overrides, preinstalled CLI assumptions or hidden host caches. Record the source and resolved versions.

## 3. Complete and recover release publication

Inspect the existing release-state owner and tests before changing code. Preserve resume semantics;
avoid a new release state machine alongside the current one.

- Verify local version/file/lockfile agreement, commit/tag creation, tag push and reruns using a
  disposable pack repository with a local bare Git remote. This can exercise real Git sequencing
  without pushing the monorepo or creating a public repository.
- Establish whether current tests already cover each relevant failure and add only missing cases.
  Distinguish mocked build/Git/API behavior from the operations actually executed.
- Prepare and verify the archive, checksum and integrity metadata before exposing a completed
  release. Prefer a draft release, upload/verify all required files, then publish it.
- Define recovery after creation, partial upload, completed upload and publish failure. Retrying must
  not bump again, silently overwrite differing content or leave a publicly discoverable incomplete
  release. Check tag/version/content identity rather than assuming a same-named release is correct.
- Keep credentials narrowly scoped and out of logs/archives. Reuse GitHub's supported workflow token
  permissions; npm publishing rights belong to the distribution plan, not an external pack release.

Acceptance: focused failure/retry tests cover the named boundaries and retain prior useful files.
Local Git sequencing and mocked API coverage are explicitly labelled. Release-preparation repairs
preserve actual build/archive acceptance through the existing authoring fixture.

## 4. Run one authorized external release smoke check

This checkpoint requires explicit authorization for repository creation/use, version/tag changes,
pushes, workflow execution, release creation/publication and any cleanup. A sleeping or unavailable
owner is not approval. Do not cut a monorepo release to work around missing authorization.

Use a designated external pack repository, then:

1. Start from the documented public package/host versions and a clean checkout of the scaffolded pack.
2. Prepare and publish an explicitly selected test version through the supported workflow. Agree its
   visibility/channel first; do not unexpectedly change what app users receive as the latest release.
3. Download/install by the documented GitHub release selector into isolated app data. Verify exact
   pack/version/content identity, checksum, compatibility and actual activation/runtime behavior.
4. Exercise an update and the selected safe retry boundary. Preserve logs and release-file identities.
5. Record the verified commands/platforms and complete only the agreed cleanup. Do not delete useful
   repositories, releases or evidence automatically.

This establishes the real GitHub path. npm installation and Homebrew install/upgrade/uninstall remain
owned by their distribution plan and must not be claimed from this smoke check.

## Evidence and completion

| Result | What establishes it | What it does not establish |
|---|---|---|
| Local package consumer and archive/runtime | Packed first-party packages installed outside the repo; real build, verified archive and isolated host execution | Public npm availability, hosted release workflow or Homebrew |
| Release preflight | The real selected readiness checks pass | Upload success or successful installation by another machine |
| Release sequencing/recovery | Labelled real local Git and focused failure/retry coverage | Actual GitHub token permissions or service behavior when mocked |
| Public GitHub release round trip | Authorized clean workflow, complete release files and exact download/install/runtime verification | npm/Homebrew distribution |
| Public package/CLI distribution | The linked distribution plan's registry and platform acceptance | All external-pack release behavior by itself |

Record source commits, package/host versions, exact commands/results, side effects and unresolved
checks. Existing local evidence can be reused where relevant inputs and assertions have not changed;
do not repeatedly run the full chain to investigate one release failure. Required final validation
still applies to implementation checkpoints under their owning goal.

Complete this plan only when command semantics, supported-platform preparation, complete/recoverable
publication and the authorized public round trip are proven and the CLI/docs/templates agree. Until
public execution is authorized and possible, record those rows as unverified. This is not a reason to
keep the separate settings/contracts goal open once all of its own requirements pass.
