<template>
  <!-- Open PR actions -->
  <div v-if="pr && pr.state === 'OPEN'" class="flex items-center gap-1.5 px-3 py-2 border-t border-neutral-800 bg-neutral-800/30">
    <!-- Merge -->
    <div ref="mergeContainer" class="relative">
      <div class="flex">
        <HoverCardRoot :open-delay="300" :close-delay="100">
          <HoverCardTrigger as-child>
            <button
              @click="$emit('merge', selectedMethod)"
              :disabled="!canMerge"
              :aria-label="mergeTooltip"
              :class="MAIN_BTN_CLASSES[mergeVariant]"
              class="flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-l transition-colors"
            >
              <Loader2 v-if="mergeVariant === 'merging' || mergeVariant === 'pending'" :size="11" class="animate-spin" />
              <AlertTriangle v-else-if="mergeVariant === 'error'" :size="11" />
              <Ban v-else-if="mergeVariant === 'blocked'" :size="11" />
              <GitMerge v-else :size="11" />
              <span>{{ mergeMethodList.find(m => m.value === selectedMethod)?.shortLabel }}</span>
            </button>
          </HoverCardTrigger>
          <HoverCardPortal>
            <HoverCardContent
              :side="'top'"
              :align="'start'"
              :side-offset="8"
              class="z-50"
            >
              <MergeButtonTooltip :variant="mergeVariant" :pr="pr" />
              <HoverCardArrow class="fill-neutral-700" />
            </HoverCardContent>
          </HoverCardPortal>
        </HoverCardRoot>
        <button
          @click="showMergeOptions = !showMergeOptions"
          :disabled="!canMerge"
          :aria-label="mergeTooltip"
          :class="CHEVRON_BTN_CLASSES[mergeVariant]"
          class="px-1 py-1 rounded-r transition-colors"
        >
          <ChevronDown :size="11" />
        </button>
      </div>
      <!-- Merge method dropdown -->
      <div
        v-if="showMergeOptions"
        class="absolute bottom-full left-0 mb-1 rounded border border-neutral-700 bg-neutral-800 shadow-lg z-50 whitespace-nowrap"
      >
        <button
          v-for="method in mergeMethodList"
          :key="method.value"
          @click="selectMethod(method.value)"
          class="flex items-center w-full gap-2 px-3 py-1.5 text-xs text-left transition-colors hover:bg-neutral-700"
          :class="selectedMethod === method.value ? 'text-green-400' : 'text-neutral-300'"
        >
          <Check v-if="selectedMethod === method.value" :size="10" />
          <span v-else class="w-[10px]" />
          {{ method.label }}
        </button>
      </div>
    </div>

    <!-- Draft toggle -->
    <button
      @click="$emit('toggle-draft')"
      :disabled="isTogglingDraft"
      class="flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors"
      :class="pr.isDraft
        ? 'bg-blue-700/50 text-blue-300 hover:bg-blue-700/70'
        : 'bg-neutral-700/50 text-neutral-400 hover:bg-neutral-700'"
      :title="pr.isDraft ? 'Mark as ready for review' : 'Convert to draft'"
    >
      <Loader2 v-if="isTogglingDraft" :size="11" class="animate-spin" />
      <FileEdit v-else :size="11" />
      <span>{{ pr.isDraft ? 'Ready' : 'Draft' }}</span>
    </button>

    <div class="flex-1" />

    <!-- Close -->
    <button
      @click="$emit('close')"
      :disabled="isClosing"
      class="flex items-center gap-1 px-2 py-1 text-xs rounded text-red-400 hover:bg-red-900/30 transition-colors disabled:opacity-50"
      title="Close pull request"
    >
      <Loader2 v-if="isClosing" :size="11" class="animate-spin" />
      <XCircle v-else :size="11" />
      <span>Close</span>
    </button>
  </div>

  <!-- Merged/Closed PR actions -->
  <div v-else-if="pr && (pr.state === 'MERGED' || pr.state === 'CLOSED')" class="flex items-center gap-1.5 px-3 py-2 border-t border-neutral-800 bg-neutral-800/30">
    <button
      @click="$emit('checkout-base')"
      class="flex items-center gap-1 px-2 py-1 text-xs rounded text-blue-400 hover:bg-blue-900/30 transition-colors"
      title="Checkout and pull base branch"
    >
      <GitBranch :size="11" />
      <span>Checkout & Pull Base</span>
    </button>
    <button
      v-if="canDeleteBranch"
      @click="confirmDeleteBranch"
      :disabled="isDeletingBranch"
      class="flex items-center gap-1 px-2 py-1 text-xs rounded text-red-400 hover:bg-red-900/30 transition-colors disabled:opacity-50 ml-auto"
      title="Delete remote branch"
    >
      <Loader2 v-if="isDeletingBranch" :size="11" class="animate-spin" />
      <Trash2 v-else :size="11" />
      <span>Delete Branch</span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, useTemplateRef } from 'vue'
