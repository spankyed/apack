#!/usr/bin/env bash
# Invoked inside the existing per-worktree Linux runner, never on the Mac.
set -euo pipefail
[[ "$(uname -s)" == Linux && -f /.dockerenv ]] || { echo 'Use npm run test:linux for this fixture' >&2; exit 2; }
if ! command -v xvfb-run >/dev/null || ! command -v xclip >/dev/null; then
  apt-get update -qq
  apt-get install -y --no-install-recommends xvfb xauth xclip python3 procps fonts-dejavu-core
fi
if [[ "${1:-}" == pdf-pages-app ]] && ! command -v pdftoppm >/dev/null; then
  apt-get update -qq
  apt-get install -y --no-install-recommends poppler-utils
fi
export APACK_CHAIN_CORES=2
# test:linux already prepares the published packages and platform-specific default pack.
npm run build:runtime -- --cores 2
# The original CLI refuses bypass-capable sessions as root. Keep its guard intact.
if [[ "$(id -u)" == 0 ]]; then
  evidence="${APACK_CLAUDE_RESEARCH_OUTPUT:-/work/.claude-research}"
  mkdir -p "$evidence"
  chown node:node "$evidence"
  mkdir -p /work/.apack/tests /work/tests/results
  chown -R node:node /work/.apack/tests /work/tests/results
  exec runuser -u node -- xvfb-run -a -s '-screen 0 1280x1024x24' python3 scripts/claude-research-ci.py --linux-container "${1:-action-panes-app}"
fi
exec xvfb-run -a -s '-screen 0 1280x1024x24' python3 scripts/claude-research-ci.py --linux-container "${1:-action-panes-app}"
