/** Authored lifetimes for desktop instances sharing one original native view attachment. */
export const claudeTerminalInstanceRuntime = String.raw`function createNativeInstanceLifetimes(release){
 const instances=new Map(),keyOf=scope=>JSON.stringify([scope.client_id,scope.component,scope.instance_id]);
 const validate=revision=>{if(!Number.isSafeInteger(revision)||revision<1)throw Error('Invalid native UI instance revision');};
 function replace(scope,revision,active){
  if(!instances.has(keyOf(scope))&&instances.size>=4096)throw Error('Native UI instance lifetime limit reached');
  instances.set(keyOf(scope),{client_id:scope.client_id,component:scope.component,instance_id:scope.instance_id,revision,active});
 }
 return {
  begin(scope,revision){validate(revision);const prior=instances.get(keyOf(scope));if(prior&&(prior.revision>revision||prior.revision===revision&&!prior.active))throw Error('Native UI instance expired');if(prior?.revision===revision)return;replace(scope,revision,true);release(scope);},
  retire(scope,revision){validate(revision);const prior=instances.get(keyOf(scope));if(prior?.revision>revision)return false;if(prior?.revision===revision&&!prior.active)return true;replace(scope,revision,false);release(scope);return true;},
  active(scope,revision){const entry=instances.get(keyOf(scope));return entry?.active===true&&entry.revision===revision;},
  known(scope){return instances.has(keyOf(scope));},
  detach(client){for(const [key,entry] of instances)if(entry.client_id===client){release(entry);instances.delete(key);}},
  clear(){for(const entry of instances.values())release(entry);instances.clear();},
 };
}`
