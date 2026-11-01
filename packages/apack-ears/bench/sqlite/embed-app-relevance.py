#!/usr/bin/env python3
"""Embed the frozen public app relevance corpus locally in a capped disposable container."""
import argparse
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import shutil
import tempfile
import urllib.request

REVISION = '1110a243fdf4706b3f48f1d95db1a4f5529b4d41'
FIXTURE_SHA256 = '29d79b6060b21ca68d3bb5dd491cc2e3cfff36a11c2f10b28d6df62c9acc3527'
FILES = {
    'onnx/model.onnx': (90405214, '6fd5d72fe4589f189f8ebc006442dbb529bb7ce38f8082112682524616046452'),
    'tokenizer.json': (466247, 'be50c3628f2bf5bb5e3a7f17b1f74611b2561a3a27eeab05e5aa30f411572037'),
    'sentence_bert_config.json': (53, 'fc1993fde0a95c24ec6c022539d41cf6e2f7c9721e5415d6fb6897472a9cd4b7'),
    '1_Pooling/config.json': (190, '4be450dde3b0273bb9787637cfbd28fe04a7ba6ab9d36ac48e92b11e350ffc23'),
}


def digest(path):
    value = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(block)
    return value.hexdigest()


def acquire(root, name, size, expected):
    path = root / name
    path.parent.mkdir(parents=True, exist_ok=True)
    url = f'https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2/resolve/{REVISION}/{name}'
    count = 0
    with urllib.request.urlopen(url, timeout=120) as source, path.open('xb') as target:
        for block in iter(lambda: source.read(65536), b''):
            count += len(block)
            assert count <= size
            target.write(block)
    assert count == size and digest(path) == expected


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--fixture', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--receipt', required=True, type=Path)
    args = parser.parse_args()
    assert Path('/.dockerenv').exists()
    limits = {name: Path('/sys/fs/cgroup', name).read_text().strip()
              for name in ['cpu.max', 'memory.max', 'memory.swap.max']}
    assert limits == {'cpu.max': '200000 100000', 'memory.max': '6442450944', 'memory.swap.max': '0'}
    assert os.environ.get('OPENBLAS_NUM_THREADS') == '1'
    for name, version in [('onnxruntime', '1.31.1'), ('tokenizers', '0.23.3'), ('numpy', '2.5.4')]:
        assert importlib.metadata.version(name) == version
    os.environ['TOKENIZERS_PARALLELISM'] = 'false'
    import numpy as np
    import onnxruntime as ort
    from tokenizers import Tokenizer
    ort.disable_telemetry_events()
    assert digest(args.fixture) == FIXTURE_SHA256 and not args.receipt.exists()
    fixture = json.loads(args.fixture.read_text())
    assert len(fixture['documents']) == 214 and len(fixture['cases']) == 25
    texts = [(row['name'] + '\n\n' + row['body']).strip() for row in fixture['documents']]
    texts += [case['query'] for case in fixture['cases']]
    args.output.mkdir(mode=0o700)
    receipt = {'completed': False, 'protocol': 'ears-local-relevance-embeddings/1', 'modelRevision': REVISION,
               'fixtureSha256': FIXTURE_SHA256, 'recipeSha256': digest(Path(__file__)), 'limits': limits,
               'documents': 214, 'queries': 25, 'dimensions': 384, 'maxTokens': 256,
               'pooling': 'attention-mask mean, then L2 normalization', 'documentInput': 'blank-line field join, then trim', 'containsPayload': False}
    try:
        with tempfile.TemporaryDirectory(prefix='model-', dir=args.output) as temporary:
            root = Path(temporary)
            for name, (size, sha) in FILES.items():
                acquire(root, name, size, sha)
            assert json.loads((root/'sentence_bert_config.json').read_text())['max_seq_length'] == 256
            pooling = json.loads((root/'1_Pooling/config.json').read_text())
            assert pooling['word_embedding_dimension'] == 384 and pooling['pooling_mode_mean_tokens'] is True
            tokenizer = Tokenizer.from_file(str(root/'tokenizer.json'))
            tokenizer.enable_truncation(max_length=256)
            tokenizer.enable_padding(pad_id=0, pad_token='[PAD]')
            options = ort.SessionOptions()
            options.intra_op_num_threads = 2
            options.inter_op_num_threads = 1
            session = ort.InferenceSession(str(root/'onnx/model.onnx'), sess_options=options,
                                           providers=['CPUExecutionProvider'])
            names = {value.name for value in session.get_inputs()}
            assert names <= {'input_ids', 'attention_mask', 'token_type_ids'}
            vectors, truncated = [], 0
            for offset in range(0, len(texts), 8):
                encoded = tokenizer.encode_batch(texts[offset:offset+8])
                truncated += sum(bool(row.overflowing) for row in encoded)
                inputs = {'input_ids': np.asarray([row.ids for row in encoded], dtype=np.int64),
                          'attention_mask': np.asarray([row.attention_mask for row in encoded], dtype=np.int64),
                          'token_type_ids': np.asarray([row.type_ids for row in encoded], dtype=np.int64)}
                hidden = session.run(None, {name: inputs[name] for name in names})[0]
                assert hidden.ndim == 3 and hidden.shape[-1] == 384
                mask = inputs['attention_mask'][..., None].astype(np.float32)
                pooled = (hidden * mask).sum(axis=1) / np.maximum(mask.sum(axis=1), 1e-9)
                norms = np.linalg.norm(pooled, axis=1, keepdims=True)
                assert np.isfinite(pooled).all() and (norms > 0).all()
                vectors.extend((pooled / norms).astype(np.float32).tolist())
            assert len(vectors) == 239
            payload = {'fixtureSha256': FIXTURE_SHA256, 'modelRevision': REVISION, 'dimensions': 384,
                       'documents': [{'id': row['id'], 'vector': vector} for row, vector in zip(fixture['documents'], vectors[:214], strict=True)],
                       'queries': vectors[214:]}
            file = args.output/'vectors.json'
            with file.open('x') as target:
                json.dump(payload, target)
            receipt.update({'truncatedInputs': truncated, 'vectorsSha256': digest(file),
                            'onnxruntime': ort.__version__, 'tokenizers': importlib.metadata.version('tokenizers')})
        receipt.update({'completed': True, 'modelCacheRemoved': not root.exists()})
    except BaseException as error:
        receipt['errorType'] = type(error).__name__
        shutil.rmtree(args.output)
        raise
    finally:
        with args.receipt.open('x') as target:
            json.dump(receipt, target, indent=2)
            target.write('\n')


if __name__ == '__main__':
    main()
