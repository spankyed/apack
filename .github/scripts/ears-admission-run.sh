#!/usr/bin/env bash
set -euo pipefail
node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
const limits = Object.fromEntries(['cpu.max', 'memory.max', 'memory.swap.max'].map(name =>
  [name, readFileSync('/sys/fs/cgroup/' + name, 'utf8').trim()]));
assert.deepEqual(limits, { 'cpu.max': '200000 100000', 'memory.max': '6442450944', 'memory.swap.max': '0' });
writeFileSync('/results/limits.json', JSON.stringify(limits));
JS
if [ "${ADMISSION_TRACE:-false}" = true ]; then
  python3 packages/apack-ears/bench/sqlite/run-admission.py /results/trials --trace --trials 1 --sizes 100000 "$@"
else
  python3 packages/apack-ears/bench/sqlite/run-admission.py /results/trials --trials 3 --sizes 10000 100000 "$@"
fi
