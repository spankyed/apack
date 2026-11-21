<template>
  <div class="max-w-2xl">
    <div class="rounded-md bg-neutral-850 animate-fade-in">
      <!-- Header with integrated buttons -->
      <div class="flex items-center justify-between px-3 py-2">
        <div class="flex items-center gap-2">
          <ListTodo :size="14" class="text-neutral-500" />
          <h3 class="text-sm font-medium text-neutral-200">
            {{ artifact.title || 'Proposed Tasks' }}
            <span class="ml-1 text-xs font-normal text-neutral-500">({{ tasks.length }})</span>
          </h3>
        </div>
        <div v-if="status === 'pending'" class="flex gap-2">
          <button
            @click="handleReject"
            class="px-3 py-1 text-xs font-medium text-red-400 transition-colors border rounded bg-red-500/10 border-red-500/20 hover:bg-red-500/15"
          >
            Reject
          </button>
          <button
            @click="handleApprove"
            class="px-3 py-1 text-xs font-medium text-green-400 transition-colors border rounded bg-green-500/10 border-green-500/20 hover:bg-green-500/15"
          >
            Approve
          </button>
        </div>
        <span
          v-else-if="status === 'approved' || status === 'rejected'"
          :class="[
            'text-xs px-2 py-0.5 rounded',
            status === 'approved' 
              ? 'bg-green-500/10 text-green-400' 
              : 'bg-red-500/10 text-red-400'
          ]"
        >
          {{ status === 'approved' ? 'Approved' : 'Rejected' }}
        </span>
      </div>
      
      <!-- Todo Tasks -->
      <div class="space-y-0">
        <div 
          v-for="task in tasks" 
          :key="task.id"
          :class="[
            'flex items-center gap-3 px-3 py-2.5 border-t border-neutral-700/30 transition-colors',
            task.completed 
              ? 'bg-neutral-900/20' 
              : 'hover:bg-neutral-900/30'
          ]"
        >
          <!-- Checkbox -->
          <div class="relative flex items-center justify-center">
            <input
              type="checkbox"
              :checked="task.completed"
              disabled
              :class="[
                'w-4 h-4 rounded   transition-all cursor-not-allowed',
                task.completed 
                  ? 'bg-blue-500/20 border-blue-500/40'
                  : 'bg-neutral-800 border-neutral-700'
              ]"
            />
            <Check 
              v-if="task.completed"
              :size="10" 
              class="absolute text-blue-400 pointer-events-none"
            />
          </div>
          
          <!-- Task Content -->
          <div class="flex-1 min-w-0">
            <input
              v-if="isEditable"
              v-model="task.description"
              type="text"
              class="w-full px-2 py-1 text-sm transition-colors bg-transparent rounded text-neutral-100 focus:outline-none focus:bg-neutral-900/50"
              placeholder="Enter task description..."
              @input="updateTaskDescription(task.id, $event)"
            />
            <p 
              v-else
              :class="[
                'text-sm',
                task.completed 
                  ? 'text-neutral-500 line-through' 
                  : 'text-neutral-300'
              ]"
            >
              {{ task.description }}
            </p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { tell } from '#generated/events.ts'
import { useSurfaceState } from '#generated/fe.ts'
import { ref, computed, watch } from 'vue';
import { ListTodo, Check } from 'lucide-vue-next';
import type { ArtifactItem } from '@apackdev/sdk/artifacts';

interface TodoTask {
  id: string;
  description: string;
  completed: boolean;
}

interface TodoContent {
  tasks: TodoTask[];
  status: 'pending' | 'active' | 'approved' | 'rejected';
}

const props = defineProps<{
  artifact: ArtifactItem<Partial<TodoContent>>;
}>();

const currentThread = useSurfaceState('threads', (s) => s.currentThread);

/**
 * The decision is the artifact's, read from it rather than kept here.
 *
 * It used to be a local `ref` this set as the button was clicked, which read as working and was not: the
 * artifact never changed, so the same list open elsewhere stayed pending and a remount dropped the
 * decision. Whatever acts on `user.todo.*` records the outcome on the artifact, and this shows it.
 */
const status = computed(() => props.artifact.content?.status ?? 'pending');

/** The tasks, which the user may reword while the list is pending — local until a decision sends them */
const tasks = ref<TodoTask[]>(props.artifact.content?.tasks ?? []);

watch(() => props.artifact.content?.tasks, (next) => {
  if (next) tasks.value = next;
}, { deep: true });

const isEditable = computed(() => status.value === 'pending');

function updateTaskDescription(taskId: string, event: Event) {
  const target = event.target as HTMLInputElement;
  const task = tasks.value.find(t => t.id === taskId);
  if (task) {
    task.description = target.value;
  }
}

/**
 * A decision is raised as a brain event, which is how an artifact asks for something to happen: the
 * threads system forwards any `eventType` to the brain (`FORWARD_BRAIN_EVENT`) and a flow listens. The
 * session artifacts do the same for a permission mode and a cleared goal.
 *
 * That generic route is the point of an artifact being an extension: nothing about todo lists belongs in
 * the threads feature, which is where three events and three handlers for them used to sit.
 */
function decide(eventType: 'user.todo.approved' | 'user.todo.rejected', payload: Record<string, unknown>) {
  const threadId = currentThread.value?.id;
  if (!threadId) {
    console.warn('[todo-artifact] no current thread; cannot raise the decision');
    return;
  }
  tell('threads', {
    type: 'FORWARD_BRAIN_EVENT',
    eventType,
    payload: { threadId, artifactId: props.artifact.id, ...payload },
  });
}

function handleApprove() {
  decide('user.todo.approved', { tasks: tasks.value });
}

function handleReject() {
  decide('user.todo.rejected', {});
}
</script>

<style scoped>
/* Custom checkbox styling */
input[type="checkbox"]:disabled {
  appearance: none;
  -webkit-appearance: none;
  -moz-appearance: none;
}

/* Smooth animations */
.animate-fade-in {
  animation: fadeIn 0.2s ease-out;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>