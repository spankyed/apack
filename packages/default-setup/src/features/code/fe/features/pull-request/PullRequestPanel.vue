<template>
  <div class="flex flex-col h-full bg-neutral-900">
    <!-- Header -->
    <CodePanelHeader
      :icon="GitPullRequest"
      title="Pull Request"
    >
      <template #actions>
        <button
          @click="refreshStatus()"
          :disabled="pullRequest.data.isPrLoading"
          class="p-0 transition-colors rounded text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800"
          title="Refresh PR changes"
        >
          <RefreshCw :size="16" :class="{ 'animate-spin': pullRequest.data.isPrLoading }" />
        </button>
      </template>
    </CodePanelHeader>

    <!-- No git repository -->
    <EmptyState
      v-if="isNoGitRepoError"
      :icon="GitPullRequest"
      title="No Git Repository"
      subtitle="Open a folder with a git repository to create and view pull requests"
    />

    <!-- No directory -->
    <NoDirectoryState v-else-if="!code.data.baseDirectory" />

    <!-- Main content -->
    <template v-else>
      <!-- Not signed in to GitHub: the sign-in itself, here where it is needed -->
      <div
        v-if="pullRequest.data.githubAccess === 'signed-out' && !pullRequest.data.isPrLoading"
        class="px-3 py-3 text-xs border-b border-neutral-800"
      >
        <p class="mb-2 text-neutral-400">{{ pullRequest.data.githubAccessMessage }}</p>
        <GitHubAccount />
      </div>

      <!-- Signed in, but GitHub will not show this repository's pull requests to it, or the remote is elsewhere -->
      <div
        v-else-if="pullRequest.data.githubAccess && pullRequest.data.githubAccess !== 'ok' && !pullRequest.data.isPrLoading"
        class="flex items-start gap-2 px-3 py-2 text-xs text-yellow-400 bg-yellow-900/20 border-b border-yellow-800/30"
      >
        <AlertTriangle :size="12" class="shrink-0 mt-0.5" />
        <div class="flex-1">
          <span>{{ pullRequest.data.githubAccessMessage }}</span>
          <button
            v-if="pullRequest.data.githubAccess !== 'not-github'"
            @click="send({ type: 'pr.NAVIGATE_TO_HELP' })"
            class="ml-1 underline text-yellow-300 hover:text-yellow-200 transition-colors"
          >Learn more</button>
        </div>
      </div>

      <!-- Top action row (always rendered to prevent layout shift, hidden in PR view) -->
      <div v-if="topRowStatus !== 'hidden'" class="flex items-center gap-1.5 px-4 py-2 border-b border-neutral-800 bg-neutral-800/50" :class="{ 'hidden': pullRequest.data.viewMode === 'pr' }">
        <!-- Checking spinner (replaces selector while checking) -->
        <button
          v-if="topRowStatus === 'checking'"
          disabled
          class="flex items-center gap-1.5 pl-2 pr-2.5 py-1.5 text-xs rounded border border-neutral-700 bg-neutral-900 text-neutral-500 flex-1 min-w-0 cursor-default"
        >
          <Loader2 :size="12" class="animate-spin shrink-0" />
          <span class="truncate">Checking...</span>
        </button>

        <!-- Back button + PR Selector (mutually exclusive with checking spinner) -->
        <template v-else>
          <!-- Back to current branch (left of selector when viewing another PR) -->
          <button
            v-if="isViewingOtherPR"
            @click="handleBackToBranch()"
            class="px-2 h-7 rounded transition-colors text-neutral-500 hover:text-neutral-200 hover:bg-neutral-700/50 shrink-0"
            title="Back to current branch"
          >
            <ArrowLeft :size="13" />
          </button>

          <!-- PR Selector — always shown when not checking -->
          <PRSelector
            :list="pullRequest.data.prList"
            :reading="prListReading"
            :selectedPR="selectedPR"
            @select-pr="handleSelectPRFromDropdown"
            @shown="send({ type: 'pr.LIST_SHOWN' })"
            @set-state="(state) => send({ type: 'pr.SET_LIST_STATE', state })"
            @set-query="(query) => send({ type: 'pr.SET_LIST_QUERY', query })"
            @load-more="send({ type: 'pr.LOAD_MORE_PRS' })"
          />
        </template>

        <!-- Action buttons (compact, right side) — hide branch-specific buttons when viewing another PR -->
        <template v-if="!selectedPR">
          <button
            v-if="topRowStatus === 'publish'"
            @click="handlePublishBranch()"
            :disabled="isPushing"
            class="flex items-center justify-center gap-1 px-2 h-7 text-sm rounded bg-blue-600/80 text-white hover:bg-blue-500 transition-colors disabled:opacity-50 shrink-0"
          >
            <Loader2 v-if="isPushing" :size="12" class="animate-spin shrink-0" />
            <span>Publish</span>
          </button>
          <button
            v-else-if="topRowStatus === 'no-pr'"
            @click="handleCreatePR()"
            class="flex items-center justify-center px-2 h-7 text-sm rounded bg-green-600/80 text-white hover:bg-green-500 transition-colors shrink-0"
          >
            <span>Create PR</span>
          </button>
          <button
            v-else-if="topRowStatus === 'check-failed'"
            disabled
            class="flex items-center gap-1 px-2 h-7 text-sm rounded bg-neutral-700/50 text-neutral-500 shrink-0 cursor-default"
          >
            <AlertCircle :size="12" class="shrink-0" />
            <span>Error</span>
          </button>
        </template>
        <button
          v-if="selectedPR"
          @click="handleViewPRInfo()"
          class="px-2 h-7 text-sm rounded transition-colors text-neutral-500 hover:text-neutral-200 hover:bg-neutral-700/50 shrink-0"
          title="View PR details"
        >View</button>
      </div>

      <!-- Fatal error: no base branch -->
      <EmptyState
        v-if="isNoBaseBranchError"
        :icon="GitBranch"
        title="Cannot Determine Base Branch"
        subtitle="Unable to determine the base branch for comparison. Check that the repository has a default branch configured."
      />

      <template v-else>
      <!-- PR view (create form or info) -->
      <template v-if="pullRequest.data.viewMode === 'pr'">
        <!-- Back to files bar -->
        <div
          @click="send({ type: 'pr.SET_VIEW_MODE', mode: 'files' })"
          class="flex items-center px-3 border-b border-neutral-800 bg-neutral-800/50 cursor-pointer text-neutral-500 hover:text-neutral-300 transition-colors h-[42px]"
        >
          <div class="flex items-center gap-1.5 text-sm">
            <ArrowLeft :size="12" />
            Back to files
          </div>
          <button
            v-if="selectedPR"
            @click.stop="handleRefreshPR()"
            :disabled="isLoadingDetails"
            class="ml-auto p-0.5 rounded text-neutral-500 hover:text-neutral-200 hover:bg-neutral-700 transition-colors disabled:opacity-50"
            title="Refresh PR details"
          >
            <RefreshCw :size="12" :class="{ 'animate-spin': isLoadingDetails }" />
          </button>
        </div>

        <!-- No PR → create form -->
        <CreatePRForm
          v-if="!selectedPR"
          :title="pullRequest.data.createTitle"
          :body="pullRequest.data.createBody"
          :baseBranch="pullRequest.data.createBaseBranch"
          :defaultBaseBranch="pullRequest.data.prBaseBranch"
          :headBranch="git.data.gitBranch"
          :branches="git.data.availableBranches"
          :isCreating="pullRequest.data.isCreating"
          @update-field="handleUpdateField"
          @submit="handleSubmitCreate"
          @submit-draft="handleSubmitDraft"
        />

        <!-- Existing PR → info + action bar -->
        <template v-else>
          <PRInfo
            :pr="selectedPR"
            :comments="pullRequest.data.prComments"
            :branches="git.data.availableBranches"
            :isLoading="isLoadingDetails"
            :isUpdating="pullRequest.data.isUpdatingPR"
            :answered="pullRequest.data.lastWriteAnswer"
            @save="handleSavePR"
            @start-editing="sendCommit({ type: 'commit.GET_ALL_BRANCHES' })"
          >
            <PRComments
              :comments="pullRequest.data.prComments"
              :reviewThreads="pullRequest.data.reviewThreads"
              :tab="pullRequest.data.commentTab"
              :prNumber="selectedPR.number"
              :isOpen="selectedPR.state === 'OPEN'"
              :isSubmitting="isSubmittingComment"
              :answered="pullRequest.data.lastWriteAnswer"
              @set-tab="(tab) => send({ type: 'pr.SET_COMMENT_TAB', tab })"
              @create-comment="(body) => send({ type: 'pr.CREATE_COMMENT', number: selectedPR!.number, body })"
              @edit-comment="(id, body) => send({ type: 'pr.EDIT_COMMENT', commentId: id, body })"
              @delete-comment="(id) => send({ type: 'pr.DELETE_COMMENT', commentId: id })"
              @reply-thread="(prNum, commentId, body) => send({ type: 'pr.REPLY_TO_THREAD', prNumber: prNum, commentId, body })"
              @resolve-thread="(id) => send({ type: 'pr.RESOLVE_THREAD', threadId: id })"
              @unresolve-thread="(id) => send({ type: 'pr.UNRESOLVE_THREAD', threadId: id })"
              @edit-review-comment="(id, body) => send({ type: 'pr.EDIT_REVIEW_COMMENT', commentId: id, body })"
              @delete-review-comment="(id) => send({ type: 'pr.DELETE_REVIEW_COMMENT', commentId: id })"
            />
          </PRInfo>
          <PRActionBar
            :pr="selectedPR"
            :isMerging="pullRequest.data.isMerging"
            :isClosing="pullRequest.data.isClosing"
            :isTogglingDraft="pullRequest.data.isTogglingDraft"
            :isDeletingBranch="pullRequest.data.isDeletingBranch"
            :canDeleteBranch="branchDeletable(selectedPR)"
            :isCheckingOut="pullRequest.data.isCheckingOut"
            :isCheckedOut="isOnPRBranch"
            @checkout="send({ type: 'pr.CHECKOUT' })"
            @merge="handleMerge"
            @close="handleClose"
            @toggle-draft="handleToggleDraft"
            @delete-branch="handleDeleteBranch"
            @checkout-base="send({ type: 'pr.CHECKOUT_BASE' })"
          />
        </template>
      </template>

      <!-- Files view (diff tree) — default -->
      <PRComparison
        v-else
        :files="prFiles"
        :baseBranch="pullRequest.data.prBaseBranch"
        :currentBranch="displayBranch"
        :isLoading="pullRequest.data.isPrLoading"
        :baseDirectory="code.data.baseDirectory"
        @select-file="handleFileSelect"
        @open-file="handleOpenFile"
      />
        <!-- A diff that needs content this partial clone was not given: downloaded only when asked -->
        <div
          v-if="pullRequest.data.missingFileDiff"
          data-testid="pr-content-missing"
          class="flex items-center gap-2 px-3 py-1.5 text-xs text-amber-300 bg-amber-900/20 border-t border-amber-800/30 mt-auto"
        >
          <AlertCircle :size="12" class="shrink-0" />
          <span class="flex-1">This repository was cloned without every version of its files, and {{ pullRequest.data.missingFileDiff.path }} needs one it does not have.</span>
          <button
            data-testid="pr-fetch-missing"
            @click="send({ type: 'pr.FETCH_MISSING_DIFF' })"
            class="px-2 py-0.5 rounded text-amber-200 hover:text-amber-100 hover:bg-amber-900/40 transition-colors shrink-0"
          >
            Download it
          </button>
        </div>
        <!-- Non-fatal error banner (dismissible, pinned to bottom) -->
        <div
          v-if="pullRequest.data.prError && !isNoGitRepoError && !isNoBaseBranchError"
          class="flex items-center gap-2 px-3 py-1.5 text-xs text-red-400 bg-red-900/20 border-t border-red-800/30 mt-auto"
        >
          <AlertCircle :size="12" class="shrink-0" />
          <span class="flex-1">{{ pullRequest.data.prError }}</span>
          <button
            @click="send({ type: 'pr.CLEAR_ERROR' })"
            class="p-0.5 rounded text-red-500 hover:text-red-300 hover:bg-red-900/30 transition-colors shrink-0"
          >
            <X :size="12" />
          </button>
        </div>
      </template>
    </template>
    <ToastNotification ref="toast" />
  </div>
