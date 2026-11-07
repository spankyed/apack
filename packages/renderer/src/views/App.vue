<script setup lang="ts">
import WebApp from './WebApp.vue';
import ContributionBoundary from './layout/ContributionBoundary.vue';
import SettingsRecovery from './settings/SettingsRecovery.vue';
import { useSettingsRecovery } from '@/runtime/settings';
import SurfacePopoutApp from './SurfacePopoutApp.vue';
import { applicationState } from '@/main'
import { useSelector } from '@xstate/vue';
import { onScopeDispose, shallowRef } from 'vue';
import { fePacks } from '@/runtime/packs';

const recovery = useSettingsRecovery();
/**
 * Re-read, never read once: this window mounts before any pack's frontend has loaded — `main.ts` registers
 * none, and the shell loads every one, the app's own included, once the bus says which packs are running. The
 * slot is drawn while the shell has the `welcome` tag, which is that same window, so a one-shot read is
 * always `undefined` and a pack contributing a welcome screen has nothing drawn for it on the one boot it is
 * meant for.
 */
const welcome = shallowRef(fePacks.appExtensionBinding('welcome'));
onScopeDispose(fePacks.onChanged(() => { welcome.value = fePacks.appExtensionBinding('welcome'); }));
const isWelcome = useSelector(applicationState, (s) => s.hasTag('welcome'));
const isConnecting = useSelector(applicationState, (s) => s.hasTag('connecting'));
const isSurfacePopout = new URLSearchParams(window.location.search).get('popout') === 'surface';
</script>

<template>
  <SettingsRecovery v-if="recovery" :recovery="recovery" />
  <template v-else>
    <!-- Welcome modal overlay (first-time users) -->
    <ContributionBoundary v-if="isWelcome && !isSurfacePopout && welcome" class="fixed inset-0 z-[9999]"
      :pack-id="welcome.packId" :owner="`${welcome.packId}/welcome`" area="app extension"
      :current="() => fePacks.appExtensionBinding('welcome') === welcome">
      <component :is="welcome.component" />
    </ContributionBoundary>
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
