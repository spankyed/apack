# Migrations (`@apackdev/host/migrations`)

Versioned migrations represent deliberate future data changes. Historical pre-0.4 settings conversion
has been removed: normal settings writes and imports use the current contract. Do not recreate aliases,
fallback readers or invalid-value exemptions. Developer backup conversion, if needed, is a separately
invoked operation on a copy; it is not part of boot or import.

## Runners

API boot and app-data reset use `startPacks()`: pack `onInit`, `runAppMigrations(registry)`,
`runPackMigrations(targets)`, then content apply. Backup import replaces the store's contents with the accepted backup's and runs
the two migration runners directly; it does not reinitialize packs or reapply their content.

| Runner | Target version | Recorded version |
| --- | --- | --- |
| `runAppMigrations` | Registered packs' `migrations.app` targets at the host app version | `AppState.version` |
| `runPackMigrations` | Each pack's declared version and `migrations.pack` targets | `AppState.packVersions[packId]` |

A pack declares the version line; provenance does not select it. Native, shipped and external packs may use either line. The manifest key owns its target, and the value owns `description` and an `up` function export
reference. Modules export behavior only; codegen checks the export and assembles `PackMigration`.

Native composition declares the same keyed migrations in `NativePackDeclaration`. App-line migrations
need no native pack version; nonempty pack-line declarations require `NativePackDeclaration.version`.
Admission checks targets, descriptions and callable `up` bindings, then captures callback membership,
owner version and dependencies. Discovery imports no migration modules. Runtime target queries return
`packId` and callbacks, plus `version` for the pack line; they never manufacture an installed manifest or
directory. Native and installed owners share dependency ordering before a caller subset is selected.
Synthetic installed origins without accepted manifests cannot bind migration functions.

The host and default-setup currently declare no migrations. Add one only for a concrete supported data change, not hypothetical
old installations. The frontend runner (`src/fe/window-storage`) operates separately on window storage.

App migrations run when `stored < target <= app version`. A prerelease uses its release as the cap;
development runs pending targets without a cap. No recorded app version means new data at the current
version. Pack migrations compare the per-pack stored version with the pack's declared version. SemVer build metadata does not change precedence; the recorded value retains the full declared version.

A failure stops subsequent migrations and does not record success. `startPacks()` skips pack migrations
and content after an app migration failure; the next boot retries. Pack failures retain that pack's
recorded version. Idempotent guards are required because development/prerelease startup may run a
migration again. Reset clears app data and initializes the current state; import restores current data
before running applicable versioned migrations.

The app-line record is currently global. A pack disabled across an app upgrade cannot catch up its
app-line migrations independently. The replacement work must settle a per-pack record before enabling
that lifecycle; do not assume the existing runner already handles it.

## Adding a pack migration

Use `apack pack add migration <target>` for a pack version change, or add `--app` when the data follows
the host app version. The command writes the file and the manifest entry. Regenerate pack bindings and
validate the real lifecycle that runs the change.

```json
"migrations": {
  "pack": { "1.1.0": { "description": "Describe the change", "up": "src/migrations/1.1.0.ts#up" } }
}
```

Do not bump release metadata by hand. Keep each transformation idempotent, test failure/retry and
version recording, and update every owned consumer with the contract change.

Coverage: `tests/migrations/runner.spec.ts` checks version lines, release/prerelease/development behavior
and failures. `tests/services/host-runtime.spec.ts` checks startup/reset ordering. API
`tests/runtime/app-reset.spec.ts` exercises reset with built packs; `host-data-services.spec.ts` exercises
real current-format export/import, app completion and unavailable-pack override preservation.
