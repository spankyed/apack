#!/usr/bin/env python3
"""Metadata-only receipt for the full private paired corpus; never prints source text or vectors."""
import argparse
import hashlib
import json
from pathlib import Path

EXPECTED = {
    'corpus.f32': (613785600, '07483f2744b8c71fa788884f0f3b268403fd36e4e2303c585e390c973a53ad7f'),
    'queries.f32': (614400, '89322f980622e74f4942db843017216e363d5a2ac5bb446c622b8fdecf9d35a9'),
    'corpus-ids.jsonl': (8343427, '94494d8b24feea74d496e4e622572f55b182c170c1900213f1e77e562116b792'),
    'queries-ids.jsonl': (8018, '78c72404a494de0239c8e7d5b3aa0cc6393a8b4fc01ec5572355c92421d0d141'),
}


def digest(file):
    sha = hashlib.sha256()
    with file.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            sha.update(chunk)
    return sha.hexdigest()


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--corpus', required=True, type=Path)
parser.add_argument('--output', required=True, type=Path)
args = parser.parse_args()
root = args.corpus.resolve()
manifest = json.loads((root/'manifest.json').read_text())
assert manifest['repository'] == 'https://huggingface.co/datasets/Qdrant/dbpedia-entities-openai3-text-embedding-3-small-1536-100K'
assert manifest['revision'] == '0d5fd00fbc5a9c0c836d70cd409f7e461255e572'
assert manifest['counts'] == {'corpus': 99900, 'queries': 100}
assert manifest['textFields'] == ['title', 'text', 'combined_text'] and manifest['privatePayloadOnly']
for name, (size, expected_hash) in EXPECTED.items():
    assert (root/name).stat().st_size == size and digest(root/name) == expected_hash, name
counts = {}
for kind, count in manifest['counts'].items():
    name = kind+'-text.jsonl'
    assert digest(root/name) == manifest['files'][name]['sha256']
    paired = 0
    with (root/(kind+'-ids.jsonl')).open() as identities, (root/name).open() as texts:
        for identity_line, text_line in zip(identities, texts, strict=True):
            identity, text = json.loads(identity_line), json.loads(text_line)
            assert all(text[key] == value for key, value in identity.items())
            assert identity['row'] == paired
            assert (identity['sourceOrdinal'] % 1000 == 0) == (kind == 'queries')
            assert all(isinstance(text[field], str) for field in manifest['textFields']) and text['combined_text'].strip()
            paired += 1
    assert paired == count
    counts[kind] = paired
report = {'completed': True, 'protocol': 'ears-private-paired-corpus-qualification/1',
          'manifestSha256': digest(root/'manifest.json'), 'sourceRevision': manifest['revision'],
          'paired': counts, 'unchangedOriginalVectorAndIdentityFiles': list(EXPECTED),
          'receiptContainsPayload': False, 'scope': 'Full source/identity/vector/text pairing only; not hybrid relevance or performance qualification'}
with args.output.open('x') as target:
    json.dump(report, target, indent=2)
    target.write('\n')
print(json.dumps(report))
