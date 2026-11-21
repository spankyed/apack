# Changesets

Versions the published packages `@apackdev/sdk`, `@apackdev/ui`, `@apackdev/cli` and `@apackdev/testing` together (one
fixed group). EARS, which the SDK depends on, is `@elmdb/ears`, elmdb's package, versioned there. The app's own version is owned by `build/release/release.sh`.

```bash
npx changeset          # describe a change to the packages
npx changeset version  # bump versions + changelogs (the publish workflow does this in a PR)
npm run packages:publish -- --dry-run
```

`npm run packages:build` builds the publishable package trees. `@apackdev/sdk` and `@apackdev/ui` publish from `packages/<name>/publish/`, with checkout-only source exports removed.
`@apackdev/cli` and `@apackdev/testing` stay `private` in the workspace
and publish the bundled copy the build writes to `packages/<name>/dist/package`
(`scripts/publish-packages.ts`, run by `.github/workflows/publish-packages.yml`).
