#!/usr/bin/env python3
"""Verify persisted commits with no application acknowledgement using actual WAL sync/stop/kill.

Linux disposable environment only. Source/dependencies must already be prepared. No SQL/COMMIT
method is replaced. This tests process death, not failing devices or physical power loss.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import signal
import subprocess
import tempfile
import time

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--return-sync-error', action='store_true', help='Return EIO after successful WAL sync, then kill after application error without closing')
parser.add_argument('--source-root', type=Path, default=Path(__file__).resolve().parents[4])
parser.add_argument('--output', type=Path, required=True, help='New evidence directory; refuses an incumbent')
args = parser.parse_args()
assert platform.system() == 'Linux' and (Path('/.dockerenv').exists() or os.environ.get('GITHUB_ACTIONS') == 'true')
source = args.source_root.resolve()
helpers = Path(__file__).resolve().parent
out = args.output.resolve()
out.mkdir(mode=0o700)


def sha(file):
    return hashlib.sha256(file.read_bytes()).hexdigest()


records = []
report = {'source': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=source, text=True).strip(),
          'helpers': {p.name: sha(p) for p in (helpers/'lost-ack.c', helpers/'lost-ack.mjs', Path(__file__))},
          'sourceHashes': {str(p.relative_to(source)): sha(p) for p in sorted((source/'packages/apack-ears/src').rglob('*.ts'))},
          'scope': ('Real successful WAL sync returns EIO; application receives error, parent kills before close, fresh process determines outcome. Not physical power loss.' if args.return_sync_error else 'Real successful WAL sync; parent SIGKILL before application acknowledgement. Not physical power loss.'),
          'records': records, 'completed': False}


def persist():
    (out/'report.json').write_text(json.dumps(report, indent=2)+'\n')


def sync_witness(directory, pid, stopped, stop_signal, log_path):
    assert stopped and stop_signal == signal.SIGSTOP, 'Missing stopped sync witness: '+log_path.read_text()
    assert not (directory/'ack.json').exists() and 'ACK\n' not in log_path.read_text()
    event = json.loads((directory/'event.json').read_text())
    assert event['result'] == 0 and event['pid'] == pid
    if args.return_sync_error:
        assert event['point'] == 'after-success-return-eio'
        error = json.loads((directory/'error.json').read_text())
        assert error['returned'] is True and (error['code'] == 'COMMIT_UNKNOWN' or error['code'].startswith('SQLITE_IOERR'))
        assert 'ERROR_RETURNED\n' in log_path.read_text()
    else:
        assert event['point'] == 'after-success-before-return'
    return event


persist()
try:
    with tempfile.TemporaryDirectory(prefix='ears-lost-ack-', dir=out) as temporary:
        scratch = Path(temporary)
        library = scratch/'lost-ack.so'
        with (out/'compile.log').open('w') as log:
            subprocess.run(['cc', '-shared', '-fPIC', '-Wall', '-Wextra', '-O2', str(helpers/'lost-ack.c'), '-o', str(library)], stdout=log, stderr=subprocess.STDOUT, check=True, timeout=30)
        report['shimBinarySha256'] = sha(library)
        env = {**os.environ, 'NODE_OPTIONS': '--conditions=@apackdev/source --import=tsx --max-old-space-size=4096', 'TSX_DISABLE_CACHE': '1'}
        for operation in ['write', 'unit', 'bulkLoad', 'schema', 'disabled-control']:
            directory = scratch/operation
            directory.mkdir()
            event = directory/'event.json'
            actual = 'write' if operation == 'disabled-control' else operation
            child_env = {**env, 'LD_PRELOAD': str(library), 'EARS_LOST_ACK_WAL': str(directory/'database/data.sqlite3-wal'),
                         'EARS_LOST_ACK_ARM': str(directory/'arm'), 'EARS_LOST_ACK_EVENT': str(event)}
            if args.return_sync_error:
                child_env['EARS_LOST_ACK_RETURN_EIO'] = '1'
            if operation == 'disabled-control':
                child_env['EARS_LOST_ACK_DISABLED'] = '1'
            record = {'operation': operation}
            records.append(record)
            persist()
            command = ['node', str(helpers/'lost-ack.mjs'), 'write', str(directory), actual, str(source)]
            log_path = out/(operation+'.log')
            with log_path.open('w') as log:
                child = subprocess.Popen(command, cwd=source, env=child_env, stdout=log, stderr=subprocess.STDOUT)
                deadline = time.monotonic()+30
                stopped = False
                try:
                    while child.poll() is None and time.monotonic() < deadline:
                        if event.exists():
                            pid, status = os.waitpid(child.pid, os.WNOHANG | os.WUNTRACED)
                            if pid and os.WIFSTOPPED(status):
                                stopped = True
                                record['stopSignal'] = os.WSTOPSIG(status)
                                break
                        time.sleep(.02)
                    if operation != 'disabled-control':
                        record['event'] = sync_witness(directory, child.pid, stopped, record.get('stopSignal'), log_path)
                        child.kill()
                        assert child.wait(timeout=10) == -signal.SIGKILL
                        record['killedBeforeAcknowledgement'] = True
                    else:
                        assert child.wait(timeout=10) == 0 and (directory/'ack.json').exists() and not event.exists()
                        try:
                            sync_witness(directory, child.pid, stopped, record.get('stopSignal'), log_path)
                        except AssertionError:
                            record['missingInjectorRejected'] = True
                        else:
                            raise AssertionError('Disabled injector passed vacuously')
                finally:
                    if child.poll() is None:
                        child.kill()
                        child.wait(timeout=10)
            with (out/(operation+'-reopen.log')).open('w') as log:
                opened = subprocess.run(['node', str(helpers/'lost-ack.mjs'), 'read-error' if args.return_sync_error and operation != 'disabled-control' else 'read', str(directory), actual, str(source)], cwd=source, env=env, stdout=log, stderr=subprocess.STDOUT, timeout=30)
            assert opened.returncode == 0, (out/(operation+'-reopen.log')).read_text()
            if args.return_sync_error and operation != 'disabled-control':
                record['applicationErrorReturned'] = json.loads((directory/'error.json').read_text())
            record['before'] = json.loads((directory/'before.json').read_text())
            record['reopen'] = json.loads((directory/'reopen.json').read_text())
            assert record['before']['synchronous'] == 2 and record['before']['journalMode'] == 'wal'
            record['passed'] = True
            persist()
            print(json.dumps(record), flush=True)
        assert all(sha(source/name) == digest for name, digest in report['sourceHashes'].items()), 'Source changed during validation'
    report['completed'] = True
    persist()
except BaseException as error:
    report['error'] = repr(error)
    persist()
    raise
