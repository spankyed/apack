/** Authored paint mapping shared by native terminal and print adapters; native owns the palette. */
export const claudeNativeThemeRuntime = String.raw`function nativeThemePaint(palette,value){
 if(!value||typeof value!=='object'||Array.isArray(value))return value;
 const result={...value};
 for(const key of ['color','backgroundColor','borderColor'])if(typeof result[key]==='string'&&Object.hasOwn(palette,result[key]))result[key]=palette[result[key]];
 return result;
}
function nativePaletteDecorations(palette,decorations){
 if(!decorations?.length)return decorations;
 return decorations.map(run=>{
  const result=nativeThemePaint(palette,run);delete result._apackThemeColor;delete result._apackThemeBackgroundColor;
  for(const [key,role]of [['color','_apackThemeColor'],['backgroundColor','_apackThemeBackgroundColor']])if(typeof run[key]==='string'&&Object.hasOwn(palette,run[key]))result[role]=run[key];
  return result;
 });
}
function nativePaletteTree(palette,tree){
 const paint=value=>nativeThemePaint(palette,value);
 const visit=(value,inheritedColor,inheritedBackground,parentType,insideButton=false)=>{
  if(typeof value==='string')return parentType==='Box'?{type:'Text',props:{color:inheritedColor??palette.text},children:[value]}:value;
  if(!value||typeof value!=='object'||Array.isArray(value))return value;
  const field=value.type==='Input'||value.type==='Select',document=['Link','Markdown','Code'].includes(value.type);
  const themed=['Text','Box','Button'].includes(value.type),props=themed?paint(value.props??{}):field?{...value.props,_apackFieldTheme:{text:palette.text,inverseText:palette.inverseText}}:value.props;
  if(document){const props={...value.props};delete props._apackDocumentTheme;if(value.type!=='Link'||inheritedColor===undefined&&!insideButton)props._apackDocumentTheme={text:inheritedColor??palette.text};value={...value,props};}
  let color=inheritedColor,background=inheritedBackground;
  if(value.type==='Button'){props.color=props.plain!==true&&props.variant==='primary'?palette.suggestion:palette.text;props.hotkeyColor=props.plain===true?palette.suggestion:props.color;color=props.color;}
  if(value.type==='Text'){
   if(!insideButton)props.color??=inheritedColor??palette.text;color=props.color??inheritedColor;
   if(props.inverse===true)props.backgroundColor??=inheritedBackground??palette.inverseText;
  }
  if(themed&&props?.backgroundColor!==undefined)background=props.backgroundColor;
  return {...value,...(themed||field?{props}:{}),...(themed&&value.hover?{hover:paint(value.hover)}:{}),...(Array.isArray(value.children)?{children:value.children.map(child=>visit(child,color,background,value.type,insideButton||value.type==='Button'))}:{})};
 };
 return visit(tree);
}
`
