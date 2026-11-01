import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { openDatabase } from '../../src/sqlite/index.ts';
import { SqliteDatabase } from '../../src/sqlite/database.ts';
import { resolveNativeVectorExtension } from '../../src/sqlite/native-extension.ts';
let root:string,directory:string;
const binary=()=>process.platform==='win32'?'vec1.dll':process.platform==='darwin'?'vec1.dylib':'vec1.so';
const sha=(file:string)=>createHash('sha256').update(readFileSync(file)).digest('hex');
beforeEach(()=>{root=mkdtempSync(join(tmpdir(),'ears-packaged-native-'));directory=join(root,'native');cpSync(dirname(resolveNativeVectorExtension()),directory,{recursive:true});});
afterEach(()=>rmSync(root,{recursive:true,force:true}));

describe.runIf(process.env.EARS_EVALUATION_BACKEND==='sqlite')('package-owned native vector artifacts',()=>{
  it('loads ordinary and read-only opens from the package, ignoring executable paths stored as data',()=>{
    const path=join(root,'store'),db=openDatabase({path,syncs:false});
    try {
      expect(db).toBeInstanceOf(SqliteDatabase);if(!(db instanceof SqliteDatabase))throw Error('Expected SQLite');
      expect(db.nativeVectorExtension).toBe(resolveNativeVectorExtension());
      expect(db.get('SELECT vec1_info() info')!.info).toBeTypeOf('string');
      db.run('INSERT INTO meta(key,value) VALUES (?,?)',['nativeVectorExtension',db.pack(join(root,'not-executable.so'))]);
    }finally{db.close();}
    const reader=openDatabase({path,readOnly:true});
    try {if(!(reader instanceof SqliteDatabase))throw Error('Expected SQLite');expect(reader.nativeVectorExtension).toBe(resolveNativeVectorExtension());}
    finally{reader.close();}
  });
  it('refuses missing manifests and missing libraries instead of compiling or silently falling back',()=>{
    expect(()=>resolveNativeVectorExtension(join(root,'missing'))).toThrow(expect.objectContaining({code:'NATIVE_MISSING'}));
    rmSync(join(directory,binary()));
    expect(()=>resolveNativeVectorExtension(directory)).toThrow(expect.objectContaining({code:'NATIVE_MISSING'}));
  });
  it('refuses malformed, wrong-target, stale-source and incompatible-header provenance',()=>{
    const file=join(directory,'manifest.json'),manifest=JSON.parse(readFileSync(file,'utf8'));
    for(const change of [{platform:'other'},{arch:'other'},{sourceSha256:'0'.repeat(64)},{patchSha256:'0'.repeat(64)},
      {upstream:'other'},{headersPackage:'other'},{format:2},{extensionSha256:'invalid'}]) {
      writeFileSync(file,JSON.stringify({...manifest,...change}));
      expect(()=>resolveNativeVectorExtension(directory)).toThrow(expect.objectContaining({code:'NATIVE_CHANGED'}));
    }
    writeFileSync(file,'not json');expect(()=>resolveNativeVectorExtension(directory)).toThrow(expect.objectContaining({code:'NATIVE_CHANGED'}));
    expect(()=>resolveNativeVectorExtension('relative')).toThrow(expect.objectContaining({code:'VALUE_INVALID'}));
  });
  it('verifies library bytes and never uses a filename supplied by provenance',()=>{
    const file=join(directory,'manifest.json'),manifest=JSON.parse(readFileSync(file,'utf8'));
    writeFileSync(file,JSON.stringify({...manifest,extension:join(root,'other.so')}));
    expect(resolveNativeVectorExtension(directory)).toBe(join(directory,binary()));
    writeFileSync(join(directory,binary()),'modified binary');
    expect(()=>resolveNativeVectorExtension(directory)).toThrow(expect.objectContaining({code:'NATIVE_CHANGED'}));
  });
  it('stages identical native bytes, minimal provenance and the upstream license for publication',()=>{
    const staged=fileURLToPath(new URL(`../../publish/dist/sqlite/native/${process.platform}-${process.arch}/`,import.meta.url));
    expect(sha(resolveNativeVectorExtension(staged))).toBe(sha(resolveNativeVectorExtension()));
    expect(readdirSync(staged).sort()).toEqual(['LICENSE','manifest.json',binary()].sort());
    expect(readFileSync(join(staged,'LICENSE'),'utf8')).toContain('author disclaims copyright');
    expect(readFileSync(join(staged,'manifest.json'),'utf8')).not.toContain('.temp');
  });
});
