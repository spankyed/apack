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
          :disabled="isPrLoading"
          class="p-0 transition-colors rounded text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800"
          title="Refresh PR changes"
        >
          <RefreshCw :size="16" :class="{ 'animate-spin': isPrLoading }" />
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
    <NoDirectoryState v-else-if="!baseDirectory" />

    <!-- Main content -->
    <template v-else>
      <!-- Not signed in to GitHub: the sign-in itself, here where it is needed -->
      <div
        v-if="githubAccess === 'signed-out' && !isPrLoading"
        class="px-3 py-3 text-xs border-b border-neutral-800"
      >
        <p class="mb-2 text-neutral-400">{{ githubAccessMessage }}</p>
        <GitHubAccount />
      </div>

      <!-- Signed in, but GitHub will not show this repository's pull requests to it, or the remote is elsewhere -->
      <div
        v-else-if="githubAccess && githubAccess !== 'ok' && !isPrLoading"
        class="flex items-start gap-2 px-3 py-2 text-xs text-yellow-400 bg-yellow-900/20 border-b border-yellow-800/30"
      >
        <AlertTriangle :size="12" class="shrink-0 mt-0.5" />
        <div class="flex-1">
          <span>{{ githubAccessMessage }}</span>
          <button
            v-if="githubAccess !== 'not-github'"
            @click="prActor?.send({ type: 'pr.NAVIGATE_TO_HELP' })"
            class="ml-1 underline text-yellow-300 hover:text-yellow-200 transition-colors"
          >Learn more</button>
        </div>
      </div>

      <!-- Top action row (always rendered to prevent layout shift, hidden in PR view) -->
      <div v-if="topRowStatus !== 'hidden'" class="flex items-center gap-1.5 px-4 py-2 border-b border-neutral-800 bg-neutral-800/50" :class="{ 'hidden': viewMode === 'pr' }">
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
            :openPRs="openPRs"
            :selectedPR="selectedPR"
            @select-pr="handleSelectPRFromDropdown"
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
      <template v-if="viewMode === 'pr'">
        <!-- Back to files bar -->
        <div
          @click="prActor?.send({ type: 'pr.SET_VIEW_MODE', mode: 'files' })"
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
          :title="createTitle"
          :body="createBody"
          :baseBranch="createBaseBranch"
          :defaultBaseBranch="prBaseBranch"
          :headBranch="currentBranch"
          :branches="availableBranches"
          :isCreating="isCreating"
          @update-field="handleUpdateField"
          @submit="handleSubmitCreate"
          @submit-draft="handleSubmitDraft"
        />

        <!-- Existing PR → info + action bar -->
        <template v-else>
          <PRInfo
            :pr="selectedPR"
            :comments="prComments"
            :branches="availableBranches"
            :isLoading="isLoadingDetails"
            :isUpdating="isUpdatingPR"
            :answered="lastWriteAnswer"
            @save="handleSavePR"
            @start-editing="commitActor?.send({ type: 'commit.GET_ALL_BRANCHES' })"
          >
            <PRComments
              :comments="prComments"
              :reviewThreads="reviewThreads"
              :tab="commentTab"
              :prNumber="selectedPR.number"
              :isOpen="selectedPR.state === 'OPEN'"
              :isSubmitting="isSubmittingComment"
              :answered="lastWriteAnswer"
              @set-tab="(tab) => prActor?.send({ type: 'pr.SET_COMMENT_TAB', tab })"
              @create-comment="(body) => prActor?.send({ type: 'pr.CREATE_COMMENT', number: selectedPR!.number, body })"
              @edit-comment="(id, body) => prActor?.send({ type: 'pr.EDIT_COMMENT', commentId: id, body })"
              @delete-comment="(id) => prActor?.send({ type: 'pr.DELETE_COMMENT', commentId: id })"
              @reply-thread="(prNum, commentId, body) => prActor?.send({ type: 'pr.REPLY_TO_THREAD', prNumber: prNum, commentId, body })"
              @resolve-thread="(id) => prActor?.send({ type: 'pr.RESOLVE_THREAD', threadId: id })"
              @unresolve-thread="(id) => prActor?.send({ type: 'pr.UNRESOLVE_THREAD', threadId: id })"
              @edit-review-comment="(id, body) => prActor?.send({ type: 'pr.EDIT_REVIEW_COMMENT', commentId: id, body })"
              @delete-review-comment="(id) => prActor?.send({ type: 'pr.DELETE_REVIEW_COMMENT', commentId: id })"
            />
          </PRInfo>
          <PRActionBar
            :pr="selectedPR"
            :isMerging="isMerging"
            :isClosing="isClosing"
            :isTogglingDraft="isTogglingDraft"
            :isDeletingBranch="isDeletingBranch"
            @merge="handleMerge"
            @close="handleClose"
            @toggle-draft="handleToggleDraft"
            @delete-branch="handleDeleteBranch"
            @checkout-base="prActor?.send({ type: 'pr.CHECKOUT_BASE' })"
          />
        </template>
      </template>

      <!-- Files view (diff tree) — default -->
      <PRComparison
        v-else
        :files="prFiles"
        :baseBranch="prBaseBranch"
        :currentBranch="displayBranch"
        :isLoading="isPrLoading"
        :baseDirectory="baseDirectory"
        @select-file="handleFileSelect"
        @open-file="handleOpenFile"
      />
        <!-- A diff that needs content this partial clone was not given: downloaded only when asked -->
        <div
          v-if="missingFileDiff"
          data-testid="pr-content-missing"
          class="flex items-center gap-2 px-3 py-1.5 text-xs text-amber-300 bg-amber-900/20 border-t border-amber-800/30 mt-auto"
        >
          <AlertCircle :size="12" class="shrink-0" />
          <span class="flex-1">This repository was cloned without every version of its files, and {{ missingFileDiff.path }} needs one it does not have.</span>
          <button
            data-testid="pr-fetch-missing"
            @click="prActor?.send({ type: 'pr.FETCH_MISSING_DIFF' })"
            class="px-2 py-0.5 rounded text-amber-200 hover:text-amber-100 hover:bg-amber-900/40 transition-colors shrink-0"
          >
            Download it
          </button>
        </div>
        <!-- Non-fatal error banner (dismissible, pinned to bottom) -->
        <div
          v-if="prError && !isNoGitRepoError && !isNoBaseBranchError"
          class="flex items-center gap-2 px-3 py-1.5 text-xs text-red-400 bg-red-900/20 border-t border-red-800/30 mt-auto"
        >
          <AlertCircle :size="12" class="shrink-0" />
          <span class="flex-1">{{ prError }}</span>
          <button
            @click="prActor?.send({ type: 'pr.CLEAR_ERROR' })"
            class="p-0.5 rounded text-red-500 hover:text-red-300 hover:bg-red-900/30 transition-colors shrink-0"
          >
            <X :size="12" />
          </button>
        </div>
      </template>
    </template>
  </div>
