/** Original CodeBlock export rendering; source and callbacks remain owned by the original drawing. */
export const claudeTerminalDocumentRuntime = String.raw`function nativeDocumentSyntaxFlag(n){
 const binding=typeof originalContext==='undefined'?n.runtime?.ey():originalContext??n.runtime?.ey();
 return binding?.toolContext?.(new AbortController())?.getAppState?.().settings?.syntaxHighlightingDisabled===true;
}
async function nativeDocumentTree(n,tree,options={}){
 let nodes=0,bytes=0;const initialTheme=JSON.stringify(nativeThemeProvider(n).value.resolvedTheme),syntaxFlag=nativeDocumentSyntaxFlag(n);
 const visit=async value=>{
  options.signal?.throwIfAborted();
  if(!value||typeof value!=='object'||Array.isArray(value))return value;
  if(++nodes>1024)throw Error('Native document node limit');
  let result=value;
  if(value.type==='Raster'){
   const {columns,rows,cells}=value.props??{};
   if(!Number.isInteger(columns)||columns<1||columns>512||!Number.isInteger(rows)||rows<1||rows>256||typeof value.raster?.plugin!=='string')throw Error('Invalid native Raster');
   const decoded=n.engine.yCr(cells,columns,rows);if(decoded.problem!==undefined)throw Error(decoded.problem);
   const ansi=n.engine.gAs(decoded.words,{columns,rows},n.engine.j7s());
   if(typeof ansi!=='string')throw Error('Native Raster renderer returned invalid output');
   result=ansi.length<=65536&&bytes+ansi.length<=65536?{type:'NativeRaster',props:{columns,rows,ansi},part:{plugin:value.raster.plugin}}:{type:'Text',props:{dimColor:true},children:['Raster preview exceeds this view. Open the native interface to inspect it.'],part:{plugin:value.raster.plugin}};
   bytes+=Math.min(ansi.length,65536);
  }
  if(value.type==='Code'||value.type==='Markdown'){
   const props={...value.props},markdown=value.type==='Markdown',annotation=markdown?'_apackMarkdownAnsi':'_apackCodeAnsi',source=markdown?props.text:props.source;delete props[annotation];
   if(typeof source==='string'&&source.length<=32768){
    const defaults=n.documentDefaults.$Et(),theme=nativeThemeProvider(n),themeKey=JSON.stringify(theme.value.resolvedTheme),columns=Math.max(20,Math.min(240,options.columns??process.stdout.columns??80));
    // Fresh export state: never mount the live app store, tasks, keybindings or another sandbox.
    const element=n.jsx.e(n.appProvider.d_,{session:n.questionOptions.j(),keybindings:false,initialState:{...defaults,tasks:{},taskDecorations:{},settings:{...defaults.settings,syntaxHighlightingDisabled:syntaxFlag}},children:n.jsx.e(theme.type,{value:theme.value,children:n.jsx.e(n.documentRendering.$d.BodyColumns.Provider,{value:columns,children:n.jsx.e(markdown?n.documentRendering.$d.MarkdownBlock:n.documentRendering.$d.CodeBlock,markdown?{text:props.text}:props)})})});
    const text=await n.staticRender.v6e(element,{columns});
    options.signal?.throwIfAborted();
    if(JSON.stringify(nativeThemeProvider(n).value.resolvedTheme)!==themeKey)throw Error('Native document theme changed while formatting');
    if(typeof text!=='string')throw Error('Native Code renderer returned invalid output');
    if(text.length<=65536&&bytes+text.length<=65536){props[annotation]=text;bytes+=text.length;}
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
 while(pending.length){const node=pending.pop();if(++checked>1024)throw Error('Native document eligibility limit');if(!node||typeof node!=='object')continue;for(const plugin of [node.part?.plugin,node.client?.plugin,node.raster?.plugin,node.image?.plugin])if(typeof plugin==='string'&&n.engine?.FPe(plugin)===false)throw Error('Native document eligibility changed while formatting');if(Array.isArray(node.children))pending.push(...node.children);}
 options.signal?.throwIfAborted();
 if(nativeDocumentSyntaxFlag(n)!==syntaxFlag)throw Error('Native document settings changed while formatting');
 if(JSON.stringify(nativeThemeProvider(n).value.resolvedTheme)!==initialTheme)throw Error('Native document theme changed while formatting');
 return result;
}`
