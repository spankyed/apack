#!/usr/bin/env bash
set -euo pipefail
# Mutate only the runner-owned disposable Linux copy; never the authored checkout.
test "$(pwd)" = /work
export APACK_THREAD_FAULT="${1:-full-read}"
case "$APACK_THREAD_FAULT" in full-read|missing-completion) ;; *) exit 2 ;; esac
APACK_PERFORMANCE_SCENARIO=thread-counterfactual APACK_PERFORMANCE_MODE=lightweight APACK_PERFORMANCE_TRIALS=1 xvfb-run -a npm run test:e2e -- --config tests/performance/playwright.config.ts --grep "$APACK_THREAD_FAULT"
