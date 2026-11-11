// What a spec file is failed for leaving running, decided from one listing of every process. Each case is a
// listing as `ps` would give it: a shell (10) that started npm (100), which started vitest (110), which started
// the worker under test (120) and a second worker (130), all in npm's process group.
import { expect, it } from 'vitest';
import { leftoversIn, parseListing, type ListedProcess } from '../src/leftover-processes.ts';

const BEGAN = Date.parse('2026-11-11T01:00:10.900');
const before = BEGAN - 60_000;
const during = BEGAN + 2_000;

const row = (pid: number, ppid: number, pgid: number, command: string, startedAt = before): ListedProcess =>
  ({ pid, ppid, pgid, startedAt, command });

const RUN = [
  row(1, 0, 1, '/sbin/launchd'),
  row(10, 1, 10, '-zsh'),
  row(100, 10, 100, 'npm run test'),
  row(110, 100, 100, 'node vitest'),
  row(120, 110, 100, 'node vitest worker'),
  row(130, 110, 100, 'node vitest worker'),
];
const left = (...more: ListedProcess[]) =>
  leftoversIn([...RUN, ...more], 120, BEGAN).map(({ process, how }) => `${process.command}: ${how}`);

it('reports a process the worker started in a group of its own, and what that process started', () => {
  expect(left(
    row(200, 120, 200, 'node fake-broker.cjs', during),
    row(201, 200, 200, 'sh -c helper', during),
  )).toEqual(['node fake-broker.cjs: detached', 'sh -c helper: detached']);
});

// A bundler's service process lives for the worker and ends when the worker's pipe closes
it('leaves alone a child still attached to the worker, and reports what that child detached', () => {
  expect(left(
    row(210, 120, 100, 'esbuild --service', during),
    row(211, 210, 211, 'daemon', during),
  )).toEqual(['daemon: detached']);
});

it('reports a process in the worker\'s group that lost its parent while the file ran', () => {
  expect(left(row(220, 1, 100, '/bin/sh .git/hooks/post-commit', during))).toEqual(['/bin/sh .git/hooks/post-commit: orphaned']);
});

it('counts a process created in the second the file began, which is as finely as a listing dates one', () => {
  expect(left(row(220, 1, 100, 'sh loop', Date.parse('2026-11-11T01:00:10.000')))).toEqual(['sh loop: orphaned']);
});

it('leaves alone a process that lost its parent before the file began: an earlier file\'s, or nothing of this run\'s', () => {
  expect(left(row(220, 1, 100, 'sh loop', before))).toEqual([]);
});

it('leaves alone the run itself, the worker beside this one and what that worker started', () => {
  expect(left(
    row(300, 130, 100, 'git status', during),
    row(301, 130, 301, 'node detached-by-the-other-worker', during),
  )).toEqual([]);
});

it('leaves alone a process without a parent in some other group', () => {
  expect(left(row(400, 1, 400, 'someone else\'s daemon', during))).toEqual([]);
});

it('reports nothing from a listing the worker is not in, which says nothing about it', () => {
  expect(leftoversIn([row(1, 0, 1, '/sbin/launchd'), row(200, 120, 200, 'node fake-broker.cjs', during)], 120, BEGAN)).toEqual([]);
});

it('reads a listing\'s rows, a single-digit day and a command with spaces in it included', () => {
  const listing = [
    '    1     0     1 Sat Nov  7 09:02:11 2026     /sbin/launchd',
    '88813     1 88813 Wed Nov 11 02:16:02 2026     node /tmp/broker client/fake-broker.cjs /tmp/b.sock',
    '',
  ].join('\n');

  expect(parseListing(listing)).toEqual([
    { pid: 1, ppid: 0, pgid: 1, startedAt: new Date(2026, 10, 7, 9, 2, 11).getTime(), command: '/sbin/launchd' },
    { pid: 88813, ppid: 1, pgid: 88813, startedAt: new Date(2026, 10, 11, 2, 16, 2).getTime(), command: 'node /tmp/broker client/fake-broker.cjs /tmp/b.sock' },
  ]);
});