import {
  GitMerge, GitBranch, ChevronDown, Check, XCircle, FileEdit, Loader2, Trash2,
  AlertTriangle, Ban,
} from 'lucide-vue-next'
import {
  HoverCardRoot, HoverCardTrigger, HoverCardContent, HoverCardPortal, HoverCardArrow,
} from 'reka-ui'
import { useClickOutside } from '@apackdev/ui/composables/useClickOutside'
import type { GhPullRequest } from '#generated/types.ts'
import { isFailing, isPending } from './merge-checks.ts'
import MergeButtonTooltip, { type MergeVariant } from './MergeButtonTooltip.vue'

const props = defineProps<{
  pr: GhPullRequest | null
  isMerging: boolean
  isClosing: boolean
  isTogglingDraft: boolean
  isDeletingBranch: boolean
  /** The branch is this repository's and no other open pull request is from it (`branchDeletable`) */
  canDeleteBranch: boolean
}>()

/** Semantic state of the merge button: drives color, icon, tooltip, and disabled flag. */
const mergeState = computed<{ variant: MergeVariant; reason: string }>(() => {
  const pr = props.pr
  if (props.isMerging) return { variant: 'merging', reason: 'Merging…' }
  if (!pr)             return { variant: 'blocked', reason: 'No pull request selected' }
  if (pr.isDraft)      return { variant: 'blocked', reason: 'Cannot merge a draft PR' }

  if (pr.mergeable === 'CONFLICTING' || pr.mergeStateStatus === 'DIRTY')
    return { variant: 'error', reason: 'Cannot merge — branch has conflicts with base' }
  if (pr.mergeStateStatus === 'BEHIND')
    return { variant: 'blocked', reason: 'Branch is out of date with base — update it first' }
  if (pr.reviewDecision === 'CHANGES_REQUESTED')
    return { variant: 'error', reason: 'Cannot merge — changes have been requested' }
  if (pr.reviewDecision === 'REVIEW_REQUIRED')
    return { variant: 'blocked', reason: 'Cannot merge — required review is missing' }

  const checks = pr.statusCheckRollup ?? []
  if (checks.some(isFailing)) return { variant: 'error',   reason: 'Cannot merge — status checks are failing' }
  if (checks.some(isPending)) return { variant: 'pending', reason: 'Cannot merge — status checks are still running' }

  if (pr.mergeStateStatus === 'BLOCKED')
    return { variant: 'blocked', reason: 'Cannot merge — blocked by branch protection rules' }
  if (pr.mergeable === 'UNKNOWN' || pr.mergeStateStatus === 'UNKNOWN')
    return { variant: 'pending', reason: 'Checking mergeability…' }

  return { variant: 'clean', reason: 'Merge pull request' }
})

const canMerge = computed(() => mergeState.value.variant === 'clean')
const mergeTooltip = computed(() => mergeState.value.reason)
const mergeVariant = computed(() => mergeState.value.variant)

const MAIN_BTN_CLASSES: Record<MergeVariant, string> = {
  clean:   'bg-green-700/80 text-white hover:bg-green-600',
  merging: 'bg-green-700/60 text-white cursor-wait',
  blocked: 'bg-neutral-700/60 text-neutral-400 cursor-not-allowed',
  error:   'bg-red-950/50 text-red-300 border border-red-900/60 cursor-not-allowed',
  pending: 'bg-amber-950/50 text-amber-300 border border-amber-900/60 cursor-not-allowed',
}

const CHEVRON_BTN_CLASSES: Record<MergeVariant, string> = {
  clean:   'bg-green-700/80 text-white hover:bg-green-600 border-l border-green-600/50',
  merging: 'bg-green-700/60 text-white cursor-wait border-l border-green-600/50',
  blocked: 'bg-neutral-700/60 text-neutral-400 cursor-not-allowed border-l border-neutral-600/60',
  error:   'bg-red-950/50 text-red-300 cursor-not-allowed border-l border-red-900/60',
  pending: 'bg-amber-950/50 text-amber-300 cursor-not-allowed border-l border-amber-900/60',
}

const emit = defineEmits<{
  'merge': [method: 'merge' | 'squash' | 'rebase']
  'close': []
  'toggle-draft': []
  'delete-branch': []
  'checkout-base': []
}>()

/** Deleting a branch cannot be taken back from here, so it is asked first */
function confirmDeleteBranch() {
  const branch = props.pr?.headRefName
  if (branch && confirm(`Delete the branch ${branch} on GitHub? Its commits stay in the pull request.`)) emit('delete-branch')
}

const showMergeOptions = ref(false)
const selectedMethod = ref<'merge' | 'squash' | 'rebase'>('merge')
const mergeContainer = useTemplateRef<HTMLElement>('mergeContainer')

useClickOutside(mergeContainer, () => {
  showMergeOptions.value = false
})

const mergeMethodList = [
  { value: 'merge' as const, label: 'Create a merge commit', shortLabel: 'Merge' },
  { value: 'squash' as const, label: 'Squash and merge', shortLabel: 'Squash' },
  { value: 'rebase' as const, label: 'Rebase and merge', shortLabel: 'Rebase' },
]

const selectMethod = (method: 'merge' | 'squash' | 'rebase') => {
  selectedMethod.value = method
  showMergeOptions.value = false
}
</script>
