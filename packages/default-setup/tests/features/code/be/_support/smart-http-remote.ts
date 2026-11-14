// A git remote over smart HTTP on this machine, as GitHub serves one: git's own `http-backend` behind a server that
// asks for a sign-in and takes only the tokens it was given, as the password of any username. It records who
// signed in with which token, so a case can say whose sign-in a push used.
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import type { AddressInfo } from 'node:net';
import { execFileWhileWorking } from '@apackdev/sdk/progress';

export interface SignedIn {
  username: string;
  password: string;
}

/** `repository` is where it is served, as GitHub serves `owner/name`: `repo` unless a case names another */
export async function startSmartHttpRemote({ tokens, repository = 'repo' }: { tokens: string[]; repository?: string }): Promise<{
  /** The server's address, as a credential helper's URL names it */
  web: string;
  /** The repository's address on it */
  url: string;
  /** The bare repository it serves, on disk */
  directory: string;
  /** Every sign-in it took */
  signIns: SignedIn[];
  close(): Promise<void>;
}> {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'smart-http-')));
  const directory = path.join(root, `${repository}.git`);
  fs.mkdirSync(path.dirname(directory), { recursive: true });
  await execFileWhileWorking('git', ['init', '--quiet', '--bare', '--initial-branch=main', directory]);
  const signIns: SignedIn[] = [];

  const server = http.createServer((request, response) => {
    const [scheme, encoded] = (request.headers.authorization ?? '').split(' ');
    const [username = '', password = ''] = scheme === 'Basic' && encoded ? Buffer.from(encoded, 'base64').toString().split(/:(.*)/s) : [];
    if (!tokens.includes(password)) {
      request.resume();
      response.writeHead(401, { 'WWW-Authenticate': 'Basic realm="smart-http"' }).end();
      return;
    }
    signIns.push({ username, password });
    const [pathInfo, query = ''] = (request.url ?? '').split('?');
    const backend = spawn('git', ['http-backend'], {
      env: {
        ...process.env,
        GIT_PROJECT_ROOT: root,
        GIT_HTTP_EXPORT_ALL: '1',
        REQUEST_METHOD: request.method ?? 'GET',
        PATH_INFO: pathInfo,
        QUERY_STRING: query,
        CONTENT_TYPE: request.headers['content-type'] ?? '',
        // A signed-in user may push: http-backend takes a push only from one
        REMOTE_USER: username,
        REMOTE_ADDR: '127.0.0.1',
      },
    });
    request.pipe(backend.stdin);
    const out: Buffer[] = [];
    backend.stdout.on('data', (chunk: Buffer) => out.push(chunk));
    backend.on('close', () => {
      const whole = Buffer.concat(out);
      const split = whole.indexOf('\r\n\r\n');
      const head = whole.subarray(0, split).toString().split('\r\n');
      const headers: Record<string, string> = {};
      let status = 200;
      for (const line of head) {
        const [name, ...value] = line.split(': ');
        if (name!.toLowerCase() === 'status') status = Number.parseInt(value.join(': '), 10);
        else if (name) headers[name] = value.join(': ');
      }
      response.writeHead(status, headers).end(whole.subarray(split + 4));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const web = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    web,
    url: `${web}/${repository}.git`,
    directory,
    signIns,
    close: async () => {
      await new Promise<void>((resolve, reject) => { server.closeAllConnections(); server.close((error) => error ? reject(error) : resolve()); });
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}
