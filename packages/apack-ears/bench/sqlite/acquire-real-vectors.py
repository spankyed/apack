#!/usr/bin/env python3
"""Project the pinned public Qdrant corpus privately, one verified shard/batch at a time.

Requires Python >=3.12, pyarrow==26.0.0 and numpy==2.5.4 in a disposable environment.
No model API, credential, text export or raw dataset commit. Original shards are removed after projection.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import urllib.request

import numpy as np
import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.parquet as pq

REPO = 'Qdrant/dbpedia-entities-openai3-text-embedding-3-small-1536-100K'
REVISION = '0d5fd00fbc5a9c0c836d70cd409f7e461255e572'
FIELD = 'text-embedding-3-small-1536-embedding'
DIMENSIONS = 1536
SHARDS = [
    ('train-00000-of-00004.parquet', 412654848, '30d3ef775f4a68c1ce3c9214ced4245a24b66b107eec82e3ad427fdda2d91cc8'),
    ('train-00001-of-00004.parquet', 412629827, '03dd0c3c9919d1df87fc247208a162d94e9581c2a19270baf25e1a373b3e3f33'),
    ('train-00002-of-00004.parquet', 412663807, '10adb6ed005ac8e4a52211e19116b919555887521ab664dab1cbb5fec4111a3a'),
    ('train-00003-of-00004.parquet', 412703035, '53ef785b78f0c69d02c6f6c32bf193d5fa859cb361be73b3c190b115411cdc4b'),
]

def digest(file):
    result = hashlib.sha256()
    with file.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            result.update(chunk)
    return result.hexdigest()

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output', required=True, type=Path, help='New private output directory; parent must exist')
args = parser.parse_args()
if platform.system() != 'Linux' or not (Path('/.dockerenv').exists() or os.environ.get('GITHUB_ACTIONS') == 'true'):
    raise SystemExit('Use a disposable Linux environment')
assert np.__version__ == '2.5.4' and pa.__version__ == '26.0.0'
assert sum(size for _, size, _ in SHARDS) < 2 * 10**9
output = args.output.resolve()
output.mkdir(mode=0o700)  # Refuse an incumbent, including an interrupted prior acquisition.
manifest = {'protocol': 'ears-public-real-vectors/1', 'repository': 'https://huggingface.co/datasets/' + REPO,
    'revision': REVISION, 'field': FIELD, 'dimensions': DIMENSIONS, 'dtype': '<f4',
    'querySelection': 'sourceOrdinal % 1000 == 0; held out from corpus', 'batchRows': 64,
    'tools': {'python': platform.python_version(), 'numpy': np.__version__, 'pyarrow': pa.__version__},
    'recipeSha256': digest(Path(__file__)), 'privatePayloadOnly': True,
    'attribution': 'Published by Qdrant; DBpedia-derived entity embeddings. No dataset payload or source text is redistributed by this recipe.',
    'licenseNote': 'The pinned Qdrant card declares no license. This private research acquisition is not permission to redistribute the corpus.',
    'shards': []}
row_count = 0
counts = {'corpus': 0, 'queries': 0}
streams = {}
try:
    for kind in counts:
        streams[kind] = ((output / (kind + '.f32')).open('xb'), (output / (kind + '-ids.jsonl')).open('x'))
    for filename, expected_size, expected_hash in SHARDS:
        file = output / filename
        url = f'https://huggingface.co/datasets/{REPO}/resolve/{REVISION}/data/{filename}?download=true'
        req = urllib.request.Request(url, headers={'User-Agent': 'apack-sqlite-evaluation'})
        sha = hashlib.sha256()
        downloaded = 0
        with urllib.request.urlopen(req, timeout=60) as response, file.open('xb') as target:
            if response.headers.get('Content-Length'):
                assert int(response.headers['Content-Length']) == expected_size
            while True:
                data = response.read(1024 * 1024)
                if not data:
                    break
                downloaded += len(data)
                assert downloaded <= expected_size
                target.write(data)
                sha.update(data)
                if downloaded % (64 * 1024 * 1024) == 0:
                    print(json.dumps({'shard': filename, 'downloadedBytes': downloaded}), flush=True)
        assert downloaded == expected_size and sha.hexdigest() == expected_hash, 'Public source hash/size mismatch'
        shard_rows = 0
        parquet = pq.ParquetFile(file)
        try:
            for batch in parquet.iter_batches(batch_size=64, columns=['_id', FIELD], use_threads=False):
                column = batch.column(batch.schema.get_field_index(FIELD))
                assert column.null_count == 0
                assert np.all(pc.list_value_length(column).to_numpy() == DIMENSIONS)
                values = column.flatten()
                assert values.null_count == 0
                matrix = values.to_numpy().astype('<f4', copy=False).reshape(batch.num_rows, DIMENSIONS)
                assert np.isfinite(matrix).all() and np.any(matrix != 0, axis=1).all()
                ids = batch.column(batch.schema.get_field_index('_id')).to_pylist()
                for index, source_id in enumerate(ids):
                    assert isinstance(source_id, str)
                    kind = 'queries' if row_count % 1000 == 0 else 'corpus'
                    vector_file, id_file = streams[kind]
                    vector_file.write(matrix[index].tobytes())
                    id_file.write(json.dumps({'row': counts[kind], 'sourceOrdinal': row_count, 'sourceId': source_id}) + '\n')
                    counts[kind] += 1
                    row_count += 1
                    shard_rows += 1
        finally:
            parquet.close()
        file.unlink()  # Keep peak disk bounded: only this shard plus the growing projection.
        manifest['shards'].append({'path': 'data/' + filename, 'bytes': expected_size, 'sha256': expected_hash, 'rows': shard_rows})
        print(json.dumps({'projectedShard': filename, 'rows': row_count, 'counts': counts}), flush=True)
    assert row_count == 100000 and counts == {'corpus': 99900, 'queries': 100}
    for pair in streams.values():
        for stream in pair:
            stream.close()
    streams.clear()
    manifest['sourceRows'] = row_count
    manifest['counts'] = counts
    manifest['files'] = {file.name: {'bytes': file.stat().st_size, 'sha256': digest(file)} for file in output.iterdir() if file.is_file()}
    for kind, count in counts.items():
        assert manifest['files'][kind + '.f32']['bytes'] == count * DIMENSIONS * 4
    with (output / 'manifest.json').open('x') as sealed:
        json.dump(manifest, sealed, indent=2)
        sealed.write('\n')
    print(json.dumps({'sealed': str(output / 'manifest.json'), 'counts': counts}), flush=True)
except BaseException:
    for pair in streams.values():
        for stream in pair:
            stream.close()
    shutil.rmtree(output)  # Only the new directory reserved by this operation is ours.
    raise
