// What can be done about a remote that asked for a sign-in, from the remote's address
import { expect, it } from 'vitest';
import { signInHelpFor } from '../../../../../src/features/code/be/services/sign-in.ts';

it.each([
  ['https://github.com/octo/repo.git', { host: 'github.com', kind: 'github-cli' }],
  ['https://someone@github.com/octo/repo.git', { host: 'github.com', kind: 'github-cli' }],
  ['https://GitHub.com/octo/repo', { host: 'github.com', kind: 'github-cli' }],
  ['https://gitlab.com/octo/repo.git', { host: 'gitlab.com', kind: 'https' }],
  ['http://127.0.0.1:8080/repo.git', { host: '127.0.0.1', kind: 'https' }],
  ['git@github.com:octo/repo.git', { host: 'github.com', kind: 'ssh' }],
  ['ssh://git@github.com/octo/repo.git', { host: 'github.com', kind: 'ssh' }],
  ['ssh://git@git.example.com:2222/octo/repo.git', { host: 'git.example.com', kind: 'ssh' }],
  ['example.com:octo/repo.git', { host: 'example.com', kind: 'ssh' }],
] as const)('offers the sign-in %s can take', (address, help) => {
  expect(signInHelpFor(`${address}\n`)).toEqual(help);
});

it.each(['/srv/git/repo.git', '../repo.git', 'file:///srv/git/repo.git', 'C:/git/repo.git', ''])('offers nothing for %s, which is a path on this machine', (address) => {
  expect(signInHelpFor(address)).toBeUndefined();
});

// The host reaches a command line when the user takes the offer
it('offers nothing for an address whose host would read as an option', () => {
  expect(signInHelpFor('https://-oProxyCommand=evil/repo.git')).toBeUndefined();
});
