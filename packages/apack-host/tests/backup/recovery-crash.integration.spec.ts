// Real process death after an import commit and after either offline publication rename. No data is mocked.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFile, spawn, type ChildProcess, type ExecFileException } from 'node:child_process';
import { once } from 'node:events';
import { afterEach, expect, it } from 'vitest';
import { withoutSourceCondition } from '../../src/build/source-resolution.ts';

const roots: string[] = [], readers: ChildProcess[] = [];
afterEach(async () => {
  for (const reader of readers.splice(0)) { if (reader.exitCode === null && reader.signalCode === null) { reader.kill('SIGKILL'); await once(reader, 'exit'); } }
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
const child = String.raw`
import fs from 'node:fs';
import path from 'node:path';
import {syncBuiltinESMExports} from 'node:module';
import {createEarsEngine} from '@apackdev/ears';
import {_appDataPaths} from '@apackdev/sdk/utils';
import {resolveAppEnvironment} from '@apackdev/sdk/env';
import {_RUN_HISTORY_SCHEMA} from '@apackdev/sdk/services';
import {databaseStorage,openDatabaseStore,openRunHistory,findDatabaseWriter} from '@apackdev/host/database';
import {databaseBackupStore,importDatabase,listImportRecoveries,restoreImportRecovery} from '@apackdev/host/backup';
for(const name of ['@apackdev/ears','@apackdev/sdk/utils']){
 if(!new URL(import.meta.resolve(name)).pathname.includes('/dist/'))throw new Error('Recovery child must resolve built package: '+name);
}
const [action,root,format,boundary]=JSON.parse(process.env.EARS_RECOVERY_PROBE), paths=_appDataPaths(root);
const target={...resolveAppEnvironment({env:'test',userDataDir:root}),storageFormat:format};
const schema=type=>type==='RunNode'?_RUN_HISTORY_SCHEMA:({types:{[type]:{required:[]}},relations:{},roles:[]});
const read=(dir,type)=>{
 if(!fs.existsSync(dir))return null;
 const db=databaseStorage(format).open({path:dir,readOnly:true});
 try{return createEarsEngine({database:db}).query(type).ids()}finally{db.close()}
};
const refusal=operation=>{try{const result=operation();result.database.close();return null}catch(error){return error.code}};
const inspect=()=>({
 primary:read(paths.lmdb,'Row'),history:read(paths.runHistory,'RunNode'),media:fs.readFileSync(path.join(paths.media,'asset'),'utf8'),
 primaryOpen:refusal(()=>openDatabaseStore({path:paths.lmdb,storageFormat:format,schema:{getRegisteredEntityTypes:()=>new Set(['Row']),getRegisteredRelationKinds:()=>new Set(),getRegisteredRoles:()=>new Set()}})),
 historyOpen:refusal(()=>openRunHistory(paths.runHistory,{storageFormat:format})),sessions:listImportRecoveries(root)
});
if(action==='import'){
 const candidate=path.join(root,'candidate');fs.mkdirSync(candidate,{recursive:true});
 for(const [name,type] of [['lmdb','Row'],['runHistory','RunNode']]){
  for(const [dir,suffix] of [[paths[name],'before'],[path.join(candidate,name),'candidate']]){
   const db=databaseStorage(format).open({path:dir,schema:schema(type),syncs:true});
   try{createEarsEngine({database:db}).create(type,{id:type+'-'+suffix,...(type==='RunNode'?{kind:'flow',label:suffix,status:'completed',startedAt:0,rootId:type+'-'+suffix}:{})})}finally{db.close()}
  }
 }
 fs.writeFileSync(path.join(candidate,'metadata.json'),JSON.stringify({databases:['lmdb','runHistory']}));
 for(const [dir,value] of [[paths.media,'incumbent'],[path.join(candidate,'media'),'candidate']]){
  fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'asset'),value);
 }
 const primary=databaseStorage(format).open({path:paths.lmdb,syncs:true}),history=databaseStorage(format).open({path:paths.runHistory,syncs:true});
 const replace=primary.replaceWith.bind(primary);
 primary.replaceWith=source=>{replace(source);fs.writeFileSync(path.join(root,'killed-at'),'import-committed');process.kill(process.pid,'SIGKILL')};
 await importDatabase({lmdb:databaseBackupStore(primary),runHistory:databaseBackupStore(history)},candidate,paths.media,{log:{info(){},warn(){}}});
 throw new Error('import kill boundary not reached');
}else if(action==='inspect')console.log(JSON.stringify(inspect()));
else if(action==='reader'||action==='writer'){
 // Publish a preparation after a real writable handle opens, matching a handle that predates recovery.
 const pending=action==='writer'?listImportRecoveries(root).find(item=>item.status!=='recovered'):undefined;
 const marker=pending?path.join(path.dirname(pending.recoveryPath),'recovery.json'):undefined;
 const record=marker?fs.readFileSync(marker):undefined;
 if(marker)fs.unlinkSync(marker);
 let reader;
 try{reader=openRunHistory(paths.runHistory,{readOnly:action==='reader',storageFormat:format})}
 finally{if(marker)fs.writeFileSync(marker,record,{mode:0o600})}
 const parent=process.ppid;
 console.log('ready');setInterval(()=>{if(process.ppid!==parent){reader.database.close();process.exit(1)}},100);
}
else{
 const pending=listImportRecoveries(root).find(item=>item.status!=='recovered');
 if(!pending)throw new Error('pending session missing');
 const dir=path.dirname(pending.recoveryPath);
 if(action==='kill-recovery'){
  const rename=fs.renameSync.bind(fs);
  fs.renameSync=(from,to)=>{
   rename(from,to);
   if(String(to)===(boundary==='move'?path.join(dir,'interrupted/lmdb'):paths.lmdb)){
    fs.writeFileSync(path.join(root,'killed-at'),'recovery-'+boundary);process.kill(process.pid,'SIGKILL');
   }
  };syncBuiltinESMExports();
 }
 let result;
 try{result=restoreImportRecovery(target,pending.session)}catch(error){
  if(action==='recover-blocked'){console.log(JSON.stringify({refused:error.message}));process.exit(0)}throw error;
 }
 if(action==='kill-recovery')throw new Error('recovery kill boundary not reached');
 console.log(JSON.stringify({...inspect(),result,interrupted:read(path.join(dir,'interrupted/lmdb'),'Row'),retained:read(path.join(dir,'rollback/lmdb'),'Row'),writer:findDatabaseWriter(root)}));
}
`;
async function run(action: string, root: string, format: string, boundary: string, killed = false) {
  const result = await new Promise<{ error: ExecFileException | null; stdout: string; stderr: string }>(resolve => {
    execFile(process.execPath, ['--input-type=module', '--eval', child], {
      encoding: 'utf8', timeout: 15_000, env: { ...process.env, NODE_OPTIONS: withoutSourceCondition(process.env.NODE_OPTIONS), APACK_STORAGE_FORMAT: format, APACK_USER_DATA_DIR: root, EARS_RECOVERY_PROBE: JSON.stringify([action, root, format, boundary]) },
    }, (error, stdout, stderr) => { resolve({ error, stdout, stderr }); });
  });
  const reason = `${action} (${format}, ${boundary}): ${result.stderr}`;
  expect(result.error?.killed, reason).not.toBe(true);
  if (killed) { expect(result.error?.signal, reason).toBe('SIGKILL'); return; }
  expect(result.error, reason).toBeNull();
  return JSON.parse(result.stdout);
}

it.skipIf(process.platform === 'win32').each(
  ['elmdb/1', 'sqlite/1'].flatMap(format => ['move', 'publish'].flatMap(boundary =>
    [false, true].map(alias => [format, boundary, alias] as const))),
)('recovers %s after SIGKILL at %s (alias=%s) without exposing a partially restored profile', async (format, boundary, alias) => {
  const physical = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-real-import-crash-')); roots.push(physical);
  const root = alias ? path.join(physical, 'profile-alias') : physical;
  if (alias) fs.symlinkSync(physical, root, 'dir');
  await run('import', root, format!, boundary!, true);
  expect(fs.readFileSync(path.join(root, 'killed-at'), 'utf8')).toBe('import-committed');
  expect(await run('inspect', root, format!, boundary!)).toMatchObject({ primary: ['Row-candidate'], history: ['RunNode-before'], media: 'incumbent', primaryOpen: 'RECOVERY_REQUIRED', historyOpen: 'RECOVERY_REQUIRED' });
  await run('kill-recovery', root, format!, boundary!, true);
  expect(fs.readFileSync(path.join(root, 'killed-at'), 'utf8')).toBe('recovery-' + boundary);
  expect(await run('inspect', root, format!, boundary!)).toMatchObject({ primaryOpen: 'RECOVERY_REQUIRED', historyOpen: 'RECOVERY_REQUIRED', sessions: [{ status: 'restoring' }] });
  expect(await run('recover', alias ? fs.realpathSync(physical) : root, format!, boundary!)).toMatchObject({ primary: ['Row-before'], history: ['RunNode-before'], media: 'incumbent', primaryOpen: null, historyOpen: null, result: { status: 'recovered' }, interrupted: ['Row-candidate'], retained: ['Row-before'], writer: null });
});

it.skipIf(process.platform === 'win32').each(['reader', 'writer'])('refuses a separate live %s and reclaims its claim after SIGKILL', async action => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-reader-recovery-')); roots.push(root);
  await run('import', root, 'sqlite/1', 'move', true);
  const reader = spawn(process.execPath, ['--input-type=module', '--eval', child], {
    stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NODE_OPTIONS: withoutSourceCondition(process.env.NODE_OPTIONS), APACK_STORAGE_FORMAT: 'sqlite/1', APACK_USER_DATA_DIR: root, EARS_RECOVERY_PROBE: JSON.stringify([action, root, 'sqlite/1', 'move']) },
  });
  readers.push(reader);
  const ready = await Promise.race([once(reader.stdout!, 'data'), once(reader, 'exit').then(() => { throw new Error('Reader exited before opening'); })]);
  expect(String(ready[0]).trim()).toBe('ready');
  expect(await run('recover-blocked', root, 'sqlite/1', 'move')).toMatchObject({ refused: expect.stringContaining('Close apps and tools using this profile') });
  reader.kill('SIGKILL'); await once(reader, 'exit');
  expect(await run('recover', root, 'sqlite/1', 'move')).toMatchObject({ primary: ['Row-before'], history: ['RunNode-before'], result: { status: 'recovered' }, writer: null });
});
