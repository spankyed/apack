<template>
  <div ref="region" :data-native-client="node.id" :data-native-plugin="node.plugin" tabindex="0" class="native-client relative min-w-0 overflow-hidden font-mono outline-none focus-within:ring-1 focus-within:ring-blue-400" :style="style" @focus.self="focusKeyboard" @click.capture="capturedClick" @click="focusClient" @keydown="key" @pointerdown="pointer" @pointermove="pointer" @pointerup="pointer" @pointerenter="pointer" @pointerleave="pointer" @pointercancel="cancel">
    <slot />
    <textarea v-if="node.keys" ref="textInput" data-native-client-text-input aria-label="Client text input" tabindex="-1" rows="1" maxlength="16384" autocomplete="off" autocapitalize="off" :spellcheck="false" class="pointer-events-none absolute left-0 top-0 h-px w-px resize-none overflow-hidden border-0 bg-transparent p-0 opacity-0" @compositionstart="compositionStart" @compositionend="compositionEnd" @input="textChanged" />
    <span ref="measure" aria-hidden="true" class="pointer-events-none invisible absolute whitespace-pre" style="width:100ch;height:1lh">0</span>
  </div>
</template>
<script setup lang="ts">
import {computed,inject,ref,onMounted,onBeforeUnmount,watch,nextTick,type CSSProperties} from 'vue'
import {claudeClientInput,claudeClientReturnFocus} from './native-client-input.ts'
import type {ClaudeUiNode} from '#features/code/be/services/claude-code/ui-presentation.ts'
import type {ClaudeUiClientInput} from '#features/code/be/services/claude-code/ui-controls.ts'
const props=defineProps<{node:Extract<ClaudeUiNode,{kind:'client'}>}>()
const returnFocus=inject(claudeClientReturnFocus,undefined)
const send=inject(claudeClientInput,undefined),region=ref<HTMLElement|null>(null),textInput=ref<HTMLTextAreaElement|null>(null),measure=ref<HTMLElement|null>(null)
const dimension=(value:number|string|undefined,unit:string)=>typeof value==='number'?`${value}${unit}`:value
const style=computed<CSSProperties>(()=>({width:dimension(props.node.layout?.width,'ch')??'fit-content',height:dimension(props.node.layout?.height,'lh'),flexGrow:props.node.layout?.flexGrow,maxWidth:'100%'}))
let live=true,composing=false,compositionClient:string|undefined,completedComposition:string|undefined
function focusKeyboard(){if(props.node.keys)textInput.value?.focus({preventScroll:true})}
function cancelComposition(){composing=false;compositionClient=undefined;completedComposition=undefined;if(textInput.value)textInput.value.value=''}
function commitText(text:string){if(!live||!props.node.keys)return;for(const character of text)send?.(props.node.id,{kind:'key',key:character===' '?'space':character==='\n'?'return':character==='\t'?'tab':character})}
function compositionStart(){composing=true;compositionClient=props.node.id;completedComposition=undefined}
function compositionEnd(event:CompositionEvent){
 const text=event.data,current=compositionClient===props.node.id
 composing=false;compositionClient=undefined;completedComposition=text
 if(textInput.value)textInput.value.value=''
 if(current)commitText(text)
}
function textChanged(event:Event){
 const input=event as InputEvent;if(composing||input.isComposing)return
 const text=textInput.value?.value||input.data||''
 if(textInput.value)textInput.value.value=''
 if(completedComposition!==undefined){const duplicate=text===completedComposition;completedComposition=undefined;if(duplicate)return}
 commitText(text)
}
let suppressPointerClick=false
let lastPointer={x:0,y:0}
let observer:ResizeObserver|undefined,frame:number|undefined,lastLayout='',captured:HTMLElement|undefined,pointerId:number|undefined,pending:Extract<ClaudeUiClientInput,{kind:'pointer'}>|undefined
const cell=()=>({width:Math.max(1,(measure.value?.getBoundingClientRect().width??800)/100),height:Math.max(1,measure.value?.getBoundingClientRect().height||20)})
function layout(){
 frame=undefined;const element=region.value;if(!element)return
 // clientWidth rounds to whole pixels: an intrinsic five-cell region can become four cells.
 const size=cell(),bounds=element.getBoundingClientRect(),style=getComputedStyle(element)
 const width=Math.max(0,bounds.width-(parseFloat(style.borderLeftWidth)||0)-(parseFloat(style.borderRightWidth)||0))
 const height=Math.max(0,bounds.height-(parseFloat(style.borderTopWidth)||0)-(parseFloat(style.borderBottomWidth)||0))
 // Blink quantizes layout to 1/64 CSS px; don't lose a whole cell at that boundary.
 const quantum=1/64
 const event={kind:'resize' as const,columns:Math.floor((width+quantum)/size.width),rows:Math.floor((height+quantum)/size.height)},encoded=JSON.stringify(event)
 if(encoded!==lastLayout){lastLayout=encoded;send?.(props.node.id,event)}
}
function schedule(){if(frame===undefined)frame=requestAnimationFrame(()=>{layout();flush()})}
function flush(){if(pending){send?.(props.node.id,pending);pending=undefined}}
function capturedClick(event:MouseEvent){if(suppressPointerClick&&event.detail>0){suppressPointerClick=false;event.preventDefault();event.stopImmediatePropagation();focusClient(event)}}
function focusClient(event:MouseEvent){if(props.node.keys&&event.target instanceof HTMLElement&&!event.target.closest('input,textarea,select'))region.value?.focus({preventScroll:true})}
function key(event:KeyboardEvent){
 if((event.target!==region.value&&event.target!==textInput.value)||composing||event.isComposing||event.key==='Process'||event.key==='Dead')return
 completedComposition=undefined
 const terminal=region.value?.closest('[data-native-placement="InfoNotice"],[data-native-placement="TurnDuration"]')
 if(event.key==='Escape'){if(terminal&&returnFocus){event.preventDefault();event.stopPropagation();returnFocus();}return}
 if(!props.node.keys)return
 if(event.ctrlKey&&['c','d'].includes(event.key.toLowerCase())){const site=region.value?.closest<HTMLElement>('.native-extension-surface');if(site)site.focus({preventScroll:true});else if(terminal&&returnFocus){event.preventDefault();event.stopPropagation();returnFocus();}else {textInput.value?.blur();region.value?.blur()}return}
 if(['Shift','Control','Alt','Meta','AltGraph','CapsLock','NumLock','ScrollLock'].includes(event.key))return
 const names:Record<string,string>={' ':'space',ArrowUp:'up',ArrowDown:'down',ArrowLeft:'left',ArrowRight:'right',Enter:'return',Tab:'tab',Backspace:'backspace',Delete:'delete',PageUp:'pageup',PageDown:'pagedown',Home:'home',End:'end'}
 const name=names[event.key]??event.key;if(name.length>32)return
 event.preventDefault();event.stopPropagation();send?.(props.node.id,{kind:'key',key:name,...(event.ctrlKey?{ctrl:true as const}:{}),...(event.shiftKey?{shift:true as const}:{}),...(event.metaKey||event.altKey?{meta:true as const}:{})})
}
function pointer(event:PointerEvent){
 if(!props.node.pointer||!region.value)return
 if(pointerId!==undefined&&event.pointerId!==pointerId)return
 const types:Record<string,Extract<ClaudeUiClientInput,{kind:'pointer'}>['type']>={pointerdown:'down',pointermove:'move',pointerup:'up',pointerenter:'enter',pointerleave:'leave'},type=types[event.type];if(!type)return
 const bounds=region.value.getBoundingClientRect(),size=cell(),x=(event.clientX-bounds.left)/size.width,y=(event.clientY-bounds.top)/size.height
 const buttons=['left','middle','right'] as const,button=(type==='down'||type==='up'||pointerId!==undefined)?buttons[event.button]??(event.buttons&1?'left':event.buttons&2?'right':event.buttons&4?'middle':undefined):undefined
 if(!['enter','leave'].includes(type))lastPointer={x:Math.floor(x),y:Math.floor(y)}
 const input:Extract<ClaudeUiClientInput,{kind:'pointer'}>={kind:'pointer',type,...lastPointer,...(!['enter','leave'].includes(type)?{fine:{x,y}}:{}),...(button?{button}:{}),...(event.ctrlKey?{ctrl:true}:{}),...(event.shiftKey?{shift:true}:{}),...(event.altKey?{alt:true}:{})}
 if(type==='down'){
  suppressPointerClick=false
  const target=event.target instanceof HTMLElement?event.target:region.value
  if(!target.closest('button,input,textarea,select,a'))region.value.focus({preventScroll:true})
  target.setPointerCapture?.(event.pointerId);captured=target;pointerId=event.pointerId
 }
 if(type==='move'){pending=input;schedule()}else{flush();send?.(props.node.id,input)}
 if(pointerId!==undefined){event.stopPropagation();if(type==='move')event.preventDefault()}
 if(type==='up'){
  const action=captured?.closest('button,a'),hit=action&&document.elementFromPoint(event.clientX,event.clientY)
  suppressPointerClick=!!action&&!action.contains(hit||null)
  release()
 }
}
function release(){if(pointerId!==undefined&&captured?.hasPointerCapture?.(pointerId))captured.releasePointerCapture(pointerId);captured=undefined;pointerId=undefined}
function cancel(){flush();if(pointerId!==undefined)send?.(props.node.id,{kind:'pointer',type:'up',...lastPointer});release()}
onMounted(()=>{observer=typeof ResizeObserver==='undefined'?undefined:new ResizeObserver(schedule);if(region.value)observer?.observe(region.value);schedule()})
watch(()=>props.node.id,()=>{cancelComposition();release();lastPointer={x:0,y:0};lastLayout='';void nextTick(schedule)})
watch(()=>props.node.keys,value=>{if(!value)cancelComposition()},{flush:'sync'})
onBeforeUnmount(()=>{live=false;cancelComposition();cancel();observer?.disconnect();if(frame!==undefined)cancelAnimationFrame(frame)})
</script>
