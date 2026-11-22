<template>
  <div class="max-w-3xl">
    <!-- Header Section -->
    <div class="mb-6">
      <h2 class="text-xl font-semibold text-white mb-2">Secrets</h2>
      <p class="text-sm text-neutral-500">
        API keys for model providers. Add a key per account, and select the one each provider uses.
      </p>
    </div>

    <!-- How keys are protected -->
    <div v-if="settings.data.secretsStatus" class="mb-6 flex items-start gap-2 rounded-md border px-3 py-2 text-xs" :class="protectionClass" data-testid="secrets-protection">
      <ShieldCheck v-if="settings.data.secretsStatus.protection === 'os-keystore'" class="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
      <ShieldAlert v-else class="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
      <div class="flex-1">
        <template v-if="settings.data.secretsStatus.protection === 'os-keystore'">Keys are encrypted, with their key held by {{ settings.data.secretsStatus.backend }}.</template>
        <template v-else-if="settings.data.secretsStatus.protection === 'unprotected'">Keys are encrypted with a key kept in a file on this system, which anyone who can read your files can use.</template>
        <template v-else>
          {{ settings.data.secretsStatus.backend }} isn't available on this system, so keys can't be stored securely.
          <button class="ml-1 underline hover:text-white" data-testid="secrets-allow-unprotected" @click="allowUnprotected">Store keys unprotected</button>
        </template>
      </div>
    </div>

    <p v-if="error" class="mb-4 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300" data-testid="secrets-error">{{ error }}</p>

    <!-- Divider -->
    <div class="border-t border-neutral-800 my-8"></div>

    <!-- Model Providers -->
    <div class="space-y-6" data-onboarding-id="settings-secrets-section">
      <h3 class="text-sm font-medium text-gray-300 uppercase tracking-wider">Model Providers</h3>

      <div v-for="provider in standardProviders" :key="provider.key" class="space-y-2" :data-testid="`secrets-provider-${provider.key}`">
        <div class="flex items-center">
          <button
            @click="openLink(provider.url)"
            class="flex items-center gap-1 text-sm font-medium text-gray-200 hover:text-blue-400 transition-colors group"
            :title="`Open ${provider.label} API keys page`"
          >
            {{ provider.label }}
            <ExternalLink class="w-3 h-3 text-gray-400 group-hover:text-blue-400 transition-colors" />
          </button>
          <span v-if="provider.priority" class="ml-2 text-[11px] font-medium" :class="provider.priority === 'required' ? 'text-red-400/80' : 'text-amber-400/80'">
            {{ provider.priority }}
          </span>
          <span class="ml-2 text-xs text-gray-500">{{ provider.description }}</span>
        </div>

        <SecretKeyRow
          v-for="secret in keysFor(provider.key)"
          :key="secret.id"
          :secret="secret"
          :selectable="true"
          :rename="(label) => run(() => secretsClient.rename(secret.id, label))"
          :replace="(value) => run(() => secretsClient.replaceValue(secret.id, value))"
          :select="() => run(() => secretsClient.select(secret.id))"
          @delete="confirmDelete(secret)"
        />

        <p v-if="keysFor(provider.key).length > 0 && !keysFor(provider.key).some((secret) => secret.selected)" class="text-xs text-amber-400/80">
          No key selected: {{ provider.label }} calls fail until you select one.
        </p>

        <NewSecretRow
          :data-onboarding-id="`settings-${provider.key}-key-input`"
          :name-placeholder="keysFor(provider.key).length === 0 ? provider.label : 'Label, e.g. Work'"
          :default-name="keysFor(provider.key).length === 0 ? provider.label : ''"
          :value-placeholder="`Enter ${provider.label} API key`"
          :collapsed="keysFor(provider.key).length > 0"
          add-text="Add another key"
          :save="(label, value) => add(provider.key, label, value)"
        />
      </div>
    </div>

    <!-- Divider -->
    <div class="border-t border-neutral-800 my-8"></div>

    <!-- Custom keys -->
    <div class="space-y-2">
      <h3 class="text-sm font-medium text-gray-300 uppercase tracking-wider">Custom Keys</h3>
      <SecretKeyRow
        v-for="secret in keysFor('custom')"
        :key="secret.id"
        :secret="secret"
        :selectable="false"
        :rename="(label) => run(() => secretsClient.rename(secret.id, label))"
        :replace="(value) => run(() => secretsClient.replaceValue(secret.id, value))"
        @delete="confirmDelete(secret)"
      />
      <NewSecretRow
        name-placeholder="Name"
        value-placeholder="Enter key"
        :collapsed="true"
        add-text="Add custom key"
        :save="(label, value) => add('custom', label, value)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { ExternalLink, ShieldAlert, ShieldCheck } from 'lucide-vue-next'
import { openLink, secretsClient, useState, useSurface } from '@apackdev/sdk/fe'
import { providerLabels } from '@apackdev/sdk/models'
import type { SecretMetadata, SecretProvider } from '@apackdev/sdk/services'
import { API_KEY_URLS, REQUIRED_PROVIDERS } from '@/views/settings/constants'
import SecretKeyRow from './SecretKeyRow.vue'
import NewSecretRow from './NewSecretRow.vue'
import { errorMessage } from '@apackdev/sdk/utils/pure';
import type { SettingsState } from '@apackdev/host/fe'

const settingsActor: SettingsState = useSurface()
const { state: settings } = useState(settingsActor)
const error = ref<string | null>(null)

const descriptions: Record<keyof typeof providerLabels, string> = {
  anthropic: 'Claude',
  openai: 'GPT',
  google: 'Gemini',
  groq: 'Fast inference API',
  mistral: 'Mistral models',
  cohere: 'Command, Embed, Rerank',
}

const standardProviders = (Object.keys(providerLabels) as Array<keyof typeof providerLabels>).map((key) => ({
  key,
  label: providerLabels[key],
  description: descriptions[key],
  url: API_KEY_URLS[key],
  priority: (REQUIRED_PROVIDERS as readonly string[]).includes(key) ? 'required' : key === 'google' ? 'recommended' : undefined,
}))

const keysFor = (provider: SecretProvider) => (settings.value.data.secrets ?? []).filter((secret) => secret.provider === provider)

const protectionClass = computed(() => settings.value.data.secretsStatus?.protection === 'os-keystore'
  ? 'border-emerald-500/20 bg-emerald-500/5 text-emerald-300/90'
  : 'border-amber-500/30 bg-amber-500/10 text-amber-200')

/** Runs a secrets procedure, resolving whether it succeeded; the settings system sends the updated list, so only errors are kept here */
async function run(call: () => Promise<unknown>): Promise<boolean> {
  error.value = null
  try {
    await call()
    return true
  } catch (err) {
    error.value = errorMessage(err)
    return false
  }
}

const add = (provider: SecretProvider, label: string, value: string) =>
  run(() => secretsClient.add(provider, label, value))

const allowUnprotected = () => run(() => secretsClient.allowUnprotected())

function confirmDelete(secret: SecretMetadata) {
  if (confirm(`Delete the key "${secret.label}"?`)) run(() => secretsClient.delete(secret.id))
}
</script>
