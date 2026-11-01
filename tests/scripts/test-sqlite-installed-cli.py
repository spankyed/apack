#!/usr/bin/env python3
"""Verify prebuilt SQLite candidate tarballs in an isolated npm installation (disposable Linux only)."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import tempfile
import time


def main():
    if sys.platform != 'linux' or not (Path('/.dockerenv').exists() or os.environ.get('GITHUB_ACTIONS') == 'true'):
        raise SystemExit('Run only in disposable Linux/CI, after npm run packages:build')
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True, help='New evidence directory; parent must exist')
    args = parser.parse_args()
    repo = Path(__file__).resolve().parents[2]
    output = args.output.resolve()
    output.mkdir(mode=0o700)  # Refuse collisions without taking ownership of previous evidence.
    commands = []
    source = os.environ.get('EARS_TEST_SOURCE') or subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=repo, text=True).strip()
    (output / 'source.json').write_text(json.dumps({'source': source, 'scope': 'isolated npm-installed tarballs; Linux only'}, indent=2) + '\n')

    def run(label, command, cwd, timeout, env=None):
        start = time.monotonic()
        with (output / (label + '.txt')).open('w') as log:
            process = subprocess.Popen(command, cwd=cwd, env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
            try:
                status = process.wait(timeout=timeout)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()
                commands.append({'label': label, 'timeout': timeout, 'seconds': time.monotonic() - start})
                (output / 'commands.json').write_text(json.dumps(commands, indent=2) + '\n')
                raise
        commands.append({'label': label, 'exitCode': status, 'seconds': time.monotonic() - start})
        (output / 'commands.json').write_text(json.dumps(commands, indent=2) + '\n')
        print(label, status, round(time.monotonic() - start, 3), flush=True)
        if status != 0:
            raise RuntimeError((output / (label + '.txt')).read_text()[-16000:])

    # This check refuses stale/missing output; it never builds or repairs it.
    run('prebuilt-inputs', ['node', '--import', 'tsx', '--input-type=module', '-e',
        "import {packagesBuiltOrRefuse} from '@apackdev/host/build/packages-built'; packagesBuiltOrRefuse('npm run packages:build');"], repo, 60)
    with tempfile.TemporaryDirectory(prefix='ears-installed-') as temporary:
        work = Path(temporary)
        archives = work / 'archives'
        archives.mkdir()
        manifest = {'name': 'ears-logical-installed-probe', 'version': '0.0.0', 'private': True,
                    'type': 'module', 'dependencies': {}, 'overrides': {}}
        packed = {}
        for name, directory in [
            ('ears', repo / 'packages/apack-ears/publish'),
            ('sdk', repo / 'packages/apack-sdk/publish'),
            ('cli', repo / 'packages/apack-cli/dist/package'),
            ('elmdb', repo / 'vendor/elmdb/crates/elmdb-node'),
        ]:
            run('pack-' + name, ['npm', 'pack', '--silent', '--pack-destination', str(archives)], directory, 60)
            filename = (output / ('pack-' + name + '.txt')).read_text().strip().splitlines()[-1]
            if Path(filename).name != filename:
                raise RuntimeError('npm pack did not return a tarball basename')
            tarball = archives / filename
            packed[name] = {'file': filename, 'sha256': hashlib.sha256(tarball.read_bytes()).hexdigest()}
            if name == 'elmdb':
                manifest['overrides']['elmdb'] = 'file:' + str(tarball)
            else:
                manifest['dependencies']['@apackdev/' + name] = 'file:' + str(tarball)
        (work / 'package.json').write_text(json.dumps(manifest, indent=2) + '\n')
        (output / 'tarballs.json').write_text(json.dumps(packed, indent=2) + '\n')
        env = os.environ | {'NODE_OPTIONS': '', 'npm_config_jobs': '2', 'CARGO_BUILD_JOBS': '2'}
        # Normal native install scripts are intentional; no workspace dependency or binding is copied in.
        run('isolated-npm-install', ['npm', 'install', '--no-audit', '--no-fund', '--fetch-retries=0', '--fetch-timeout=30000'], work, 240, env)
        shutil.copy2(work / 'package-lock.json', output / 'installed-package-lock.json')
        for directory, folders, files in os.walk(work / 'node_modules', followlinks=False):
            for name in folders + files:
                candidate = Path(directory) / name
                if candidate.is_symlink() and not candidate.resolve().is_relative_to(work):
                    raise RuntimeError(str(candidate) + ' escapes the isolated installation')
        support = repo / 'packages/apack-cli/tests/_support'
        shutil.copy2(support / 'logical-cli.mjs', work / 'probe.mjs')
        shutil.copy2(support / 'logical-installed-receipt.mjs', work / 'runtime-receipt.mjs')
        run('isolated-logical-cli', ['node', str(work / 'probe.mjs'), str(output / 'isolated-logical-cli.json'), str(work)], work, 180, env)
        report = json.loads((output / 'isolated-logical-cli.json').read_text())
        if len(report['checks']) != 5 or 'failure' in report:
            raise RuntimeError('Installed CLI did not complete all five workflow checks')


if __name__ == '__main__':
    main()
