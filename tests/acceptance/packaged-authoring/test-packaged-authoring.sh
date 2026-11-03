#!/usr/bin/env bash
# Both halves of the packaged-authoring check, in order, for running it by hand. The chain runs them as two
# steps: the author half needs no app and runs beside the typechecks, the app half needs one and runs after
# `build:runtime` (`needsApp`, scripts/lib/chain-steps.ts).
#
# Both halves run as bash here rather than through their npm scripts, so this takes one outer bound — the
# `scenario` one its own npm script carries — and not each half's as well. The same shape as
# `test-external-pack.sh`, for the same reason.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
bash "$HERE/test-packaged-authoring-author.sh"
bash "$HERE/test-packaged-authoring-app.sh"
