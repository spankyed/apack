import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

it('bounds replay storage and refuses concurrent, foreign and symlinked deletion', () => {
  const script = fileURLToPath(new URL('../../../scripts/claude-research-ci.py', import.meta.url));
  const output = execFileSync('python3', ['-B', '-c', String.raw`
import importlib.util, os, tempfile, sys
from pathlib import Path
spec = importlib.util.spec_from_file_location('replay', sys.argv[1])
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)
def refused(reason):
    try:
        with r.replay_directory('other', True):
            raise AssertionError('unexpected admission')
    except RuntimeError as error:
        assert reason in str(error), str(error)
with tempfile.TemporaryDirectory() as temporary:
    base = Path(temporary) / 'replays'
    os.environ['APACK_CLAUDE_RESEARCH_OUTPUT'] = str(base)
    with r.replay_directory('first', True) as first:
        (first / 'snapshot').write_text('old build')
        refused('Another')
        assert (first / 'snapshot').read_text() == 'old build'
    try:
        with r.replay_directory('second', True) as second:
            assert second == first and not (second / 'snapshot').exists()
            (second / 'failure.log').write_text('keep failure')
            raise ValueError('simulated failure')
    except ValueError:
        pass
    assert (first / 'failure.log').read_text() == 'keep failure'
    assert sorted(p.name for p in base.iterdir()) == ['current', 'run.lock']
    (first / '.claude-research-replay').unlink()
    refused('unowned')
    assert (first / 'failure.log').exists()
    r.shutil.rmtree(first)
    outside = Path(temporary) / 'outside'
    outside.mkdir()
    (outside / 'keep').write_text('safe')
    first.symlink_to(outside, target_is_directory=True)
    refused('symlinked')
    assert (outside / 'keep').read_text() == 'safe'
print('bounded storage verified')
`, script], { encoding: 'utf8' });
  expect(output.trim()).toBe('bounded storage verified');
});
