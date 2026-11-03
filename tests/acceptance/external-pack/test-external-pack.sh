#!/usr/bin/env bash
# External fixture contracts, fork preparation and app checks, in order, for running by hand. The chain uses
# separate producers: fixture contracts and the default-pack fork need no app; Playwright consumes
# their output after `build:runtime`. Extra args are forwarded to Playwright.
#
# The combined command takes its existing outer scenario bound. The chain bounds each producer separately.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
bash "$HERE/test-external-pack-contract.sh"
"$HERE/../../../node_modules/.bin/tsx" "$HERE/prepare-default-pack-fork.ts"
bash "$HERE/test-external-pack-app.sh" "$@"
