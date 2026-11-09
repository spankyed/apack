<template>
  <div class="flex h-full">
    <div ref="sidebar" data-testid="feature-settings-list" class="w-64 p-2 bg-neutral-900 border-r border-neutral-800 overflow-auto">
      <h3 class="px-3 py-2 text-xs font-semibold text-neutral-500 uppercase">Feature preferences</h3>
      <div v-for="feature in features" :key="feature.id" class="flex items-center gap-1 mb-0.5">
        <button @click="selectFeature(feature.id)" :data-active="selected?.id === feature.id"
          class="flex-1 px-3 py-2 rounded text-left text-sm"
          :class="selected?.id === feature.id ? 'bg-blue-500/20 text-blue-400' : 'text-neutral-400 hover:text-white'">
          {{ feature.label }}
          <span class="block text-xs text-neutral-500">{{ feature.id }}</span>
        </button>
        <button v-if="feature.surface" @click="toggleVisibility(feature.id)" class="p-2 text-neutral-400"
          :title="isVisible(feature.id) ? 'Hide from toolbar' : 'Show in toolbar'">
          <component :is="isVisible(feature.id) ? Eye : EyeOff" class="w-4 h-4" />
        </button>
      </div>
      <p v-if="!features.length" class="p-3 text-sm text-neutral-500">No feature preferences declared.</p>
    </div>
    <div class="min-w-0 flex-1 p-4 lg:p-8 overflow-auto">
      <SettingsEditor v-if="selected" :key="selected.id" :target="selected.target" :title="selected.label"
        :description="selected.definition.description" :form="selected.form"
        :value="snapshot?.values.features[selected.id]" :surface="selected.surface?.id">
        <template #actions>
          <button data-testid="feature-help" :aria-label="`Help for ${selected.label}`" v-if="hasHelp(selected.id)" @click="openFeatureHelp(selected.id)" class="text-sm text-neutral-400 underline">Help</button>
          <button v-if="selected.surface" @click="untypedOpenSurface(selected.id)" title="Open feature" class="text-neutral-400">
            <ExternalLink class="w-4 h-4" />
          </button>
        </template>
      </SettingsEditor>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, onMounted } from 'vue';
import { useSelector } from '@xstate/vue';
import { useSurface, useShell, untypedOpenSurface } from '@apackdev/sdk/fe';
import { resolveName, type FeatureRef } from '@apackdev/sdk/ids';
import type { SettingsState } from '@apackdev/host/fe';
import { Eye, EyeOff, ExternalLink } from 'lucide-vue-next';
import { useWindowSettingsSnapshot } from '@/runtime/settings';
import { useSettingsFormLookup } from '@/views/settings/forms';
import { useContextualHelp } from '@/views/settings/contextual-help';
import SettingsEditor from '../components/SettingsEditor.vue';

const actor: SettingsState = useSurface();
const shell = useShell();
const snapshot = useWindowSettingsSnapshot();
const settingsForm = useSettingsFormLookup();
const selectedId = useSelector(actor, state => state.context.selectedFeatureId);
const { hasHelp, openFeatureHelp } = useContextualHelp();
const features = computed(() => Object.entries(snapshot.value?.catalog.features ?? {}).map(([name, definition]) => {
  const id = resolveName(name);
  const target = { kind: 'feature' as const, featureRef: id };
  const surface = shell.surfaces.value.find(surface => surface.id === id);
  return { id, target, definition, surface, label: definition.title ?? surface?.label ?? id, form: settingsForm(target) };
}));
const selected = computed(() => features.value.find(feature => feature.id === selectedId.value) ?? features.value[0]);
const sidebar = ref<HTMLElement>();
const scrollToSelected = () => sidebar.value?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
onMounted(scrollToSelected);
watch(() => selected.value?.id, scrollToSelected, { flush: 'post' });
const selectFeature = (featureId: FeatureRef) => actor.send({ type: 'FEATURE.SELECT', featureId });
const isVisible = (id: FeatureRef) => shell.surfaceVisibility.value[id] !== false;
const toggleVisibility = (id: FeatureRef) => shell.setSurfaceVisible(id, !isVisible(id));
</script>
