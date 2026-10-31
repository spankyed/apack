# Hosted backend activation attribution at9db369afa5 — 2026-10-31

Run41184048338 completes both isolated normal APIs and real RPC pack activations on hosted
macOS26/arm64. Diagnostic lint/Python checks and normal packages/shipped-pack/API builds pass.
SQLite activation takes5357.929ms, elmdb4257.873ms. SQLite observes197 commits (176primary,
21history), totaling421.155ms. Write/finish/commit spans overlap; do not add them together.
Ordinary acknowledgment defaults differ (SQLiteFULL; nativegroupcommit), so this is not a
pure backend-speed comparison. It does not replace the renderer's five-second acceptance.

Sampled stacks point to repeated catalog/settings compilation in both backends: about2.75s
SQLite/2.57s native under _compileSettingsDefinition, with about2.05s/1.89s under meta-schema
compilation. These are inclusive sampled wall intervals, not disjoint CPU or syscall time.
Raw profiles, function locations, process CPU counters, SQL spans and source/build hashes are
retained. Profiling adds overhead, including inspector control work outside the RPC stopwatch.

Source inspection finds a new Ajv per settings definition, recompiling its built-in meta-schema
when fresh catalog snapshots are parsed. The next change reuses only a lazy meta-schema checker;
every definition still receives a fresh private Ajv reference registry, strict compilation,
cloned schema and validated defaults. Invalid schema metadata is explicitly checked first.
This follows Ajv's [schema management guidance](https://ajv.js.org/guide/managing-schemas) and
[validation API](https://ajv.js.org/api.html). It avoids caching mutable definitions or sharing
pack reference namespaces. New tests cover different local references under a reused root$id
and revalidation of changed metadata. The implementation is not accepted until affected SDK/
host checks, a new profile and the original focused renderer case validate it.
