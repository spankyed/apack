# Starter authoring toolchain

## Phase 3 local transport check

Tested apack source commit `d51cbdec82b2aaaf2d0ba48cb8a7b39b436957ce` on macOS arm64.
The pack input was the external Phase 0 scaffold at `bb6ebb3`, extracted into a new temporary directory.

- `npm ci`, `npm run packages:ensure`, `npm exec -- tsc -p scripts` and `npm run packages:check` passed in the producer worktree.
- `npm run packages:stage-toolchain -- /private/tmp/apack-authoring-candidates` staged four npm tarballs with the commit, dependency URLs and SHA-256 digests in `toolchain.json`. A second staging attempt refused the existing directory.
- A loopback HTTP server delivered the exact tarballs from that directory. The disposable scaffold declared those URLs and the pinned elmdb and EARS release overrides. Lockfile generation recorded all four URL and SHA-512 integrity pairs, which were independently compared to the bytes on disk. Clean `npm ci` then installed the toolchain without a sibling apack checkout or global CLI.
- The disposable pack passed validation, typechecking, its registration test, build and facade checks. The project-local CLI created a pack archive with seven receipt entries.
- This verifies the npm tarball transport using loopback HTTP and the existing hosted dependency pins. The real GitHub toolchain release and the full production pack's configured consumer build still require their own acceptance.

## Disposable production export

Exported `packages/default-setup` at apack `d54dcff6f3` into a temporary project. That source remains
the comparison baseline. The export used the same local HTTP tarballs and the actual hosted upstream
dependency URLs. This experiment identifies changes for the eventual transfer PR.

- Replaced workspace-only setup with the package-local CLI and SDK schema path. Declared the Git and
  terminal-view tarball URLs directly. EARS and elmdb stayed transitive overrides. Kept the Vite
  version and Tiptap family coherent with the host lockfile so npm could resolve peers.
- Declared Sass and the inherited direct imports from Vue Flow, Lucide, Monaco, Reka, Vidstack and
  XState in the pack manifest. Supplied a key for a null Vue breadcrumb ID and inlined the published
  UI package in the Vitest frontend project so Vitest transformed its CSS.
- With the host's `ai@7.0.100`, `rollup@4.65.1` and `rollup-plugin-dts@6.4.1`, all six compiled
  content files, the facade and the Monaco DSL definitions matched the in-tree baseline. Of the
  snapshot fields, only the manifest's SDK schema path and its consequential declaration revision
  differed.
- `npm run typecheck`, `npm run build`, `npm run facade:check`, `npm run archive` and `npm test`
  passed. The final suite reported 283 files and 1795 tests passed, with one file and six tests
  skipped. The archive's SHA-256 was
  `b05d96f5817b28ad6178b6756c9bc7fa1d613a4a4056bf3cc352ece8a4a82885`.
- Installed that archive using the regular local installer in a new profile and booted the Phase 1
  macOS preview. The installed receipt stayed byte-for-byte equal to the archive's and distinct
  from the app's copy. The main window displayed the starter letter and served its stylesheet over
  `pack://` at build revision `a4f0b07b5a95672a8319047b2688210045909fc06039cc3d51e92f5ac61442a2`.

The standalone project was disposable. Final transfer must use the selected production source
commit and real hosted toolchain, and verify the release notices and packaged acceptance there.
