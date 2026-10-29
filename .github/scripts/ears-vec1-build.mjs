// Disposable platform qualification only; this does not install a production native dependency.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

const upstream={commit:'814fd8ef4d42d6567f1613a66f556c8194764d06',
  sha256:'b341c15fe10e41a9b96981ff3a9c217ea0774b4e04932b5acf3dac1320aeceb1'};
const url=`https://raw.githubusercontent.com/sqlite/sqlite/${upstream.commit}/ext/vec1/vec1.c`;
const root=resolve(process.argv[2]??'.temp/sqlite-platform/native-generation');
assert(!existsSync(root),'Native qualification output must be new');mkdirSync(root,{recursive:true,mode:0o700});
const response=process.argv[3]?null:await fetch(url);
if(response)assert(response.ok,`Pinned source download refused: ${response.status}`);
const bytes=process.argv[3]?readFileSync(process.argv[3]):Buffer.from(await response.arrayBuffer());
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
assert.equal(sha(bytes),upstream.sha256,'Pinned native source hash must match before execution');
const file=join(root,'vec1.c');writeFileSync(file,bytes,{flag:'wx'});
const require=createRequire(import.meta.url),manifest=require.resolve('better-sqlite3/package.json');
const headers=join(dirname(manifest),'deps/sqlite3');assert(existsSync(join(headers,'sqlite3ext.h')));
const extension=join(root,process.platform==='win32'?'vec1.dll':process.platform==='darwin'?'vec1.dylib':'vec1.so');
const compiler=process.platform==='win32'?'cl.exe':process.platform==='darwin'?'clang':'cc';
const args=process.platform==='win32'?['/nologo','/O2','/DNDEBUG','/LD','/I'+headers,file,'/link','/OUT:'+extension]:
  ['-O3','-DNDEBUG','-Werror=implicit-function-declaration',process.platform==='darwin'?'-dynamiclib':'-shared','-fPIC','-I'+headers,file,'-lm','-o',extension];
execFileSync(compiler,args,{cwd:root,stdio:'inherit'});
const source=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
writeFileSync(join(root,'provenance.json'),JSON.stringify({source,upstream:{...upstream,url},compiler,args,
  headersPackage:JSON.parse(readFileSync(manifest,'utf8')).version,extension,extensionSha256:sha(readFileSync(extension)),
  node:process.version,platform:process.platform,arch:process.arch,patchApplied:false,
  qualification:'Original upstream extension for Node lifecycle tests; not normal packaging, signing or ANN performance acceptance'},null,2)+'\n');
if(process.env.GITHUB_ENV)appendFileSync(process.env.GITHUB_ENV,'EARS_VEC1_EXTENSION='+extension+'\n');
console.log('Qualified extension build:',extension);
