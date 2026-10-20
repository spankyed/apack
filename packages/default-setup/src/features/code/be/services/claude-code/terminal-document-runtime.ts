import { encodeClaudeDocument } from '../../../common/native-document-codec.ts'
/** Original CodeBlock export rendering; source and callbacks remain owned by the original drawing. */
export const claudeTerminalDocumentRuntime = String.raw`const encodeNativeDocument = ${encodeClaudeDocument.toString()};
function nativeDocumentSyntaxFlag(n){
 const binding=typeof originalContext==='undefined'?n.runtime?.ey():originalContext??n.runtime?.ey();
 return binding?.toolContext?.(new AbortController())?.getAppState?.().settings?.syntaxHighlightingDisabled===true;
}
function nativeImagePresentation(n,node,scope){
 if(!scope)throw Error('Native Image needs its original terminal placement');
 const props=node.props,plugin=node.image?.plugin;if(!props||typeof plugin!=='string'||typeof props.alt!=='string')throw Error('Invalid native Image');
 const root=n.themeRoots.ai().get(process.stdout),pending=[root?.container?.current],seen=new Set(),matches=[];
 while(pending.length){
  const fiber=pending.pop();if(!fiber||seen.has(fiber))continue;if(seen.size>=8192)throw Error('Native Image traversal exceeded bound');seen.add(fiber);
  if(fiber.sibling)pending.push(fiber.sibling);if(fiber.child)pending.push(fiber.child);
  if(typeof fiber.type==='function'&&fiber.type.name==='Fo'){
   const held=fiber.memoizedProps;
   if(held?.plugin===plugin&&held.elementKey===props.key&&held.columns===props.columns&&held.rows===props.rows&&held.alt===props.alt&&JSON.stringify(held.source)===JSON.stringify(props.source)){
    let parent=fiber.return,inside=false,depth=0;
    while(parent&&++depth<=128){const value=parent.memoizedProps?.value;if(value?.component===scope.component&&value.requestId===scope.requestId){inside=true;break;}parent=parent.return;}
    if(inside){
     let hash=composerFunctionHashes.get(fiber.type);if(!hash){hash=createHash('sha256').update(Function.prototype.toString.call(fiber.type)).digest('hex');composerFunctionHashes.set(fiber.type,hash);}
     if(hash!=='90ffae0a8b68a15a4c68fa3ca5513e524c112e97e31aac7c1abc7bf8a217f6cf')throw Error('Original Image renderer changed');
     if(fiber.child?.memoizedProps?.dimColor===true&&fiber.child.memoizedProps.children===props.alt){matches.push({type:'Text',props:{dimColor:true},children:[props.alt],part:{plugin}});continue;}
     const box=fiber.child?.memoizedProps;
     if(box?.width!==props.columns||box?.height!==props.rows||box?.overflow!=='hidden'||box?.children?.type!=='ink-raw-ansi')throw Error('Original Image pixel placement changed');
     let hook=fiber.memoizedState,allocation,admitted,steps=0;
     while(hook&&++steps<=128){const state=hook.memoizedState;if(state?.images===root.terminalImages&&Number.isInteger(state.id))allocation=state;const ref=state?.current;if(ref&&Object.hasOwn(ref,'reactKey')&&Object.hasOwn(ref,'source')&&ref.box===props.columns+'x'+props.rows)admitted=ref;hook=hook.next;}
     if(!allocation||!root.terminalImages?.live?.get(allocation.id)?.isSent||!admitted?.source)throw Error('Native Image has no admitted byte source');
     const source=admitted.source,format=typeof source.png==='string'?'png':typeof source.rgba==='string'?'rgba':undefined,data=format&&source[format];
     if(!format)throw Error('Native Image pixel delivery requires an admitted byte source');
     if(data.length>65536){matches.push({type:'Text',props:{dimColor:true},children:['Image preview exceeds this view. Open the native interface to inspect it.'],part:{plugin}});continue;}
     if(!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)||!data.length)throw Error('Invalid native Image bytes');
     const dimensions=format==='rgba'?{width:source.width,height:source.height}:{};
     if(format==='rgba'&&(!Number.isSafeInteger(source.width)||source.width<1||!Number.isSafeInteger(source.height)||source.height<1||source.width*source.height*4!==Buffer.from(data,'base64').length))throw Error('Invalid native Image dimensions');
     matches.push({type:'NativeImage',props:{columns:props.columns,rows:props.rows,alt:props.alt,format,data,...dimensions},part:{plugin}});
    }
   }
  }
 }
 if(!matches.length)throw Error('Original Image is not mounted in this terminal placement');
 if(matches.length!==1)throw Error('Original Image mount is ambiguous');
 return matches[0];
}
function nativeImageFingerprint(n,tree,scope){
 const pending=[tree],images=[];let count=0;
 while(pending.length){if(++count>2048)throw Error('Native Image drawing limit');const node=pending.pop();if(!node||typeof node!=='object')continue;
  if(node.type==='Image'){try{images.push(nativeImagePresentation(n,node,scope));}catch(error){images.push({unavailable:error.message});}}
  if(Array.isArray(node.children))pending.push(...node.children);
 }
 return images.length?createHash('sha256').update(JSON.stringify(images)).digest('hex'):undefined;
}
async function nativeDocumentTree(n,tree,options={}){
 let nodes=0,bytes=0,documentBudget=Math.max(0,262144-Buffer.byteLength(JSON.stringify(tree),'utf8'));const initialTheme=JSON.stringify(nativeThemeProvider(n).value.resolvedTheme),syntaxFlag=nativeDocumentSyntaxFlag(n);
 const visit=async value=>{
  options.signal?.throwIfAborted();
  if(!value||typeof value!=='object'||Array.isArray(value))return value;
  if(++nodes>1024)throw Error('Native document node limit');
  let result=value;
  if(value.type==='Image')result=nativeImagePresentation(n,value,options.terminalScope);
  if(value.type==='Raster'){
   const {columns,rows,cells}=value.props??{};
   if(!Number.isInteger(columns)||columns<1||columns>512||!Number.isInteger(rows)||rows<1||rows>256||typeof value.raster?.plugin!=='string')throw Error('Invalid native Raster');
   const decoded=n.engine.yCr(cells,columns,rows);if(decoded.problem!==undefined)throw Error(decoded.problem);
   const ansi=n.engine.gAs(decoded.words,{columns,rows},n.engine.j7s());
   if(typeof ansi!=='string')throw Error('Native Raster renderer returned invalid output');
   result=ansi.length<=65536&&bytes+ansi.length<=65536?{type:'NativeRaster',props:{columns,rows,ansi},part:{plugin:value.raster.plugin}}:{type:'Text',props:{dimColor:true},children:['Raster preview exceeds this view. Open the native interface to inspect it.'],part:{plugin:value.raster.plugin}};
   bytes+=Math.min(ansi.length,65536);
  }
  if(value.type==='Image'||value.type==='Raster'){
   let cost=Buffer.byteLength(JSON.stringify(result),'utf8')-Buffer.byteLength(JSON.stringify(value),'utf8');
   if(cost>documentBudget){result={type:'Text',props:{dimColor:true},children:[value.type+' preview exceeds this drawing. Open the native interface to inspect it.'],...(value.image?.plugin||value.raster?.plugin?{part:{plugin:value.image?.plugin??value.raster?.plugin}}:{})};cost=Buffer.byteLength(JSON.stringify(result),'utf8')-Buffer.byteLength(JSON.stringify(value),'utf8');}
   documentBudget=Math.max(0,documentBudget-cost);
  }
  if(value.type==='Code'||value.type==='Markdown'){
   const props={...value.props},markdown=value.type==='Markdown',annotation=markdown?'_apackMarkdownAnsi':'_apackCodeAnsi',source=markdown?props.text:props.source;delete props[annotation];delete props._apackDocumentPacked;delete props._apackDocumentFallback;
   if(typeof source==='string'&&source.length<=131072){
    const defaults=n.documentDefaults.$Et(),theme=nativeThemeProvider(n),themeKey=JSON.stringify(theme.value.resolvedTheme),columns=Math.max(20,Math.min(240,options.columns??process.stdout.columns??80));
    // Fresh export state: never mount the live app store, tasks, keybindings or another sandbox.
    const element=n.jsx.e(n.appProvider.d_,{session:n.questionOptions.j(),keybindings:false,initialState:{...defaults,tasks:{},taskDecorations:{},settings:{...defaults.settings,syntaxHighlightingDisabled:syntaxFlag}},children:n.jsx.e(theme.type,{value:theme.value,children:n.jsx.e(n.documentRendering.$d.BodyColumns.Provider,{value:columns,children:n.jsx.e(markdown?n.documentRendering.$d.MarkdownBlock:n.documentRendering.$d.CodeBlock,markdown?{text:props.text}:props)})})});
    const text=await n.staticRender.v6e(element,{columns});
    options.signal?.throwIfAborted();
    if(JSON.stringify(nativeThemeProvider(n).value.resolvedTheme)!==themeKey)throw Error('Native document theme changed while formatting');
    if(typeof text!=='string')throw Error('Native Code renderer returned invalid output');
    let addition;
    if(text.length<=65536)addition={[annotation]:text};
    else if(text.length<=1048576){try{addition={_apackDocumentPacked:encodeNativeDocument(text)};}catch{}}
    const cost=addition?Buffer.byteLength(JSON.stringify(addition),'utf8')+1:Infinity;
    if(cost<=documentBudget){Object.assign(props,addition);documentBudget-=cost;}else props._apackDocumentFallback='drawing-budget';
   }else props._apackDocumentFallback='source-limit';
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
