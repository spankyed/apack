<template>
  <iframe title="Option preview" sandbox="" referrerpolicy="no-referrer" :srcdoc="document" data-testid="native-question-html-preview" class="native-question-html-preview" />
</template>
<script setup lang="ts">
import { computed } from 'vue'
import { nativeQuestionHtmlDocument } from './native-question-html.ts'
const props = defineProps<{ fragment: string }>()
const document = computed(() => nativeQuestionHtmlDocument(props.fragment))
</script>
<style scoped>
.native-question-html-preview { display:block; width:100%; height:180px; max-height:45vh; border:1px solid #393939; border-radius:7px; background:#191919; }
</style>
