#!/usr/bin/env python3
"""Independent Float64 cosine truth over the sealed private Float32 projection.

Run only in the capped disposable Linux environment; no SQLite/ANN dependency.
Outputs row ordinals and scores, never source IDs, text or embedding payloads.
"""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import platform
import resource
import time

import numpy as np


def sha256(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--corpus', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
parser.add_argument('--partition', choices=('original', 'fresh'), default='original')
args = parser.parse_args()
assert platform.system() == 'Linux' and Path('/.dockerenv').exists()
assert np.__version__ == '2.5.4'
assert os.environ.get('OPENBLAS_NUM_THREADS') == '1'
limits = {name: Path('/sys/fs/cgroup', name).read_text().strip()
          for name in ('cpu.max', 'memory.max', 'memory.swap.max')}
assert limits == {'cpu.max': '200000 100000', 'memory.max': '6442450944', 'memory.swap.max': '0'}
assert not args.output.exists()
manifest = json.loads((args.corpus / 'manifest.json').read_text())
assert manifest['dimensions'] == 1536 and manifest['counts'] == {'corpus': 99900, 'queries': 100}
assert manifest['files']['corpus.f32']['sha256'] == '07483f2744b8c71fa788884f0f3b268403fd36e4e2303c585e390c973a53ad7f'
assert manifest['files']['queries.f32']['sha256'] == '89322f980622e74f4942db843017216e363d5a2ac5bb446c622b8fdecf9d35a9'
for name in ('corpus.f32', 'queries.f32'):
    path = args.corpus / name
    assert path.stat().st_size == manifest['files'][name]['bytes']
    assert sha256(path) == manifest['files'][name]['sha256']
corpus = np.memmap(args.corpus / 'corpus.f32', dtype='<f4', mode='r', shape=(99900, 1536))
selected = np.array([499 + 999 * j for j in range(100)], dtype=np.int64)
excluded = np.zeros(99900, dtype=bool)
if args.partition == 'fresh':
    excluded[selected] = True
    ordinals = np.arange(99900)
    excluded |= (ordinals % 100 == 7) & np.isin((ordinals + 31337) % 99900, selected)
    query_bytes = np.ascontiguousarray(corpus[selected], dtype='<f4').tobytes()
    queries = corpus[selected].astype(np.float64)
else:
    query_bytes = (args.corpus / 'queries.f32').read_bytes()
    queries = np.frombuffer(query_bytes, dtype='<f4').reshape(100, 1536).astype(np.float64)
canonical_queries = queries.copy()
assert np.isfinite(queries).all()
query_norms = np.linalg.norm(queries, axis=1)
assert (query_norms > 0).all()
queries /= query_norms[:, None]
report = {'protocol': 'ears-real-vector-fresh-truth/1' if args.partition == 'fresh' else 'ears-real-vector-truth/1', 'qualification': False,
          'partition': args.partition, 'queriesSha256': hashlib.sha256(query_bytes).hexdigest(),
          'queryOrdinals': selected.tolist() if args.partition == 'fresh' else None,
          'excludedOrdinals': np.flatnonzero(excluded).tolist(),
          'exclusionsSha256': hashlib.sha256(np.flatnonzero(excluded).astype('<u4').tobytes()).hexdigest(),
          'scalarChecks': [],
          'recipeSha256': sha256(Path(__file__)), 'numpy': np.__version__, 'limits': limits,
          'manifestSha256': sha256(args.corpus / 'manifest.json'),
          'metric': 'Float64 cosine over canonical Float32; descending score then ascending zero-based corpus ordinal',
          'eligibility': 'ordinal % 100 < scopePercent; trash when ordinal % 97 == 0; exclude frozen partition ordinals',
          'update': 'replace rows with ordinal % 100 == 7 by original corpus[(ordinal+31337)%99900]',
          'k': 10, 'cohorts': []}
start = time.monotonic()
for size in (1000, 10000, 99900):
    for phase in ('initial', 'updated'):
        # Only N*100 scalar scores reside in RAM, not an N*1536 Float64 corpus.
        scores = np.empty((size, 100), dtype=np.float64)
        for offset in range(0, size, 2048):
            ordinals = np.arange(offset, min(offset + 2048, size))
            source = np.where((ordinals % 100 == 7) & (phase == 'updated'),
                              (ordinals + 31337) % 99900, ordinals)
            batch = corpus[source].astype(np.float64)
            assert np.isfinite(batch).all()
            norms = np.linalg.norm(batch, axis=1)
            assert (norms > 0).all()
            scores[offset:offset + len(batch)] = (batch / norms[:, None]) @ queries.T
        ordinals = np.arange(size)
        for percent in (100, 10, 1):
            eligible = ordinals[(ordinals % 100 < percent) & (ordinals % 97 != 0) & ~excluded[:size]]
            answers = []
            for q in range(100):
                ordered = eligible[np.lexsort((eligible, -scores[eligible, q]))][:10]
                assert len(ordered) == min(10, len(eligible))
                answers.append({'query': q, 'ordinals': ordered.tolist(),
                                'cosines': scores[ordered, q].tolist()})
            # Independent scalar fsum over canonical Float32 inputs checks matrix accumulation.
            for q in (0, 37, 99):
                ordinal = answers[q]['ordinals'][0]
                source = (ordinal + 31337) % 99900 if phase == 'updated' and ordinal % 100 == 7 else ordinal
                left = [float(value) for value in corpus[source]]
                right = [float(value) for value in canonical_queries[q]]
                scalar = math.fsum(a*b for a, b in zip(left, right)) / math.sqrt(
                    math.fsum(a*a for a in left) * math.fsum(b*b for b in right))
                matrix = float(scores[ordinal, q])
                assert abs(scalar - matrix) < 1e-12
                report['scalarChecks'].append({'size': size, 'phase': phase, 'scopePercent': percent,
                    'query': q, 'ordinal': ordinal, 'scalarCosine': scalar, 'matrixCosine': matrix})
            report['cohorts'].append({'size': size, 'phase': phase, 'scopePercent': percent,
                                      'eligible': len(eligible), 'answers': answers})
        print(json.dumps({'size': size, 'phase': phase, 'elapsedSeconds': time.monotonic() - start}), flush=True)
report['seconds'] = time.monotonic() - start
report['maxRssKiB'] = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
with args.output.open('x') as output:
    json.dump(report, output, indent=2)
    output.write('\n')
