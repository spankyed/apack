import { claudeNativeLinuxBindings } from './native-platform-bindings.ts'

const macBinary = '5262ce9de86243fed0d21edc39b271555d56780d0112e2b194439fe1c6662d37'

/** Runs inside the original CLI; platform admission is by exact executable bytes, never env flags. */
export const claudeNativePlatformRuntime = `const nativeLinuxBindings=${JSON.stringify(claudeNativeLinuxBindings)};\n` + String.raw`
let nativePlatformChecked=false,nativeRuntimePlatform;
const nativeModulePromises=new Map();
function readClaudeNativePlatform(){
 if(!nativePlatformChecked){
  const binary=createHash('sha256').update(readFileSync(process.execPath)).digest('hex');
  if(process.platform==='darwin'&&binary==='5262ce9de86243fed0d21edc39b271555d56780d0112e2b194439fe1c6662d37')nativeRuntimePlatform={platform:'darwin',binarySha256:binary};
  else if(process.platform===nativeLinuxBindings.platform&&binary===nativeLinuxBindings.binarySha256)nativeRuntimePlatform=nativeLinuxBindings;
  nativePlatformChecked=true;
 }
 return nativeRuntimePlatform;
}
function requireClaudeNativePlatform(){
 const value=readClaudeNativePlatform();
 if(!value)throw Error('Native UI transport requires an exact reviewed Claude Code 2.1.302 platform binary');
 return value;
}
function hasClaudeNativePlatform(){return readClaudeNativePlatform()!==undefined;}
function nativeFunctionName(name){
 const value=readClaudeNativePlatform();if(value?.platform!=='linux')return name;
 if(!Object.hasOwn(value.functionNames,name))throw Error('Unreviewed native producer name: '+name);
 return value.functionNames[name];
}
function nativeFunctionHash(hash){
 const value=readClaudeNativePlatform();if(value?.platform!=='linux')return hash;
 if(!Object.hasOwn(value.functionHashes,hash))throw Error('Unreviewed native producer fingerprint');
 return value.functionHashes[hash];
}
async function importClaudeNativeModule(name,load=path=>import(path)){
 const platform=requireClaudeNativePlatform();
 if(platform.platform==='darwin')return load('/$bunfs/root/'+name);
 if(!Object.hasOwn(platform.modules,name))throw Error('Unreviewed native module: '+name);
 let pending=nativeModulePromises.get(name);
 if(!pending){
  const spec=platform.modules[name];
  pending=Promise.resolve(load('/$bunfs/root/'+spec.module)).then(namespace=>new Proxy(Object.create(null),{
   get(_target,key){
    if(key===Symbol.toStringTag)return 'Module';
    if(key==='then'||typeof key!=='string')return undefined;
    if(!Object.hasOwn(spec.exports,key))throw Error('Unreviewed native export: '+name+':'+key);
    const exported=spec.exports[key];
    if(!Object.hasOwn(namespace,exported))throw Error('Original native export is absent: '+name+':'+key);
    return namespace[exported];
   },
   ownKeys(){return Object.keys(spec.exports);},
   getOwnPropertyDescriptor(_target,key){return typeof key==='string'&&Object.hasOwn(spec.exports,key)?{configurable:true,enumerable:true,get:()=>namespace[spec.exports[key]]}:undefined;},
   set(){return false;},defineProperty(){return false;},deleteProperty(){return false;},preventExtensions(){return false;},
  }));
  nativeModulePromises.set(name,pending);
 }
 return pending;
}
`

function escapePattern(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Rewrites only our authored adapter selectors; no recovered code is transformed or evaluated. */
export function withClaudeNativePlatformRuntime(source: string, kind: 'terminal' | 'print'): string {
  const originalGuard = `createHash('sha256').update(readFileSync(process.execPath)).digest('hex')`
  const guard = kind === 'terminal'
    ? `if(${originalGuard}!=='${macBinary}')throw Error('Native UI transport requires the reviewed Claude Code 2.1.302 binary');`
    : `if(${originalGuard}==='${macBinary}'){`
  if (!source.includes(guard)) throw new Error('Native platform admission anchor changed')
  let result = source.replace(guard, kind === 'terminal' ? 'requireClaudeNativePlatform();' : 'if(hasClaudeNativePlatform()){')
  return claudeNativePlatformRuntime + rewriteClaudeNativePlatformSelectors(result)
}

/** Shared by authored probe preloads so observations use the same native identities as the app. */
export function rewriteClaudeNativePlatformSelectors(source: string): string {
  let result = source
  result = result.replace(/await import\('\/\$bunfs\/root\/(chunk-[a-z0-9]+\.js)'\)/g, "await importClaudeNativeModule('$1')")
  for (const hash of Object.keys(claudeNativeLinuxBindings.functionHashes)) {
    result = result.replace(new RegExp(`(['\"])${hash}\\1`, 'g'), `nativeFunctionHash('${hash}')`)
  }
  for (const name of Object.keys(claudeNativeLinuxBindings.functionNames)) {
    const escaped = escapePattern(name)
    result = result.replace(new RegExp(`\\.name===['"]${escaped}['"]`, 'g'), `.name===nativeFunctionName('${name}')`)
    result = result.replace(new RegExp(`\\bname:['"]${escaped}['"]`, 'g'), `name:nativeFunctionName('${name}')`)
    result = result.replace(new RegExp(`(?:\\b${escaped}|['\"]${escaped}['\"]):(?=\\{|nativeFunctionHash\\()`, 'g'), `[nativeFunctionName('${name}')]:`)
  }
  return result
}
