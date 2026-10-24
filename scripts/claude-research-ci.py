"""Replay a pinned Claude integration journey on a disposable GitHub Mac or the explicit local Linux container."""
from contextlib import contextmanager
import fcntl
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
    'native-mcp-legacy-browser-app': {'CLAUDE_RESEARCH_PROMPT_THEME': 'agent', 'CLAUDE_RESEARCH_MCP_ELICITATION': '1', 'CLAUDE_RESEARCH_NATIVE_MCP_URL': '1', 'CLAUDE_RESEARCH_NATIVE_MCP_BROWSER': '1'},
    'native-mcp-retry-browser-app': {'CLAUDE_RESEARCH_PROMPT_THEME': 'agent', 'CLAUDE_RESEARCH_MCP_ELICITATION': '1', 'CLAUDE_RESEARCH_NATIVE_MCP_URL': '1', 'CLAUDE_RESEARCH_NATIVE_MCP_URL_RETRY': '1', 'CLAUDE_RESEARCH_NATIVE_MCP_BROWSER': '1'},
    'native-mcp-browser-return-app': {'CLAUDE_RESEARCH_PROMPT_THEME': 'agent', 'CLAUDE_RESEARCH_MCP_ELICITATION': '1', 'CLAUDE_RESEARCH_NATIVE_MCP_URL': '1', 'CLAUDE_RESEARCH_MCP_MODERN': '1', 'CLAUDE_RESEARCH_NATIVE_MCP_BROWSER': '1'},
    'native-mcp-modern-url-app': {'CLAUDE_RESEARCH_PROMPT_THEME': 'agent', 'CLAUDE_RESEARCH_MCP_ELICITATION': '1', 'CLAUDE_RESEARCH_NATIVE_MCP_URL': '1', 'CLAUDE_RESEARCH_MCP_MODERN': '1'},
    'native-mcp-url-retry-app': {'CLAUDE_RESEARCH_PROMPT_THEME': 'agent', 'CLAUDE_RESEARCH_MCP_ELICITATION': '1', 'CLAUDE_RESEARCH_NATIVE_MCP_URL': '1', 'CLAUDE_RESEARCH_NATIVE_MCP_URL_RETRY': '1'},
    'native-mcp-url-app': {'CLAUDE_RESEARCH_PROMPT_THEME': 'agent', 'CLAUDE_RESEARCH_MCP_ELICITATION': '1', 'CLAUDE_RESEARCH_NATIVE_MCP_URL': '1'},
    'native-mcp-form-app': {'CLAUDE_RESEARCH_PROMPT_THEME': 'agent', 'CLAUDE_RESEARCH_MCP_ELICITATION': '1', 'CLAUDE_RESEARCH_NATIVE_MCP_FORM': '1'},
    'mcp-elicitation-app': {'CLAUDE_RESEARCH_PROMPT_THEME': 'agent', 'CLAUDE_RESEARCH_MCP_ELICITATION': '1'},
    'generic-permissions-app': {'CLAUDE_RESEARCH_PROMPT_THEME': 'agent', 'CLAUDE_RESEARCH_GENERIC_PERMISSIONS': '1'},
    'tool-permissions-app': {'CLAUDE_RESEARCH_PROMPT_THEME': 'agent', 'CLAUDE_RESEARCH_TOOL_PERMISSIONS': '1'},
    'text-direction-app': {'CLAUDE_RESEARCH_PROMPT_THEME': 'text-wrap', 'CLAUDE_RESEARCH_TEXT_DIRECTION': '1'},
    'text-measurement-app': {'CLAUDE_RESEARCH_PROMPT_THEME': 'text-wrap', 'CLAUDE_RESEARCH_TEXT_MEASUREMENT': '1'},
    'resting-hover-app': {'CLAUDE_RESEARCH_PROMPT_THEME': 'text-wrap', 'CLAUDE_RESEARCH_RESTING_HOVER': '1'},
    'text-links-app': {'CLAUDE_RESEARCH_PROMPT_THEME': 'text-wrap'},
    'notebook-edit-app': {'CLAUDE_RESEARCH_PROMPT_THEME': 'agent', 'CLAUDE_RESEARCH_NOTEBOOK_EDIT': '1'},
    'mcp-oauth-app': {'CLAUDE_RESEARCH_PROMPT_THEME': 'agent', 'CLAUDE_RESEARCH_MCP_PANEL': '1', 'CLAUDE_RESEARCH_MCP_OAUTH': '1'},
    'mcp-panel-app': {'CLAUDE_RESEARCH_PROMPT_THEME': 'agent', 'CLAUDE_RESEARCH_MCP_PANEL': '1'},
    'rich-streaming-model-app': {'CLAUDE_RESEARCH_PROMPT_THEME': 'agent', 'CLAUDE_RESEARCH_HELD_MODEL_PAUSE': '1', 'CLAUDE_RESEARCH_STREAMING_MODEL_PAUSE': '1', 'CLAUDE_RESEARCH_STREAMING_MODEL_RICH': '1'},
    'streaming-model-pause-app': {'CLAUDE_RESEARCH_PROMPT_THEME': 'agent', 'CLAUDE_RESEARCH_HELD_MODEL_PAUSE': '1', 'CLAUDE_RESEARCH_STREAMING_MODEL_PAUSE': '1'},
    'held-model-pause-app': {'CLAUDE_RESEARCH_PROMPT_THEME': 'agent', 'CLAUDE_RESEARCH_HELD_MODEL_PAUSE': '1'},
    'task-manager-app': {'CLAUDE_RESEARCH_PROMPT_THEME': 'agent', 'CLAUDE_RESEARCH_TASK_MANAGER': '1'},
    'active-tool-pause-app': {'CLAUDE_RESEARCH_PROMPT_THEME': 'agent', 'CLAUDE_RESEARCH_ACTIVE_TOOL_PAUSE': '1'},
    'active-tool-cancel-app': {'CLAUDE_RESEARCH_PROMPT_THEME': 'agent', 'CLAUDE_RESEARCH_ACTIVE_TOOL_CANCEL': '1'},
    'pdf-pages-app': {'CLAUDE_RESEARCH_PROMPT_THEME': 'agent', 'CLAUDE_RESEARCH_READ_MEDIA': '1', 'CLAUDE_RESEARCH_PDF_SUCCESS': '1'},
    'attachment-media-app': {'CLAUDE_RESEARCH_PROMPT_THEME': 'agent', 'CLAUDE_RESEARCH_READ_MEDIA': '1', 'CLAUDE_RESEARCH_ATTACHMENT_MEDIA': '1'},
    'config-theme-app': {'CLAUDE_RESEARCH_PROMPT_THEME': 'agent', 'CLAUDE_RESEARCH_CONFIG_THEME': '1'},
    'command-interactions-app': {'CLAUDE_RESEARCH_PROMPT_THEME': 'agent', 'CLAUDE_RESEARCH_COMMAND_INTERACTIONS': '1'},
    'agent-settings-app': {'CLAUDE_RESEARCH_PROMPT_THEME': 'agent', 'CLAUDE_RESEARCH_AGENT_SETTINGS': '1'},
    'config-layout-app': {'CLAUDE_RESEARCH_CONFIG_LAYOUT': '1'},
    'config-model-app': {'CLAUDE_RESEARCH_CONFIG_MODEL': '1'},
    'native-action-keys': {},
    'native-action-contexts': {},
    'action-keys-app': {'CLAUDE_RESEARCH_PROMPT_THEME': 'rich-selection', 'CLAUDE_RESEARCH_ACTION_KEYS_APP': '1'},
    'action-contexts-app': {'CLAUDE_RESEARCH_PROMPT_THEME': 'rich-selection', 'CLAUDE_RESEARCH_ACTION_KEYS_APP': '1', 'CLAUDE_RESEARCH_ACTION_KEY_CONTEXTS': '1'},
    'action-dialog-app': {'CLAUDE_RESEARCH_PROMPT_THEME': 'rich-selection', 'CLAUDE_RESEARCH_ACTION_KEYS_APP': '1', 'CLAUDE_RESEARCH_ACTION_KEY_DIALOG': '1'},
    'agent-structured-app': {'CLAUDE_RESEARCH_PROMPT_THEME': 'rich-selection', 'CLAUDE_RESEARCH_AGENT_STRUCTURED': '1'},
    'composer-wrap-app': {'CLAUDE_RESEARCH_STATUS_STARTUP': '1', 'CLAUDE_RESEARCH_COMPOSER_WRAP': '1'},
    'status-startup-app': {'CLAUDE_RESEARCH_STATUS_STARTUP': '1'},
    'agent-caret-fast-app': {'CLAUDE_RESEARCH_PROMPT_THEME': 'rich-selection', 'CLAUDE_RESEARCH_AGENT_IME': '1', 'CLAUDE_RESEARCH_AGENT_CARET': '1', 'CLAUDE_RESEARCH_AGENT_CARET_FAST': '1'},
    'agent-caret-app': {'CLAUDE_RESEARCH_PROMPT_THEME': 'rich-selection', 'CLAUDE_RESEARCH_AGENT_IME': '1', 'CLAUDE_RESEARCH_AGENT_CARET': '1'},
    'system-policy-app': {'CLAUDE_RESEARCH_PROMPT_THEME': 'agent', 'CLAUDE_RESEARCH_SYSTEM_POLICY': '1'},
    'agent-ime-cancel-app': {'CLAUDE_RESEARCH_PROMPT_THEME': 'rich-selection', 'CLAUDE_RESEARCH_AGENT_IME': '1', 'CLAUDE_RESEARCH_AGENT_IME_CANCEL': '1'},
    'agent-ime-lifetime-app': {'CLAUDE_RESEARCH_PROMPT_THEME': 'rich-selection', 'CLAUDE_RESEARCH_AGENT_IME': '1', 'CLAUDE_RESEARCH_AGENT_IME_LIFETIME': '1'},
    'tool-width-app': {'CLAUDE_RESEARCH_TOOL_WIDTH': '1'},
    'prompt-timeout-app': {'CLAUDE_RESEARCH_PROMPT_TIMEOUT': '1'},
    'policy-held-client-app': {'CLAUDE_RESEARCH_POLICY_HELD_CLIENT': '1'},
    'action-panes-app': {'CLAUDE_RESEARCH_PROMPT_THEME': 'rich-selection', 'CLAUDE_RESEARCH_ACTION_KEYS_APP': '1', 'CLAUDE_RESEARCH_ACTION_KEY_PANES': '1'},
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


