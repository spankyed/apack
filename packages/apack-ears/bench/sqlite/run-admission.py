"""Sequential fresh-process admission loads; preserve every trial, including budget failures."""
import argparse
import json
import math
import os
import pathlib
import subprocess


def positive(value):
    parsed = int(value)
    if parsed < 1:
        raise argparse.ArgumentTypeError('must be positive')
    return parsed


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=pathlib.Path)
    parser.add_argument('--durable', action='store_true')
    parser.add_argument('--search', action='store_true')
    parser.add_argument('--trace', action='store_true', help='Instrument one 100k FULL value or OFF search case; not ordinary latency acceptance')
    parser.add_argument('--trials', type=positive, default=3)
    parser.add_argument('--sizes', type=int, nargs='+', default=[10000, 100000])
    args = parser.parse_args()
    if len(set(args.sizes)) != len(args.sizes) or any(n < 1000 or n > 100000 for n in args.sizes):
        parser.error('sizes must be distinct integers from 1000 through 100000')
    if args.trace and (args.trials != 1 or args.sizes != [100000] or args.search == args.durable):
        parser.error('trace requires one 100k FULL value or OFF search trial')
    repo = pathlib.Path(__file__).resolve().parents[4]
    args.output.mkdir(parents=True, exist_ok=False)
    subprocess.run(['node', '--experimental-strip-types', '--test',
                    'packages/apack-ears/bench/sqlite/load-metrics.check.ts'], cwd=repo, check=True)
    subprocess.run(['python3', 'packages/apack-ears/bench/sqlite/run-bench.py',
                    str(args.output / 'source'), '--trials', '0'] +
                   (['--durable'] if args.durable else []), cwd=repo, check=True)
    records = []
    summary = {'protocol': 'ears-admission-trials/1', 'completed': False, 'qualification': False,
               'trials': args.trials, 'sizes': args.sizes, 'durable': args.durable, 'instrumented': args.trace,
               'kind': 'search' if args.search else 'value', 'records': records,
               'scope': 'Instrumented runtime attribution; not ordinary latency acceptance' if args.trace else
                        'Fresh-process synthetic admission; resource limits belong to the enclosing runner'}

    def save():
        (args.output / 'matrix.json').write_text(json.dumps(summary, indent=2) + '\n')

    save()
    for trial in range(1, args.trials + 1):
        for n in args.sizes if trial % 2 else reversed(args.sizes):
            name = f'{n}-{trial}'
            print(f'Admission load {name}', flush=True)
            command = ['node', '--import', 'tsx', 'packages/apack-ears/bench/sqlite/admission.ts', str(n)]
            if args.durable:
                command.append('--durable')
            if args.search:
                command.append('--search')
            environment = None
            prefix = args.output / f'{name}-runtime'
            if args.trace:
                command.append('--diagnostic')
                environment = {**os.environ, 'EARS_ADMISSION_TRACE': str(prefix)}
            record = {'trial': trial, 'size': n, 'passed': False}
            try:
                result = subprocess.run(command, cwd=repo, text=True, stdout=subprocess.PIPE,
                                        stderr=subprocess.PIPE, timeout=300, env=environment)
                (args.output / f'{name}.stdout').write_text(result.stdout)
                (args.output / f'{name}.stderr').write_text(result.stderr)
                record['returncode'] = result.returncode
                try:
                    report = json.loads(result.stdout)
                    assert report['n'] == n and report['syncs'] is args.durable
                    assert report['indexKind'] == ('text/vector/trigram' if args.search else 'value')
                    assert report['admissionReads'] == 0 and report['writes'] > 0
                    budgets = report['budgets']
                    assert budgets and all(type(b['actual']) in (int, float) and
                        type(b['limit']) in (int, float) and math.isfinite(b['actual']) and
                        math.isfinite(b['limit']) for b in budgets.values())
                    record['passed'] = result.returncode == 0 and report['passed'] is True and all(
                        b['actual'] <= b['limit'] for b in budgets.values())
                    if args.trace:
                        trace = json.loads(prefix.with_suffix('.json').read_text())
                        profile = json.loads(prefix.with_suffix('.cpuprofile').read_text())
                        assert report['diagnostic']['qualification'] is False
                        assert len(trace['counters']) >= 2 and isinstance(trace['gc'], list)
                        assert profile['nodes'] and profile['samples'] and len(profile['samples']) == len(profile['timeDeltas'])
                        record['traceCaptured'] = True
                    record['budgets'] = budgets
                    (args.output / f'{name}.json').write_text(json.dumps(report, indent=2) + '\n')
                except (ValueError, KeyError, TypeError, AssertionError, OSError):
                    record['passed'] = False
                    record['invalidReport'] = True
            except subprocess.TimeoutExpired as error:
                record['timedOut'] = True
                for suffix, output in [('stdout', error.stdout), ('stderr', error.stderr)]:
                    (args.output / f'{name}.{suffix}').write_bytes(
                        output.encode() if isinstance(output, str) else output or b'')
            records.append(record)
            save()
    summary['completed'] = True
    summary['passed'] = all(record['passed'] for record in records)
    save()
    if not summary['passed']:
        raise SystemExit('Admission trials failed; every scheduled trial and its reports were retained')


if __name__ == '__main__':
    main()
