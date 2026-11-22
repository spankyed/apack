# Starter release layout

## Phase 1 preview acceptance

Tested the Phase 1 changes on the worktree based at `d54dcff6f3` with Node 24.16.0 and npm 11.21.1 on macOS arm64.

- `npm run build:preview -- --version 0.3.14` built the unsigned preview. It shipped the verified flat pack below `Contents/Resources/app/shipped-packs/default-setup`. The old workspace manifest was absent from the bundle. Electron's packaged-output verifier checked the sealed inventory, including the pack receipt.
- Playwright launched that preview with a fresh profile. The main renderer displayed the compiled “A Letter from the Dev” and loaded `runtime/fe.css` over the revision-qualified `pack://` URL (HTTP 200, 210,142 bytes). The installed receipt matched the packaged receipt byte for byte.
- In a fresh directory outside the checkout, we installed the local published SDK, CLI and testing tarballs. With `APACK_HOST` set to the actual preview bundle, `npm run build` compiled a flow using the starter's `keepAlive()` step. The dependency record identified the preview's `shipped-packs/default-setup` directory and revision `f018cfd8a60be8328fb062d00708c1aaa36878f5009b4bbd6a79ebf66699b6df`. We independently recomputed the packaged layout's build revision and matched it to that record.
- Staging refused a modified archive against its original SHA-256 and refused the genuine archive for app version `0.2.0-preview.1`. Neither attempt published the destination.
- The packaged server, run under Electron's Node executable with non-loopback IP connections denied, installed the exact receipt, registered all 11 systems, applied compiled content, started the root flow and reached its WebSocket listener. The same outer macOS sandbox prevents the full desktop from starting its process inspection and renderer sandbox. Full desktop boot passed with its normal sandbox and network available. An end-to-end desktop launch on a host with external networking disabled remains to be verified.
- The shipped-pack, CLI host and preview verifier specs passed, 82 tests total. `npm run check:specifiers` passed.
