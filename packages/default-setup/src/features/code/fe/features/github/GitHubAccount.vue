<template>
  <div class="space-y-3">
    <div v-if="account" class="flex items-center justify-between">
      <div class="flex items-center gap-3">
        <img v-if="account.avatarUrl" :src="account.avatarUrl" alt="" class="w-8 h-8 rounded-full" />
        <div>
          <p class="text-sm font-medium text-neutral-200">Signed in as {{ account.login }}</p>
          <p class="text-xs text-neutral-600">
            Signing out forgets the sign-in here. It stays valid at GitHub until you revoke it under Settings → Applications.
          </p>
        </div>
      </div>
      <button
        class="px-3 py-1 text-xs text-neutral-200 bg-neutral-800 border border-neutral-600 rounded hover:bg-neutral-700"
        @click="send({ type: 'github.SIGN_OUT' })"
      >
        Sign out
      </button>
    </div>

    <div v-else-if="github.at === 'signingIn'" class="space-y-2">
      <template v-if="code">
        <p class="text-sm text-neutral-200">
          The code is copied, and
          <button class="text-blue-400 hover:text-blue-300" @click="openInBrowser(code.verificationUri)">{{ code.verificationUri }}</button>
          is open in your browser: paste it there and approve apack.
        </p>
        <div class="flex items-center gap-3">
          <code class="px-3 py-1 text-lg tracking-widest text-neutral-100 bg-neutral-800 rounded select-all">{{ code.userCode }}</code>
          <button class="text-xs text-blue-400 hover:text-blue-300" @click="copyCode(code.userCode)">{{ copied ? 'Copied' : 'Copy' }}</button>
        </div>
        <p class="text-xs text-neutral-600">Waiting for GitHub to say you approved it.</p>
      </template>
      <p v-else class="text-sm text-neutral-500">Asking GitHub for a code…</p>
      <button class="text-xs text-neutral-400 hover:text-neutral-200" @click="send({ type: 'github.CANCEL_SIGN_IN' })">Cancel</button>
    </div>

    <div v-else class="flex items-center justify-between">
      <div class="flex-1">
        <p class="text-sm font-medium text-neutral-200">GitHub</p>
        <p class="text-xs text-neutral-600">
          {{ account === undefined ? 'Reading the sign-in…' : 'Sign in to open and review pull requests, and to push to GitHub over HTTPS.' }}
        </p>
        <p v-if="github.data.failure" class="mt-1 text-xs text-red-400">{{ github.data.failure.message }}</p>
      </div>
      <button
        :disabled="account === undefined"
        class="px-3 py-1 text-xs text-white bg-blue-600 rounded hover:bg-blue-500 disabled:opacity-50"
        @click="send({ type: 'github.SIGN_IN' })"
      >
        Sign in to GitHub
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useState, useSurface } from '@apackdev/sdk/fe'
import type { CodeState } from '#features/code/fe/state.ts'
import { panelChild } from '../children.ts'

const surface: CodeState = useSurface()
const { state: github, send } = useState(panelChild(surface, 'github')!)

const account = computed(() => github.value.data.account)
const code = computed(() => github.value.data.code)

/** Whether the code shown now was copied: a new code is not, until it is */
const copied = ref(false)
watch(() => code.value?.userCode, () => { copied.value = false })
const copyCode = async (userCode: string) => {
  copied.value = await window.electronAPI?.clipboard.writeText(userCode) ?? false
}
// The system browser, where the user is signed in to GitHub, rather than a tab in the app
const openInBrowser = (url: string) => { void window.electronAPI?.shell.openExternal(url) }

onMounted(() => send({ type: 'github.GET_ACCOUNT' }))
</script>
