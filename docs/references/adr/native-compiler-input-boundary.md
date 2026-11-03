# Native compiler input boundary

Status: Accepted — bounded native support approved on 2026-10-17; bound-only PE refusal explicitly approved on 2026-10-18. Implementation and acceptance remain separately tracked.
Date: 2026-10-17.

## Context and evidence

Pack builds capture compiler and dependency inputs, associate completed observations with sealed
output, and replay those observations for freshness checks. This supports input/output coherence;
it does not establish hermetic execution or security isolation of arbitrary native code.

A real addon linked to an absolute external library executes the original library outside the
captured input tree. Replacing that library does not invalidate the recorded build. Package-relative
native library capture (`6710e3026`) fixes a different case and does not close this defect. See the
[reproducer and acceptance evidence](../../archive/references/evidence/build-input-snapshot-proof.md#package-relative-native-library-ownership).

Platform packaging and release configuration are not proof of native compiler correctness. The
[goal's B1/B3 closure register](../../archive/goals/goal-settings-and-pack-contracts.md#b1b3-closure-register-and-decisions)
records configured targets, missing evidence and required decisions. Unverified behavior is not a
reproduced defect.

## Decision

Keep captured compiler/dependency inputs and the existing publication owner. Audit the native
dependencies actually executed by supported compiler paths before selecting additional machinery.
Preserve package-contained loading and normal platform-library resolution.

Support captured package-contained libraries and normal operating-system libraries. Refuse
identifiable outside-library dependencies with a diagnostic naming the native image and dependency.
The user explicitly approved this boundary on 2026-10-17. Universal capture of arbitrary external
native libraries and native file I/O is outside this contract; do not claim universal detection.
An absolute reference back to a live original package is not captured loading, even if that original
library sits beside its addon. Supported package-relative loading must actually use the owned copy.

Windows native compiler imports containing only precomputed bound addresses, without recoverable
import names or ordinals, are unsupported and must receive an attributed refusal. The user explicitly
approved this narrow boundary on 2026-10-18. Ordinary imports and ordinary bound imports retaining
usable lookup information remain supported. Static admission needs symbol identity to follow export
forwarders and inspect dependencies; guessing names from addresses or admitting uninspectable imports
would weaken that contract. This is a compiler-input restriction, not a restriction to Windows Server.

The existing refusal must name the requesting image and dependency, prevent affected native
initialization and preserve incumbent output when a build is refused. Verify these through existing
checks where sufficient, adding only missing coverage. Approval settles scope; it does not establish
that these acceptance checks pass. Do not introduce an override, speculative address recovery or
another fixture-construction campaign. Reconsider broader support when a real required dependency
supplies an independently Windows-loadable reproducer.

Checkpoint `12447893a` checks this encoding before dependency resolution, including OS and missing
targets. Its [focused acceptance](../../archive/references/evidence/build-input-snapshot-proof.md#bound-only-refusal-before-resolution--2026-10-19)
records diagnostic/native-loader checks and the unchanged incumbent-publication boundary; final
committed-source convergence remains separately required.

Preserved ordinary-loader experiments failed after import lookup information was removed, including
from OS-bound images. They do not establish that every address-only binary is invalid or demonstrate
a valid required dependency rejected by apack. Synthetic cases establish parsing/refusal behavior only.
See the [decision record](../../archive/references/evidence/build-input-snapshot-proof.md#bound-only-pe-support-decision--2026-10-18).

Versioned macOS override directories select original filesystem paths at launch, before JavaScript
admission. Accept these directories only within normal OS library locations, verifying their physical
targets; refuse other configured directories before either build or frontend launch. This is an
environment admission policy, including unused outside directories, rather than a claim to reproduce
dyld's global install-name/version selection. Package libraries continue to use captured package-relative
loading. The real outside-versioned reproducer and this policy's acceptance are recorded in the evidence.
Apply the same location policy to `DYLD_SHARED_CACHE_DIR`, which names one directory rather than a path
list. Normal OS shared-cache use remains supported; outside custom caches refuse before execution.
The shared cache is an OS input, not another compiler-owned library tree to copy or rewrite.

The ELF implementation reads program headers and the OS library cache without executing pack images.
Its selected OS interpreter supplies tokens, hardware capabilities and default directories through
`--list-diagnostics`, with no pack image argument. This is an invocation of the runtime's own loader,
not a requirement to install `readelf`, `ldd` or another inspection tool. Capture once before user
preloads and share that state through the existing thread handoff. The native owner remains responsible
for copied package bytes, source/cache observations and lifetime. Launch-time insertion/auditing accepts
only physical OS library paths, including `/etc/ld.so.preload`; selected ordinary overrides remain
subject to per-image admission. Runtime acceptance and environments without those diagnostics still
require evidence; this implementation is not a new approval to exclude configured platform targets.

The PE implementation uses checked static image declarations and the common native copy owner.
Loaded-module inventory comes from a bounded installed Windows PowerShell/.NET OS query. Node 23's
report implementation truncates module filenames and concurrent report generation can corrupt the
Windows heap; Windows admission therefore does not use that API. Bootstrap the inspector through the
OS object-manager namespace, then derive the system directory from the target's actual loaded ntdll.
Only that immutable directory is cached; modules, loader policy and native PATH remain live.

The existing inspector reads PATH from the target's native process parameters rather than a replaced
JavaScript environment or a worker's private environment. It uses read-only process access, explicit
native/WOW64 pointer widths, page-bounded reads capped at 1 MiB, and rejects a changed PATH/pointer
between observations. Process handles are disposed. Only PATH is returned; no other environment values
are serialized. The existing helper job is established before optional C# compilation, retaining the
five-second query bound and descendant cleanup. Unreadable or changing process parameters refuse rather
than substituting JavaScript values. These internal Windows layouts need platform acceptance; this
is not universal native-input capture or stronger isolation. The query does not initialize pack images. The exact owned-DLL, restoration,
Vue and outside-PATH refusal control passes on `b70228539`; other required Windows lookup and platform
checks remain open. See [Windows evidence](../../archive/references/evidence/build-input-snapshot-proof.md#accepted-windows-dll-ownership-and-full-path-module-metadata-2026-10-17).

Windows Node-API addons using node-gyp's standard `node.exe` delay-load hook bind to the running
runtime. Verify their named Node-API imports against the runtime's concrete exports, tied to the same
executable bytes recorded by its application context. A loaded `libnode.dll`, which that hook prefers,
requires library ownership checks. Missing Node-API exports refuse at the host boundary. Eager imports,
other libraries, ordinals and non-Node-API symbols retain ordinary admission. This models the [documented Electron host-binding contract](https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules/);
it does not infer the behavior of arbitrary native hook code or widen the approved native-I/O boundary.

Private assembly selection observes directory membership as well as named files. Typed snapshots
reach the existing input owner on successful and refused queries, preserving newly created language
folders and failed-context repair subscriptions. Full listing hashes guard each inspection; runtime
copy identity derives from named candidate state, owned directories and owned file bytes. This keeps
selective Node copies reproducible without copying unrelated installation files. See the
[directory-membership checkpoint](../../archive/references/evidence/build-input-snapshot-proof.md#private-assembly-directory-membership-and-copy-identity--2026-10-18).
Resource manifests that affect DLL selection remain required inputs. General resource reads performed
by native code remain within the already excluded native-I/O boundary; do not turn those reads into
an implicit new capture project when classifying MUI follow-ups.

Runtime linkage is a separate earlier boundary: linked images can execute library constructors before
JavaScript starts. Check the captured executable at the existing shared worker launcher, using its
actual environment, working directory and the runtime directory declared by its installation owner.
Electron framework distribution and Node executable-directory ownership are distinct. The Mach-O
implementation uses the selected executable for `@executable_path` and does not apply dylib overrides
to main-image selection. Its minimal hosted refusal/contained-loading control passes in run `39095180283`; actual runtime/signing combinations remain separately required. A fresh process cannot reuse the
supervisor's already loaded libraries; that optimization applies only to admission within an existing
process. Reuse the same metadata/admission implementation, with no second runtime or copy owner.

Copied distribution integrity and effective runtime selection are distinct. Verify captured files,
modes, directories and links against the source distribution. A fresh executable follows normal OS
policy, even when Windows retains an older binding for the original path. Its compiler identity must
include its own effective bindings; source and captured runtime freshness retain separate baselines.
Observe relevant OS policy/catalog files and directory membership so new candidates invalidate reuse
even when a cached binding stays unchanged. Do not copy the OS store or erase selection metadata to
make source/copy hashes equal. See the [policy proof and caller audit](../../archive/references/evidence/build-input-snapshot-proof.md#publisher-policy-freshness-and-runtime-identity-boundary--2026-10-19).

Static inspection alone cannot establish complete capture: dynamic library loading and native file
reads may bypass JavaScript observation. Neither an input declaration nor a scanner establishes
that execution used captured bytes. Do not claim complete capture from those mechanisms alone.

## Alternatives and tradeoffs

- Capture external libraries while preserving loader semantics: retains broader support, but requires
  a successful prototype against the existing reproducer before committing to a design.
- Restrict external native dependencies: reduces implementation scope, but detection has limits and
  affected authors need useful diagnostics. No claim of universal detection is justified.
- OS-level execution isolation: could enforce a stronger boundary, but adds platform-specific work;
  stronger isolation remains deferred and is not authorized by this record.
- Binary relocation or broader interception: no solution is selected; justify either against an
  observed requirement rather than introducing a general framework speculatively.

## Rejected shortcut

A real macOS ARM64 / Node 23.11.1 prototype shows that `DYLD_LIBRARY_PATH` can redirect one absolute
library to captured bytes, but collapses two distinct absolute libraries sharing a basename: expected
`[11, 22]` becomes `[11, 11]`. A search-path override alone therefore fails the resolution-preservation
criterion. See [prototype evidence](../../archive/references/evidence/build-input-snapshot-proof.md#external-native-library-search-path-prototype-2026-10-17).
This rules out that shortcut, not every possible exact-identity capture design. The separate user
approval above selects bounded support; the prototype itself does not authorize implementation changes.

## Acceptance and decision process

Implement in bounded checkpoints:

1. Inspect native image dependency declarations without executing the image. Cover macOS load commands,
   distinguishing dependency commands from image IDs; identify package-relative, OS and outside paths.
   Check transitive package libraries while preserving actual resolution. Refuse the existing absolute
   outside-library reproducer before native initialization; retain actual package-relative acceptance.
2. Route the check through the existing captured module owner, then audit early preloads, worker threads,
   compiler dependencies and Vite so a later load path cannot silently bypass the bounded contract.
   Extend inspection to supported ELF/PE paths without introducing executable inspection tools as end-user
   requirements. Native I/O and computed runtime loading remain explicit detection limits.
3. Prove attributed refusal and incumbent retention through the public build path, changed-input tracking
   for supported copies, transitive loading, cancellation and watch recovery. Reuse existing fixtures.
   Record native platform acceptance separately; synthetic headers are parser checks, not OS acceptance.

The user authorized branch pushes and focused Windows CI on 2026-10-17. Windows run `39075394015`,
attempt 2, passes on `4b4d820fa`, including the shared build/frontend Job Object owner, native launcher
lifetime matrix, descendant cancellation/replacement and repeated-build acceptance. This establishes
process ownership on that source, not PE library admission. macOS compiler/native batches now use a
disposable hosted runner following the daily-use machine's launch incident; causation remains unproven.
See the [current acceptance evidence](../../archive/references/evidence/build-input-snapshot-proof.md#recovery-windows-acceptance-and-isolated-macos-execution-2026-10-17).
Release workflows remain prohibited. Preserve the common process owner rather than replacing it with
PID-only termination.

The contract approval does not close these implementation or validation checkpoints. Linux support and
all required final gates remain owned by the goal.

The goal owns implementation order and completion; the evidence record owns results. This ADR owns
reasoning and the eventual decision, not another task backlog. Independent API work continues.

Revisit the boundary when a required dependency exceeds it, a new supported environment changes
loader behavior, or stronger build isolation becomes an explicit product requirement.

## External references

[Bazel sandboxing](https://bazel.build/versions/8.3.0/docs/sandboxing) distinguishes dependency
isolation and platform-specific enforcement. [Node's permission documentation](https://github.com/nodejs/node/blob/main/doc/api/permissions.md)
explains limitations relevant to native code; it is not evidence that apack has such enforcement.
