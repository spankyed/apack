import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getSessionPlan } from '#features/code/be/services/claude-code/plan.ts';
import { ClaudePlanSchema } from '#features/code/be/services/claude-code/host-controls.ts';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function fixture(payload: unknown, error = false) {
  const cwd = await mkdtemp(join(tmpdir(), 'native-plan-test-')); directories.push(cwd);
  const cliPath = join(cwd, 'claude.mjs');
  await writeFile(cliPath, `#!${process.execPath}
import {createInterface} from 'node:readline';
import {writeFileSync} from 'node:fs';
const requests=[];
const input=createInterface({input:process.stdin});
input.on('line',line=>{
 const value=JSON.parse(line);requests.push(value);const init=value.request.subtype==='initialize';
 console.log(JSON.stringify({type:'control_response',response:${error}&&!init
 ?{subtype:'error',request_id:value.request_id,error:'plan unavailable'}
 :{subtype:'success',request_id:value.request_id,response:init?{commands:[],agents:[],models:[]}:${JSON.stringify(payload)}}}));
});
input.on('close',()=>writeFileSync('capture.json',JSON.stringify({requests,argv:process.argv.slice(2),closed:true})));
`, { mode: 0o755 });
  return { cwd, cliPath, env: { PATH: process.env.PATH, HOME: cwd } };
}

describe('saved native plan lookup', () => {
  it.each([{ exists: false }, { exists: true, content: '# Plan' }, { exists: true, content: '', path: '/fixture/plan.md' }])('reads %j without a prompt or persistence and closes the process', async payload => {
    const options = await fixture(payload);
    await expect(getSessionPlan({ ...options, sessionId: 'saved-session' })).resolves.toEqual(payload);
    const capture = JSON.parse(await readFile(join(options.cwd, 'capture.json'), 'utf8'));
    expect(capture.closed).toBe(true);
    expect(capture.argv).toEqual(expect.arrayContaining(['--resume', 'saved-session', '--no-session-persistence']));
    expect(capture.requests.map((value: { request: { subtype: string } }) => value.request.subtype)).toEqual(['initialize', 'get_plan']);
  });
  it('propagates native failure and closes its child', async () => {
    const options = await fixture({}, true);
    await expect(getSessionPlan({ ...options, sessionId: 'saved-session' })).rejects.toThrow('plan unavailable');
    expect(JSON.parse(await readFile(join(options.cwd, 'capture.json'), 'utf8')).closed).toBe(true);
  });
  it('rejects prompt injection and an empty resume target before spawning', async () => {
    const options = await fixture({ exists: false });
    await expect(getSessionPlan({ ...options, sessionId: 'saved-session', prompt: 'not a lookup' } as never)).rejects.toThrow('unsupported plan options: prompt');
    await expect(getSessionPlan({ ...options, sessionId: ' ' })).rejects.toThrow('sessionId is required');
    await expect(readFile(join(options.cwd, 'capture.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it.each([{}, { exists: 'true' }, { exists: true }, { exists: true, content: 42 }])('rejects malformed native plan replies %j', value => {
    expect(ClaudePlanSchema.safeParse(value).success).toBe(false);
  });
});
