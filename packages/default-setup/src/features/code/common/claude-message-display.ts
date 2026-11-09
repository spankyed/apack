/** Match the native AssistantMessage producer's display-only context filtering (2.1.302). */
export function claudeAssistantDisplayText(text: string): string {
  return text.replace(/<(commit_analysis|context|function_analysis|pr_analysis)>.*?<\/\1>\n?/gs, '')
    .replace(/<\/?(?:cc-memory|cc_memory|ccmemory|CC-MEMORY|CC_MEMORY|CCMEMORY)(?=[\s/>])[^>]{0,1024}>/g, '')
    .replace(/^\n+/, '')
}
