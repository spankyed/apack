#!/usr/bin/env python3
"""Validate complete numeric hybrid receipts; never reads or publishes private corpus payloads."""
import argparse
import hashlib
import json
import math
from pathlib import Path

COHORTS = {'all-live': 1, 'candidate-10-percent': 10, 'candidate-1-percent': 100}
FAMILIES = {'held-out-title', 'corpus-lexical-control'}


def finite(value):
    return type(value) in (int, float) and math.isfinite(value) and value >= 0


def percentile(values, fraction):
    return sorted(values)[max(0, math.ceil(len(values) * fraction) - 1)] if values else None


def validate_reopen(report, size):
    if 'reopen' not in report:
        return
    passes = report['reopen']['passes']
    assert len(passes) == 3 and [row['pass'] for row in passes] == [0, 1, 2]
    expected = {(cohort, family, query) for cohort in COHORTS for family in FAMILIES for query in [0, 37, 99]}
    for row in passes:
        assert finite(row['openMs']) and finite(row['closeAndDrainMs'])
        samples = row['samples']
        assert len(samples) == len(expected)
        assert {(s['cohort'], s['family'], s['query']) for s in samples} == expected
        for sample in samples:
            assert sample['matchesWarm'] is True
            assert sample['returned'] == min(10, math.ceil(size / COHORTS[sample['cohort']]))
            assert finite(sample['ms']) and all(finite(delay) for delay in sample['heartbeatDelaysMs'])
        assert finite(row['resources']['usage']['maxRSS']) and row['resources']['usage']['maxRSS'] > 0


def validate_resource_snapshots(report):
    if 'cpuModels' in report:
        assert isinstance(report['cpuModels'], list) and report['cpuModels']
        assert all(isinstance(model, str) and model.strip() for model in report['cpuModels'])
    if 'resourceSnapshots' not in report:
        return
    snapshots = report['resourceSnapshots']
    assert set(snapshots) == {'afterAdmission', 'afterQueriesAndReferences', 'afterDiagnostics'}
    peaks = []
    for snapshot in snapshots.values():
        assert set(snapshot) == {'memory', 'usage', 'files'}
        memory, usage, files = snapshot['memory'], snapshot['usage'], snapshot['files']
        assert all(finite(memory[key]) for key in ['rss', 'heapTotal', 'heapUsed', 'external', 'arrayBuffers'])
        assert memory['rss'] > 0 and memory['heapTotal'] >= memory['heapUsed']
        assert all(finite(usage[key]) for key in ['maxRSS', 'userCPUTime', 'systemCPUTime'])
        assert usage['maxRSS'] > 0
        assert set(files) == {'mainBytes', 'walBytes', 'shmBytes', 'otherBytes', 'totalBytes'}
        assert all(type(value) is int and value >= 0 for value in files.values())
        assert files['mainBytes'] > 0
        assert files['totalBytes'] == sum(value for key, value in files.items() if key != 'totalBytes')
    for name in ['afterAdmission', 'afterQueriesAndReferences', 'afterDiagnostics']:
        peaks.append(snapshots[name]['usage']['maxRSS'])
    assert peaks == sorted(peaks)
    assert report['maxRssKiB'] == snapshots['afterQueriesAndReferences']['usage']['maxRSS']
    assert report['memoryAfterQueries'] == snapshots['afterQueriesAndReferences']['memory']


