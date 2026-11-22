<template>
  <div class="space-y-3">
    <p class="text-sm text-neutral-500">Leave a path blank to auto-detect the CLI. Click Test to verify and resolve it.</p>
    <CliProviderRow
      v-for="provider in providers"
      :key="provider.key"
      :model-value="provider.draft.value"
      :label="provider.label"
      :install-hint="provider.installHint"
      :install-cmd="provider.installCmd"
      placeholder="Path override (auto-detected if empty)"
      :test-result="provider.result.value"
      @update:model-value="provider.edit"
      @test="provider.test"
    />
  </div>
</template>

<script setup lang="ts">
import { shallowRef } from 'vue'
import { ask } from '#generated/events.ts'
import type { SettingUpdate } from '#generated/settings-fe.ts'
import { useSettingsDraft } from '@apackdev/sdk/fe'
import { useDebounce } from '@apackdev/ui/composables/useDebounce'
import { errorMessage } from '@apackdev/sdk/utils/pure'
import CliProviderRow from './CliProviderRow.vue'

const props = defineProps<{ paths?: Record<string, string> }>()
const emit = defineEmits<{ 'update-setting': [SettingUpdate<'code'>] }>()

const providers = [
  { key: 'copilot', label: 'Copilot CLI', installHint: 'Install via npm', installCmd: 'npm install -g @github/copilot' },
  { key: 'claude-code', label: 'Claude Code CLI', installHint: 'Install via npm', installCmd: 'npm install -g @anthropic-ai/claude-code' },
  { key: 'codex', label: 'Codex CLI', installHint: 'Install via npm', installCmd: 'npm install -g @openai/codex' },
  { key: 'git', label: 'Git', installHint: 'Install from git-scm.com, or via Homebrew', installCmd: 'brew install git' },
].map(provider => {
  const { key } = provider
  const draft = useSettingsDraft(() => props.paths?.[key] ?? '')
  const result = shallowRef<{ status: 'testing' | 'success' | 'error'; error?: string }>()
  const { debounced: save, flush } = useDebounce((value: string) => {
    emit('update-setting', { path: ['cliPaths', key], value })
  }, 600)

  return {
    ...provider,
    draft,
    result,
    edit(value: string) {
      draft.value = value
      result.value = undefined
      save(value)
    },
    async test() {
      const path = draft.value
      flush()
      result.value = { status: 'testing' }
      try {
        const outcome = await ask('code', { type: 'TEST_CLI_PROVIDER', provider: key, path })
        if (!outcome.ok) {
          result.value = { status: 'error', error: outcome.failure.message }
        } else if (outcome.value.success) {
          result.value = { status: 'success' }
        } else {
          result.value = { status: 'error', error: outcome.value.error }
        }
      } catch (error) {
        result.value = { status: 'error', error: errorMessage(error) }
      }
    },
  }
})
</script>
