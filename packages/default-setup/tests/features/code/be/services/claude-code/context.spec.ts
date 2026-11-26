import { describe, expect, it, afterEach } from 'vitest';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getSessionContextUsage } from '#features/code/be/services/claude-code/context.ts';
import { nativeContextUsage } from '../../../../../_support/claude-context.ts';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

async function fakeCli(error = false) {
  const cwd = await mkdtemp(join(tmpdir(), 'native-context-test-')); directories.push(cwd);
  const cliPath = join(cwd, 'claude-fixture.mjs');
  await writeFile(cliPath, `#!${process.execPath}
import {createInterface} from 'node:readline';
import {writeFileSync} from 'node:fs';
const requests=[];
const input=createInterface({input:process.stdin});
input.on('line',line=>{
  const value=JSON.parse(line);requests.push(value);
  const initialized=value.request.subtype==='initialize';
  const payload=initialized?{commands:[],agents:[],models:[]}:${JSON.stringify(nativeContextUsage)};
  const response=${error}&&!initialized?{subtype:'error',request_id:value.request_id,error:'context unavailable'}:
    {subtype:'success',request_id:value.request_id,response:payload};
  console.log(JSON.stringify({type:'control_response',response}));
});
input.on('close',()=>writeFileSync('capture.json',JSON.stringify({argv:process.argv.slice(2),requests,closed:true})));
`, { mode: 0o755 });
  return { cwd, cliPath, env: { PATH: process.env.PATH, HOME: cwd } };
}

describe('saved-session native context', () => {
  it('resumes without a user prompt, prevents transcript persistence and closes its process', async () => {
    const options = await fakeCli();
    await expect(getSessionContextUsage({ ...options, sessionId: 'session-1' })).resolves.toMatchObject(nativeContextUsage);
    const capture = JSON.parse(await readFile(join(options.cwd, 'capture.json'), 'utf8'));
    expect(capture.closed).toBe(true);
    expect(capture.argv).toEqual(expect.arrayContaining(['--resume', 'session-1', '--no-session-persistence']));
    expect(capture.requests.map((request: { type: string; request: { subtype: string } }) => [request.type, request.request.subtype]))
      .toEqual([['control_request', 'initialize'], ['control_request', 'get_context_usage']]);
    expect(capture.requests[1].request.detail).toBe('summary');
  });

  it('closes a process whose native context request fails and propagates the failure', async () => {
    const options = await fakeCli(true);
    await expect(getSessionContextUsage({ ...options, sessionId: 'session-1' })).rejects.toThrow('context unavailable');
    expect(JSON.parse(await readFile(join(options.cwd, 'capture.json'), 'utf8')).closed).toBe(true);
  });

  it('rejects extra prompt options before spawning instead of accidentally starting a model turn', async () => {
    const options = { ...await fakeCli(), sessionId: 'session-1', prompt: 'must not become a user turn' };
    await expect(getSessionContextUsage(options)).rejects.toThrow('unsupported context options: prompt');
    await expect(readFile(join(options.cwd, 'capture.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('refuses an empty resume target rather than returning a new session summary', async () => {
    await expect(getSessionContextUsage({ sessionId: ' ', cwd: '/fixture' })).rejects.toThrow('sessionId is required');
  });
});
