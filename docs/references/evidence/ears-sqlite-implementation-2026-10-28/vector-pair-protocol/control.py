#!/usr/bin/env python3
"""Receipt validation controls using historical numeric reports with explicitly synthetic build metadata."""
import copy
import gzip
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile

sys.dont_write_bytecode = True
root = Path(__file__).resolve().parents[5]
script = root / 'packages/apack-ears/bench/sqlite/compare-vector-builds.py'
spec = importlib.util.spec_from_file_location('pair_receipt', script)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
history = Path(__file__).resolve().parent.parent / 'corpus-cd4/corpus'
source = 'cd4aaa8bfa49eea102cadd888e9397e856906808'
fixtures = {}
for variant in ['generic', 'dispatch']:
    for size in [1000, 10000, 99900]:
        report = json.loads(gzip.decompress((history / f'hybrid-{size}.json.gz').read_bytes()))
        report['runId'] = '1'
        report['nativeVectorRuntime'] = 'version 0.8 (' + ('Scalar' if variant == 'generic' else 'AVX2') + ', multi-threaded)'
        report['nativeExtensionSha256'] = ('a' if variant == 'generic' else 'b') * 64
        report['nativeDiagnostic'] = None if variant == 'generic' else {
            'kind': 'upstream-x64-runtime-dispatch', 'baselineExtensionSha256': 'a' * 64, 'provenanceSha256': 'c' * 64}
        if size > 4096:
            report['nativeModel']['extension_sha256'] = report['nativeExtensionSha256']
            report['nativeModel']['worker_sha256'] = 'd' * 64
            report['nativeModel']['native_version'] = report['nativeVectorRuntime']
        fixtures[variant, size] = report

outcomes = []
with tempfile.TemporaryDirectory(prefix='ears-pair-protocol-') as temporary:
    directory = Path(temporary)
    (directory / 'corpus-manifest.json').write_bytes(gzip.decompress((history / 'corpus-manifest.json.gz').read_bytes()))
    def write(values):
        for (variant, size), report in values.items():
            (directory / variant).mkdir(exist_ok=True)
            (directory / variant / f'hybrid-{size}.json').write_text(json.dumps(report))
    write(fixtures)
    result = module.compare(directory, source)
    assert result['completed'] and len(result['groups']) == 18 and result['vectorRecallAccepted']
    assert result['heartbeatAccepted'] is False, 'Historical heartbeat failures must not become accepted'
    outcomes.append({'case': 'complete synthetic pair, original heartbeat failures retained', 'passed': True})
    def refuse(name, mutation):
        values = copy.deepcopy(fixtures)
        mutation(values)
        write(values)
        try:
            module.compare(directory, source)
        except (AssertionError, KeyError, ValueError):
            outcomes.append({'case': name, 'passed': True})
        else:
            raise AssertionError('Invalid pair accepted: ' + name)
    refuse('different CPU', lambda f: f['dispatch', 1000].update(cpuModels=['different CPU']))
    refuse('different run', lambda f: f['dispatch', 1000].update(runId='2'))
    refuse('different source', lambda f: f['dispatch', 1000].update(source='0' * 40))
    refuse('different limits', lambda f: f['dispatch', 1000]['limits'].update({'memory.max': '1'}))
    refuse('different oracle', lambda f: f['dispatch', 1000].update(oracleSha256='e' * 64))
    refuse('same artifact', lambda f: f['dispatch', 1000].update(nativeExtensionSha256='a' * 64))
    refuse('invalid artifact hash', lambda f: f['dispatch', 1000].update(nativeExtensionSha256='invalid'))
    refuse('wrong baseline', lambda f: f['dispatch', 1000]['nativeDiagnostic'].update(baselineExtensionSha256='e' * 64))
    refuse('missing provenance', lambda f: f['dispatch', 1000]['nativeDiagnostic'].pop('provenanceSha256'))
    refuse('wrong actual backend', lambda f: f['dispatch', 1000].update(nativeVectorRuntime='version 0.8 (Scalar, multi-threaded)'))
    refuse('wrong worker', lambda f: f['dispatch', 10000]['nativeModel'].update(worker_sha256='e' * 64))
    refuse('wrong worker artifact', lambda f: f['dispatch', 10000]['nativeModel'].update(extension_sha256='e' * 64))
    refuse('wrong worker backend', lambda f: f['dispatch', 10000]['nativeModel'].update(native_version='version 0.8 (Scalar, multi-threaded)'))
    refuse('missing sample', lambda f: f['dispatch', 1000]['samples'].pop())
    refuse('changed candidate policy', lambda f: f['dispatch', 1000].update(nativeCandidateFloor=1024))
    values = copy.deepcopy(fixtures)
    for sample in values['dispatch', 1000]['samples']:
        sample['vectorRecall']['10'] = 0
    write(values)
    output = directory / 'refused.json'
    child = subprocess.run([sys.executable, str(script), '--results', str(directory), '--source', source,
                            '--output', str(output)], capture_output=True, text=True)
    refused = json.loads(output.read_text())
    assert child.returncode != 0 and refused['vectorRecallAccepted'] is False and refused['failure']
    outcomes.append({'case': 'low recall refuses CLI success and retains receipt', 'passed': True})
print(json.dumps({'protocol': 'ears-vector-pair-protocol-control/1', 'completed': True,
                  'scope': 'Historical numeric receipts plus synthetic build metadata; no native execution or performance evidence',
                  'outcomes': outcomes}, indent=2))
