# Schema structure, references and stored-declaration validation — 2026-10-28

The SQLite candidate now compiles its app declaration structure with a per-owner Ajv 8.20.0 validator. This is
the same version already used by SDK settings; EARS declares its own direct dependency and imports no SDK code.
Compilation is cached on the database instance, outside writer ownership. Validation does not coerce values,
remove keys or supply defaults. A JSON-only/depth check rejects undefined, dates/bytes, nonfinite numbers,
non-plain objects and cycles before MessagePack cloning or recursive schema validation.

Structural validation covers root language/options, named definitions, recursive field rules, optional/nullable
flags, enums, reference/list shape, prefix shape, relation flags/endpoints/info, index variants and numeric
weights/dimensions. Explicit semantic checks resolve references, validate names/reserved fields, reject duplicate
prefixes, verify index source existence/compatibility and refuse unsupported execution semantics. These checks
run before BEGIN/layout/index/metadata writes. The existing incumbent-prefix refusal remains inside writer
ownership, after the schema-revision check. Old row contents are not revalidated during declaration admission;
unchecked imports and admitting new required fields retain their established contracts.

Valid lower-level options the candidate does not implement are refused with UNSUPPORTED, including constrained
relation endpoints/cardinality/info, refusing extra fields, exact text analysis, non-English stemming and
non-cosine/f32 vector modes. These are not silently accepted. The public EARS facade only exposes a subset of
those lower-level options; language/search decisions and full app adoption acceptance remain in the goal.
Value-index compound/uniqueness declarations retain their existing SCHEMA_INVALID refusal. This is not a promise
to support every elmdb storage-schema option as a separate product.

Stored declarations are validated before loading their indexes on read/write or read-only reopen. Malformed
stored declarations refuse as CORRUPT with the SCHEMA_INVALID cause retained. Unsupported valid declarations
retain UNSUPPORTED. Constructor failure uses the existing owned-connection cleanup. Admitted locale strings now
reach Intl.Collator (root uses the und locale); previously the query code incorrectly read locale/options off a
string and silently fell back to en. The Swedish text-order case pins the repaired behavior; broad ICU/native
locale equivalence and packaged-platform qualification are not claimed.

## Verification

Private disposable Linux (Node 23.11.1, arm64, 2 CPUs / 6 GiB, immutable native 6ab2f69) passes:

- EARS types and **80 focused cases**, initially and restored after mutation checks.
- **Six independent mutations** fail meaningful assertions: omit structural validation, omit declared-reference
  checks, accept unsupported cardinality, omit duplicate-prefix checking, omit JSON-only validation, or omit
  stored-schema validation.
- The malformed-case matrix compares **32 cases** against the pinned native parser, which refuses them with
  SCHEMA_INVALID and unchanged schema. Capability refusals are deliberate SQLite differences, not native refusals.
- Schema refusal cases preserve data, schema/commit sequence, SQL objects and value-index generations, leave no
  transaction open and allow a subsequent ordinary write. Reopen cases cover both read/write and read-only.
- Full SQLite **347 pass, three fail**: the same inherited containing/matching cases. No full-candidate green claim.
- All five publishable packages build through normal packages:build, then **all three EARS API reports pass**
  unchanged. No compiler/full validation or Rust build ran on the daily Mac.

Full results, source/manifest/lock hashes and runners are retained here. The first new-test run had a shared
nested-rule fixture mutation; cloning each raw fixture corrected it before rerunning the matrix. An initial API
attempt correctly refused because only EARS was freshly built; final validation built the normal five-package
prerequisites and did not bypass the guard. Both earlier logs are retained separately.

The published candidate under strict run 40703362139 is still 194c72c77c and does not yet contain this change.
Live pack registration, background search/vector admission, true I/O failures, sustained load and platform
acceptance remain required. Current schema/format-one representation still shares the temporary native-schema
translation; this work does not settle the final post-adoption storage interface.

Ajv usage follows its [compile/reuse guidance](https://ajv.js.org/guide/getting-started.html) and
[validation options](https://ajv.js.org/options.html). Declaration semantics remain owned by EARS.
