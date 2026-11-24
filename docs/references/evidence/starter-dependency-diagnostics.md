# Starter dependency diagnostics

Before the diagnostic, a CLI install could warn that a named dependency was missing. The Packs view had no equivalent after a provider was disabled or removed. This change reads the profile's accepted declarations, refused builds, enablement and activation failures when the Packs list is published. It reuses the manifest dependency parser so a version range inside a GitHub source is checked too.

The host fixture supplied `starter-b` with a starter role while a dependent still named `starter-a`. The list continued to name A as the required provider. It distinguished absence, a refused build, disablement, an incompatible version and activation failure. Restoring a compatible A cleared the warning. The renderer test checked the diagnostic in pack details.

This checkpoint covers user-visible diagnostics over the current host. Packaged role switching, ownership, retained data and restart across the integrated archive-layout builds remain Phase 2 acceptance.
