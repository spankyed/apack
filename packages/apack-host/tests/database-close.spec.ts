import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEarsEngine, type EarsDatabase } from '@apackdev/ears';
import { openDatabase } from '@apackdev/ears/sqlite';
import { closeDatabases } from '../src/database/close.ts';

const held:Array<{database:EarsDatabase;path:string}>=[];
afterEach(()=>{vi.restoreAllMocks();for(const {database,path} of held.splice(0)){database.close();rmSync(path,{recursive:true,force:true});}});
function fixture(){
  const path=mkdtempSync(join(tmpdir(),'apack-close-databases-'));
  const database=openDatabase({path,syncs:false,schema:{types:{Row:{required:[]}},relations:{},roles:[]}});
  held.push({database,path});return {database,e:createEarsEngine({database})};
}

describe('database shutdown ownership',()=>{
  it('holds writes while draining, keeps reads available and closes each handle only after its drain',async()=>{
    const {database,e}=fixture();e.create('Row',{title:'retained'});
    let release!:()=>void,started!:()=>void;
    const gate=new Promise<void>(resolve=>{release=resolve;}),entered=new Promise<void>(resolve=>{started=resolve;});
    database.drainBackground=vi.fn(async()=>{started();await gate;});const close=vi.spyOn(database,'close');
    const stopping=closeDatabases([database,undefined,database]);await entered;
    try {
      expect(close).not.toHaveBeenCalled();expect(e.query('Row').count()).toBe(1);
      expect(()=>e.create('Row',{title:'blocked'})).toThrow(expect.objectContaining({code:'WRITE_PAUSED'}));
    } finally {release();await stopping;}
    expect(close).toHaveBeenCalledTimes(1);expect(database.drainBackground).toHaveBeenCalledTimes(1);
    expect(database.isOpen).toBe(false);
  });

  it('drains the other store when one refuses, retaining the failed handle and original error',async()=>{
    const first=fixture(),second=fixture(),failure=new Error('worker did not exit');
    first.database.drainBackground=vi.fn(async()=>{throw failure;});const close=vi.spyOn(first.database,'close');
    await expect(closeDatabases([first.database,second.database])).rejects.toMatchObject({errors:[failure]});
    expect(close).not.toHaveBeenCalled();expect(first.database.isOpen).toBe(true);expect(second.database.isOpen).toBe(false);
  });

  it('refuses an open unit without skipping shutdown of the other store',async()=>{
    const first=fixture(),second=fixture(),unit=first.database.begin();
    try {
      await expect(closeDatabases([first.database,second.database])).rejects.toMatchObject({errors:[expect.objectContaining({code:'UNIT_OPEN'})]});
      expect(first.database.isOpen).toBe(true);expect(second.database.isOpen).toBe(false);
    } finally {unit.abort();}
  });

  it('closes backends without a background hook and ignores absent or already closed handles',async()=>{
    const {database}=fixture();database.drainBackground=undefined;
    await closeDatabases([undefined,database]);expect(database.isOpen).toBe(false);
    await expect(closeDatabases([database,undefined])).resolves.toBeUndefined();
  });
});
