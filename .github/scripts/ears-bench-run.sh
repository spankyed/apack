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
python3 packages/apack-ears/bench/sqlite/run-bench.py /results/trials --trials 3 "$@"
