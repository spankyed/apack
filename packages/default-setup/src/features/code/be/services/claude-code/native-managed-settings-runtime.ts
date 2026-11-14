/** The original settings store owns diagnostic discovery and policy effects. */
export const claudeManagedSettingsDiagnosticRuntime=String.raw`async function readNativeManagedSettingsDiagnostics(current){
 if(!current())throw Error('Native settings diagnostic view is detached');
 const settings=await import('/$bunfs/root/chunk-1pjd7qsk.js');
 if(!current())throw Error('Native settings diagnostic view changed');
 const source=settings.D_();
 if(!Array.isArray(source)||source.length>256)throw Error('Native settings diagnostics exceed desktop limit');
 const diagnostics=source.map(({file,path,message,severity,errorClass,errno,statusOnly,userWritable})=>({file,path,message,severity,errorClass,errno,statusOnly,userWritable}));
 if(JSON.stringify(diagnostics).length>131072)throw Error('Native settings diagnostic output exceeds desktop limit');
 return diagnostics;
}`