def validate_host(linux_container=False):
    if linux_container:
        if sys.platform != 'linux' or platform.machine() not in ('aarch64', 'arm64') or not Path('/.dockerenv').is_file():
            raise RuntimeError('Linux Claude acceptance requires the Linux arm64 Docker container')
        return 'linux-arm64'
    if (os.environ.get('GITHUB_ACTIONS') != 'true'
            or os.environ.get('RUNNER_ENVIRONMENT') != 'github-hosted'
            or sys.platform != 'darwin' or platform.machine() != 'arm64'):
        raise RuntimeError('Native Claude acceptance requires a disposable GitHub-hosted macOS arm64 runner')
    return 'darwin-arm64'


def prepare_native_package(target, package, supplied_archive=None):
    if supplied_archive is not None:
        source = Path(supplied_archive).resolve(strict=True)
        if not source.is_file() or digest(source) != target['tarballSha256']:
            raise ValueError('Supplied native package integrity changed')
        shutil.copyfile(source, package)
    else:
        with urlopen(target['url'], timeout=60) as response, package.open('wb') as output:
            shutil.copyfileobj(response, output)
    if digest(package) != target['tarballSha256']:
        raise ValueError('Official native package integrity changed')


@contextmanager
def replay_directory(case, linux_container=False):
    """Retain one diagnostic run until replacement; never accumulate built app snapshots."""
    if not linux_container:
        root = Path(os.environ['RUNNER_TEMP']) / ('claude-research-' + case)
        root.mkdir(exist_ok=False)
        yield root
        return
    base = Path(os.environ.get('APACK_CLAUDE_RESEARCH_OUTPUT', '/work/.claude-research'))
    base.mkdir(parents=True, exist_ok=True)
    with (base / 'run.lock').open('a+') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise RuntimeError('Another Claude research replay owns this directory') from error
        root = base / 'current'
        marker = root / '.claude-research-replay'
        identity = 'apack-claude-research-replay-v1\n'
        if root.is_symlink():
            raise RuntimeError('Refusing to replace a symlinked research directory')
        if root.exists():
            if not marker.is_file() or marker.is_symlink() or marker.read_text() != identity:
                raise RuntimeError('Refusing to replace an unowned research directory')
            shutil.rmtree(root)
        root.mkdir(mode=0o700)
        marker.write_text(identity)
        yield root


