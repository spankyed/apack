> Written in Codex session `01a1287c-2130-7191-9b4b-a48dc2edb218`, 2026-10-12.

```text
# Goal: pack access declarations correspond to enforceable permissions

Develop the security design in docs/goals/goal-pack-security-isolation.md before implementing it.
The background was surveyed at 196e54dfd. Re-audit the current loader, SDK bindings, transport,
preload and EARS access paths before relying on those findings.
Read Background, Decisions, Open decisions, Phases and Constraints first.
Complete Phase 1 and prepare the Phase 2 design for review. Resolve its open product/security
decisions before implementing isolation; this document does not select a sandbox mechanism.

Finished when the approved design is implemented and adversarial fixtures prove its declared
boundary in installed builds, legitimate pack behavior passes, public contracts/docs agree, and
the affected checks plus npm run chain pass. Record the outcome and archive this document then.

Work in reviewable phases. Do not publish, push, tag, open a PR or change release metadata unless
requested. Use isolated test data, never production data. Follow CLAUDE.md for implementation,
stored-data migration and validation. Do not add compatibility shims or weaken failing assertions.
```

# Pack security isolation and enforced permissions

Status: planned, design first; isolation implementation remains deferred pending separate prioritization
and design approval. This is the authoritative execution goal for backend and frontend security isolation.
Updating this document does not start its audit, prototypes or implementation, and does not add sandboxing
to the active settings/discovery goal. Security design can proceed alongside API-contract work; neither
settings nor discovery requires a sandbox first.

## Background

Pack backends load into the API process; pack frontends import into the app renderer and contribute
executable components. Generated types and manifest metadata currently constrain supported authoring,
but do not contain arbitrary code sharing the host's execution environment. The existing `permissions`
field is descriptive metadata, not an enforced grant.

The [manifest maturity plan](../archive/plans/manifest-maturity.md) separates declared consumed APIs from
security permissions. [Settings extraction](../archive/plans/settings-architecture.md) defines shared
cross-pack mutation by default, with optional owner-only mutation through the supported API. The
[discovery plan](../archive/plans/discovery-without-activation.md) makes declared surfaces inspectable without
loading code. None establishes a sandbox for malicious pack code.

Existing inputs must be reconciled rather than implemented independently:

- [Declared capabilities](../archive/plans/declared-capabilities.md): generated services and ambient access,
  including direct repositories, EARS queries/transactions and content appliers.
- [Archived frontend isolation](../archive/goals/goal-pack-frontend-isolation.md): historical mechanism
  options and survey. Its unfinished requirements are owned by this goal below, not completed or waived.
  Its embedded commands, trust assumptions and execution instructions are not current instructions.
- [Fault isolation](../archive/plans/pack-fault-isolation.md): crash containment and the synchronous EARS seam.
  A separate Node process alone is not filesystem/network confinement.

Chrome requires permissions for many extension APIs and distinguishes API permissions from host
access and optional runtime grants. This is evidence for separating declarations from granted access,
not a sandbox specification for apack. [Chrome permission declarations](https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions)

## Current baseline and scope ownership

Rechecked against `9752e0c3b` on 2026-10-16. This is a starting inventory, not the completed Phase 1
authority audit. Re-audit the implementation before choosing a mechanism.

| Existing contract | Evidence / security limit |
|---|---|
| Common declaration catalog and checked bindings | [Catalog](../../packages/apack-host/src/packs/catalog.ts) and [event admission](../../packages/apack-host/src/packs/event-binding.ts) expose contributions without activation and check runtime membership. Event names and accepted exports do not authenticate a sender or grant resource access. |
| Caller-bound settings and runtime retirement | [`_createPackServices`](../../packages/apack-sdk/src/services/index.ts) binds/revokes settings access. Other service members still delegate to the ambient services proxy; do not claim all APIs have the same lifetime or consumption enforcement. |
| Frontend fault containment | [Fault-isolation plan](../archive/plans/pack-fault-isolation.md) records implemented pane/form boundaries and retired-instance checks. These contain failures, not hostile JavaScript or renderer access. |
| Pack replacement and provenance | [Installer](../../packages/apack-host/src/packs/installer.ts) supports a user replacement at an app-default pack ID. Install ownership, verified bytes and build/runtime identity are inputs to policy, not security grants or proof of a trusted publisher. |
| Shared execution and preload | [Backend bridge](../../packages/apack-host/src/packs/runtime/bridge.ts) shares host modules; frontend pack code shares the renderer realm. [Preload](../../packages/preload/src/index.ts) still exposes the API token at runtime; omitting it from [pack-facing types](../../packages/apack-sdk/src/fe/electron-api.ts) does not hide it. |
| Bus addressing | [Client transport](../../packages/api/src/transport/bus.ts) binds the connection identity and checks sender addressability. It does not prove that the caller owns a named pack/surface. `resolveName` resolves names; event membership checks describe supported messages. Neither is authorization. |

