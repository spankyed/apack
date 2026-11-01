#!/usr/bin/env python3
"""Require every frozen app judgment on both backends; publish counts, never payloads."""
import argparse
import hashlib
import json
import math
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--fixture', required=True, type=Path)
parser.add_argument('--results', required=True, type=Path)
parser.add_argument('--source', required=True)
parser.add_argument('--output', required=True, type=Path)
args = parser.parse_args()
fixture_bytes = args.fixture.read_bytes()
fixture = json.loads(fixture_bytes)
assert len(fixture['cases']) == 25
model = json.loads((args.results/'model.json').read_text())
assert model['completed'] is True and model['modelCacheRemoved'] is True and model['containsPayload'] is False
assert model['fixtureSha256'] == hashlib.sha256(fixture_bytes).hexdigest()
summary = {'completed': True, 'qualification': False, 'protocol': 'ears-app-hybrid-judgments/1',
           'source': args.source, 'fixtureSha256': model['fixtureSha256'], 'modelRevision': model['modelRevision'],
           'scope': 'All frozen app judgments, one pinned English model; not text-only or full search acceptance', 'backends': {}}
for backend in ['elmdb', 'sqlite']:
    report = json.loads((args.results/(backend+'.json')).read_text())
    assert report['completed'] is True and report['backend'] == backend and report['source'] == args.source
    assert report['fixtureSha256'] == model['fixtureSha256'] and report['vectorsSha256'] == model['vectorsSha256']
    assert report['modelRevision'] == model['modelRevision'] and report['containsPayload'] is False
    assert len(report['cases']) == 25
    seen, passed = set(), 0
    for case in report['cases']:
        ordinal = case['ordinal']
        assert type(ordinal) is int and 0 <= ordinal < 25 and ordinal not in seen
        seen.add(ordinal)
        assert type(case['returned']) is int and 0 <= case['returned'] <= fixture['cases'][ordinal]['topK']
        assert type(case['matchedRelevant']) is bool and type(case['highlightPassed']) is bool
        assert case['highlightExpected'] is bool(fixture['cases'][ordinal].get('highlight'))
        assert type(case['ms']) in (int, float) and math.isfinite(case['ms']) and case['ms'] >= 0
        if case['matchedRelevant']:
            assert case['returned'] > 0
        passed += bool(case['matchedRelevant'] and case['highlightPassed'])
    assert seen == set(range(25)) and report['usefulnessPassed'] is (passed == 25)
    summary['backends'][backend] = {'passed': passed, 'failed': 25-passed, 'skipped': 0}
summary['usefulnessPassed'] = all(row['failed'] == 0 for row in summary['backends'].values())
with args.output.open('x') as output:
    json.dump(summary, output, indent=2)
    output.write('\n')
if not summary['usefulnessPassed']:
    raise SystemExit('At least one original usefulness/highlight judgment failed; all counts retained')
