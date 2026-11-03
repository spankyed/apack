# The external fixture packs, sourced by the contract and app halves so neither drifts from the other.
# external-pack uses the host's @apackdev/ui; bundled-ui-pack bundles its own (fe.bundleUi).
FIXTURE_PACKS=(
  "$ROOT/tests/packs/external-pack"
  "$ROOT/tests/packs/bundled-ui-pack"
)