Owned compiler/input snapshots and sealed builds address coherence and provenance. They do not confine
compiler code, install hooks or runtime Node access. Keep that distinction in the build/install audit.

### Frontend requirements absorbed from the older goal

The older frontend goal is archived as a separate execution plan. Preserve these unfinished requirements
in this goal's design and acceptance:

- Isolated pack code cannot use host DOM/globals, privileged preload, API tokens, other packs' state or
  app-origin storage. Cover parent/top/opener, navigation and new-window escape routes. A browser may
  expose a restricted `WindowProxy`; test access to host authority rather than requiring the reference
  itself to be absent.
- Broker identity comes from the host-created execution context/connection. Resolve addresses, check
  supported message/payload shapes and authorize operations as separate steps. Pack-supplied `from`,
  `sender`, IDs, dependency claims or settings credentials must not establish broker identity.
- Decide how surfaces, custom settings forms, step forms/layout, block/artifact viewers, editor extensions
  and app slots cross the boundary. Record the strategy and tests for every supported contribution kind.
  Removing a supported kind requires an explicit product decision, not an implicit prototype exclusion.
- Preserve authoring/testing, styles and UI integration, dev/HMR, reload, multiple windows and teardown
  through the selected integration contract. Update the SDK and test harness where the boundary changes;
  there is no promise to preserve obsolete imports or synchronous signatures.
- Decide which execution contexts are exempt. The name `default-setup`, an app-default designation,
  install location or `updatesWith` record must not confer trust on a user replacement.
- Prove denial and legitimate operation in actual installed builds. Host window hardening and backend
  execution are in this goal's authority audit; the older frontend-only deferrals do not exclude them.

Historical iframe, WebContentsView and compartment options remain research inputs. A separate renderer
process or an iframe alone is not proof of the required confinement; select mechanisms through Phase 2.

### API-contract handoff

[API consumption](../archive/plans/declared-capabilities.md) owns supported API identities/provider requirements,
generated/runtime facade agreement, accepted caller identity and lifetime/revocation, and separation of
onboarding from backup/import/reset administration. It must inventory repositories, EARS and content
execution alongside services and carry the accepted facade into user-authored actions.

This goal owns confinement of bypasses, broker authentication/authorization, resource/action grants,
delegation, user consent, revocation enforcement and platform guarantees. Consuming a service is an API
dependency; it is not a filesystem/network/process grant. Keep requested APIs, granted authority,
provider availability and runtime readiness distinct.

The security audit and mechanism prototypes need not wait for API consumption to finish. Use its
settled contracts where available and label provisional prototype seams explicitly; do not invent a
second manifest/catalog or freeze unresolved API names as security permissions. Before production
integration, agree the serializable operations, caller identity, administration boundary, availability
errors and retirement behavior that the broker will enforce. API filtering alone is not a sandbox.

## Decisions

1. Security permissions are enforced host policy, not generated types, import rules or claims supplied
   in a message. The host associates identity with the execution context/connection it created.
2. Inspect declared access without activation. Keep requests, grants and current availability distinct;
   a dependency declaration neither grants its permissions transitively nor allows impersonation.
3. Every sensitive operation crosses a checked boundary. Closing only generated service access leaves
   direct Node, EARS, renderer globals, API tokens and preload paths to audit.
4. Preserve the shared-by-default settings collaboration policy. Resource grants govern whether a pack
   can reach a settings target; the definition's `access: owner` governs mutation there. Both checks
   apply. This goal does not silently make all cross-pack settings owner-only.
5. Keep crash containment, authoring checks and security confinement distinct in docs and tests. No
   permission guarantee ships for a surface that still has an ambient bypass.
6. No trusted-code exemption follows from a pack name, path, manifest flag, update-ownership record or
   checksum equality. If exemptions are approved, specify host-verified provenance and/or explicit grants,
   bind the decision to the accepted build/runtime and re-evaluate replacements and updates. Do not let a
   user fork inherit an app-shipped exemption by occupying its ID.

## Open decisions

- **Threat model:** which code is untrusted, which resources it must not reach, and which privileges
  the user may deliberately grant. Include dependencies and build/install hooks, not just runtime entries.
- **Trusted code policy:** whether any host-shipped or explicitly approved code is exempt, how the host
  establishes that trust, and how a modified build, user fork, dependency or update affects it. Neither
  default-setup's ID nor a manifest's `builtIn` claim establishes trust.
- **Execution boundary:** backend sandbox and frontend realm/origin isolation on supported platforms;
  determine the actual restrictions, not just where code runs.
- **Data contract:** replacing or adapting synchronous EARS access across isolation, transaction
  atomicity, query subscriptions and cross-pack repositories. Do not assume synchronous RPC is viable.
- **Permission vocabulary:** concrete resources/actions, grant lifecycle, update escalation, revocation
  and user presentation. Start from audited operations rather than broad service-name booleans.
- **Revocation semantics:** define authorization/commit points for in-flight reads, writes and delegated
  work; whether already-authorized work may finish; cancellation limits; and disposal of results and
  subscriptions. Do not promise rollback of effects already committed or allow late delivery to a
  replacement runtime.