</template>

<script setup lang="ts">

import { computed, ref, watch } from 'vue'
import type { PRBranchCheckout } from '#generated/types.ts'
import ToastNotification from '@apackdev/ui/design/ToastNotification'
import { useState, useSurface, useShell } from '@apackdev/sdk/fe'
import type { CodeState } from '#features/code/fe/state.ts'
import { branchDeletable, refKey } from '#features/code/fe/features/pull-request/state.ts'
import {
  AlertCircle, AlertTriangle, GitBranch, GitPullRequest, RefreshCw,
  Loader2, ArrowLeft, X
} from 'lucide-vue-next'
import CodePanelHeader from '#features/code/fe/features/CodePanelHeader.vue'
import NoDirectoryState from '#features/code/fe/features/NoDirectoryState.vue'
import EmptyState from '#features/code/fe/features/EmptyState.vue'
import PRSelector from '#features/code/fe/features/pull-request/PRSelector.vue'
import PRComparison from '#features/code/fe/features/pull-request/PRComparison.vue'
import CreatePRForm from '#features/code/fe/features/pull-request/CreatePRForm.vue'
import PRInfo from '#features/code/fe/features/pull-request/PRInfo.vue'
import PRComments from '#features/code/fe/features/pull-request/PRComments.vue'
import PRActionBar from '#features/code/fe/features/pull-request/PRActionBar.vue'
import GitHubAccount from '#features/code/fe/features/github/GitHubAccount.vue'
import type { GitStatusFile } from '#features/code/fe/features/commit/state.ts'
import type { TreeNode } from './types.ts'
import { panelChild } from '../children.ts';

