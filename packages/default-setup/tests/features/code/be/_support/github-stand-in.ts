// A stand-in for GitHub's device flow and its REST API, on this machine: the two sign-in endpoints answer what a case
// scripts, in the shape GitHub documents, and `/user` answers for the one token it issued. Every request is recorded
// with its form fields, so a case can say what was asked and when.
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { GitHubEndpoints } from '#features/code/be/services/github.ts';

/** What the token endpoint answers to one ask: a pending, a slow-down (with GitHub's new interval or without), an error, or the token */
export type TokenAnswer =
  | { error: 'authorization_pending' | 'expired_token' | 'access_denied' | 'unsupported_grant_type' }
  | { error: 'slow_down'; interval?: number }
  | { access_token: string; scope: string };

export interface StandInRequest {
  path: string;
  fields: Record<string, string>;
  authorization?: string;
}

export const STAND_IN_TOKEN = 'gho_standin';

export async function startGitHubStandIn({ tokenAnswers, interval = 5, expiresIn = 900 }: {
  /** What each ask for the token answers, in order; the last repeats */
  tokenAnswers: TokenAnswer[];
  interval?: number;
  expiresIn?: number;
}): Promise<{ endpoints: GitHubEndpoints; requests: StandInRequest[]; close(): Promise<void> }> {
  const requests: StandInRequest[] = [];
  let asked = 0;
  const server = http.createServer((request, response) => {
    let body = '';
    request.on('data', (chunk: Buffer) => { body += chunk.toString(); });
    request.on('end', () => {
      const path = (request.url ?? '').split('?')[0]!;
      requests.push({ path, fields: Object.fromEntries(new URLSearchParams(body)), ...(request.headers.authorization && { authorization: request.headers.authorization }) });
      const json = (status: number, value: unknown) => {
        response.writeHead(status, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify(value));
      };
      if (request.method === 'POST' && path === '/login/device/code') {
        return json(200, { device_code: 'device-1', user_code: 'ABCD-1234', verification_uri: 'https://github.com/login/device', expires_in: expiresIn, interval });
      }
      if (request.method === 'POST' && path === '/login/oauth/access_token') {
        return json(200, tokenAnswers[Math.min(asked++, tokenAnswers.length - 1)]);
      }
      if (request.method === 'GET' && path === '/user') {
        return request.headers.authorization === `Bearer ${STAND_IN_TOKEN}`
          ? json(200, { login: 'octocat', name: 'The Octocat', avatar_url: 'https://avatars.example/octocat' })
          : json(401, { message: 'Bad credentials' });
      }
      json(404, { message: 'Not Found' });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    endpoints: { web: base, api: base },
    requests,
    close: () => new Promise<void>((resolve, reject) => {
      server.closeAllConnections();
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
}
