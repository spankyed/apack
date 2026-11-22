# Starter onboarding and selection baseline

The Phase 1 preview was built from the app worktree at `86e2d29890` on macOS arm64. Two disposable copies used the same Electron, backend and renderer. One had an empty `shipped-packs/` directory. The other had the Phase 0 scaffold (`spankyed/default-setup` at `bb6ebb3`) rebuilt under the ID `alternate-starter` with `npm run build` and `npm run archive`. Phase 1 staging verified the archive's seven-file receipt and SHA-256 `cc6986c4249073d5cf9f1e405450ae954470ace7c7f935931c12ffde463dadcd`. For the selection test the alternate copy's build manifest identified it as `0.3.14-preview.2`. The original and empty copy identified themselves as `0.3.14-preview.1`.

- The unmodified renderer reached onboarding on a fresh empty profile. The Packs button disappeared after backend connection and the welcome slot had no provider.
- With onboarding dismissed through the existing test hook, the empty preview could install the alternate archive through Packs. Reopening the same empty profile with the alternate selection silently installed B. Reopening an original A profile with the alternate selection silently installed B alongside A. The test verified the same data directory across both launches. This isolates selection behavior from the onboarding gate. Phase 2 still needs to prove both upgrade paths after the profile policy changes.

## Onboarding fix

- On `session/starter-optional-onboarding`, all 119 shell tests passed. The new cases checked the host-only shell, a delayed welcome from another pack, and navigation recovery after its provider was unloaded. Host and renderer typechecks and `npm run check:specifiers` passed.
- `npm run build-only --workspace @app/renderer` built the fixed renderer. With only that renderer replaced in disposable Phase 1 preview copies, a fresh empty profile opened Settings and Packs and installed the alternate archive. A fresh profile with the alternate starter already shipped opened Packs without a welcome screen. The official starter still showed the dev letter on a fresh profile. The desktop checks used Playwright and left the onboarding test hook untouched.