// Get actors
const shell = useShell()
const toast = ref<InstanceType<typeof ToastNotification>>()
const codeActor: CodeState = useSurface()
const prActor = panelChild(codeActor, 'pr')!
const commitActor = panelChild(codeActor, 'commit')!

const { state: code } = useState(codeActor)
const { state: pullRequest, send } = useState(prActor)
const { state: git, send: sendCommit } = useState(commitActor)

// The comparison this view is on, read from the slot keyed by it (`refKey`): an answer for any other PR
// lands in its own key and is never read here, which is what replaced a staleness guard
const prFiles = computed(() =>
  pullRequest.value.data.diffsByRef[refKey(pullRequest.value.data.prBaseBranch, pullRequest.value.data.selectedPR?.headRefName)] ?? [])
// Which page of the list is being read: its first, which starts it again, or the one after those read
const prListReading = computed(() => pullRequest.value.data.making.list ? 'first' : pullRequest.value.data.making.listMore ? 'more' : null)
const selectedPR = computed(() => pullRequest.value.data.selectedPR)
const isSubmittingComment = computed(() => pullRequest.value.data.inflightMutations > 0)
// Signing in or out anywhere changes what this repository's pull requests answer, so ask again
const { state: github } = useState(panelChild(codeActor, 'github')!)
watch(() => github.value.data.account, (now, before) => {
  if (before === undefined) return
  send({ type: 'pr.CHECK_GITHUB_ACCESS' })
  send({ type: 'pr.REFRESH_STATUS' })
})
const isLoadingDetails = computed(() => pullRequest.value.data.making.details)
const isPushing = computed(() => git.value.data.making.push)

