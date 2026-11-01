#!/usr/bin/env python3
"""Validate all language-trial cases without changing the original acceptance gate."""
import argparse
import hashlib
import json
import math
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--fixture', required=True, type=Path)
parser.add_argument('--report', required=True, type=Path)
parser.add_argument('--source', required=True)
parser.add_argument('--output', required=True, type=Path)
args = parser.parse_args()
fixture_bytes = args.fixture.read_bytes()
fixture = json.loads(fixture_bytes)
report = json.loads(args.report.read_text())
assert report['protocol'] == 'ears-text-language-diagnostic/1'
assert report['completed'] is True and report['qualification'] is False and report['containsPayload'] is False
assert report['source'] == args.source and report['fixtureSha256'] == hashlib.sha256(fixture_bytes).hexdigest()
assert len(fixture['cases']) == 25 and len(report['groups']) == 4
summary = {'protocol': 'ears-text-language-receipt/1', 'completed': True, 'qualification': False,
           'source': args.source, 'fixtureSha256': report['fixtureSha256'],
           'scope': 'All frozen judgments under two explicit language configurations; no acceptance waiver', 'groups': []}
seen = set()
for group in report['groups']:
    key = group['backend'], group['stem']
    assert key in {(b, s) for b in ['elmdb', 'sqlite'] for s in ['none', 'en']} and key not in seen
    seen.add(key)
    assert group['completed'] is True and group['databaseScratchRemoved'] is True
    assert group['fields'] == {'name': 3, 'body': 1} and len(group['cases']) == 25
    ordinals, passed = set(), 0
    for row in group['cases']:
        ordinal = row['ordinal']
        assert type(ordinal) is int and 0 <= ordinal < 25 and ordinal not in ordinals
        ordinals.add(ordinal)
        assert type(row['returned']) is int and 0 <= row['returned'] <= fixture['cases'][ordinal]['topK']
        assert type(row['matchedRelevant']) is bool and type(row['highlightPassed']) is bool
        assert row['highlightExpected'] is bool(fixture['cases'][ordinal].get('highlight'))
        assert type(row['ms']) in (int, float) and math.isfinite(row['ms']) and row['ms'] >= 0
        if row['matchedRelevant']:
            assert row['returned'] > 0
        passed += bool(row['matchedRelevant'] and row['highlightPassed'])
    assert passed == group['passed'] and 25 - passed == group['failed']
    summary['groups'].append({'backend': key[0], 'stem': key[1], 'passed': passed, 'failed': 25 - passed, 'skipped': 0})
with args.output.open('x') as output:
    json.dump(summary, output, indent=2)
    output.write('\n')
