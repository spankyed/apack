#!/usr/bin/env python3
"""Compare two complete same-run corpus diagnostics, without claiming model/cache variance is controlled."""
import argparse
import hashlib
import json
from pathlib import Path
import importlib.util

spec = importlib.util.spec_from_file_location('hybrid_receipt', Path(__file__).with_name('qualify-real-hybrid.py'))
qualification = importlib.util.module_from_spec(spec)
spec.loader.exec_module(qualification)


def compare(root, source):
    manifest_hash = hashlib.sha256((root / 'corpus-manifest.json').read_bytes()).hexdigest()
    result = {'completed': False, 'source': source, 'manifestSha256': manifest_hash, 'groups': [],
              'scope': 'Same-run sequential generic/dispatch diagnostics; one independently trained model per size/build, uncontrolled OS cache, no causal speedup or adoption qualification'}
    for size in [1000, 10000, 99900]:
        reports, groups = {}, {}
        for variant in ['generic', 'dispatch']:
            report = json.loads((root / variant / f'hybrid-{size}.json').read_text())
            groups[variant] = qualification.validate(report, size, source, manifest_hash)
            assert report['modelMode'] == 'managed' and report['nativeCandidateFloor'] is None
            assert report['cpuModels'] and report['nativeExtensionSha256']
            assert report['nativeVectorRuntime'].startswith('version 0.8 (' + ('Scalar' if variant == 'generic' else 'AVX2') + ',')
            reports[variant] = report
        generic, dispatch = reports['generic'], reports['dispatch']
        assert generic['nativeDiagnostic'] is None
        assert dispatch['nativeDiagnostic']['kind'] == 'upstream-x64-runtime-dispatch'
        assert dispatch['nativeDiagnostic']['baselineExtensionSha256'] == generic['nativeExtensionSha256']
        assert generic['nativeExtensionSha256'] != dispatch['nativeExtensionSha256']
        for field in ['cpuModels', 'limits', 'oracleSha256', 'oracleRecipeSha256', 'node', 'arch', 'sqlite', 'synchronous']:
            assert generic[field] == dispatch[field], field
        if size > 4096:
            assert generic['nativeModel']['worker_sha256'] == dispatch['nativeModel']['worker_sha256']
            assert generic['nativeModel']['native_version'] == generic['nativeVectorRuntime']
            assert dispatch['nativeModel']['native_version'] == dispatch['nativeVectorRuntime']
        for left, right in zip(groups['generic'], groups['dispatch'], strict=True):
            assert (left['size'], left['cohort'], left['family']) == (right['size'], right['cohort'], right['family'])
            result['groups'].append({'size': size, 'cohort': left['cohort'], 'family': left['family'],
                                     'generic': left, 'dispatch': right,
                                     'genericOverDispatchP95': left['p95Ms'] / right['p95Ms']})
    assert len(result['groups']) == 18
    result['vectorRecallAccepted'] = all(value >= .95 for group in result['groups'] for variant in ['generic', 'dispatch'] for value in group[variant]['meanVectorRecall'].values())
    result['heartbeatAccepted'] = all(group[variant]['heartbeatWithinDiagnosticLimit'] for group in result['groups'] for variant in ['generic', 'dispatch'])
    result['completed'] = True
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--results', type=Path, required=True)
    parser.add_argument('--source', required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    assert not args.output.exists()
    report = {'completed': False, 'source': args.source}
    try:
        report = compare(args.results, args.source)
        assert report['vectorRecallAccepted'], 'Original 0.95 recall requirement must pass for both variants'
    except BaseException as error:
        report['failure'] = {'type': type(error).__name__, 'message': str(error)}
        raise
    finally:
        with args.output.open('x') as file:
            json.dump(report, file, indent=2)
            file.write('\n')


if __name__ == '__main__':
    main()
