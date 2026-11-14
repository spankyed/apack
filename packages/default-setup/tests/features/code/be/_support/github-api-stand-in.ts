// A stand-in for GitHub's REST and GraphQL APIs on this machine. A case says what each route answers; a GraphQL
// request is answered by the first operation whose name its query contains (`repository`, `pullRequest(`,
// `convertPullRequestToDraft`…), in the order the case gave them; an answer a case computes may be awaited, as one
// that changes a real remote is. Every request is recorded with its body, so a
// case can say what was sent where. The bodies a case answers with are GitHub's own shapes, as its REST and GraphQL
// documentation gives them and as github.com answered on 2026-11-13.
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { GitHubEndpoints } from '#features/code/be/services/github.ts';

export interface StandInAnswer {
  status?: number;
  headers?: Record<string, string>;
  body?: unknown;
}

export interface RecordedRequest {
  method: string;
  path: string;
  body: any;
  authorization?: string;
}

/** What a request is answered with: by `METHOD /path` for REST, by a fragment of the query for GraphQL */
export interface StandInRoutes {
  rest?: Record<string, StandInAnswer | ((request: RecordedRequest) => StandInAnswer | Promise<StandInAnswer>)>;
  graphql?: Array<[fragment: string, answer: StandInAnswer | ((request: RecordedRequest) => StandInAnswer | Promise<StandInAnswer>)]>;
}

export async function startGitHubApiStandIn(routes: StandInRoutes): Promise<{ endpoints: GitHubEndpoints; requests: RecordedRequest[]; close(): Promise<void> }> {
  const requests: RecordedRequest[] = [];
  const server = http.createServer((incoming, response) => {
    let text = '';
    incoming.on('data', (chunk: Buffer) => { text += chunk.toString(); });
    incoming.on('end', async () => {
      const path = (incoming.url ?? '').split('?')[0]!;
      const request: RecordedRequest = {
        method: incoming.method ?? 'GET',
        path,
        body: text ? JSON.parse(text) : undefined,
        ...(incoming.headers.authorization && { authorization: incoming.headers.authorization }),
      };
      requests.push(request);
      const route = path === '/graphql'
        ? routes.graphql?.find(([fragment]) => String(request.body?.query ?? '').includes(fragment))?.[1]
        : routes.rest?.[`${request.method} ${path}`];
      const answer = typeof route === 'function' ? await route(request) : route ?? { status: 404, body: { message: 'Not Found' } };
      response.writeHead(answer.status ?? 200, { 'Content-Type': 'application/json', ...answer.headers });
      response.end(answer.body === undefined ? '' : JSON.stringify(answer.body));
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

/** A pull request node as GitHub's GraphQL answers the panel's query for one, with everything the details ask for */
export function pullRequestNode(overrides: Record<string, unknown> = {}) {
  return {
    id: 'PR_kwDOAbc123',
    number: 7,
    title: 'Add the thing',
    body: 'It adds the thing.',
    headRefName: 'feature/thing',
    baseRefName: 'main',
    isCrossRepository: false,
    state: 'OPEN',
    url: 'https://github.com/octo/repo/pull/7',
    isDraft: false,
    author: { login: 'octocat' },
    createdAt: '2026-11-13T10:00:00Z',
    updatedAt: '2026-11-13T11:00:00Z',
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'CLEAN',
    reviewDecision: 'APPROVED',
    checks: { nodes: [{ commit: { statusCheckRollup: { contexts: { nodes: [
      { __typename: 'CheckRun', name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS' },
      { __typename: 'StatusContext', context: 'ci/legacy', state: 'PENDING' },
    ] } } } }] },
    commitList: { nodes: [{ commit: { oid: 'abc123', messageHeadline: 'Add the thing', committedDate: '2026-11-13T09:00:00Z' } }] },
    comments: { nodes: [{
      id: 'IC_kwDOAbc', body: 'Looks good', author: { login: 'hubot' }, createdAt: '2026-11-13T12:00:00Z',
      url: 'https://github.com/octo/repo/pull/7#issuecomment-1001', viewerDidAuthor: false,
    }] },
    ...overrides,
  };
}
