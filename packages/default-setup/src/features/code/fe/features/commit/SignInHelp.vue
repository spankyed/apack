<template>
  <!-- What can be done about a remote that asked for a sign-in git does not have -->
  <div class="text-xs text-neutral-300" data-testid="sign-in-help">
    <template v-if="help.kind === 'github-cli'">
      <p>
        Git has no sign-in for {{ help.host }}. The GitHub CLI can give it one: this runs
        <code class="text-neutral-200">gh auth setup-git</code>, which makes the CLI git's credential helper for {{ help.host }}.
      </p>
      <button
        type="button"
        class="mt-1.5 px-2 py-1 rounded border border-neutral-600 text-neutral-200 hover:bg-neutral-800 disabled:opacity-50 transition-colors"
        data-testid="sign-in-with-github-cli"
        :disabled="busy"
        @click="emit('sign-in', help.host)"
      >{{ busy ? 'Signing in…' : 'Sign in with GitHub CLI' }}</button>
    </template>
    <p v-else-if="help.kind === 'ssh'">
      {{ help.host }} refused the SSH key it was offered, or was offered none. Add your key to the SSH agent
      (<code class="text-neutral-200">ssh-add</code>), then try again.
    </p>
    <p v-else>
      Git has no saved username and password for {{ help.host }}. Sign in to it once from a terminal, with a
      credential helper that keeps what you enter, then try again.
    </p>
  </div>
</template>

<script setup lang="ts">
import type { SignInHelp } from '#features/code/be/types.ts'

defineProps<{ help: SignInHelp; busy: boolean }>()
const emit = defineEmits<{ 'sign-in': [host: string] }>()
</script>
