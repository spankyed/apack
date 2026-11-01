# Current built-package sustained write/watch cohorts; disposable CI only, no retries.
import argparse, hashlib, json, math, os, pathlib, subprocess, time

parser = argparse.ArgumentParser()
parser.add_argument('output', type=pathlib.Path)
args = parser.parse_args()
args.output.mkdir(parents=True, exist_ok=False)
repo = pathlib.Path(__file__).resolve().parents[4]
limits = {name: pathlib.Path('/sys/fs/cgroup', name).read_text().strip()
          for name in ['cpu.max', 'memory.max', 'memory.swap.max']}
assert limits == {'cpu.max': '200000 100000', 'memory.max': '6442450944', 'memory.swap.max': '0'}
source = os.environ['GITHUB_SHA']
assert len(source) == 40 and all(char in '0123456789abcdef' for char in source)
compiled = ['index.js', 'engine.js', 'lmdb/index.js', 'sqlite/index.js', 'sqlite/database.js', 'sqlite/query.js']
report = {'protocol': 'ears-sustained-write-watch/1', 'source': source, 'completed': False,
          'qualification': False, 'limits': limits, 'seconds': 60, 'tasks': 20000, 'trials': 3,
          'acknowledgment': 'durable', 'heartbeatLimitMs': 16,
          'scope': 'Synthetic sustained built-package write/watch comparison; not renderer/search/provider or complete app resource qualification',
          'enginePin': (repo / 'vendor/elmdb.rev').read_text().strip(),
          'compiledInputs': {name: hashlib.sha256((repo / 'packages/apack-ears/dist' / name).read_bytes()).hexdigest() for name in compiled},
          'records': []}
def save():
    pending = args.output / 'matrix.next.json'
    pending.write_text(json.dumps(report, indent=2) + '\n')
    pending.replace(args.output / 'matrix.json')
def finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value >= 0
save()
for trial in range(1, 4):
    for mode in (['none', 'views'] if trial % 2 else ['views', 'none']):
        for backend in (['sqlite', 'elmdb'] if trial % 2 else ['elmdb', 'sqlite']):
            name = f'{trial}-{mode}-{backend}'
            record = {'trial': trial, 'mode': mode, 'backend': backend, 'completed': False}
            report['records'].append(record)
            print('Running ' + name, flush=True)
            started = time.monotonic()
            try:
                result = subprocess.run(['node', '--experimental-strip-types', 'packages/apack-ears/bench/watch-stress.ts',
                                         '60', mode, backend, 'durable'], cwd=repo,
                                        env={**os.environ, 'EARS_WATCH_TASKS': '20000'},
                                        text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=180)
                (args.output / (name + '.stdout')).write_text(result.stdout)
                (args.output / (name + '.stderr')).write_text(result.stderr)
                record['returncode'] = result.returncode
                assert result.returncode == 0, 'Workload process failed'
                value = json.loads(result.stdout)
                assert value['backend'] == backend and value['acknowledgment'] == 'durable'
                assert value['execution'] == 'built-package' and value['taskCount'] == 20000
                assert value['requestedSeconds'] == 60 and value['viewMode'] == mode
                assert value['converged'] is True
                assert finite(value['commitsPerSecond']) and value['commitsPerSecond'] > 0
                assert finite(value['settledMs']) and finite(value['acknowledgmentMs']['p95'])
                bindings = value['nativeBindings']
                assert bindings and all(len(row['sha256']) == 64 for row in bindings)
                beats = value['heartbeatDelaysMs']
                assert beats and all(finite(beat) for beat in beats)
                p99 = sorted(beats)[math.ceil(len(beats) * .99) - 1]
                record.update(completed=True, queryViewsConverged=True,
                              heartbeatP99Ms=p99, heartbeatWithinLimit=p99 <= 16,
                              commitsPerSecond=value['commitsPerSecond'], settledMs=value['settledMs'])
                (args.output / (name + '.json')).write_text(json.dumps(value, indent=2) + '\n')
            except subprocess.TimeoutExpired as error:
                for stream in ['stdout', 'stderr']:
                    value = getattr(error, stream)
                    (args.output / (name + '.' + stream)).write_text(value.decode(errors='replace') if isinstance(value, bytes) else value or '')
                record['failure'] = 'timeout after 180 seconds; no retry'
                raise
            except Exception as error:
                record['failure'] = str(error)
                raise
            finally:
                record['elapsedSeconds'] = time.monotonic() - started
                save()
report['completed'] = True
save()
