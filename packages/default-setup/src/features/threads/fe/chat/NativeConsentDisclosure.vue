<template>
  <span><template v-for="(part,index) in parts" :key="index"><a v-if="part.href" :href="part.href" class="underline focus-visible:outline focus-visible:outline-current" @click.prevent="open($event,part.href)" @auxclick.prevent="open($event,part.href)">{{ part.text }}</a><span v-else>{{ part.text }}</span></template></span>
</template>
<script setup lang="ts">
import { computed } from 'vue'
import { openLink } from '@apackdev/sdk/fe'
const props=defineProps<{text:string;links?:string[]}>()
const parts=computed(()=>{
 const urls=[...new Set(props.links??[])]
 if(!urls.length)return [{text:props.text,href:undefined}]
 const pattern=new RegExp('('+urls.map(url=>url.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|')+')','g')
 return props.text.split(pattern).map(text=>({text,href:urls.includes(text)?text:undefined}))
})
function open(event:MouseEvent,href:string){if(event.button===0||event.button===1)openLink(href)}
</script>
