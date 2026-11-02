#!/usr/bin/env python3
"""Independent hybrid-probe recall truth; capped disposable Linux only, no database imports."""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import time

import numpy as np


def sha(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--corpus', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
assert Path('/.dockerenv').exists() and os.environ.get('OPENBLAS_NUM_THREADS') == '1'
assert np.__version__ == '2.5.4' and not args.output.exists()
limits = {name: Path('/sys/fs/cgroup', name).read_text().strip()
          for name in ['cpu.max', 'memory.max', 'memory.swap.max']}
assert limits == {'cpu.max': '200000 100000', 'memory.max': '6442450944', 'memory.swap.max': '0'}
manifest = json.loads((args.corpus / 'manifest.json').read_text())
assert manifest['dimensions'] == 1536 and manifest['counts'] == {'corpus': 99900, 'queries': 100}
for name in ['corpus.f32', 'queries.f32']:
    assert sha(args.corpus / name) == manifest['files'][name]['sha256']
    assert (args.corpus / name).stat().st_size == manifest['files'][name]['bytes']
corpus = np.memmap(args.corpus / 'corpus.f32', dtype='<f4', mode='r', shape=(99900, 1536))
heldout = np.memmap(args.corpus / 'queries.f32', dtype='<f4', mode='r', shape=(100, 1536))
report = {'protocol': 'ears-hybrid-vector-truth/1', 'completed': False, 'containsPayload': False,
          'manifestSha256': sha(args.corpus / 'manifest.json'), 'recipeSha256': sha(Path(__file__)),
          'limits': limits, 'numpy': np.__version__, 'k': 64,
          'metric': 'Float64 cosine over canonical Float32; descending cosine then ascending corpus ordinal',
          'cohorts': [], 'scalarChecks': []}
started = time.monotonic()
for size in [1000, 10000, 99900]:
    anchors = np.array([q * size // 100 for q in range(100)])
    canonical = np.concatenate([heldout, corpus[anchors]]).astype(np.float64)
    assert np.isfinite(canonical).all()
    norms = np.linalg.norm(canonical, axis=1)
    assert (norms > 0).all()
    queries = canonical / norms[:, None]
    scores = np.empty((size, 200), dtype=np.float64)
    for offset in range(0, size, 2048):
        batch = corpus[offset:min(size, offset + 2048)].astype(np.float64)
        assert np.isfinite(batch).all()
        batch_norms = np.linalg.norm(batch, axis=1)
        assert (batch_norms > 0).all()
        scores[offset:offset + len(batch)] = (batch / batch_norms[:, None]) @ queries.T
    ordinals = np.arange(size)
    for name, stride in [('all-live', 1), ('candidate-10-percent', 10), ('candidate-1-percent', 100)]:
        eligible = ordinals[ordinals % stride == 0]
        answers = []
        for query in range(200):
            ordered = eligible[np.lexsort((eligible, -scores[eligible, query]))][:64]
            answers.append({'family': 'held-out-title' if query < 100 else 'corpus-lexical-control',
                            'query': query % 100, 'ordinals': ordered.tolist()})
            if query in [0, 37, 99, 100, 137, 199]:
                owner = int(ordered[0])
                left, right = corpus[owner].tolist(), canonical[query].tolist()
                scalar = math.fsum(a * b for a, b in zip(left, right)) / math.sqrt(
                    math.fsum(a * a for a in left) * math.fsum(b * b for b in right))
                assert abs(scalar - float(scores[owner, query])) < 1e-12
                report['scalarChecks'].append({'size': size, 'cohort': name, 'query': query,
                                              'scalar': scalar, 'matrix': float(scores[owner, query])})
        report['cohorts'].append({'size': size, 'cohort': name, 'eligible': len(eligible), 'answers': answers})
report['seconds'] = time.monotonic() - started
report['completed'] = True
with args.output.open('x') as output:
    json.dump(report, output)
    output.write('\n')
