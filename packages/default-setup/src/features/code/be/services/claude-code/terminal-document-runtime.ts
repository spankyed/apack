/** Original CodeBlock export rendering; source and callbacks remain owned by the original drawing. */
export const claudeTerminalDocumentRuntime = String.raw`function nativeDocumentSyntaxFlag(n){
 const binding=typeof originalContext==='undefined'?n.runtime?.ey():originalContext??n.runtime?.ey();
 return binding?.toolContext?.(new AbortController())?.getAppState?.().syntaxHighlightingDisabled===true;
}
async function nativeDocumentTree(n,tree,options={}){
 let nodes=0,bytes=0;const initialTheme=JSON.stringify(nativeThemeProvider(n).value.resolvedTheme),syntaxFlag=nativeDocumentSyntaxFlag(n);
 const visit=async value=>{
  options.signal?.throwIfAborted();
  if(!value||typeof value!=='object'||Array.isArray(value))return value;
  if(++nodes>1024)throw Error('Native document node limit');
  let result=value;
  if(value.type==='Code'){
   const props={...value.props};delete props._apackCodeAnsi;
   if(typeof props.source==='string'&&props.source.length<=32768){
    const theme=nativeThemeProvider(n),themeKey=JSON.stringify(theme.value.resolvedTheme),columns=Math.max(20,Math.min(240,options.columns??process.stdout.columns??80));
    // Fresh export state: never mount the live app store, tasks, keybindings or another sandbox.
    const element=n.jsx.e(n.appProvider.d_,{session:n.questionOptions.j(),keybindings:false,initialState:{...n.documentDefaults.$Et(),tasks:{},taskDecorations:{},syntaxHighlightingDisabled:syntaxFlag},children:n.jsx.e(theme.type,{value:theme.value,children:n.jsx.e(n.documentRendering.$d.BodyColumns.Provider,{value:columns,children:n.jsx.e(n.documentRendering.$d.CodeBlock,props)})})});
    const text=await n.staticRender.v6e(element,{columns});
    options.signal?.throwIfAborted();
    if(JSON.stringify(nativeThemeProvider(n).value.resolvedTheme)!==themeKey)throw Error('Native document theme changed while formatting');
    if(typeof text!=='string')throw Error('Native Code renderer returned invalid output');
    if(text.length<=65536&&bytes+text.length<=65536){props._apackCodeAnsi=text;bytes+=text.length;}
   }
   result={...value,props};
  }
  if(Array.isArray(value.children)){
   const children=[];for(const child of value.children)children.push(await visit(child));
   result={...result,children};
  }
  return result;
 };
 const result=await visit(tree);
 const pending=[result];let checked=0;
 while(pending.length){const node=pending.pop();if(++checked>1024)throw Error('Native document eligibility limit');if(!node||typeof node!=='object')continue;for(const plugin of [node.part?.plugin,node.client?.plugin])if(typeof plugin==='string'&&n.engine?.FPe(plugin)===false)throw Error('Native document eligibility changed while formatting');if(Array.isArray(node.children))pending.push(...node.children);}
 options.signal?.throwIfAborted();
 if(nativeDocumentSyntaxFlag(n)!==syntaxFlag)throw Error('Native document settings changed while formatting');
 if(JSON.stringify(nativeThemeProvider(n).value.resolvedTheme)!==initialTheme)throw Error('Native document theme changed while formatting');
 return result;
}`
