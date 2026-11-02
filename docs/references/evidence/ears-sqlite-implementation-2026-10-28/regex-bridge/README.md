# Owned portable regex bridge and package assets — 2026-10-28

The candidate now owns the controlled default-allocator rregex runtime in EARS vendor/rregex, preserving the
upstream license, source revision, build features and exact asset hashes. No stock npm rregex dependency is
added. The [allocator-control recipe](../regex-allocator-control/README.md) identifies the exact source,
locked dependencies, compiler and bindings generator. Normal package builds stage these portable CJS/WASM
runtime files; they require no Rust build. Compiler/target trees remain in Linux.

The private src/sqlite/regex.ts compiler loads its binding lazily and synchronously. Importing/constructing
it performs no asset read or WASM initialization. Compiled patterns own one Rust allocation, close explicitly
and idempotently, and refuse use after close. Rust syntax/size refusals become PATTERN_INVALID with pattern
and cause retained. Loader errors and WASM runtime traps retain their original identity instead of being
reported as user syntax errors. This helper is not exported by the public package and is not yet wired to
query execution; the three containing/matching failures remain open.

## Packaging and freshness

EARS files includes vendor/rregex, and the same directory is a build input alongside src/. Tests change each
runtime/provenance file's virtual digest and prove its build key changes; removing the declared directory makes
all three cases fail. A full affected build-input run initially catches the generated CJS being walked by root
lint without a matching lint cache input. Root lint/fix now exclude the generated vendor directory. Its runtime
assets remain protected by hash, loading and build-freshness checks; handwritten source retains normal lint.
The initial failure is retained; the final 64-case build-input suite passes.

A real npm pack of the normal staged tree includes CJS, WASM, provenance and the upstream license. A fresh
child loads and executes the matcher from **source, staged output and the unpacked tarball**, so relative
asset resolution is tested outside the checkout's source condition. No Rust toolchain or external rregex
package is needed by those consumers. This proves package assets, not Electron signing/native packaging or
all supported operating systems; those remain in the goal.

## Verification

Disposable Linux arm64 / Node 23.11.1 / 2 CPUs / 6 GiB passes:

- EARS types and 19 focused matcher/cache/module-state cases; restored tests pass after mutations.
- Five safeguard mutations fail: eager loading, omitted free, removed closed guard, runtime-trap relabeling,
  or missing vendor build input. The final matcher cases add bounded child-process deadlines and all 11 pass.
- Full SQLite **364 pass, three known substring/regex failures**. This is not complete-candidate acceptance.
- All five packages build, all three EARS API reports remain unchanged, and actual source/staged/packed
  matcher loading succeeds. No normal application backend switch is made.
- Final full **64 build-input cases**, repository import/pack boundaries and root/workspace lint pass
  (zero warnings/errors). Only the generated vendor directory is added to root lint exclusions.

Logs, mutations, packed file listing, source/manifest/runtime hashes and runners are retained here. The current
public strict gate is the earlier 194c72c77c candidate; these local descendants need their own exact gate.
