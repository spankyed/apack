<template>
  <div>
    <div class="flex items-center gap-3 mb-6">
      <h2 class="text-xl font-semibold text-white">{{ title }}</h2>
      <slot name="actions" />
      <button @click="confirmReset = true" title="Reset to defaults" class="ml-auto text-neutral-400 hover:text-white">
        <RotateCcw class="w-4 h-4" />
      </button>
    </div>
    <p v-if="description" class="mb-6 text-sm text-neutral-400">{{ description }}</p>
    <ContributionBoundary v-if="form && formOwner" :pack-id="formOwner" :owner="formRef" area="settings form"
      :current="isCurrentForm">
      <SurfaceScope v-if="surface" :surface="surface">
        <component :is="form" :settings="value" @update-setting="update" />
      </SurfaceScope>
      <component v-else :is="form" :settings="value" @update-setting="update" />
    </ContributionBoundary>
    <div v-else class="text-sm text-neutral-400">
      <p>A custom form is unavailable for these preferences.</p>
      <button @click="openJson" class="mt-3 underline">Edit in JSON</button>
    </div>
    <div class="mt-6 text-xs" aria-live="polite">
      <p v-if="saveStatus === 'saving'" class="text-neutral-500">Saving…</p>
      <p v-else-if="saveStatus === 'saved'" class="text-green-600">Settings saved</p>
      <p v-else-if="saveStatus === 'refused'" class="text-red-400">{{ problems.join('; ') }}</p>
    </div>
    <ConfirmationDialog v-model="confirmReset" title="Reset settings"
      :description="`Forget your changes to ${title}? Its defaults will apply again.`"
      confirm-text="Reset" variant="danger" @confirm="reset" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, type Component } from 'vue';
import ContributionBoundary from '@/views/layout/ContributionBoundary.vue';
import { SurfaceScope } from '@apackdev/sdk/fe';
import type { SettingUpdate, SettingsTarget } from '@apackdev/sdk/types';
import { splitRef, type FeatureRef } from '@apackdev/sdk/ids';
import { fePacks } from '@/runtime/packs';
import { useHostState } from '@apackdev/host/fe';
import { RotateCcw } from 'lucide-vue-next';
import ConfirmationDialog from '@apackdev/ui/design/ConfirmationDialog';
import { useSettingsSaveStatus } from '@/views/settings/save';

const props = defineProps<{
  target: SettingsTarget; title: string; description?: string;
  form?: Component; value: unknown; surface?: FeatureRef;
}>();
const formOwner = computed(() => props.target.kind === 'pack' ? props.target.packId
  : props.target.kind === 'feature' ? splitRef(props.target.featureRef)?.packId : undefined);
const formRef = computed(() => props.target.kind === 'feature' ? props.target.featureRef
  : props.target.kind === 'pack' ? `${props.target.packId}/${props.target.groupId}` : 'host/app');
const isCurrentForm = () => fePacks.settingsForm(props.target) === props.form;
const { send } = useHostState('settings');
const confirmReset = ref(false);
const { saveStatus, problems, updateSettings, resetSettings } = useSettingsSaveStatus();
const update = (event: SettingUpdate) => updateSettings({
  target: props.target, path: event.path, value: event.value, condition: event.condition,
});
const reset = () => resetSettings(props.target);
function openJson() {
  send({ type: 'TAB.SELECT', tab: 'general' });
  send({ type: 'GENERAL_NAV.SELECT', item: 'json' });
}
</script>