// Computed
const isNoGitRepoError = computed(() =>
  pullRequest.value.data.prError?.includes('not a git repository') ||
  pullRequest.value.data.prError?.includes('Not a git repository')
)

const isNoBaseBranchError = computed(() =>
  pullRequest.value.data.prError?.includes('Could not determine PR base branch') ||
  pullRequest.value.data.prError?.includes('Could not determine base branch')
)

const displayBranch = computed(() =>
  selectedPR.value?.headRefName ?? git.value.data.gitBranch
)

/**
 * Whether what is checked out is the pull request shown: its branch, where its head is the checkout's remote's, and
 * the `pr/<number>` it is checked out as otherwise (`pr.CHECKOUT`)
 */
const isOnPRBranch = computed(() => {
  const pr = selectedPR.value
  if (!pr) return false
  return git.value.data.gitBranch === (pr.headInRemote === false ? `pr/${pr.number}` : pr.headRefName)
})

const isViewingOtherPR = computed(() => !!selectedPR.value && !isOnPRBranch.value)

/** What checking out a pull request did, said once it is done */
const CHECKOUT_SAID: Record<PRBranchCheckout, (branch: string) => string> = {
  'created': branch => `${branch} is checked out`,
  'current': branch => `${branch} is checked out, and was already at the pull request's head`,
  'fast-forwarded': branch => `${branch} is checked out, moved forward to the pull request's head`,
  'kept': branch => `${branch} is checked out as it was: it has commits the pull request does not, so it was not moved`,
}
watch(() => pullRequest.value.data.lastCheckout, (done) => {
  if (done) toast.value?.success(`Checked out #${done.number}`, CHECKOUT_SAID[done.checkout](done.branch))
})