def validate(report, size, source, manifest_hash):
    validate_resource_snapshots(report)
    validate_reopen(report, size)
    assert report['protocol'] == 'ears-private-real-hybrid/1'
    assert report['completed'] is True and report['databaseScratchRemoved'] is True
    assert report['qualification'] is False and report['containsPayload'] is False
    assert report['source'] == source and report['manifestSha256'] == manifest_hash
    assert report['size'] == size and report['queries'] == 200
    assert report['queryFamilies'] == {'heldOut': 100, 'lexicalControls': 100}
    assert report['synchronous'] == 2 and finite(report['loadMs'])
    if 'limits' in report:
        assert report['limits'] == {'cpu.max': '200000 100000', 'memory.max': '6442450944', 'memory.swap.max': '0'}
    if 'vectorRecallReference' in report:
        assert report['vectorRecallReference'] == 'independent-float64-canonical-f32'
        for key in ['oracleSha256', 'oracleRecipeSha256']:
            assert isinstance(report[key], str) and len(report[key]) == 64
            assert all(char in '0123456789abcdef' for char in report[key])
        checks = report['oracleScalarChecks']
        assert {(row['cohort'], row['query']) for row in checks} == {
            (cohort, query) for cohort in COHORTS for query in [0, 37, 99, 100, 137, 199]}
        assert len(checks) == 18
        assert all(row['size'] == size and math.isfinite(row['scalar']) and math.isfinite(row['matrix'])
                   and abs(row['scalar'] - row['matrix']) < 1e-12 for row in checks)
    if 'nativeCandidateFloor' in report:
        assert report['nativeCandidateFloor'] in (None, 1024, 2048)
        assert report['nativeCandidateFloor'] is None or report['modelMode'] == 'managed'
    if 'nativeVectorRuntime' in report:
        if report['modelMode'] == 'managed':
            assert isinstance(report['nativeVectorRuntime'], str) and report['nativeVectorRuntime']
        else:
            assert report['nativeVectorRuntime'] is None
    if 'modelMode' in report:
        assert report['modelMode'] in {'fallback', 'managed'}
        assert report['nativeModelOwnerStarted'] is (report['modelMode'] == 'managed')
        if report['modelMode'] == 'managed':
            assert report['exactVectorChunkLimit'] == 4096
            required = size > 4096
            assert report['nativeModelRequired'] is required and report['nativeModelReady'] is required
            model = report['nativeModel']
            if required:
                assert model['state'] == 'ready' and type(model['samples']) is int and 64 <= model['samples'] <= 20000
                for key in ['model_sha256', 'extension_sha256']:
                    assert isinstance(model[key], str) and len(model[key]) == 64
                    assert all(char in '0123456789abcdef' for char in model[key])
            else:
                assert model is None
            assert finite(report['nativeAdmission']['ms'])
            assert all(finite(value) for value in report['nativeAdmission']['heartbeatDelaysMs'])
    assert finite(report['maxRssKiB']) and report['maxRssKiB'] > 0
    assert len(report['samples']) == 600
    if 'diagnostics' in report:
        assert len(report['diagnostics']) == 3
        assert {row['cohort'] for row in report['diagnostics']} == set(COHORTS)
        for row in report['diagnostics']:
            assert row['statementCount'] > 0 and row['statements']
            assert any(statement['distanceScoring'] for statement in row['statements'])
            for statement in row['statements']:
                assert set(statement) == {'sqlSha256', 'distanceScoring', 'returnedRows', 'ms', 'plan'}
                assert finite(statement['ms']) and finite(statement['returnedRows'])
    if 'nativeProbeComparison' in report:
        assert report['modelMode'] == 'managed' and report['nativeCandidateFloor'] is None
        expected = {(cohort, family, query, probe, k)
                    for cohort, stride in COHORTS.items() if math.ceil(size / stride) > 4096
                    for family in FAMILIES for query in range(0, 100, 10)
                    for probe in [8, 16, 32] for k in [10, 40, 64]}
        rows = report['nativeProbeComparison']
        assert len(rows) == len(expected)
        assert {(r['cohort'], r['family'], r['query'], r['nprobe'], r['k']) for r in rows} == expected
        for row in rows:
            fields = {'cohort', 'family', 'query', 'nprobe', 'k', 'nativeCalls', 'returned', 'recall', 'ms'}
            if 'nativePages' in row:
                fields |= {'nativePages', 'bqFallback'}
                assert type(row['bqFallback']) is bool and len(row['nativePages']) == row['nativeCalls']
                for page in row['nativePages']:
                    assert set(page) == {'limit', 'returned'}
                    assert type(page['limit']) is int and 1 <= page['limit'] <= 4096
                    assert type(page['returned']) is int and 0 <= page['returned'] <= page['limit']
            assert set(row) == fields
            assert type(row['nativeCalls']) is int and row['nativeCalls'] > 0
            assert row['returned'] == row['k'] and finite(row['ms'])
            assert finite(row['recall']) and row['recall'] <= 1
    if 'ownerProjection' in report:
        expected = {(cohort, limit) for cohort, stride in COHORTS.items()
                    if math.ceil(size / stride) > 4096 for limit in [256, 1024, 2048]}
        assert {(row['cohort'], row['limit']) for row in report['ownerProjection']} == expected
        assert len(report['ownerProjection']) == len(expected)
        for row in report['ownerProjection']:
            assert len(row['samples']) == 3 and {s['trial'] for s in row['samples']} == {0, 1, 2}
            for sample in row['samples']:
                assert set(sample) == {'trial', 'returned', 'ownerMs', 'rowidMs', 'mappingMs'}
                assert type(sample['returned']) is int and 0 <= sample['returned'] <= row['limit']
                assert all(finite(sample[key]) for key in ['ownerMs', 'rowidMs', 'mappingMs'])
    seen, groups = set(), {}
    for sample in report['samples']:
        cohort, family, query = sample['cohort'], sample['family'], sample['query']
        assert cohort in COHORTS and family in FAMILIES and type(query) is int and 0 <= query < 100
        key = cohort, family, query
        assert key not in seen
        seen.add(key)
        eligible = math.ceil(size / COHORTS[cohort])
        assert sample['vectorMatches'] == eligible and sample['returned'] == min(10, eligible)
        assert type(sample['textMatches']) is int and 0 <= sample['textMatches'] <= eligible
        if cohort == 'all-live' and family == 'corpus-lexical-control':
            assert sample['textMatches'] > 0
        assert finite(sample['ms']) and all(finite(value) for value in sample['heartbeatDelaysMs'])
        if report.get('fusionPolicy') == 'global-vector-window-max-40-4k':
            assert report['fusionVectorDepth'] == 40
            assert finite(sample['fullRankingOverlapAt10']) and sample['fullRankingOverlapAt10'] <= 1
        if 'vectorPolicy' in report:
            assert report['vectorPolicy'] in {'bounded-64-with-256-owner-pool', 'adaptive-native-owner-pool'}
            if report['vectorPolicy'] == 'adaptive-native-owner-pool':
                assert report['nativeOwnerTargets'] == {'through32': 256, 'through40': 1024, 'through64': 2048}
                assert report['fallbackOwnerTarget'] == 256
            assert set(sample['vectorRecall']) == {'10', '40', '64'}
            assert all(finite(value) and value <= 1 for value in sample['vectorRecall'].values())
        if report.get('nativeCandidateFloor') == 2048:
            assert report['matchedCandidateWidths'] == ['production', '1024', '2048']
            assert set(sample['candidateWidths']) == {'production', '1024', '2048'}
            for measurements in sample['candidateWidths'].values():
                assert set(measurements) == {'10', '40', '64'}
                assert all(set(value) == {'recall', 'ms'} and finite(value['recall'])
                           and value['recall'] <= 1 and finite(value['ms']) for value in measurements.values())
        groups.setdefault((cohort, family), []).append(sample)
    assert seen == {(c, f, q) for c in COHORTS for f in FAMILIES for q in range(100)}
    results = []
    for (cohort, family), samples in sorted(groups.items()):
        timings = [sample['ms'] for sample in samples]
        heartbeat = [value for sample in samples for value in sample['heartbeatDelaysMs']]
        limit = {1000: None, 10000: 100, 99900: 200}[size]
        p95, pulse99 = percentile(timings, .95), percentile(heartbeat, .99)
        results.append({'size': size, 'cohort': cohort, 'family': family, 'samples': len(samples),
                        'p50Ms': percentile(timings, .5), 'p95Ms': p95, 'p99Ms': percentile(timings, .99),
                        'maxMs': max(timings), 'heartbeatP99Ms': pulse99,
                        'meanFullRankingOverlapAt10': sum(s['fullRankingOverlapAt10'] for s in samples) / len(samples) if 'fusionPolicy' in report else None,
                        'modelMode': report.get('modelMode', 'not-recorded'),
                        'nativeCandidateFloor': report.get('nativeCandidateFloor'),
                        'matchedMeanVectorRecall': {width: {str(k): sum(s['candidateWidths'][width][str(k)]['recall'] for s in samples) / len(samples) for k in [10, 40, 64]} for width in ['production', '1024', '2048']} if report.get('nativeCandidateFloor') == 2048 else None,
                        'matchedVectorP95Ms': {width: {str(k): percentile([s['candidateWidths'][width][str(k)]['ms'] for s in samples], .95) for k in [10, 40, 64]} for width in ['production', '1024', '2048']} if report.get('nativeCandidateFloor') == 2048 else None,
                        'vectorRecallReference': report.get('vectorRecallReference', 'same-engine-exact'),
                        'meanVectorRecall': {str(k): sum(s['vectorRecall'][str(k)] for s in samples) / len(samples) for k in [10, 40, 64]} if 'vectorPolicy' in report else None,
                        'vectorRecallTarget': .95,
                        'latencyDiagnosticLimitMs': limit, 'heartbeatDiagnosticLimitMs': 16,
                        'latencyWithinDiagnosticLimit': p95 <= limit if limit is not None else None,
                        'heartbeatWithinDiagnosticLimit': pulse99 <= 16 if pulse99 is not None else None})
    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--results', type=Path, required=True)
    parser.add_argument('--source', required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    manifest_hash = hashlib.sha256((args.results / 'corpus-manifest.json').read_bytes()).hexdigest()
    groups = []
    for size in [1000, 10000, 99900]:
        report = json.loads((args.results / f'hybrid-{size}.json').read_text())
        assert all(key in report for key in ['cpuModels', 'resourceSnapshots', 'reopen', 'nativeVectorRuntime']), 'Current runs must record resources, CPU/runtime metadata and three reopen passes'
        groups.extend(validate(report, size, args.source, manifest_hash))
    receipt = {'completed': True, 'protocol': 'ears-real-hybrid-matrix-receipt/1', 'source': args.source,
               'queriesVerified': 1800, 'groups': groups, 'qualification': False,
               'scope': 'Complete warm fusion diagnostic under recorded execution conditions; not full relevance/app/resource certification'}
    receipt['vectorRecallAccepted'] = all(group['meanVectorRecall'] is None or all(value >= .95 for value in group['meanVectorRecall'].values()) for group in groups)
    with args.output.open('x') as output:
        json.dump(receipt, output, indent=2)
        output.write('\n')
    if not receipt['vectorRecallAccepted']:
        raise SystemExit('At least one scope/family fails the unchanged 0.95 vector recall target; raw samples and receipt retained')


if __name__ == '__main__':
    main()