</template>

<script setup lang="ts">

import { computed, watch } from 'vue'
import { useSelector } from '@xstate/vue'
import { useSurface, useShell } from '@apackdev/sdk/fe'
import type { CodeState } from '#features/code/fe/state.ts'
import { refKey } from '#features/code/fe/features/pull-request/state.ts'
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
const codeActor: CodeState = useSurface()
const prActor = panelChild(codeActor, 'pr')!
const commitActor = panelChild(codeActor, 'commit')!

// State selectors
// The comparison this view is on, read from the slot keyed by it (`refKey`): an answer for any other PR
// lands in its own key and is never read here, which is what replaced a staleness guard
const prFiles = useSelector(prActor, (state) =>
  state.context.diffsByRef[refKey(state.context.prBaseBranch, state.context.selectedPR?.headRefName)] ?? [])
const prBaseBranch = useSelector(prActor, (state) => state.context.prBaseBranch)
const prError = useSelector(prActor, (state) => state.context.prError)
const missingFileDiff = useSelector(prActor, (state) => state.context.missingFileDiff)
const isPrLoading = useSelector(prActor, (state) => state.context.isPrLoading)
const baseDirectory = useSelector(codeActor, (state) => state.context.baseDirectory)
const openPRs = useSelector(prActor, (state) => state.context.openPRs)
const selectedPR = useSelector(prActor, (state) => state.context.selectedPR)
const prComments = useSelector(prActor, (state) => state.context.prComments)
const reviewThreads = useSelector(prActor, (state) => state.context.reviewThreads)
const commentTab = useSelector(prActor, (state) => state.context.commentTab)
const isSubmittingComment = useSelector(prActor, (state) => state.context.inflightMutations > 0)
const viewMode = useSelector(prActor, (state) => state.context.viewMode)
const githubAccess = useSelector(prActor, (state) => state.context.githubAccess)
const githubAccessMessage = useSelector(prActor, (state) => state.context.githubAccessMessage)
const isCheckingBranchPR = useSelector(prActor, (state) => state.context.isCheckingBranchPR)
// Signing in or out anywhere changes what this repository's pull requests answer, so ask again
const githubActor = panelChild(codeActor, 'github')!
const githubAccount = useSelector(githubActor, (state) => state.context.account)
watch(githubAccount, (now, before) => {
  if (before === undefined) return
  prActor?.send({ type: 'pr.CHECK_GITHUB_ACCESS' })
  prActor?.send({ type: 'pr.REFRESH_STATUS' })
})
const branchPRCheckFailed = useSelector(prActor, (state) => state.context.branchPRCheckFailed)
const createTitle = useSelector(prActor, (state) => state.context.createTitle)
const createBody = useSelector(prActor, (state) => state.context.createBody)
const createBaseBranch = useSelector(prActor, (state) => state.context.createBaseBranch)

