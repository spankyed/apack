"""Unprivileged file-page cache control on owned Linux copies; never a global drop_caches."""
import argparse
import ctypes
import hashlib
import json
import math
import mmap
import os
import pathlib
import shutil
import stat
import subprocess
import sys
import tempfile

if sys.platform != 'linux':
    raise RuntimeError('This diagnostic requires Linux fadvise/mincore')
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('output', type=pathlib.Path)
output = parser.parse_args().output.resolve()
if output.exists():
    parser.error('Expected a new output directory; preserve previous reports')
output.mkdir(parents=True)
repo = pathlib.Path(__file__).resolve().parents[4]
source = os.environ['GITHUB_SHA']
if len(source) != 40 or any(c not in '0123456789abcdef' for c in source):
    raise ValueError('Missing exact source identity')
limits = {name: (pathlib.Path('/sys/fs/cgroup') / name).read_text().strip()
          for name in ['cpu.max', 'memory.max', 'memory.swap.max']}
if limits != {'cpu.max': '200000 100000', 'memory.max': '6442450944', 'memory.swap.max': '0'}:
    raise ValueError('Expected two CPUs, 6 GiB and no swap')
libc = ctypes.CDLL(None, use_errno=True)
libc.mincore.argtypes = [ctypes.c_void_p, ctypes.c_size_t, ctypes.POINTER(ctypes.c_ubyte)]
libc.mincore.restype = ctypes.c_int


def resident(fd, size):
    pages = (size + mmap.PAGESIZE - 1) // mmap.PAGESIZE
    with mmap.mmap(fd, size, flags=mmap.MAP_PRIVATE, prot=mmap.PROT_READ | mmap.PROT_WRITE) as mapped:
        vector = (ctypes.c_ubyte * pages)()
        address = ctypes.addressof(ctypes.c_char.from_buffer(mapped))
        if libc.mincore(address, size, vector):
            raise OSError(ctypes.get_errno(), 'mincore')
        return sum(bool(value & 1) for value in vector), pages


def control(file, condition):
    if condition not in ['warm-file-pages', 'cold-file-pages']:
        raise ValueError('Unknown cache condition')
    fd = os.open(file, os.O_RDWR | os.O_NOFOLLOW)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_size <= 0:
            raise ValueError('Expected a nonempty regular owned database file')
        # Flush copy writes before DONTNEED; dirty pages otherwise remain resident.
        os.fsync(fd)
        # Establish a warm control before every attempted eviction, including the cold condition.
        while os.read(fd, 1024 * 1024):
            pass
        warm, pages = resident(fd, info.st_size)
        if warm != pages:
            raise ValueError('Could not establish complete warm-file residency')
        if condition == 'cold-file-pages':
            os.posix_fadvise(fd, 0, 0, os.POSIX_FADV_DONTNEED)
        observed, _ = resident(fd, info.st_size)
        if observed != (0 if condition == 'cold-file-pages' else pages):
            raise ValueError('Requested cache state not observed; no cold timing may be admitted')
        return {'bytes': info.st_size, 'pages': pages, 'warmResidentPages': warm,
                'residentPagesBeforeLaunch': observed, 'pageBytes': mmap.PAGESIZE}
    finally:
        os.close(fd)


matrix = {'protocol': 'ears-cold-reopen-matrix/1', 'source': source, 'completed': False,
          'qualification': False, 'limits': limits, 'trials': 20, 'records': [],
          'kernel': os.uname().release,
          'declaredEnginePin': (repo / 'vendor/elmdb.rev').read_text().strip(),
          'scope': 'Alternating backend/condition order; fresh processes and closed copies; verified main-file residency before launch, not a guarantee for every later task, app/code caches or physical device cache',
          'recipeSha256': hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest()}


def save():
    (output / 'matrix.json').write_text(json.dumps(matrix, indent=2) + '\n')


def invoke(phase, backend, directory, name):
    destination = output / (name + '.json')
    result = subprocess.run(['node', '--experimental-strip-types',
                             'packages/apack-ears/bench/sqlite/cold-reopen.mjs',
                             phase, backend, str(directory), str(destination)],
                            cwd=repo, capture_output=True, text=True, timeout=180)
    (output / (name + '.stdout')).write_text(result.stdout)
    (output / (name + '.stderr')).write_text(result.stderr)
    value = json.loads(destination.read_text())
    if (result.returncode or not value['completed'] or value['source'] != source
            or value['backend'] != backend or value['phase'] != phase or value['n'] != 10000):
        raise RuntimeError('Failed subprocess; preserve outcome without retry: ' + name)
    if phase == 'read' and value.get('consumed') is not True:
        raise ValueError('Unconsumed read results')
    required = ['open', 'engine'] if phase == 'seed' else ['open', 'engine', 'firstField', 'page50', 'ordered50']
    for metric in required:
        timing = value['timesMs'][metric]
        if isinstance(timing, bool) or not isinstance(timing, (int, float)) or not math.isfinite(timing) or timing < 0:
            raise ValueError('Invalid timing: ' + metric)
    return value


save()
owned = None
try:
    with tempfile.TemporaryDirectory(prefix='ears-cold-reopen-') as owned:
        work = pathlib.Path(owned)
        matrix['fileSystem'] = subprocess.check_output(['stat', '-f', '-c', '%T', str(work)], text=True).strip()
        # Negative witness: merely labelling a warm file cold cannot pass the residency predicate.
        witness = work / 'cache-control.bin'
        witness.write_bytes(b'cache witness' * 8192)
        warm = control(witness, 'warm-file-pages')
        cold = control(witness, 'cold-file-pages')
        assert warm['residentPagesBeforeLaunch'] > 0 and cold['residentPagesBeforeLaunch'] == 0
        matrix['cacheControl'] = {'warm': warm, 'cold': cold}
        for backend in ['elmdb', 'sqlite']:
            invoke('seed', backend, work / (backend + '-seed'), backend + '-seed')
        for trial in range(20):
            for backend in (['sqlite', 'elmdb'] if trial % 2 == 0 else ['elmdb', 'sqlite']):
                for condition in (['cold-file-pages', 'warm-file-pages'] if trial % 2 == 0
                                  else ['warm-file-pages', 'cold-file-pages']):
                    name = f'{backend}-{condition}-{trial}'
                    copy = work / name
                    shutil.copytree(work / (backend + '-seed'), copy)
                    try:
                        wal = copy / 'data.sqlite3-wal'
                        if backend == 'sqlite' and wal.exists() and wal.stat().st_size:
                            raise ValueError('A cold main-file label cannot admit data retained in WAL')
                        main = copy / ('data.mdb' if backend == 'elmdb' else 'data.sqlite3')
                        cache = control(main, condition)
                        value = invoke('read', backend, copy, name)
                        matrix['records'].append({'backend': backend, 'condition': condition, 'trial': trial,
                                                  'cache': cache, 'report': name + '.json',
                                                  'sha256': hashlib.sha256((output / (name + '.json')).read_bytes()).hexdigest()})
                        save()
                    finally:
                        shutil.rmtree(copy)
    matrix['completed'] = len(matrix['records']) == 80
except Exception as error:
    matrix['failure'] = {'name': type(error).__name__, 'message': str(error)}
    raise
finally:
    matrix['scratchRemoved'] = owned is not None and not pathlib.Path(owned).exists()
    save()
