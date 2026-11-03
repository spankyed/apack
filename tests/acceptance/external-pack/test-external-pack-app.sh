#!/usr/bin/env bash
# The half of the external-pack check that needs the built app: each fixture pack's Playwright suite, run
# from the pack directory against this checkout. Extra args are forwarded to Playwright.
#
# It does not build the packs, and `--prebuilt` is what makes that true of the fixture as well as of this
# script. test-external-pack-contract.sh builds them, and the chain orders it first (its FIXTURE_OUTPUTS are
# this step's inputs). Rebuilding here would cost ~6s a fixture to buy nothing — and worse than nothing:
# `apack pack build` clears `dist` before its first phase, so a rebuild in this step makes each fixture look
# unbuilt for the length of it, to this step's own installer and to any concurrent reader of `tests/packs`.
# A pack that is not built, or built before its sources, is still said out loud rather than quietly fixed:
# the fixture refuses a stale build under --prebuilt, and the installer names a missing one.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
APACK="$ROOT/node_modules/.bin/apack"
export APACK_HOST="$ROOT"
source "$ROOT/tests/acceptance/external-pack/support.sh"
"$ROOT/node_modules/.bin/tsx" "$ROOT/tests/acceptance/external-pack/prepare-default-pack-fork.ts" --check

for PACK in "${FIXTURE_PACKS[@]}"; do
  if [ ! -d "$PACK/dist" ]; then
    echo "$PACK is not built. Run npm run test:external-pack:contract first." >&2
    exit 1
  fi
done

# Normal launches over repository-owned temporary storage verify fork preservation, removal and restoration.
# The public CLI's test isolation policy is retained; this runner owns its explicit fixture environment. Its
# first launch is the fork test itself, so the fixture suite leaves that test to it rather than running it twice.
#
# It runs beside the fixture suites, on its own data dir and output directory, only where the machine has the
# cores for another app. On a 3-vCPU runner two apps slowed a pack disable past its 5s assertion, so a smaller
# machine runs it after the suites.
fork_pid=""
fork_after=0
exclude=()
if [ "$#" -eq 0 ]; then
  exclude=(--grep-invert 'externally built default fork')
  if [ "$(node -p 'require("node:os").availableParallelism()')" -ge 6 ]; then
    fork_log="$(mktemp)"
    "$ROOT/node_modules/.bin/tsx" "$ROOT/tests/acceptance/external-pack/test-default-pack-fork.ts" >"$fork_log" 2>&1 &
    fork_pid=$!
  else
    fork_after=1
  fi
fi

status=0
for PACK in "${FIXTURE_PACKS[@]}"; do
  cd "$PACK"
  "$APACK" pack test --host "$ROOT" --prebuilt ${exclude[@]+"${exclude[@]}"} "$@" || { status=$?; break; }
done

if [ "$fork_after" -eq 1 ] && [ "$status" -eq 0 ]; then
  "$ROOT/node_modules/.bin/tsx" "$ROOT/tests/acceptance/external-pack/test-default-pack-fork.ts" || status=$?
fi
if [ -n "$fork_pid" ]; then
  fork_status=0
  wait "$fork_pid" || fork_status=$?
  echo "--- default fork lifecycle (exit $fork_status) ---"
  cat "$fork_log"
  rm -f "$fork_log"
  if [ "$status" -eq 0 ]; then status=$fork_status; fi
fi
exit "$status"
