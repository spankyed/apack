import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {getTestSettings,mockService} from '@apackdev/testing/harness';
import {services,type Services} from '#generated/services.ts';
import {repository} from '#generated/repository.ts';
import {cliService} from '#features/code/be/services/cli.ts';
import {action} from '../../../../src/content/actions/claude-code/cc-dir-ops.ts';

let root:string;
let threadId:ReturnType<typeof repository.threadCommands.create>['id'];
let readSettings:ReturnType<typeof vi.fn>;
let writeSettings:ReturnType<typeof vi.fn>;
beforeEach(async()=>{
  root=await mkdtemp(join(tmpdir(),'claude-directory-remember-'));
  vi.stubEnv('CLAUDE_CONFIG_DIR',root);
  threadId=repository.threadCommands.create({topic:'Directory settings failure',instructions:'',tags:[]}).id;
  repository.threadCommands.update(threadId,{context:{claudeCode:{additionalDirs:['/kept']}}});
  readSettings=vi.fn(cliService.claudeCode.readSettings);
  writeSettings=vi.fn(cliService.claudeCode.writeSettings);
  mockService<Services,'cli'>('cli',{claudeCode:{...cliService.claudeCode,readSettings,writeSettings}});
  mockService<Services,'chat'>('chat',{sendBlockMessage:vi.fn()});
  mockService<Services,'emitter'>('emitter',{broadcastToSurface:vi.fn()});
});
afterEach(async()=>{vi.unstubAllEnvs();await rm(root,{recursive:true,force:true});});
const run=(text='/added --remember')=>action({command:'cc-add-dir',threadId,text},services,{} as never,'directory-flow');
const directories=()=>repository.threadQueries.byId(threadId)?.context?.claudeCode?.additionalDirs;

it('does not change thread roots when remembered settings cannot be parsed',async()=>{
  const raw='{"privateFixtureSecret":"do-not-display",';
  await writeFile(join(root,'settings.json'),raw);
  const result=await run();
  expect(directories()).toEqual(['/kept']);
  expect(result.success).toBe(false);
  expect(result.text).toContain('cc-add-dir failed:');
  expect(result.text).not.toContain('privateFixtureSecret');
  expect(await readFile(join(root,'settings.json'),'utf8')).toBe(raw);
});
it('does not change thread roots when the remembered settings write fails',async()=>{
  const raw=JSON.stringify({env:{FIXTURE:'retained'}});
  await writeFile(join(root,'settings.json'),raw);
  writeSettings.mockRejectedValueOnce(new Error('fixture settings write refused'));
  const result=await run();
  expect(directories()).toEqual(['/kept']);
  expect(result.success).toBe(false);
  expect(result.text).toContain('fixture settings write refused');
  expect(await readFile(join(root,'settings.json'),'utf8')).toBe(raw);
});
it('adds remembered roots after saving while retaining unrelated settings and deduplicating',async()=>{
  await writeFile(join(root,'settings.json'),JSON.stringify({env:{FIXTURE:'retained'},permissions:{allow:['Read']}}));
  expect((await run()).success).toBe(true);
  expect((await run()).success).toBe(true);
  expect(directories()).toEqual(['/kept','/added']);
  expect(JSON.parse(await readFile(join(root,'settings.json'),'utf8'))).toEqual({env:{FIXTURE:'retained'},permissions:{allow:['Read'],additionalDirectories:['/added']}});
  expect(writeSettings).toHaveBeenCalledTimes(1);
});
it('keeps thread-only directory selection independent of the settings file',async()=>{
  readSettings.mockRejectedValue(new Error('must not read'));
  expect((await run('/added')).success).toBe(true);
  expect(directories()).toEqual(['/kept','/added']);
  expect(readSettings).not.toHaveBeenCalled();expect(writeSettings).not.toHaveBeenCalled();
});

it.each([
  ['"/folder with spaces"','/folder with spaces'],
  ['/','/'],
])('preserves the selected directory path for %s',async(text,path)=>{
  expect((await run(text)).success).toBe(true);
  expect(directories()).toEqual(['/kept',path]);
  expect(readSettings).not.toHaveBeenCalled();
});
it('rejects an unfinished quoted path before changing roots',async()=>{
  const result=await run('"/unfinished path');
  expect(result.success).toBe(false);
  expect(directories()).toEqual(['/kept']);
  expect(result.text).toContain('unclosed quote');
});

it.each([
  ['"/folder with spaces"','/folder with spaces'],
  ['/','/'],
])('uses the same literal path for cc-set-dir %s',async(text,path)=>{
  const result=await action({command:'cc-set-dir',threadId,text},services,{} as never,'directory-flow');
  expect(result.success).toBe(true);
  expect(getTestSettings().getOverrides().features?.['default-setup/code']).toHaveProperty('defaultBaseDirectory',path);
  expect(directories()).toEqual(['/kept']);
});
