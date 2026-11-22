// What a command left running in its process group, read from one listing of every process
import { expect, it } from 'vitest';
import { describeLeft, leftIn, parsePs } from '../../../scripts/lib/left-running.ts';

// As `ps -A -o pid=,pgid=,stat=,command=` prints: the command that led group 500 has exited, and is gone from it
const LISTING = [
  '    1     1 Ss   /sbin/launchd',
  '  480   480 S    npm run chain',
  '  510   500 S    node /repo/node_modules/vitest/dist/workers/forks.js',
  '  511   500 S+   node server.js --port 0',
  '  512   500 Z    (node)',
  '  600   600 S    node fake-broker.cjs /tmp/b.sock',
  '',
].join('\n');

it('names what is still running in the group, and nothing that has exited or is in another group', () => {
  expect(leftIn(parsePs(LISTING), 500).map(left => `${left.pid} ${left.command}`)).toEqual([
    '510 node /repo/node_modules/vitest/dist/workers/forks.js',
    '511 node server.js --port 0',
  ]);
});

// Under some shells the command that led the group is still listed for a moment after it exited
it('leaves out the command that led the group', () => {
  const rows = parsePs(`${LISTING}  500   500 S    sh -c npm test\n`);
  expect(leftIn(rows, 500).map(left => left.pid)).toEqual([510, 511]);
});

it('says how many were left, and what each was running', () => {
  const said = describeLeft(leftIn(parsePs(LISTING), 500));
  expect(said).toContain('left 2 processes running, which were then killed');
  expect(said).toContain('  pid 511: node server.js --port 0\n');
});
