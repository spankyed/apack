<template>
  <!-- What can be done about a remote that asked for a sign-in git does not have -->
  <div class="text-xs text-neutral-300" data-testid="sign-in-help">
    <template v-if="help.kind === 'github'">
      <template v-if="account">
        <p>
          GitHub refused the app's sign-in as {{ account.login }} for this repository: it may need access the sign-in
          lacks, or an organisation's single sign-on. Sign out and in again in Settings → Code, then try again.
        </p>
        <button
          type="button"
          class="mt-1.5 px-2 py-1 rounded border border-neutral-600 text-neutral-200 hover:bg-neutral-800 disabled:opacity-50 transition-colors"
          data-testid="sign-in-try-again"
          :disabled="busy"
          @click="emit('sign-in', help.host)"
        >{{ busy ? 'Trying…' : 'Try again' }}</button>
      </template>
      <template v-else>
        <p class="mb-1.5">
          Git has no sign-in for {{ help.host }}. Signing in to GitHub gives it one, for this app's git alone: your
          git settings are not changed.
        </p>
        <GitHubAccount />
      </template>
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
import { watch } from 'vue'
import { useSelector } from '@xstate/vue'
import { useSurface } from '@apackdev/sdk/fe'
import type { SignInHelp } from '#features/code/be/types.ts'
import type { CodeState } from '#features/code/fe/state.ts'
import GitHubAccount from '../github/GitHubAccount.vue'
import { panelChild } from '../children.ts'

const props = defineProps<{ help: SignInHelp; busy: boolean }>()
const emit = defineEmits<{ 'sign-in': [host: string] }>()

const surface: CodeState = useSurface()
const github = panelChild(surface, 'github')!
const account = useSelector(github, (state) => state.context.account)

// Signing in here is git's sign-in too, so what was refused runs again as soon as there is one
watch(account, (now, before) => {
  if (now && !before && props.help.kind === 'github') emit('sign-in', props.help.host)
})
</script>
