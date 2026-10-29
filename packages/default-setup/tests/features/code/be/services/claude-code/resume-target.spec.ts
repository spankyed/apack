import { describe, expect, it, afterEach } from 'vitest';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateSessionResumeTarget } from '#features/code/be/services/claude-code/session-controls.ts';
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
  const response=${error}?{subtype:'error',request_id:value.request_id,error:'context unavailable'}:
    {subtype:'success',request_id:value.request_id,response:payload};
  console.log(JSON.stringify({type:'control_response',response}));
});
input.on('close',()=>writeFileSync('capture.json',JSON.stringify({argv:process.argv.slice(2),requests,closed:true})));
`, { mode: 0o755 });
  return { cwd, cliPath, env: { PATH: process.env.PATH, HOME: cwd } };
}

describe('native resume-target validation', () => {
  it('initializes without a prompt, prevents persisted forks and closes', async () => {
    const options = await fakeCli();
    await validateSessionResumeTarget({ ...options, sessionId: 'session-1', messageUuid: 'assistant-1' });
    const capture = JSON.parse(await readFile(join(options.cwd, 'capture.json'), 'utf8'));
    expect(capture.closed).toBe(true);
    expect(capture.argv).toEqual(expect.arrayContaining(['--resume', 'session-1', '--fork-session', '--resume-session-at', 'assistant-1', '--no-session-persistence']));
    expect(capture.requests).toHaveLength(1);
    expect(capture.requests[0]).toMatchObject({type:'control_request',request:{subtype:'initialize'}});
  });
  it('propagates native rejection and closes', async () => {
    const options = await fakeCli(true);
    await expect(validateSessionResumeTarget({...options,sessionId:'session-1',messageUuid:'old'})).rejects.toThrow('context unavailable');
    expect(JSON.parse(await readFile(join(options.cwd,'capture.json'),'utf8')).closed).toBe(true);
  });
  it('rejects accidental user turns and empty boundaries before launch', async () => {
    const options = {...await fakeCli(),sessionId:'session-1',messageUuid:'assistant-1',prompt:'never send'};
    await expect(validateSessionResumeTarget(options)).rejects.toThrow('unsupported resume target options');
    await expect(validateSessionResumeTarget({sessionId:'session-1',messageUuid:' ',cwd:options.cwd})).rejects.toThrow('required');
    await expect(readFile(join(options.cwd,'capture.json'))).rejects.toMatchObject({code:'ENOENT'});
  });
});