const isCreating = useSelector(prActor, (state) => state.context.isCreating)
const isMerging = useSelector(prActor, (state) => state.context.isMerging)
const isClosing = useSelector(prActor, (state) => state.context.isClosing)
const isTogglingDraft = useSelector(prActor, (state) => state.context.isTogglingDraft)
const isDeletingBranch = useSelector(prActor, (state) => state.context.isDeletingBranch)
const isUpdatingPR = useSelector(prActor, (state) => state.context.isUpdatingPR)
const isLoadingDetails = useSelector(prActor, (state) => state.context.isLoadingDetails)
const lastWriteAnswer = useSelector(prActor, (state) => state.context.lastWriteAnswer)
const hasUpstream = useSelector(commitActor, (state) => state.context.hasUpstream)
const isPushing = useSelector(commitActor, (state) => state.context.isPushing)
const currentBranch = useSelector(commitActor, (state) => state.context.gitBranch)
const availableBranches = useSelector(commitActor, (state) => state.context.availableBranches)

// Computed
const isNoGitRepoError = computed(() =>
  prError.value?.includes('not a git repository') ||
  prError.value?.includes('Not a git repository')
)

const isNoBaseBranchError = computed(() =>
  prError.value?.includes('Could not determine PR base branch') ||
  prError.value?.includes('Could not determine base branch')
)

const displayBranch = computed(() =>
  selectedPR.value?.headRefName ?? currentBranch.value
)

const isViewingOtherPR = computed(() =>
  selectedPR.value && selectedPR.value.headRefName !== currentBranch.value
)

const isBaseBranch = computed(() => {
  const branch = currentBranch.value
  if (!branch) return false
  if (prBaseBranch.value && branch === prBaseBranch.value) return true
  return ['main', 'master', 'develop'].includes(branch)
})

const topRowStatus = computed(() => {
  if (isCheckingBranchPR.value) return 'checking' as const
  if (githubAccess.value !== 'ok') return 'hidden' as const
  if (isBaseBranch.value) return 'base-branch' as const
  if (!hasUpstream.value) return 'publish' as const
  if (selectedPR.value) return 'has-pr' as const
  if (branchPRCheckFailed.value) return 'check-failed' as const
  return 'no-pr' as const
})

// Actions
const refreshStatus = () => {
  prActor?.send({ type: 'pr.REFRESH_STATUS' })
}

const handleOpenFile = (file: TreeNode) => {
  if (file.type !== 'file' || !file.status) return
  shell.restoreChat()
  prActor?.send({
    type: 'pr.OPEN_FILE',
    file: { path: file.path, status: file.status, staged: false }
  })
}

const handleFileSelect = (file: TreeNode) => {
  if (file.type !== 'file' || !file.status) return
  shell.restoreChat()
  const gitFile: GitStatusFile = { path: file.path, status: file.status, staged: false }
  prActor?.send({ type: 'pr.SELECT_FILE', file: gitFile })
  prActor?.send({ type: 'pr.VIEW_DIFF', path: file.path })
}

const handleSelectPRFromDropdown = (number: number) => {
  prActor?.send({ type: 'pr.SELECT_PR_BY_NUMBER', number })
}

const handleCreatePR = () => {
  prActor?.send({ type: 'pr.NEW_PR' })
  // Ensure branches are loaded for the base branch select
  commitActor?.send({ type: 'commit.GET_ALL_BRANCHES' })
}

const handleRefreshPR = () => {
  if (selectedPR.value) {
    prActor?.send({ type: 'pr.REFRESH_PR', number: selectedPR.value.number })
  }
}

// The machine reads the discussion when the one it holds is another pull request's
const handleViewPRInfo = () => {
  prActor?.send({ type: 'pr.SET_VIEW_MODE', mode: 'pr' })
}

const handleBackToBranch = () => {
  prActor?.send({ type: 'pr.BACK_TO_BRANCH' })
}

const handleUpdateField = (field: string, value: any) => {
  prActor?.send({ type: 'pr.UPDATE_CREATE_FIELD', field, value })
}

const handleSubmitCreate = () => {
  prActor?.send({ type: 'pr.SUBMIT_CREATE' })
}

const handleSubmitDraft = () => {
  prActor?.send({ type: 'pr.SUBMIT_CREATE_DRAFT' })
}

const handlePublishBranch = () => {
  commitActor?.send({ type: 'commit.PUSH_BRANCH' })
}

const handleMerge = (method: 'merge' | 'squash' | 'rebase') => {
  prActor?.send({ type: 'pr.MERGE', method })
}

const handleClose = () => {
  prActor?.send({ type: 'pr.CLOSE' })
}

const handleToggleDraft = () => {
  prActor?.send({ type: 'pr.TOGGLE_DRAFT' })
}

const handleDeleteBranch = () => {
  prActor?.send({ type: 'pr.DELETE_BRANCH' })
}

const handleSavePR = (data: { title?: string; body?: string; base?: string }) => {
  if (selectedPR.value) {
    prActor?.send({ type: 'pr.UPDATE_PR', number: selectedPR.value.number, ...data })
  }
}
</script>
