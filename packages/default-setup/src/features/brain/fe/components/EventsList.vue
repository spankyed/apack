<template>
  <div class="h-full overflow-y-auto">
    <div
      v-for="event in displayEvents"
      :key="event.id"
      class="group relative cursor-pointer hover:bg-white/[0.03] transition-all duration-200"
      :class="{ 'opacity-40': pulsingEventType && !event.active }"
      @click="$emit('event-click', event.eventType)"
    >
      <!-- Pulse overlay -->
      <div 
        v-if="pulsingEventType === event.eventType"
        class="absolute inset-0 pointer-events-none"
      >
        <!-- Glow effect -->
        <div :class="['absolute inset-0 animate-glow bg-gradient-to-r from-transparent to-transparent', event.glowClass]" />
        <!-- Border highlight -->
        <div :class="['absolute inset-x-0 top-0 h-px animate-scan bg-gradient-to-r from-transparent to-transparent', event.scanClass]" />
      </div>

      <div class="relative px-5 py-2.5 border-b border-neutral-800/50">
        <div class="flex items-center justify-between gap-3">
          <div class="flex-1 min-w-0">
            <div class="text-sm font-medium text-neutral-100 mb-0.5 truncate transition-colors duration-300"
                :class="event.active ? event.activeTextClass : ''">
              {{ event.label }}
            </div>
            <div class="flex items-center gap-2 text-xs text-neutral-500">
              <span class="font-mono">{{ event.subtitle }}</span>
              <span class="text-neutral-600">•</span>
              <span class="capitalize">{{ event.kindLabel }}</span>
            </div>
          </div>
          <div class="relative flex items-center justify-center flex-shrink-0 w-5 h-5 transition-all duration-300 rounded"
            :class="event.iconBgClass">
            <!-- Ripple effect for active event -->
            <div v-if="pulsingEventType === event.eventType"
                :class="['absolute inset-0 rounded animate-ripple', event.rippleClass]" />
            <component
              :is="event.icon"
              class="relative z-10 w-3.5 h-3.5 transition-all duration-300"
              :class="event.iconClass"
            />
          </div>
        </div>
      </div>
    </div>
    
    <div v-if="events.length === 0" class="flex flex-col items-center justify-center h-48 px-4 text-center">
      <div class="flex items-center justify-center w-12 h-12 mb-3">
        <Radio class="w-6 h-6 text-neutral-500" />
      </div>
      <p class="text-sm text-neutral-400">No event listeners in this flow</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { EventListenerEntity } from '#generated/types.ts';
import { Radio } from 'lucide-vue-next';
import { cronToHuman } from '@apackdev/sdk/cron';
import { useNodeStyles } from '@apackdev/ui/components/node-styles';

const { getNodeConfig } = useNodeStyles();

interface Props {
  events: readonly EventListenerEntity[];
  pulsingEventType?: string;
}

const props = defineProps<Props>();

defineEmits<{
  'event-click': [eventType: string];
}>();

const COLOR_ANIMATIONS: Record<string, {
  glowClass: string; scanClass: string; rippleClass: string;
  activeTextClass: string; activeIconClass: string; idleIconClass: string;
  activeBgClass: string; idleBgClass: string;
}> = {
  blue: {
    glowClass: 'via-blue-500/10', scanClass: 'via-blue-400', rippleClass: 'bg-blue-400/30',
    activeTextClass: 'text-blue-200', activeIconClass: 'text-blue-300 animate-subtle-pulse',
    idleIconClass: 'text-blue-400', activeBgClass: 'bg-blue-500/30 scale-110',
    idleBgClass: 'bg-blue-500/10 group-hover:bg-blue-500/20',
  },
  cyan: {
    glowClass: 'via-cyan-500/10', scanClass: 'via-cyan-400', rippleClass: 'bg-cyan-400/30',
    activeTextClass: 'text-cyan-200', activeIconClass: 'text-cyan-300 animate-subtle-pulse',
    idleIconClass: 'text-cyan-400', activeBgClass: 'bg-cyan-500/30 scale-110',
    idleBgClass: 'bg-cyan-500/10 group-hover:bg-cyan-500/20',
  },
};

function getTriggerTheme(triggerType: string) {
  const config = getNodeConfig(triggerType);
  const colorKey = config?.colorKey || 'blue';
  return {
    ...(COLOR_ANIMATIONS[colorKey] || COLOR_ANIMATIONS.blue),
    icon: config?.icon || Radio,
  };
}

const displayEvents = computed(() =>
  props.events.map((event) => {
    const triggerType = event.triggerType || 'listener';
    const theme = getTriggerTheme(triggerType);
    const active = props.pulsingEventType === event.eventType;

    return {
      ...event,
      ...theme,
      active,
      subtitle: event.cronExpression
        ? cronToHuman(event.cronExpression)
        : event.eventType,
      kindLabel: triggerType === 'listener'
        ? event.scope
        : (getNodeConfig(triggerType)?.label || triggerType),
      iconClass: active ? theme.activeIconClass : theme.idleIconClass,
      iconBgClass: active ? theme.activeBgClass : theme.idleBgClass,
    };
  })
);
</script>

<style scoped>
@keyframes glow {
  0% {
    opacity: 0;
    transform: translateX(-100%);
  }
  50% {
    opacity: 1;
  }
  100% {
    opacity: 0;
    transform: translateX(100%);
  }
}

@keyframes scan {
  0% {
    transform: translateX(-100%);
  }
  100% {
    transform: translateX(100%);
  }
}

@keyframes ripple {
  0% {
    transform: scale(0.8);
    opacity: 1;
  }
  100% {
    transform: scale(1.8);
    opacity: 0;
  }
}

@keyframes subtle-pulse {
  0%, 100% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.1);
  }
}

.animate-glow {
  animation: glow 600ms ease-out;
}

.animate-scan {
  animation: scan 600ms ease-out;
}

.animate-ripple {
  animation: ripple 600ms ease-out;
}

.animate-subtle-pulse {
  animation: subtle-pulse 600ms ease-in-out;
}
</style> 
