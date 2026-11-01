"""Alternate matched FULL value-admission checkpoint policies; diagnostic, not ordinary acceptance."""
import argparse
import json
import math
import pathlib
import subprocess
from runtime_provenance import capture_runtime_provenance


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=pathlib.Path)
    args = parser.parse_args()
    repo = pathlib.Path(__file__).resolve().parents[4]
    args.output.mkdir(parents=True, exist_ok=False)
    limits = {name: (pathlib.Path('/sys/fs/cgroup') / name).read_text().strip()
              for name in ['cpu.max', 'memory.max', 'memory.swap.max']}
    assert limits == {'cpu.max': '200000 100000', 'memory.max': '6442450944', 'memory.swap.max': '0'}
    provenance = capture_runtime_provenance(repo, 'source')
    assert provenance['elmdbObservedCommit'] == provenance['elmdbPinnedCommit']
    (args.output / 'provenance.json').write_text(json.dumps(provenance, indent=2) + '\n')
    report = {'completed': False, 'qualification': False, 'source': provenance['commit'], 'limits': limits,
              'records': [], 'scope': 'Three fresh processes per explicit 1000/128-page policy, alternated order; '
              'same FULL value/53-watch/100k workload and original budgets without profiler/commit observer; '
              'not default policy, 10k/search/platform, causal checkpoint attribution or app acceptance'}

    def save():
        (args.output / 'matrix.json').write_text(json.dumps(report, indent=2) + '\n')

    save()
    try:
        for trial in range(1, 4):
            for pages in ([1000, 128] if trial % 2 else [128, 1000]):
                name = f'{pages}-{trial}'
                record = {'trial': trial, 'checkpointPages': pages, 'valid': False}
                report['records'].append(record)
                save()
                result = subprocess.run(['node', '--import', 'tsx', 'packages/apack-ears/bench/sqlite/admission.ts',
                                         '100000', '--durable', f'--checkpoint-pages={pages}'], cwd=repo,
                                        text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=300)
                (args.output / f'{name}.stdout').write_text(result.stdout)
                (args.output / f'{name}.stderr').write_text(result.stderr)
                record['returncode'] = result.returncode
                data = json.loads(result.stdout)
                (args.output / f'{name}.json').write_text(json.dumps(data, indent=2) + '\n')
                assert data['checkpointPages'] == pages and data['checkpointProbe'] == {'pages': pages, 'qualification': False}
                assert 'diagnostic' not in data and data['n'] == 100000 and data['syncs'] is True
                assert data['indexKind'] == 'value' and data['admissionReads'] == 0 and data['writes'] > 0
                assert sorted(data['cpuModels']) == provenance['cpuModels'] and data['cpuModels']
                assert data['nativeBindings'] and data['batchSamples'] and data['samples']['heartbeatDelays']
                expected_bindings = {row['sha256'] for row in provenance['sqliteNative']['bindings']}
                assert all(row['sha256'] in expected_bindings for row in data['nativeBindings'])
                budgets = data['budgets']
                assert set(budgets) == {'admissionMs', 'operationP99Ms', 'lookupP99Ms', 'turnWaitP99Ms',
                                        'heartbeatDelayP99Ms', 'maxObservedWalBytes', 'maxObservedFilesBytes'}
                fixed_limits = {'admissionMs': 100, 'operationP99Ms': 16, 'lookupP99Ms': 16,
                                'turnWaitP99Ms': 16, 'heartbeatDelayP99Ms': 16}
                assert all(budgets[name]['limit'] == limit for name, limit in fixed_limits.items())
                for budget in budgets.values():
                    assert all(type(budget[key]) in (int, float) and math.isfinite(budget[key]) and budget[key] >= 0
                               for key in ['actual', 'limit'])
                passed = all(budget['actual'] <= budget['limit'] for budget in budgets.values())
                assert data['passed'] is passed and result.returncode == (0 if passed else 1)
                record.update({'valid': True, 'budgetsPassed': passed, 'budgets': budgets})
                save()
        report['completed'] = True
    except Exception as error:
        report['failure'] = {'type': type(error).__name__, 'message': str(error)}
        raise
    finally:
        save()


if __name__ == '__main__':
    main()
