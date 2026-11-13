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

    <div v-else-if="signIn" class="space-y-2">
      <template v-if="signIn.code">
        <p class="text-sm text-neutral-200">
          Enter this code at
          <button class="text-blue-400 hover:text-blue-300" @click="openLink(signIn.code.verificationUri)">{{ signIn.code.verificationUri }}</button>
        </p>
        <div class="flex items-center gap-3">
          <code class="px-3 py-1 text-lg tracking-widest text-neutral-100 bg-neutral-800 rounded select-all">{{ signIn.code.userCode }}</code>
          <button class="text-xs text-blue-400 hover:text-blue-300" @click="copyCode(signIn.code.userCode)">{{ copied ? 'Copied' : 'Copy' }}</button>
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
        <p v-if="failure" class="mt-1 text-xs text-red-400">{{ failure.message }}</p>
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
import { onMounted, ref } from 'vue'
import { useSelector } from '@xstate/vue'
import { openLink, useSurface } from '@apackdev/sdk/fe'
import type { CodeState } from '#features/code/fe/state.ts'
import { panelChild, type PanelChild } from '../children.ts'

const surface: CodeState = useSurface()
const github = panelChild(surface, 'github')!
const send = (event: Parameters<PanelChild<'github'>['send']>[0]) => github.send(event)

const account = useSelector(github, (state) => state.context.account)
const signIn = useSelector(github, (state) => state.context.signIn)
const failure = useSelector(github, (state) => state.context.failure)

const copied = ref(false)
const copyCode = async (code: string) => {
  await navigator.clipboard.writeText(code)
  copied.value = true
}

onMounted(() => send({ type: 'github.GET_ACCOUNT' }))
</script>
