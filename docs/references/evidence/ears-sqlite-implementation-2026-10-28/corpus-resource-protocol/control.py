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

reopen = {'reopen': {'passes': [{
    'pass': iteration, 'openMs': 1, 'closeAndDrainMs': 2,
    'resources': copy.deepcopy(snapshot),
    'samples': [{'cohort': cohort, 'family': family, 'query': query,
                 'ms': 1, 'heartbeatDelaysMs': [2], 'returned': 10, 'matchesWarm': True}
                for cohort in module.COHORTS for family in module.FAMILIES for query in [0, 37, 99]]
} for iteration in range(3)]}}
module.validate_reopen(reopen, 10000)
module.validate_reopen({}, 10000)
mutations = [
    lambda r: r['reopen']['passes'].pop(),
    lambda r: r['reopen']['passes'][1].update({'pass': 0}),
    lambda r: r['reopen']['passes'][0].update(openMs=float('nan')),
    lambda r: r['reopen']['passes'][0]['samples'].pop(),
    lambda r: r['reopen']['passes'][0]['samples'][0].update(matchesWarm=False),
    lambda r: r['reopen']['passes'][0]['samples'][0].update(returned=9),
    lambda r: r['reopen']['passes'][0]['samples'][0].update(ms=-1),
    lambda r: r['reopen']['passes'][0]['samples'][0].update(heartbeatDelaysMs=[float('inf')]),
    lambda r: r['reopen']['passes'][0]['samples'][0].update(query=12),
]
for mutate in mutations:
    candidate = copy.deepcopy(reopen)
    mutate(candidate)
    try:
        module.validate_reopen(candidate, 10000)
    except (AssertionError, KeyError):
        pass
    else:
        raise AssertionError('Invalid reopen receipt accepted')
print('Complete three-pass reopen shape accepted; nine incomplete, mismatched or nonfinite reopen receipts refused.')
