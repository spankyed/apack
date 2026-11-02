import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, readdirSync, writeFileSync, existsSync, symlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
const root=process.cwd(),output=resolve(process.argv[2]);
const [pack]=JSON.parse(execFileSync('npm',['pack','./packages/apack-ears/publish','--json','--pack-destination',output],{encoding:'utf8'}));
assert(pack.files.some(f=>f.path.endsWith('/manifest.json')&&f.path.includes('/native/')));
assert(!pack.files.some(f=>f.path.endsWith('/upstream.c')||f.path.includes('.temp')));
const extracted=join(root,'.temp','native-package-extracted-v2');mkdirSync(extracted,{recursive:true});
execFileSync('tar',['-xzf',join(output,pack.filename),'-C',extracted]);
const packageRoot=join(extracted,'package');
// A real install honors package-private runtime versions. This offline probe reuses only this
// session's private lock-matching dependency trees, never the repo root's incompatible overrides.
const require=createRequire(join(root,'packages/apack-ears/package.json'));
const dependencies={},published=JSON.parse(readFileSync(join(packageRoot,'package.json'),'utf8'));
for(const name of Object.keys(published.dependencies)){
  let directory=dirname(require.resolve(name)),owner;
  for(;;){
    const file=join(directory,'package.json');
    if(existsSync(file)){const candidate=JSON.parse(readFileSync(file,'utf8'));if(candidate.name===name){owner=candidate;break;}}
    const parent=dirname(directory);assert.notEqual(parent,directory,'Runtime dependency package not found: '+name);directory=parent;
  }
  const target=join(packageRoot,'node_modules',name);mkdirSync(dirname(target),{recursive:true});symlinkSync(directory,target,'dir');
  dependencies[name]={declared:published.dependencies[name],version:owner.version,source:directory};
}
assert.equal(dependencies.ajv.version,'8.20.0');
const {openDatabase}=await import(pathToFileURL(join(packageRoot,'dist/sqlite/index.js')).href);
const {createEarsEngine}=await import(pathToFileURL(join(packageRoot,'dist/index.js')).href);
const directory=join(packageRoot,'dist/sqlite/native',`${process.platform}-${process.arch}`);
const manifest=JSON.parse(readFileSync(join(directory,'manifest.json'),'utf8'));
const db=openDatabase({path:join(extracted,'profile'),schema:{types:{Row:{required:[]}},relations:{},roles:[]}});
try{
  const e=createEarsEngine({database:db});e.create('Row',{id:'Row-packaged',title:'native distribution'});
  assert.deepEqual(e.query('Row').ids(),['Row-packaged']);
  const info=db.get('SELECT vec1_info() info').info;assert.equal(typeof info,'string');
  assert(db.nativeVectorExtension.startsWith(directory));
  const report={completed:true,node:process.version,platform:process.platform,arch:process.arch,
    npmPack:pack,dependencies,tarballSha256:createHash('sha256').update(readFileSync(join(output,pack.filename))).digest('hex'),
    nativeFiles:readdirSync(directory).sort(),manifest,nativeInfo:info,defaultPackagedPath:db.nativeVectorExtension,
    behavior:'unpacked ordinary npm artifact opens and uses native vec1 and the EARS facade without explicit extension override'};
  writeFileSync(join(output,'npm-native-probe.json'),JSON.stringify(report,null,2)+'\n');
}finally{db.close();}