const isBaseBranch = computed(() => {
  const branch = git.value.data.gitBranch
  if (!branch) return false
  if (pullRequest.value.data.prBaseBranch && branch === pullRequest.value.data.prBaseBranch) return true
  return ['main', 'master', 'develop'].includes(branch)
})

const topRowStatus = computed(() => {
  if (pullRequest.value.data.isCheckingBranchPR) return 'checking' as const
  if (pullRequest.value.data.githubAccess !== 'ok') return 'hidden' as const
  if (isBaseBranch.value) return 'base-branch' as const
  if (!git.value.data.hasUpstream) return 'publish' as const
  if (selectedPR.value) return 'has-pr' as const
  if (pullRequest.value.data.branchPRCheckFailed) return 'check-failed' as const
  return 'no-pr' as const
})

// Actions
const refreshStatus = () => {
  send({ type: 'pr.REFRESH_STATUS' })
}

const handleOpenFile = (file: TreeNode) => {
  if (file.type !== 'file' || !file.status) return
  shell.restoreChat()
  send({
    type: 'pr.OPEN_FILE',
    file: { path: file.path, status: file.status, staged: false }
  })
}

const handleFileSelect = (file: TreeNode) => {
  if (file.type !== 'file' || !file.status) return
  shell.restoreChat()
  const gitFile: GitStatusFile = { path: file.path, status: file.status, staged: false }
  send({ type: 'pr.SELECT_FILE', file: gitFile })
  send({ type: 'pr.VIEW_DIFF', path: file.path })
}

const handleSelectPRFromDropdown = (number: number) => {
  send({ type: 'pr.SELECT_PR_BY_NUMBER', number })
}

const handleCreatePR = () => {
  send({ type: 'pr.NEW_PR' })
  // Ensure branches are loaded for the base branch select
  sendCommit({ type: 'commit.GET_ALL_BRANCHES' })
}

const handleRefreshPR = () => {
  if (selectedPR.value) {
    send({ type: 'pr.REFRESH_PR', number: selectedPR.value.number })
  }
}

// The machine reads the discussion when the one it holds is another pull request's
const handleViewPRInfo = () => {
  send({ type: 'pr.SET_VIEW_MODE', mode: 'pr' })
}

const handleBackToBranch = () => {
  send({ type: 'pr.BACK_TO_BRANCH' })
}

const handleUpdateField = (field: string, value: any) => {
  send({ type: 'pr.UPDATE_CREATE_FIELD', field, value })
}

const handleSubmitCreate = () => {
  send({ type: 'pr.SUBMIT_CREATE' })
}

const handleSubmitDraft = () => {
  send({ type: 'pr.SUBMIT_CREATE_DRAFT' })
}

const handlePublishBranch = () => {
  sendCommit({ type: 'commit.PUSH_BRANCH' })
}

const handleMerge = (method: 'merge' | 'squash' | 'rebase') => {
  send({ type: 'pr.MERGE', method })
}

const handleClose = () => {
  send({ type: 'pr.CLOSE' })
}

const handleToggleDraft = () => {
  send({ type: 'pr.TOGGLE_DRAFT' })
}

const handleDeleteBranch = () => {
  send({ type: 'pr.DELETE_BRANCH' })
}

const handleSavePR = (data: { title?: string; body?: string; base?: string }) => {
  if (selectedPR.value) {
    send({ type: 'pr.UPDATE_PR', number: selectedPR.value.number, ...data })
  }
}
</script>
