#!/usr/bin/env python3
"""Validate retained fresh EARS records and report unchanged measured gates.

Exit 1 means complete measurements missed a gate; malformed evidence raises instead.
This verifies recorded measurements, not installed-app or production acceptance.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path


def percentile(values, fraction):
    ordered = sorted(values)
    return ordered[max(0, math.ceil(len(ordered) * fraction) - 1)]


def verify_summary(values, recorded):
    assert values and all(math.isfinite(value) and value >= 0 for value in values)
    assert recorded['count'] == len(values)
    for key, fraction in [('p50', .5), ('p95', .95), ('p99', .99), ('max', 1)]:
        assert abs(recorded[key] - percentile(values, fraction)) < 1e-9


def verify(report, truth, truth_bytes):
    assert report['completed'] is True and not report.get('failure')
    assert report['partition'] == 'fresh' and report['native'] is True and report['diagnostic'] is False
    assert truth['protocol'] == 'ears-real-vector-fresh-truth/1'
    assert report['truthSha256'] == hashlib.sha256(truth_bytes).hexdigest()
    assert report['querySha256'] == truth['queriesSha256']
    assert report['exclusionsSha256'] == truth['exclusionsSha256']
    assert report['manifestSha256'] == truth['manifestSha256']
    assert report['synchronous'] == 2
    assert len(report['source']) == 40
    assert report['initialCanonicalRowsVerified'] == report['size']
    assert report['updatedCanonicalRowsVerified'] == report['size']
    assert report['modelAdmission']['state']['state'] == 'ready'
    assert report['modelAdmission']['state']['samples'] <= 20000
    excluded = set(truth['excludedOrdinals'])
    wanted = {(size, phase, percent) for size in (1000, 10000, 99900)
              if size <= report['size'] for phase in ('initial', 'updated') for percent in (100, 10, 1)}
    assert {(c['size'], c['phase'], c['scopePercent']) for c in report['cohorts']} == wanted
    assert len(report['cohorts']) == len(wanted)
    outcomes = []
    for cohort in report['cohorts']:
        key = (cohort['size'], cohort['phase'], cohort['scopePercent'])
        expected = next(c for c in truth['cohorts'] if (c['size'], c['phase'], c['scopePercent']) == key)
        assert cohort['eligible'] == expected['eligible']
        assert [p['pass'] for p in cohort['passes']] == [0, 1, 2, 3]
        passes = []
        for run in cohort['passes']:
            assert run['timed'] == (run['pass'] != 0)
            assert [s['q'] for s in run['samples']] == list(range(100))
            recalls = []
            for sample, answer in zip(run['samples'], expected['answers']):
                assert sample['q'] == answer['query']
                ordinals, scores = sample['ordinals'], sample['scores']
                assert len(ordinals) == len(set(ordinals)) == len(answer['ordinals']) == len(scores)
                assert all(0 <= i < cohort['size'] and i % 100 < cohort['scopePercent']
                           and i % 97 != 0 and i not in excluded for i in ordinals)
                assert all(math.isfinite(score) and abs(score) <= 1.0001 for score in scores)
                assert all(a >= b for a, b in zip(scores, scores[1:]))
                assert all(a < b for a, b, left, right in zip(ordinals, ordinals[1:], scores, scores[1:]) if left == right)
                recall = len(set(ordinals) & set(answer['ordinals'])) / len(answer['ordinals'])
                assert abs(sample['recall'] - recall) < 1e-12
                recalls.append(recall)
            mean = sum(recalls) / 100
            assert abs(run['meanRecall'] - mean) < 1e-12
            verify_summary([s['ms'] for s in run['samples']], run['latencyMs'])
            verify_summary(run['heartbeatSamples'], run['heartbeatMs'])
            assert run['nativeCandidateCalls'] >= 100 if cohort['eligible'] > 4096 else run['nativeCandidateCalls'] == 0
            latency_limit = 100 if cohort['size'] == 10000 else 200
            passes.append({'pass': run['pass'], 'meanRecall': mean,
                           'latencyP95Ms': run['latencyMs']['p95'], 'heartbeatP99Ms': run['heartbeatMs']['p99'],
                           'recallPassed': mean >= .95, 'heartbeatPassed': run['heartbeatMs']['p99'] <= 16,
                           'latencyPassed': cohort['size'] < 10000 or run['latencyMs']['p95'] <= latency_limit})
        outcomes.append({'size': key[0], 'phase': key[1], 'scopePercent': key[2], 'passes': passes})
    query_passed = all(p['recallPassed'] and p['heartbeatPassed'] and p['latencyPassed'] for c in outcomes for p in c['passes'])
    assert report['frozenGatesPassed'] == query_passed
    admission = report['modelAdmission']
    verify_summary(admission['heartbeatSamples'], admission['heartbeatMs'])
    return {'protocol': 'ears-fresh-vector-verification/1', 'source': report['source'], 'size': report['size'],
            'evidenceValid': True, 'queryGatesPassed': query_passed,
            'admissionHeartbeatP99Ms': admission['heartbeatMs']['p99'],
            'admissionHeartbeatPassed': admission['heartbeatMs']['p99'] <= 16,
            'productionAcceptance': False, 'cohorts': outcomes}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('report', type=Path)
    parser.add_argument('truth', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    truth_bytes = args.truth.read_bytes()
    result = verify(json.loads(args.report.read_text()), json.loads(truth_bytes), truth_bytes)
    with args.output.open('x') as output:
        json.dump(result, output, indent=2)
        output.write('\n')
    raise SystemExit(0 if result['queryGatesPassed'] and result['admissionHeartbeatPassed'] else 1)
