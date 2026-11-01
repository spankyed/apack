#!/usr/bin/env python3
"""Privately join pinned public source text to the already verified real-vector projection.

Run with pyarrow==26.0.0 in disposable Linux, two CPUs/6 GiB/no swap. One source shard is
retained at a time. No model API is called; neither source text nor vector payload enters Git.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import resource
import shutil
import urllib.request

import pyarrow as pa
import pyarrow.parquet as pq

REPOSITORY = 'https://huggingface.co/datasets/Qdrant/dbpedia-entities-openai3-text-embedding-3-small-1536-100K'
REVISION = '0d5fd00fbc5a9c0c836d70cd409f7e461255e572'
MAX_OWNED_BYTES = 800 * 1024**2


def digest(file):
    sha = hashlib.sha256()
    with file.open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            sha.update(chunk)
    return sha.hexdigest()


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--vectors', required=True, type=Path, help='Existing sealed vector projection, mounted read-only')
parser.add_argument('--output', required=True, type=Path, help='New private text directory; refuses an incumbent')
args = parser.parse_args()
assert platform.system() == 'Linux' and (Path('/.dockerenv').exists() or os.environ.get('GITHUB_ACTIONS') == 'true')
assert pa.__version__ == '26.0.0'
limits = {name: Path('/sys/fs/cgroup', name).read_text().strip() for name in ('cpu.max', 'memory.max', 'memory.swap.max')}
assert limits == {'cpu.max': '200000 100000', 'memory.max': str(6 * 1024**3), 'memory.swap.max': '0'}
vectors = args.vectors.resolve()
vector_manifest_file = vectors / 'manifest.json'
vector_manifest = json.loads(vector_manifest_file.read_text())
assert vector_manifest['protocol'] == 'ears-public-real-vectors/1'
assert vector_manifest['repository'] == REPOSITORY and vector_manifest['revision'] == REVISION
assert vector_manifest['counts'] == {'corpus': 99900, 'queries': 100}
assert vector_manifest['dimensions'] == 1536 and vector_manifest['dtype'] == '<f4'
assert len(vector_manifest['shards']) == 4
for name in ('corpus.f32', 'queries.f32', 'corpus-ids.jsonl', 'queries-ids.jsonl'):
    expected = vector_manifest['files'][name]
    assert (vectors / name).stat().st_size == expected['bytes'] and digest(vectors / name) == expected['sha256'], name
output = args.output.resolve()
assert not output.is_relative_to(vectors) and not vectors.is_relative_to(output)
output.mkdir(mode=0o700)
opened = []
manifest = {'protocol': 'ears-public-real-text/1', 'repository': REPOSITORY, 'revision': REVISION,
            'vectorManifestSha256': digest(vector_manifest_file), 'recipeSha256': digest(Path(__file__)),
            'tools': {'python': platform.python_version(), 'pyarrow': pa.__version__}, 'limits': limits,
            'selection': 'Same sourceOrdinal/sourceId and corpus/query row as the sealed vector projection',
            'textFields': ['title', 'text', 'combined_text'], 'privatePayloadOnly': True,
            'licenseNote': vector_manifest['licenseNote'], 'counts': {'corpus': 0, 'queries': 0},
            'peakOwnedPayloadBytes': 0, 'shards': []}
try:
    targets = {kind: (output / (kind + '-text.jsonl')).open('x') for kind in ('corpus', 'queries')}
    opened.extend(targets.values())
    identities = {kind: (vectors / (kind + '-ids.jsonl')).open() for kind in targets}
    opened.extend(identities.values())
    source_ordinal = 0
    text_bytes = 0
    for shard in vector_manifest['shards']:
        filename = Path(shard['path']).name
        assert shard['path'] == 'data/' + filename and filename.startswith('train-') and filename.endswith('.parquet')
        temporary = output / filename
        assert text_bytes + shard['bytes'] <= MAX_OWNED_BYTES, 'Next shard exceeds owned-payload bound'
        request = urllib.request.Request(f"{REPOSITORY}/resolve/{REVISION}/{shard['path']}?download=true",
                                         headers={'User-Agent': 'apack-sqlite-evaluation'})
        sha, downloaded = hashlib.sha256(), 0
        with urllib.request.urlopen(request, timeout=60) as response, temporary.open('xb') as target:
            for data in iter(lambda: response.read(1024 * 1024), b''):
                downloaded += len(data)
                assert downloaded <= shard['bytes']
                target.write(data)
                sha.update(data)
        assert downloaded == shard['bytes'] and sha.hexdigest() == shard['sha256'], 'Pinned source shard changed'
        manifest['peakOwnedPayloadBytes'] = max(manifest['peakOwnedPayloadBytes'], sum(p.stat().st_size for p in output.iterdir()))
        assert manifest['peakOwnedPayloadBytes'] <= MAX_OWNED_BYTES
        parquet = pq.ParquetFile(temporary)
        rows = 0
        try:
            for batch in parquet.iter_batches(batch_size=64, columns=['_id', 'title', 'text', 'combined_text'], use_threads=False):
                for record in batch.to_pylist():
                    kind = 'queries' if source_ordinal % 1000 == 0 else 'corpus'
                    expected = json.loads(next(identities[kind]))
                    assert expected == {'row': manifest['counts'][kind], 'sourceOrdinal': source_ordinal, 'sourceId': record['_id']}
                    assert all(isinstance(record[field], str) for field in manifest['textFields'])
                    assert record['combined_text'].strip()
                    line = json.dumps({**expected, **{field: record[field] for field in manifest['textFields']}}, ensure_ascii=False) + '\n'
                    text_bytes += len(line.encode('utf8'))
                    assert downloaded + text_bytes <= MAX_OWNED_BYTES, 'Text projection exceeds owned-payload bound'
                    manifest['peakOwnedPayloadBytes'] = max(manifest['peakOwnedPayloadBytes'], downloaded + text_bytes)
                    targets[kind].write(line)
                    manifest['counts'][kind] += 1
                    source_ordinal += 1
                    rows += 1
        finally:
            parquet.close()
        assert rows == shard['rows']
        for stream in targets.values():
            stream.flush()
        manifest['peakOwnedPayloadBytes'] = max(manifest['peakOwnedPayloadBytes'], sum(p.stat().st_size for p in output.iterdir()))
        assert manifest['peakOwnedPayloadBytes'] <= MAX_OWNED_BYTES
        temporary.unlink()
        manifest['shards'].append(shard)
        print(json.dumps({'projectedShard': filename, 'counts': manifest['counts']}), flush=True)
    assert manifest['counts'] == vector_manifest['counts'] and source_ordinal == vector_manifest['sourceRows']
    for stream in identities.values():
        assert next(stream, None) is None
    for stream in opened:
        stream.close()
    opened.clear()
    manifest['maxRssKiB'] = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    manifest['files'] = {p.name: {'bytes': p.stat().st_size, 'sha256': digest(p)} for p in output.iterdir() if p.is_file()}
    with (output / 'manifest.json').open('x') as sealed:
        json.dump(manifest, sealed, indent=2)
        sealed.write('\n')
    print(json.dumps({'sealed': str(output / 'manifest.json'), 'counts': manifest['counts']}), flush=True)
except BaseException:
    for stream in opened:
        stream.close()
    shutil.rmtree(output)
    raise
