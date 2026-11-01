"""Pure actual-runner controls; fake child reports establish protocol, never native performance."""
import contextlib
import io
import json
import pathlib
import runpy
import subprocess
import sys
import tempfile
from unittest.mock import patch

repo = pathlib.Path.cwd()
script = repo / 'packages/apack-ears/bench/sqlite/checkpoint-admission.py'
sys.path.insert(0, str(script.parent))
limits = {'cpu.max': '200000 100000', 'memory.max': '6442450944', 'memory.swap.max': '0'}
provenance = {'commit': 'a' * 40, 'elmdbObservedCommit': 'b' * 40, 'elmdbPinnedCommit': 'b' * 40,
              'cpuModels': ['controlled'], 'sqliteNative': {'bindings': [{'sha256': 'c' * 64}]}}
read_text = pathlib.Path.read_text
for mode in ['ok', 'budget', 'cpu', 'nan', 'policy', 'exit', 'instrumented', 'limits', 'bindings']:
    calls = []
    with tempfile.TemporaryDirectory(prefix='ears-checkpoint-control-') as temporary:
        output = pathlib.Path(temporary) / 'report'
        def read(path, *args, **kwargs):
            if str(path.parent) == '/sys/fs/cgroup': return limits[path.name]
            return read_text(path, *args, **kwargs)
        def run(command, **kwargs):
            pages = int(command[-1].split('=')[1]); calls.append(pages)
            budgets = {name: {'actual': 1, 'limit': limit} for name, limit in {
                'admissionMs': 100, 'operationP99Ms': 16, 'lookupP99Ms': 16,
                'turnWaitP99Ms': 16, 'heartbeatDelayP99Ms': 16,
                'maxObservedWalBytes': 16777216, 'maxObservedFilesBytes': 16777216}.items()}
            value = {'checkpointPages': pages, 'checkpointProbe': {'pages': pages, 'qualification': False},
                     'n': 100000, 'syncs': True, 'indexKind': 'value', 'admissionReads': 0, 'writes': 1,
                     'cpuModels': ['controlled'], 'nativeBindings': [{'sha256': 'c' * 64}],
                     'batchSamples': [{'ms': 1}], 'samples': {'heartbeatDelays': [1]}, 'budgets': budgets, 'passed': True}
            code = 0
            if mode == 'budget': budgets['heartbeatDelayP99Ms']['actual'] = 17; value['passed'] = False; code = 1
            if mode == 'cpu': value['cpuModels'] = ['wrong']
            if mode == 'nan': budgets['heartbeatDelayP99Ms']['actual'] = float('nan')
            if mode == 'policy': value['checkpointPages'] = 999
            if mode == 'exit': code = 7
            if mode == 'instrumented': value['diagnostic'] = {}
            if mode == 'limits': budgets['heartbeatDelayP99Ms']['limit'] = 100
            if mode == 'bindings': value['nativeBindings'][0]['sha256'] = 'd' * 64
            return subprocess.CompletedProcess(command, code, json.dumps(value), 'retained child stderr')
        problem = None
        with patch.object(sys, 'argv', [str(script), str(output)]), patch.object(pathlib.Path, 'read_text', read), \
             patch('runtime_provenance.capture_runtime_provenance', return_value=provenance), \
             patch('subprocess.run', run), contextlib.redirect_stdout(io.StringIO()):
            try: runpy.run_path(str(script), run_name='__main__')
            except AssertionError as error: problem = error
        receipt = json.loads((output / 'matrix.json').read_text())
        if mode in ['ok', 'budget']:
            assert problem is None and receipt['completed'] and receipt['qualification'] is False
            assert calls == [1000, 128, 128, 1000, 1000, 128]
            assert all(row['valid'] and row['budgetsPassed'] is (mode == 'ok') for row in receipt['records'])
        else:
            assert problem is not None and not receipt['completed'] and calls == [1000]
            assert receipt['records'][0]['valid'] is False and receipt['failure']['type'] == 'AssertionError'
        assert (output / '1000-1.stderr').read_text() == 'retained child stderr'
print(json.dumps({'controls': 9, 'passed': True, 'scope': 'Pure actual-runner protocol controls with fake native children; no workload or performance evidence'}))
