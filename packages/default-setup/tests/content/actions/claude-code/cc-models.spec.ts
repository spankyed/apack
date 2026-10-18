import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { query } from '../../../../src/features/code/be/services/claude-code/query.ts';
import { getModels } from '../../../../src/features/code/be/services/claude-code/models.ts';
import { describe, expect, it, vi } from 'vitest';
import { mockService } from '@apackdev/testing/harness';
import { services, type Services } from '#generated/services.ts';
import { action } from '../../../../src/content/actions/claude-code/cc-command.ts';

function setup(cwd?: string) {
 const catalog = { models: [{ value: 'native-alias', displayName: 'Native choice', resolvedModel: 'native-id', supportedEffortLevels: ['future-effort'] }] };
 const live = vi.fn().mockResolvedValue(catalog), fresh = vi.fn().mockResolvedValue(catalog);
 mockService<Services, 'cli'>('cli', { claudeCode: {
  getNativeTerminal: vi.fn(), getWorkingDir: () => '/selected', getConversation: () => cwd ? { owner: { sessionCwd: cwd, handle: { getModels: live } } } : undefined,
  getModels: fresh,
 } as never });
 mockService<Services, 'chat'>('chat', { sendBlockMessage: vi.fn() });
 return { live, fresh };
}
const run = (text?: string) => action({ command: 'cc-models', threadId: 'catalog-thread', text }, services, {} as never, 'catalog-flow');
describe('native model catalog command', () => {
 it('uses the matching process and preserves native names and effort values', async () => {
  const f=setup('/selected'); const result=await run();
  expect(result.text).toContain('native-alias: Native choice (native-id)');
  expect(result.text).toContain('future-effort'); expect(result.text).toContain('does not identify the active selection');
  expect(f.live).toHaveBeenCalledOnce(); expect(f.fresh).not.toHaveBeenCalled();
 });
 it.each([undefined, '/other'])('requires explicit start without a matching owner (%s)', async cwd => {
  const f=setup(cwd); expect((await run()).text).toContain('session hooks');
  expect(f.live).not.toHaveBeenCalled(); expect(f.fresh).not.toHaveBeenCalled();
  expect((await run('start')).text).toContain('Native choice'); expect(f.fresh).toHaveBeenCalledWith({cwd:'/selected'});
 });
 it('requires explicit temporary discovery for unknown-model listing even with a live owner', async () => {
  const f=setup('/selected');
  expect((await run('--include-unsupported-models')).text).toContain('Usage:');
  expect(f.fresh).not.toHaveBeenCalled(); expect(f.live).not.toHaveBeenCalled();
  expect((await run('start --include-unsupported-models')).text).toContain('Native choice');
  expect(f.fresh).toHaveBeenCalledWith({cwd:'/selected',includeUnsupportedModels:true});
  expect(f.live).not.toHaveBeenCalled();
 });
 it('rejects invalid arguments before starting a process', async () => {
  const f=setup(); expect((await run('start extra')).text).toContain('Usage:'); expect(f.fresh).not.toHaveBeenCalled();
 });
 it('reports native failure and empty catalog without invented entries', async () => {
  const f=setup('/selected'); f.live.mockRejectedValueOnce(new Error('native policy refusal'));
  expect((await run()).text).toContain('native policy refusal');
  f.live.mockResolvedValueOnce({models:[]}); expect((await run()).text).toContain('Native catalog is empty');
 });
});

it.skipIf(!process.env.CLAUDE_CATALOG_TEST_BINARY)('presents the actual native catalog and closes fresh discovery with no model request or settings write', async () => {
 const root=await mkdtemp(join(tmpdir(),'native-catalog-app-')); let requests=0;
 const server=createServer((_req,res)=>{requests++;res.writeHead(503);res.end('unexpected model call');});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const address=server.address(); if(!address || typeof address==='string') throw new Error('missing loopback address');
 let handle: Awaited<ReturnType<typeof query>> | undefined;
 try {
  const config=join(root,'home','.claude'); await mkdir(config,{recursive:true});
  const settings=join(config,'settings.json'), before=JSON.stringify({apiKeyHelper:'/usr/bin/printf research-fixture-key',model:'sonnet'}); await writeFile(settings,before);
  const options={cwd:root,includeUnsupportedModels:true,cliPath:process.env.CLAUDE_CATALOG_TEST_BINARY,env:{PATH:process.env.PATH,HOME:join(root,'home'),CLAUDE_CONFIG_DIR:config,ANTHROPIC_BASE_URL:`http://127.0.0.1:${address.port}`,DISABLE_AUTOUPDATER:'1',CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1'}};
  handle=await query({...options,keepStdinOpen:true,noSessionPersistence:true}); await handle.initialized;
  const native=await handle.getModels(); expect(native.models.length).toBeGreaterThan(0);
  setup(root); mockService<Services,'cli'>('cli',{claudeCode:{getNativeTerminal:()=>undefined,getWorkingDir:()=>root,getConversation:()=>({owner:{sessionCwd:root,handle}})} as never});
  const result=await run();
  for(const model of native.models) expect(result.text).toContain(`${model.value}: ${model.displayName}`);
  await handle.close(); handle=undefined;
  const fresh=await getModels(options); expect(fresh).toEqual(native);
  expect(requests).toBe(0); expect(await readFile(settings,'utf8')).toBe(before);
 } finally {await handle?.close(); await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve())); await rm(root,{recursive:true,force:true});}
},15000);

it('reads the current terminal catalog without a discovery process', async () => {
 const f=setup();
 const getModels=vi.fn(async()=>({models:[{value:'native-new',displayName:'Native new model',disabled:true}]}));
 vi.mocked(services.cli.claudeCode.getNativeTerminal).mockReturnValue({state:{cwd:'/selected',sessionId:'session'},getModels} as never);
 const result=await run();
 expect(result.text).toContain('native-new: Native new model');
 expect(result.text).toContain('[unavailable]');
 expect(getModels).toHaveBeenCalledWith({includeUnsupportedModels:false});
 expect(f.fresh).not.toHaveBeenCalled();expect(f.live).not.toHaveBeenCalled();
});
