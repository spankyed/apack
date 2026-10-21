"""Replay a pinned Claude integration journey only on a disposable GitHub macOS runner."""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import platform
import shutil
import subprocess
import sys
import tarfile
from urllib.request import urlopen

CASES = {
    'native-action-keys': {},
    'action-keys-app': {'CLAUDE_RESEARCH_PROMPT_THEME': 'rich-selection', 'CLAUDE_RESEARCH_ACTION_KEYS_APP': '1'},
    'agent-source': {'CLAUDE_RESEARCH_PROMPT_THEME': 'rich-selection', 'CLAUDE_RESEARCH_AGENT_SOURCE': '1'},
    'field-bounds': {'CLAUDE_RESEARCH_PROMPT_THEME': 'structured', 'CLAUDE_RESEARCH_FIELD_BOUNDS': '1'},
    'source-fill': {'CLAUDE_RESEARCH_PROMPT_THEME': 'structured', 'CLAUDE_RESEARCH_SOURCE_FILL': '1'},
    'everyday': {'CLAUDE_RESEARCH_PROMPT_THEME': 'everyday'},
}


def digest(path):
    with path.open('rb') as stream:
        result = hashlib.sha256()
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            result.update(chunk)
        return result.hexdigest()


def unpack_tools(bundle, manifest, destination):
    if digest(bundle) != manifest['archiveSha256']:
        raise ValueError('Research archive hash changed')
    with tarfile.open(bundle, 'r:gz') as archive:
        members = archive.getmembers()
        if len(members) != len(manifest['files']) or len(members) > 1000:
            raise ValueError('Research archive member inventory changed')
        seen = set()
        for member in members:
            name = PurePosixPath(member.name)
            if (not member.isfile() or name.is_absolute() or '..' in name.parts
                    or member.name not in manifest['files'] or member.name in seen
                    or member.size > 10 * 1024 * 1024):
                raise ValueError('Unexpected research archive member')
            data = archive.extractfile(member).read()
            if hashlib.sha256(data).hexdigest() != manifest['files'][member.name]:
                raise ValueError('Research source hash changed: ' + member.name)
            target = destination.joinpath(*name.parts)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
            seen.add(member.name)


def run(case):
    if (os.environ.get('GITHUB_ACTIONS') != 'true'
            or os.environ.get('RUNNER_ENVIRONMENT') != 'github-hosted'
            or sys.platform != 'darwin' or platform.machine() != 'arm64'):
        raise RuntimeError('Native Claude acceptance requires a disposable GitHub-hosted macOS arm64 runner')
    if case not in CASES:
        raise ValueError('Unknown Claude research case')
    checkout = Path(__file__).resolve().parents[1]
    fixture = checkout / 'tests/fixtures/claude-research'
    manifest = json.loads((fixture / 'manifest.json').read_text())
    root = Path(os.environ['RUNNER_TEMP']) / ('claude-research-' + case)
    root.mkdir(exist_ok=False)
    research = root / 'research'
    unpack_tools(fixture / 'runner.tgz', manifest, research)
    target = manifest['target']
    if target['version'] != '2.1.302' or target['platform'] != 'darwin-arm64':
        raise ValueError('Explicit pinned-target review required')
    package = root / 'native.tgz'
    with urlopen(target['url'], timeout=60) as response, package.open('wb') as output:
        shutil.copyfileobj(response, output)
    if digest(package) != target['tarballSha256']:
        raise ValueError('Official native package integrity changed')
    binary = root / 'claude'
    with tarfile.open(package, 'r:gz') as archive:
        member = archive.getmember('package/claude')
        if not member.isfile():
            raise ValueError('Expected pinned regular native binary')
        with archive.extractfile(member) as source, binary.open('wb') as output:
            shutil.copyfileobj(source, output)
    if digest(binary) != target['binarySha256']:
        raise ValueError('Pinned native binary hash changed')
    binary.chmod(0o700)
    env = {key: value for key, value in os.environ.items() if not key.startswith('CLAUDE_RESEARCH_')}
    env.update(CASES[case])
    env['APACK_CHAIN_CORES'] = '2'
    script = """import {probeApackControls} from './src/integration/run-apack-controls.mjs';
const [checkout,binary,root]=process.argv.slice(1);
const result=await probeApackControls(checkout,binary,root+'/workspaces',root+'/output','terminal-plan-app-theme');
console.log(JSON.stringify(result,null,2));
if(result.status!=='complete')process.exitCode=1;
"""
    if case == 'native-action-keys':
        script = """import {probeNativeActionKeys} from './src/protocol/native-action-keys.mjs';
const [checkout,binary,root]=process.argv.slice(1);
const result=await probeNativeActionKeys(binary,root+'/workspaces',root+'/output',checkout);
console.log(JSON.stringify(result,null,2));
if(result.status!=='complete')process.exitCode=1;
"""
    (root / 'provenance.json').write_text(json.dumps({'research': manifest, 'productCommit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=checkout).decode().strip(), 'case': case}, indent=2) + '\n')
    subprocess.run(['node', '--input-type=module', '-e', script, str(checkout), str(binary), str(root)], cwd=research, env=env, check=True, timeout=210)


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit('Usage: python3 scripts/claude-research-ci.py <native-action-keys|action-keys-app|agent-source|field-bounds|agent-and-fields|source-fill|everyday>')
    for case in (['agent-source', 'field-bounds'] if sys.argv[1] == 'agent-and-fields' else [sys.argv[1]]):
        run(case)