def run(case, linux_container=False):
    target_platform = validate_host(linux_container)
    if linux_container and case not in ['system-policy-app', 'agent-ime-cancel-app', 'pdf-pages-app', 'native-mcp-legacy-browser-app', 'native-mcp-retry-browser-app', 'native-mcp-browser-return-app', 'native-mcp-modern-url-app', 'native-mcp-url-retry-app', 'native-mcp-url-app', 'native-mcp-form-app', 'mcp-elicitation-app', 'generic-permissions-app', 'tool-permissions-app', 'text-direction-app', 'text-measurement-app', 'resting-hover-app', 'text-links-app', 'everyday', 'rich-streaming-model-app', 'streaming-model-pause-app', 'notebook-edit-app', 'mcp-oauth-app', 'mcp-panel-app', 'held-model-pause-app', 'task-manager-app', 'active-tool-pause-app', 'active-tool-cancel-app', 'attachment-media-app', 'config-theme-app', 'command-interactions-app', 'agent-settings-app', 'config-layout-app', 'config-model-app', 'agent-structured-app', 'composer-wrap-app', 'status-startup-app', 'action-panes-app', 'policy-held-client-app', 'prompt-timeout-app', 'tool-width-app', 'agent-ime-lifetime-app', 'agent-caret-app', 'agent-caret-fast-app']:
        raise ValueError('Linux container adoption covers reviewed pane, held-policy, prompt-timeout, tool-width Agent IME lifetime and Agent caret profiles only')
    if case not in CASES:
        raise ValueError('Unknown Claude research case')
    checkout = Path(__file__).resolve().parents[1]
    fixture = checkout / 'tests/fixtures/claude-research'
    manifest = json.loads((fixture / 'manifest.json').read_text())
    with replay_directory(case, linux_container) as root:
        print('Claude evidence directory: '+str(root), flush=True)
        research = root / 'research'
        unpack_tools(fixture / 'runner.tgz', manifest, research)
        target = json.loads((fixture / 'linux-arm64.json').read_text()) if linux_container else manifest['target']
        if target['version'] != '2.1.302' or target['platform'] != target_platform:
            raise ValueError('Explicit pinned-target review required')
        package = root / 'native.tgz'
        supplied_archive = os.environ.get('APACK_CLAUDE_RESEARCH_NATIVE_ARCHIVE')
        prepare_native_package(target, package, supplied_archive)
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
        if linux_container:
            env['NODE_OPTIONS'] = (env.get('NODE_OPTIONS', '')+' --import='+str(fixture / 'linux-electron-launch.mjs')).strip()
        script = """import {probeApackControls} from './src/integration/run-apack-controls.mjs';
    const [checkout,binary,root]=process.argv.slice(1);
    const result=await probeApackControls(checkout,binary,root+'/workspaces',root+'/output','terminal-plan-app-theme');
    console.log(JSON.stringify(result,null,2));
    if(result.status!=='complete')process.exitCode=1;
    """
        if case in ['policy-held-client-app', 'prompt-timeout-app']:
            script = script.replace('terminal-plan-app-theme', 'terminal-managed-transition-app')
        if case == 'tool-width-app':
            script = script.replace('terminal-plan-app-theme', 'terminal-file-app')
        if case in ['native-action-keys', 'native-action-contexts']:
            script = """import {probeNativeActionKeys} from './src/protocol/native-action-keys.mjs';
    const [checkout,binary,root]=process.argv.slice(1);
    const result=await probeNativeActionKeys(binary,root+'/workspaces',root+'/output',checkout,{scenario:__scenario__});
    console.log(JSON.stringify(result,null,2));
    if(result.status!=='complete')process.exitCode=1;
    """.replace('__scenario__', json.dumps('contexts' if case == 'native-action-contexts' else 'baseline'))
        (root / 'provenance.json').write_text(json.dumps({'research': manifest, 'productCommit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=checkout).decode().strip(), 'case': case, 'executionPlatform': target_platform, 'executedTarget': target, 'suppliedNativeArchive': str(Path(supplied_archive).resolve()) if supplied_archive else None}, indent=2) + '\n')
        subprocess.run(['node', '--input-type=module', '-e', script, str(checkout), str(binary), str(root)], cwd=research, env=env, check=True, timeout=240 if case in ['system-policy-app', 'agent-ime-cancel-app', 'pdf-pages-app', 'native-mcp-legacy-browser-app', 'native-mcp-retry-browser-app', 'native-mcp-browser-return-app', 'native-mcp-modern-url-app', 'native-mcp-url-retry-app', 'native-mcp-url-app', 'native-mcp-form-app', 'mcp-elicitation-app', 'generic-permissions-app', 'tool-permissions-app', 'action-keys-app', 'action-contexts-app', 'action-dialog-app', 'action-panes-app'] else 210)


if __name__ == '__main__':
    linux_container = sys.argv[1:2] == ['--linux-container']
    args = sys.argv[2:] if linux_container else sys.argv[1:]
    if len(args) != 1:
        raise SystemExit('Usage: python3 scripts/claude-research-ci.py <native-action-keys|native-action-contexts|action-keys-app|action-contexts-app|action-dialog-app|action-panes-app|policy-held-client-app|prompt-timeout-app|tool-width-app|agent-ime-lifetime-app|agent-caret-app|agent-caret-fast-app|agent-source|field-bounds|agent-and-fields|source-fill|everyday>')
    for case in (['agent-source', 'field-bounds'] if args[0] == 'agent-and-fields' else [args[0]]):
        run(case, linux_container=linux_container)
