<template>
  <div class="absolute bottom-4 right-4 z-50 pointer-events-none">
    <TransitionGroup name="toast">
      <div
        v-for="notification in notifications"
        :key="notification.id"
        class="max-w-sm rounded-lg shadow-lg pointer-events-auto mb-2"
        :class="[
          notification.type === 'success' ? 'bg-green-900/90 border border-green-800' :
          notification.type === 'error' ? 'bg-red-900/90 border border-red-800' :
          'bg-blue-900/90 border border-blue-800'
        ]"
      >
        <div class="flex items-start gap-3 px-4 py-3">
          <component 
            :is="getIcon(notification.type)"
            class="w-5 h-5 flex-shrink-0 mt-0.5"
            :class="[
              notification.type === 'success' ? 'text-green-400' :
              notification.type === 'error' ? 'text-red-400' :
              'text-blue-400'
            ]"
          />
          <div class="flex-1">
            <p class="text-sm font-medium text-white">{{ notification.message }}</p>
            <p v-if="notification.description" class="mt-1 text-xs text-neutral-300">
              {{ notification.description }}
            </p>
          </div>
          <button
            @click="removeNotification(notification.id)"
            class="p-1 rounded hover:bg-white/10 transition-colors"
          >
            <X class="w-4 h-4 text-neutral-400" />
          </button>
        </div>
      </div>
    </TransitionGroup>
  </div>
</template>

<script setup lang="ts">
import { ref, markRaw } from 'vue';
import { CheckCircle, AlertCircle, Info, X } from 'lucide-vue-next';

export interface Toast {
  id: string;
  type: 'success' | 'error' | 'info';
  message: string;
  description?: string;
  duration?: number;
}

const notifications = ref<Toast[]>([]);

const getIcon = (type: Toast['type']) => {
  switch (type) {
    case 'success': return markRaw(CheckCircle);
    case 'error': return markRaw(AlertCircle);
    default: return markRaw(Info);
  }
};

// Counts the toasts shown, for a key each: several shown in one turn are still told apart
let shown = 0;

const removeNotification = (id: string) => {
  const index = notifications.value.findIndex(n => n.id === id);
  if (index > -1) {
    notifications.value.splice(index, 1);
  }
};

const show = (toast: Omit<Toast, 'id'>) => {
  const id = String(++shown);
  const notification: Toast = {
    id,
    duration: 4000,
    ...toast,
  };
  
  notifications.value.push(notification);
  
  if (notification.duration && notification.duration > 0) {
    setTimeout(() => {
      removeNotification(id);
    }, notification.duration);
  }
  
  return id;
};

// Expose methods for external use
defineExpose({
  show,
  success: (message: string, description?: string) => 
    show({ type: 'success', message, description }),
  error: (message: string, description?: string) => 
    show({ type: 'error', message, description }),
  info: (message: string, description?: string) => 
    show({ type: 'info', message, description }),
});
</script>

<style scoped>
.toast-enter-active,
.toast-leave-active {
  transition: all 0.3s ease;
}

.toast-enter-from {
  opacity: 0;
  transform: translateY(0.5rem);
}

.toast-leave-to {
  opacity: 0;
  transform: translateY(0.5rem);
}
</style>