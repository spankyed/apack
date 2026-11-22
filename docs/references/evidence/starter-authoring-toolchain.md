# Starter authoring toolchain

## Phase 3 local transport check

Tested apack source commit `d51cbdec82b2aaaf2d0ba48cb8a7b39b436957ce` on macOS arm64.
The pack input was the external Phase 0 scaffold at `bb6ebb3`, extracted into a new temporary directory.

- `npm ci`, `npm run packages:ensure`, `npm exec -- tsc -p scripts` and `npm run packages:check` passed in the producer worktree.
- `npm run packages:stage-toolchain -- /private/tmp/apack-authoring-candidates` staged four npm tarballs with the commit, dependency URLs and SHA-256 digests in `toolchain.json`. A second staging attempt refused the existing directory.
- A loopback HTTP server delivered the exact tarballs from that directory. The disposable scaffold declared those URLs and the pinned elmdb and EARS release overrides. Lockfile generation recorded all four URL and SHA-512 integrity pairs, which were independently compared to the bytes on disk. Clean `npm ci` then installed the toolchain without a sibling apack checkout or global CLI.
- The disposable pack passed validation, typechecking, its registration test, build and facade checks. The project-local CLI created a pack archive with seven receipt entries.
- This verifies the npm tarball transport using loopback HTTP and the existing hosted dependency pins. The real GitHub toolchain release and the full production pack's configured consumer build still require their own acceptance.
