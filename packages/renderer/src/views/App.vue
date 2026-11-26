<script setup lang="ts">
import WebApp from './WebApp.vue';
import SettingsRecovery from './settings/SettingsRecovery.vue';
import { useSettingsRecovery } from '@/runtime/settings';
import SurfacePopoutApp from './SurfacePopoutApp.vue';
import { useHostState } from '@apackdev/host/fe';
import { computed, onScopeDispose, shallowRef } from 'vue';
import { fePacks } from '@/runtime/packs';

const recovery = useSettingsRecovery();
/**
 * Re-read, never read once: this window mounts before any pack's frontend has loaded — `main.ts` registers
 * none, and the shell loads every one, the app's own included, once the bus says which packs are running. The
 * slot is drawn while the shell has the `welcome` tag, which is that same window, so a one-shot read is
 * always `undefined` and a pack contributing a welcome screen has nothing drawn for it on the one boot it is
 * meant for.
 */
const WelcomeComponent = shallowRef(fePacks.getAppExtension('welcome'));
onScopeDispose(fePacks.onChanged(() => { WelcomeComponent.value = fePacks.getAppExtension('welcome'); }));
const { state: shell } = useHostState('application');
const isWelcome = computed(() => shell.value.at === 'onboarding.letter');
const isConnecting = computed(() => shell.value.at === 'running.connecting');
const isSurfacePopout = new URLSearchParams(window.location.search).get('popout') === 'surface';
</script>

<template>
  <SettingsRecovery v-if="recovery" :recovery="recovery" />
  <template v-else>
    <!-- Welcome modal overlay (first-time users) -->
    <component v-if="isWelcome && !isSurfacePopout && WelcomeComponent" :is="WelcomeComponent" />
    <!-- Main web app component (always rendered, surfaces show own loading states) -->
    <SurfacePopoutApp v-if="isSurfacePopout" />
    <WebApp v-else />

    <!-- Loading overlay while waiting for backend connection -->
    <Transition name="fade">
      <div v-if="isConnecting" class="loading-overlay" />
    </Transition>
  </template>
</template>

<style>
/* Import web app styles */
@import '../style.css';

/* Loading overlay */
.loading-overlay {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgb(23 23 23 / 0.85);
  z-index: 9998;
}
.fade-leave-active {
  transition: opacity 0.3s ease;
}
.fade-leave-to {
  opacity: 0;
}
</style>
