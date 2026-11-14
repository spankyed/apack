<template>
  <div class="approval-buttons space-y-3">
    <!-- Response Display (when disabled/responded) -->
    <div v-if="disabled && response" class="space-y-2">
      <div
        class="flex items-center gap-2 px-3 py-2 rounded-lg border"
        :class="approvalClasses"
      >
        <component :is="approvalIcon" class="w-5 h-5 flex-shrink-0" />
        <span class="text-sm font-medium">{{ approvalText }}</span>
      </div>
      <div
        v-if="reasonText"
        class="px-3 py-2 bg-neutral-700/30 rounded-lg border border-neutral-600/50 text-sm text-neutral-300"
      >
        <div class="text-xs text-neutral-400 mb-1">Reason:</div>
        {{ reasonText }}
      </div>
    </div>

    <!-- Input Controls (when not disabled/not responded) -->
    <template v-else>
      <!-- Reason Input (opt-in) -->
      <div v-if="requireReason || allowReason" class="space-y-2">
        <label class="text-xs text-neutral-400">
          Reason {{ requireReason ? '(required)' : '(optional)' }}:
        </label>
        <textarea
          v-model="reason"
          :placeholder="reasonPlaceholder"
          :rows="reasonRows"
          :disabled="disabled"
          :class="[
            'w-full px-3 py-2 border rounded-lg text-sm placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-primary-600 focus:border-transparent resize-y',
            disabled
              ? 'bg-neutral-700/50 border-neutral-700 text-neutral-500 cursor-not-allowed'
              : 'bg-neutral-700 border-neutral-600 text-neutral-200'
          ]"
        ></textarea>
      </div>

      <!-- Custom Options Mode -->
      <div v-if="options?.length" class="flex flex-wrap items-center gap-2">
        <button
          v-for="(opt, i) in options"
          :key="i"
          @click="handleOption(opt)"
          :disabled="isDisabled"
          :class="[
            'px-4 py-2 rounded-lg transition-colors text-sm font-medium flex items-center gap-2',
            isDisabled
              ? 'bg-neutral-700 text-neutral-500 cursor-not-allowed'
              : variantClass(opt.variant),
          ]"
        >
          {{ opt.label }}
        </button>
      </div>

      <!-- Default Approve/Deny Buttons (when no custom options) -->
      <div v-else class="flex items-center gap-2">
        <!-- Auto-accept checkbox (left side, for file mutation tools) -->
        <label v-if="autoAcceptOption" class="flex items-center gap-2 cursor-pointer select-none mr-3">
          <input
            type="checkbox"
            v-model="autoAcceptChecked"
            class="w-3.5 h-3.5 rounded border-neutral-500 bg-neutral-700 text-blue-600 focus:ring-blue-600 focus:ring-offset-0"
          />
          <span class="text-xs text-neutral-400">Auto-accept file edits for session</span>
        </label>

        <div class="ml-auto flex items-center gap-2">
          <button
            @click="handleApprove"
            :disabled="isDisabled"
            :class="[
              'px-4 py-2 rounded-lg transition-colors text-sm font-medium flex items-center gap-2',
              isDisabled
                ? 'bg-neutral-700 text-neutral-500 cursor-not-allowed'
                : 'bg-green-600 hover:bg-green-500 text-white'
            ]"
          >
            <CheckCircle class="w-4 h-4" />
            {{ approveLabel }}
          </button>

          <button
            @click="handleDeny"
            :disabled="isDisabled"
            :class="[
              'px-4 py-2 rounded-lg transition-colors text-sm font-medium flex items-center gap-2',
              isDisabled
                ? 'bg-neutral-700 text-neutral-500 cursor-not-allowed'
                : 'bg-neutral-600 hover:bg-neutral-500 text-neutral-200'
            ]"
          >
            <XCircle class="w-4 h-4" />
            {{ denyLabel }}
          </button>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { CheckCircle, XCircle } from 'lucide-vue-next'

interface ApprovalOption {
  label: string
  variant: 'primary' | 'secondary' | 'danger' | 'neutral'
  flags?: Record<string, any>
}

interface Props {
  requireReason?: boolean
  allowReason?: boolean
  reasonPlaceholder?: string
  reasonRows?: number
  approveLabel?: string
  denyLabel?: string
  modelValue?: string
  disabled?: boolean
  response?: any
  autoAcceptOption?: boolean
  options?: ApprovalOption[]
}

interface Emits {
  (e: 'update:modelValue', value: string): void
  (e: 'submit', response: { approved: boolean; reason?: string; [key: string]: any }): void
}

const props = withDefaults(defineProps<Props>(), {
  requireReason: false,
  allowReason: false,
  reasonPlaceholder: 'Enter your reason...',
  reasonRows: 3,
  approveLabel: 'Approve',
  denyLabel: 'Deny',
  modelValue: '',
  disabled: false
})

const emit = defineEmits<Emits>()

const reason = ref(props.modelValue)
const autoAcceptChecked = ref(false)

const isApprovedResponse = (response: any): boolean => {
  if (response?.approved !== undefined) return !!response.approved
  if (response === true) return true
  return response?.decision === 'accept' || response?.decision === 'acceptForSession'
}

// Response display handling
const isCancelledResponse = computed(() => props.response?.cancelled === true)
const approvalClasses = computed(() => {
  if (isCancelledResponse.value) return 'bg-neutral-800/40 border-neutral-600/30 text-neutral-300'
  const approved = isApprovedResponse(props.response)
  return approved
    ? 'bg-green-900/20 border-green-600/30 text-green-200'
    : 'bg-red-900/20 border-red-600/30 text-red-200'
})

const approvalIcon = computed(() => {
  const approved = isApprovedResponse(props.response)
  return approved ? CheckCircle : XCircle
})

const approvalText = computed(() => {
  if (isCancelledResponse.value) return 'Cancelled'
  const approved = isApprovedResponse(props.response)
  return approved ? 'Approved' : 'Denied'
})

const reasonText = computed(() => {
  return props.response?.reason || ''
})

const isDisabled = computed(() => {
  return props.disabled || (props.requireReason && !reason.value.trim())
})

const variantClass = (variant: string) => {
  switch (variant) {
    case 'primary': return 'bg-green-600 hover:bg-green-500 text-white'
    case 'secondary': return 'bg-blue-600 hover:bg-blue-500 text-white'
    case 'danger': return 'bg-red-600 hover:bg-red-500 text-white'
    case 'neutral': return 'bg-neutral-600 hover:bg-neutral-500 text-neutral-200'
    default: return 'bg-neutral-600 hover:bg-neutral-500 text-neutral-200'
  }
}

const handleOption = (opt: ApprovalOption) => {
  if (isDisabled.value) return
  const trimmedReason = reason.value.trim()
  const flags = opt.flags ?? {}
  emit('submit', { approved: flags.approved !== false, reason: trimmedReason || undefined, ...flags })
}

const handleApprove = () => {
  if (isDisabled.value) return
  const trimmedReason = reason.value.trim()
  emit('update:modelValue', trimmedReason)
  const response: Record<string, any> = { approved: true, reason: trimmedReason || undefined }
  if (autoAcceptChecked.value) response.autoAccept = true
  emit('submit', response as any)
}

const handleDeny = () => {
  if (isDisabled.value) return
  const trimmedReason = reason.value.trim()
  emit('update:modelValue', trimmedReason)
  emit('submit', { approved: false, reason: trimmedReason || undefined })
}
</script>
