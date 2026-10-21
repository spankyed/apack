#!/usr/bin/env bash
# Invoked inside the existing per-worktree Linux runner, never on the Mac.
set -euo pipefail
[[ "$(uname -s)" == Linux && -f /.dockerenv ]] || { echo 'Use npm run test:linux for this fixture' >&2; exit 2; }
if ! command -v xvfb-run >/dev/null; then
  apt-get update -qq
  apt-get install -y --no-install-recommends xvfb xauth python3 procps fonts-dejavu-core
fi
export APACK_CHAIN_CORES=2
npm run build:runtime -- --cores 2
exec xvfb-run -a -s '-screen 0 1280x1024x24' python3 scripts/claude-research-ci.py --linux-container "${1:-action-panes-app}"