- **Frontend extension contract:** how custom forms, step/block/artifact viewers, editor extensions and
  app slots work without sharing executable objects and host DOM authority.

## Phases

### 1. Audit all authority paths

Inventory backend entry loading/module bridges, raw Node imports/native modules/child processes,
filesystem/network/terminal access, secrets and inference, repositories/EARS/content appliers,
frontend import maps, preload, renderer globals, API tokens, bus routing and dependency delegation.
Also audit build-time compilers, package lifecycle scripts and installer execution: runtime isolation
does not protect an install that already executes untrusted code with host authority.

Record each path's host-established caller identity, resource/action, lifetime, current bypasses,
proposed enforcement owner and denial/allowed-operation evidence. Distinguish app host code, app-shipped
packs, user replacements, dependencies and user-authored content; provenance is not a grant. Name the
operations default-setup actually needs and which cannot retain their present signatures. Link existing
settings/discovery/fault-containment evidence rather than reimplementing those subsystems.

**Done when:** the threat model and authority inventory cover both backend and frontend, all supported
contributions and dependency execution, with source evidence and explicit unresolved decisions.

### 2. Prove the boundary and settle the design

Use small, bounded prototypes against the actual backend and frontend execution paths. Before each,
name its claimed guarantee, bypass attempt, legitimate operation and evidence required to select or
reject the mechanism. Use isolated test resources and retain results; do not start a broad migration or
repeated full suites to choose a mechanism.

Prove these representative cases together:

1. Onboarding works without database administration; the real Database consumer can perform explicitly
   granted backup/import/reset operations. Denied administration fails before side effects.
2. A real EARS query, transaction and subscription work across the boundary with specified atomicity,
   ownership and lifecycle semantics. Prototype the required async/API change rather than assuming
   synchronous RPC preserves the current model.
3. A surface and custom settings form, plus a representative step/block/editor contribution, integrate
   through the proposed frontend boundary. They retain useful interaction and state without sharing
   executable pack objects with privileged host code contrary to the selected guarantee.
4. Malicious fixtures attempt access to denied file/network/process targets, preload/token/host-DOM access,
   parent/top/opener escape, forged caller identity and undeclared dependency delegation. Pair denials
   with allowed operations through the same real path; a mock broker rejection alone is insufficient.
5. Revoke authority while a call is pending, then replace/unload the runtime. Test the agreed commit and
   cancellation policy, subscription cleanup, retained handles and late results; a replacement must not
   inherit the old runtime's authority or receive its pending result. Include a user fork at an app-default
   ID to prove that names do not grant trusted-host privileges.

Measure startup and interaction costs before choosing the migration. Specify serializable broker APIs,
resource/action grants, contribution integration and any trusted-code exception. For each supported
platform, document what the mechanism actually prevents and how unsupported configurations refuse or
limit operation. Reconcile the API-contract handoff and every frontend contribution kind before approval.

**Done when:** the design is approved, prototypes demonstrate the claimed restrictions, and every open
decision affecting the chosen mechanism is settled. A prototype failure is evidence to revise the
design, not grounds to weaken the guarantee.

### 3. Implement isolation and permission mediation

Migrate runtime loaders, generated SDK access, transport, data access, build/install execution and
frontend integration according to the approved authority inventory and contribution mapping. Preserve
declaration discovery and installed-build validation. Authenticate callers at the broker, check current
grants and resource ownership, and remove ambient authority from
isolated code. Handle disable/uninstall, crashes, pending calls, subscriptions and grant revocation.

**Done when:** supported isolated pack operations work through the broker; denied operations fail
without side effects; replacement/revocation cannot retain stale authority; host-shipped exceptions
cannot be acquired by a pack-authored flag or forged identity.

### 4. Validate installed behavior and finish contracts

Cover direct bypass attempts, forged/delegated identities, dependency permission escalation, restricted
settings mutations, secrets/data access, update grants, revocation and frontend navigation/token escape.
Test actual installed builds and supported platforms, not only mocks of broker checks. Pair denials with
successful granted operations and verify the tests fail if their relevant enforcement is removed.

Update schema/API reports, SDK/authoring docs, installer permission presentation and reconciled older
plans. Run focused boundary specs, external-pack/packaged-authoring and app checks, then the chain.

**Done when:** the declared guarantee has adversarial evidence and maintained guards, legitimate pack
behavior passes, documentation describes the actual trust model, and no descriptive field is presented
as an enforced permission without its corresponding boundary.

## Constraints

Do not expand the current settings, discovery or manifest work into isolation implementation. Their
API contracts can improve independently while documenting trusted in-process execution honestly.
Do not use JavaScript `vm`, workers or a plain child process as proof of confinement. Choose the
mechanism through the prototype and supported-platform audit. Never pass a host-wide API token or
raw privileged handles into an isolated pack. Keep secrets values and arbitrary payload contents out
of permission diagnostics. Re-audit historical plans instead of copying stale exceptions or commands.
