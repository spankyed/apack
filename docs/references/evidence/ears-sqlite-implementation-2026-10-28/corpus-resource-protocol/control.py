"""Pure receipt controls; no corpus, native runtime or payload is accessed."""
import copy
import importlib.util
import sys
from pathlib import Path
sys.dont_write_bytecode = True
root = Path(__file__).resolve().parents[5]
spec = importlib.util.spec_from_file_location('qualifier', root / 'packages/apack-ears/bench/sqlite/qualify-real-hybrid.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
snapshot = {
    'memory': {'rss': 8192, 'heapTotal': 4096, 'heapUsed': 2048, 'external': 1024, 'arrayBuffers': 512},
    'usage': {'maxRSS': 8, 'userCPUTime': 100, 'systemCPUTime': 10},
    'files': {'mainBytes': 4096, 'walBytes': 512, 'shmBytes': 128, 'otherBytes': 64, 'totalBytes': 4800},
}
valid = {'cpuModels': ['control CPU'], 'resourceSnapshots': {
    name: copy.deepcopy(snapshot) for name in ['afterAdmission', 'afterQueriesAndReferences', 'afterDiagnostics']
}, 'maxRssKiB': 8, 'memoryAfterQueries': copy.deepcopy(snapshot['memory'])}
valid['resourceSnapshots']['afterDiagnostics']['usage']['maxRSS'] = 12
module.validate_resource_snapshots(valid)
# Earlier receipts remain inspectable, but current CLI qualification separately requires new fields.
module.validate_resource_snapshots({})
mutations = [
    lambda r: r.update(cpuModels=[]),
    lambda r: r['resourceSnapshots'].pop('afterAdmission'),
    lambda r: r.update(maxRssKiB=12),
    lambda r: r['memoryAfterQueries'].update(rss=1),
    lambda r: r['resourceSnapshots']['afterAdmission']['files'].update(totalBytes=999),
    lambda r: r['resourceSnapshots']['afterAdmission']['files'].update(walBytes=-1),
    lambda r: r['resourceSnapshots']['afterAdmission']['memory'].update(rss=float('nan')),
    lambda r: r['resourceSnapshots']['afterAdmission']['memory'].update(heapUsed=9999),
    lambda r: r['resourceSnapshots']['afterDiagnostics']['usage'].update(maxRSS=1),
]
for mutate in mutations:
    candidate = copy.deepcopy(valid)
    mutate(candidate)
    try:
        module.validate_resource_snapshots(candidate)
    except (AssertionError, KeyError):
        pass
    else:
        raise AssertionError('Invalid resource receipt accepted')
print('Two valid current/historical shapes accepted; nine malformed or misattributed resource receipts refused.')
