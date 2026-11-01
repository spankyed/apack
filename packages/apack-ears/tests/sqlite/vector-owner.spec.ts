import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { claimNativeVectorOwner } from '../../src/sqlite/vector-owner.ts';
let root:string;const held:Array<()=>void>=[];
beforeEach(()=>{root=mkdtempSync(join(tmpdir(),'ears-vector-owner-'));});
afterEach(()=>{for(const release of held.splice(0))release();rmSync(root,{recursive:true,force:true});});
const claim=()=>{const release=claimNativeVectorOwner(root);held.push(release);return release;};

describe.runIf(process.env.EARS_EVALUATION_BACKEND==='sqlite')('native vector service ownership',()=>{
  it('excludes independent descriptors in the same process and keeps the persistent inode after release',()=>{
    const release=claim(),file=join(root,'.native-model-owner.lock'),before=statSync(file);
    expect(()=>claim()).toThrow(expect.objectContaining({code:'BACKGROUND_OWNER_EXISTS'}));
    release();release();expect(existsSync(file)).toBe(true);claim();
    expect(statSync(file).ino).toBe(before.ino);
    if(process.platform!=='win32')expect(statSync(file).mode&0o777).toBe(0o600);
  });
  it('does not turn filesystem failures into ownership refusals',()=>{
    const file=join(root,'ordinary-file');writeFileSync(file,'retained');
    expect(()=>claimNativeVectorOwner(file)).toThrow(expect.objectContaining({code:expect.stringMatching(/^(ENOTDIR|ENOENT)$/)}));
  });
  it('releases after process death and keeps ownership through a handled termination signal',async()=>{
    const module=new URL('../../src/sqlite/vector-owner.ts',import.meta.url).href;
    const script=`const {claimNativeVectorOwner}=await import(${JSON.stringify(module)});const release=claimNativeVectorOwner(${JSON.stringify(root)});
      process.on('disconnect',()=>process.exit(0));process.on('SIGTERM',()=>process.send('signal'));
      process.send('ready');`;
    const child=spawn(process.execPath,['--import','tsx','--input-type=module','-e',script],{stdio:['ignore','ignore','pipe','ipc']});
    let errors='';child.stderr?.on('data',chunk=>{errors+=chunk;});
    const exit=once(child,'exit');
    try {
      const ready=await Promise.race([once(child,'message'),exit.then(()=>{throw Error('Owner child exited: '+errors);})]);
      expect(ready[0]).toBe('ready');expect(()=>claim()).toThrow(expect.objectContaining({code:'BACKGROUND_OWNER_EXISTS'}));
      if(process.platform!=='win32'){
        const signal=once(child,'message');child.kill('SIGTERM');expect((await signal)[0]).toBe('signal');
        expect(()=>claim()).toThrow(expect.objectContaining({code:'BACKGROUND_OWNER_EXISTS'}));
      }
    } finally {child.kill('SIGKILL');await exit;}
    expect(()=>claim()).not.toThrow();
  });
});
