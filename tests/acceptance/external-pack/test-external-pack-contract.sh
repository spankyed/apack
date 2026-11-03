#!/usr/bin/env bash
# The half of the external-pack check that needs no app: validate each fixture pack, build it, typecheck it
# against its generated facades, and run its harness specs. The same path a third-party pack author takes.
#
# Its own file rather than a flag on one script, and that is not style. `check:tiers` reads a step's scripts
# as text to find out whether it can reach the app, and a branch it never takes still reads as a reach — so a
# `--contract` mode inside the script that also runs `apack pack test` defeats the check meant to keep the halves
# apart. Two files make the dependency structural (docs/goals/goal-test-tiers.md).
#
# Proved by running this with packages/renderer/dist moved aside: 32 tests, exit 0, no app.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
APACK="$ROOT/node_modules/.bin/apack"
# Packs depending on a built-in pack (the fixture on default-setup) resolve it from this checkout
export APACK_HOST="$ROOT"
source "$ROOT/tests/acceptance/external-pack/support.sh"

for PACK in "${FIXTURE_PACKS[@]}"; do
  cd "$PACK"
  "$APACK" pack validate
  "$APACK" pack build
  "$ROOT/node_modules/.bin/tsc" --noEmit -p "$PACK"
  # Harness specs, where the pack has them. Through the CLI, so this runs what a pack author runs:
  # `apack pack test --contract` is a no-op with a message when a pack has no vitest config.
  "$APACK" pack test --contract
done
