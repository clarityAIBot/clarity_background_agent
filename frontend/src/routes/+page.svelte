<script lang="ts">
  import { browser } from "$app/environment";
  import Button from "$lib/components/ui/button.svelte";
  import Card from "$lib/components/ui/card.svelte";
  import Badge from "$lib/components/ui/badge.svelte";
  import TaskDetailView from "$lib/components/TaskDetailView.svelte";
  import SourceLink from "$lib/components/SourceLink.svelte";
  import Pagination from "$lib/components/ui/pagination.svelte";
  import HowItWorksModal from "$lib/components/HowItWorksModal.svelte";
  import LoadingSpinner from "$lib/components/ui/loading-spinner.svelte";
  import Footer from "$lib/components/ui/footer.svelte";
  import NavButton from "$lib/components/ui/nav-button.svelte";
  import UserMenu from "$lib/components/UserMenu.svelte";
  import { formatStatus } from "$lib/utils/cn";
  import {
    getAllStatus,
    getRequestHistory,
    getRequestDetail,
    type StatusResponse,
    type RequestHistoryItem,
    type RequestDetail,
    type PaginationInfo,
  } from "$lib/api";

  let status = $state<StatusResponse | null>(null);
  let historyItems = $state<RequestHistoryItem[]>([]);
  let pagination = $state<PaginationInfo | null>(null);
  let currentPage = $state(1);
  let lastUpdatedAt = $state<Date | null>(null);
  let loading = $state(false);
  let historyLoading = $state(false);
  let error = $state("");

  // Task detail view state
  let selectedTask = $state<RequestDetail | null>(null);
  let taskDetailLoading = $state(false);
  let taskDetailRefreshing = $state(false);
  let detailLastUpdatedAt = $state<Date | null>(null);

  // URL state management
  function getTaskIdFromUrl(): string | null {
    if (!browser) return null;
    const params = new URLSearchParams(window.location.search);
    return params.get("task");
  }

  function updateUrl(taskId: string | null) {
    if (!browser) return;
    const url = new URL(window.location.href);
    if (taskId) {
      url.searchParams.set("task", taskId);
    } else {
      url.searchParams.delete("task");
    }
    window.history.pushState({}, "", url.toString());
  }

  // Handle browser back/forward navigation
  function handlePopState() {
    const taskId = getTaskIdFromUrl();
    if (
      taskId &&
      (!selectedTask || selectedTask.request.requestId !== taskId)
    ) {
      loadTaskFromUrl(taskId);
    } else if (!taskId && selectedTask) {
      selectedTask = null;
    }
  }

  async function loadTaskFromUrl(taskId: string) {
    try {
      taskDetailLoading = true;
      selectedTask = await getRequestDetail(taskId);
      detailLastUpdatedAt = new Date();
    } catch (e) {
      console.error("[Clarity] Task detail load error from URL:", e);
      error = "Failed to load task details";
      // Clear invalid task ID from URL
      updateUrl(null);
    } finally {
      taskDetailLoading = false;
    }
  }

  // Initialize from URL on mount
  $effect(() => {
    if (browser) {
      window.addEventListener("popstate", handlePopState);

      // Load task from URL if present
      const taskId = getTaskIdFromUrl();
      if (taskId) {
        loadTaskFromUrl(taskId);
      }

      return () => {
        window.removeEventListener("popstate", handlePopState);
      };
    }
  });

  async function loadStatus() {
    console.log("[Clarity] loadStatus called");
    try {
      loading = true;
      error = "";
      status = await getAllStatus();
    } catch (e) {
      console.error("[Clarity] Status load error:", e);
      error = "Failed to load status";
    } finally {
      loading = false;
    }
  }

  async function loadHistory(page: number = 1, silent: boolean = false) {
    try {
      if (!silent) historyLoading = true;
      const result = await getRequestHistory(page, 20);
      historyItems = result.history;
      pagination = result.pagination;
      currentPage = page;
      lastUpdatedAt = new Date();
    } catch (e) {
      console.error("[Clarity] History load error:", e);
    } finally {
      if (!silent) historyLoading = false;
    }
  }

  function goToPage(page: number) {
    if (page < 1 || (pagination && page > pagination.totalPages)) return;
    loadHistory(page, false);
  }

  // Load data on mount (authentication is handled by layout)
  $effect(() => {
    if (browser) {
      loadStatus();
      loadHistory();
    }
  });

  // Polling for task list every 5 seconds when not viewing a specific task
  $effect(() => {
    if (!browser || selectedTask) {
      return;
    }

    const pollInterval = setInterval(() => {
      // Silent refresh - don't show loading indicator for polling
      loadHistory(currentPage, true);
    }, 5000);

    return () => {
      clearInterval(pollInterval);
    };
  });

  // Polling for task detail every 5 seconds when viewing a specific task
  $effect(() => {
    if (!browser || !selectedTask) {
      return;
    }

    const taskId = selectedTask.request.requestId;
    const pollInterval = setInterval(async () => {
      try {
        // Silent refresh of task detail
        const updated = await getRequestDetail(taskId);
        selectedTask = updated;
        detailLastUpdatedAt = new Date();
      } catch (e) {
        console.error("[Clarity] Task detail poll error:", e);
      }
    }, 5000);

    return () => {
      clearInterval(pollInterval);
    };
  });

  async function selectTask(requestId: string) {
    try {
      taskDetailLoading = true;
      selectedTask = await getRequestDetail(requestId);
      detailLastUpdatedAt = new Date();
      updateUrl(requestId);
    } catch (e) {
      console.error("[Clarity] Task detail load error:", e);
      error = "Failed to load task details";
    } finally {
      taskDetailLoading = false;
    }
  }

  async function refreshTaskDetail() {
    if (!selectedTask) return;
    try {
      taskDetailRefreshing = true;
      selectedTask = await getRequestDetail(selectedTask.request.requestId);
      detailLastUpdatedAt = new Date();
    } catch (e) {
      console.error("[Clarity] Task detail refresh error:", e);
      error = "Failed to refresh task details";
    } finally {
      taskDetailRefreshing = false;
    }
  }

  function closeTaskDetail() {
    selectedTask = null;
    updateUrl(null);
  }

  // How It Works modal state
  let showHowItWorks = $state(false);

  // Close modal on escape key
  function handleKeydown(event: KeyboardEvent) {
    if (event.key === "Escape" && showHowItWorks) {
      showHowItWorks = false;
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div
  class="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950"
>
  <div class="container mx-auto py-6 sm:py-8 lg:py-12 px-4 sm:px-6 lg:px-8">
    <!-- Header -->
    <div class="flex items-start justify-between mb-6 sm:mb-8 lg:mb-12">
      <!-- Left: Logo and Title -->
      <div>
        <div class="flex items-center gap-2 sm:gap-3 mb-1 sm:mb-2">
          <img
            src="/clarity_logo.svg"
            alt="Clarity AI Logo"
            class="w-8 h-8 sm:w-10 sm:h-10 lg:w-12 lg:h-12"
          />
          <h1
            class="text-2xl sm:text-3xl lg:text-4xl font-bold tracking-tight bg-gradient-to-r from-purple-600 via-violet-600 to-cyan-500 bg-clip-text text-transparent"
          >
            Clarity AI
          </h1>
        </div>
        <p class="text-muted-foreground text-sm sm:text-base">
          AI-powered development assistant
        </p>
      </div>

      <!-- Right: Navigation Buttons -->
      <div class="flex items-center gap-1 sm:gap-2">
        <NavButton onclick={() => showHowItWorks = true} icon="info" label="How It Works" hideLabel />
        <NavButton href="/settings" icon="settings" label="Settings" hideLabel />
        <UserMenu />
      </div>
    </div>

      <!-- Task History -->
      <Card class="p-4 sm:p-6">
          {#if taskDetailLoading}
            <!-- Loading state for task detail -->
            <LoadingSpinner />
          {:else if selectedTask}
            <!-- Task Detail View -->
            <TaskDetailView
              detail={selectedTask}
              onBack={closeTaskDetail}
              onRefresh={refreshTaskDetail}
              isRefreshing={taskDetailRefreshing}
            />
          {:else}
            <!-- Task List View -->
            <div
              class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-0 mb-4 sm:mb-6"
            >
              <h2 class="text-lg sm:text-xl font-semibold">Task History</h2>
              <div class="flex items-center gap-3">
                {#if lastUpdatedAt}
                  <span class="text-xs text-muted-foreground">
                    Updated {lastUpdatedAt.toLocaleTimeString()}
                  </span>
                {/if}
                <Button
                  variant="outline"
                  size="sm"
                  onclick={() => loadHistory(currentPage)}
                  disabled={historyLoading}
                >
                  {historyLoading ? "Refreshing..." : "Refresh"}
                </Button>
              </div>
            </div>

            {#if historyLoading && historyItems.length === 0}
              <LoadingSpinner />
            {:else if historyItems.length === 0}
              <div class="text-center py-12 text-muted-foreground">
                No tasks found. Create a new task via GitHub or Slack to see it
                here.
              </div>
            {:else}
              <!-- Mobile: Card Layout -->
              <div class="block lg:hidden space-y-3">
                {#each historyItems as item}
                  <div
                    class="p-4 rounded-lg border border-slate-800 hover:bg-slate-800/50 cursor-pointer transition-colors"
                    role="button"
                    tabindex="0"
                    onclick={() => selectTask(item.requestId)}
                    onkeydown={(e) => e.key === 'Enter' && selectTask(item.requestId)}
                  >
                    <div class="flex items-start justify-between gap-2 mb-2">
                      <div class="flex-1 min-w-0">
                        <div class="font-medium truncate">
                          {item.title || "Untitled Task"}
                        </div>
                        <div
                          class="text-xs text-muted-foreground font-mono mt-0.5"
                        >
                          {item.requestId.substring(0, 12)}...
                        </div>
                      </div>
                      <Badge
                        variant={item.status === "completed" ||
                        item.status === "pr_created"
                          ? "success"
                          : item.status === "error" ||
                              item.status === "cancelled"
                            ? "destructive"
                            : "secondary"}
                      >
                        {formatStatus(item.status)}
                      </Badge>
                    </div>
                    <div
                      class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"
                    >
                      {#if item.origin === "slack"}
                        <span class="text-purple-400">Slack</span>
                      {:else if item.origin === "github_issue" || item.origin === "github"}
                        <span class="text-slate-300">GitHub</span>
                      {:else if item.origin === "web"}
                        <span class="text-cyan-400">Web</span>
                      {/if}
                      <span>{item.repositoryName || "-"}</span>
                      {#if item.agentType}
                        <span
                          class="flex items-center gap-1 {item.agentType ===
                          'claude-code'
                            ? 'text-orange-400'
                            : 'text-cyan-400'}"
                        >
                          {#if item.agentType === "claude-code"}
                            <svg
                              class="w-3.5 h-3.5"
                              viewBox="0 0 24 24"
                              fill="currentColor"
                              ><path
                                d="m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z"
                              /></svg
                            >
                          {:else}
                            <svg
                              class="w-3.5 h-3.5"
                              viewBox="0 0 24 24"
                              fill="currentColor"
                              ><path
                                d="M8 10L10.5 12.5L8 15M13 10H16M13 12.5H16M13 15H16"
                                stroke="currentColor"
                                stroke-width="2"
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                fill="none"
                              /><rect
                                x="3"
                                y="3"
                                width="18"
                                height="18"
                                rx="3"
                                stroke="currentColor"
                                stroke-width="2"
                                fill="none"
                              /></svg
                            >
                          {/if}
                          {item.agentType === "claude-code"
                            ? "Claude Code"
                            : "OpenCode"}
                          {#if item.agentType === "opencode" && item.agentProvider}({item.agentProvider ===
                            "openai"
                              ? "OpenAI"
                              : item.agentProvider === "google"
                                ? "Google"
                                : item.agentProvider}){/if}
                        </span>
                      {/if}
                      <span
                        >{new Date(
                          item.updatedAt || item.createdAt,
                        ).toLocaleDateString()}</span
                      >
                    </div>
                  </div>
                {/each}
              </div>

              <!-- Desktop: Table Layout -->
              <div class="hidden lg:block overflow-x-auto">
                <table class="w-full text-sm text-left">
                  <thead
                    class="text-xs uppercase bg-slate-900/50 text-muted-foreground"
                  >
                    <tr>
                      <th scope="col" class="px-4 py-3">Task</th>
                      <th scope="col" class="px-4 py-3">Source</th>
                      <th scope="col" class="px-4 py-3">Status</th>
                      <th scope="col" class="px-4 py-3">Repo</th>
                      <th scope="col" class="px-4 py-3">Agent</th>
                      <th scope="col" class="px-4 py-3">Last Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {#each historyItems as item}
                      <tr
                        class="border-b border-slate-800 hover:bg-slate-800/50 cursor-pointer transition-colors"
                        tabindex="0"
                        onclick={() => selectTask(item.requestId)}
                        onkeydown={(e) => e.key === 'Enter' && selectTask(item.requestId)}
                      >
                        <td class="px-4 py-3 font-medium">
                          <div class="flex items-center gap-2">
                            <span class="max-w-md truncate"
                              >{item.title || "Untitled Task"}</span
                            >
                            <svg
                              class="w-4 h-4 text-muted-foreground flex-shrink-0"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                stroke-width="2"
                                d="M9 5l7 7-7 7"
                              />
                            </svg>
                          </div>
                          <div
                            class="text-xs text-muted-foreground font-mono mt-0.5"
                          >
                            {item.requestId.substring(0, 12)}...
                          </div>
                        </td>
                        <td class="px-4 py-3">
                          <SourceLink
                            origin={item.origin}
                            slackChannelId={item.slackChannelId}
                            slackThreadTs={item.slackThreadTs}
                            issueUrl={item.issueUrl}
                            onClick={(e) => e.stopPropagation()}
                          />
                        </td>
                        <td class="px-4 py-3">
                          <Badge
                            variant={item.status === "completed" ||
                            item.status === "pr_created"
                              ? "success"
                              : item.status === "error" ||
                                  item.status === "cancelled"
                                ? "destructive"
                                : "secondary"}
                          >
                            {formatStatus(item.status)}
                          </Badge>
                        </td>
                        <td class="px-4 py-3 text-muted-foreground"
                          >{item.repositoryName || "-"}</td
                        >
                        <td class="px-4 py-3">
                          {#if item.agentType}
                            <div class="flex flex-col">
                              <span
                                class="flex items-center gap-1.5 text-sm {item.agentType ===
                                'claude-code'
                                  ? 'text-orange-400'
                                  : 'text-cyan-400'}"
                              >
                                {#if item.agentType === "claude-code"}
                                  <svg
                                    class="w-4 h-4"
                                    viewBox="0 0 24 24"
                                    fill="currentColor"
                                    ><path
                                      d="m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z"
                                    /></svg
                                  >
                                {:else}
                                  <svg
                                    class="w-4 h-4"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    ><path
                                      d="M8 10L10.5 12.5L8 15M13 10H16M13 12.5H16M13 15H16"
                                      stroke="currentColor"
                                      stroke-width="2"
                                      stroke-linecap="round"
                                      stroke-linejoin="round"
                                    /><rect
                                      x="3"
                                      y="3"
                                      width="18"
                                      height="18"
                                      rx="3"
                                      stroke="currentColor"
                                      stroke-width="2"
                                    /></svg
                                  >
                                {/if}
                                {item.agentType === "claude-code"
                                  ? "Claude Code"
                                  : "OpenCode"}
                              </span>
                              {#if item.agentType === "opencode" && item.agentProvider}
                                <span
                                  class="text-xs text-muted-foreground ml-5"
                                >
                                  ({item.agentProvider === "openai"
                                    ? "OpenAI"
                                    : item.agentProvider === "google"
                                      ? "Google"
                                      : item.agentProvider === "groq"
                                        ? "Groq"
                                        : item.agentProvider === "deepseek"
                                          ? "DeepSeek"
                                          : item.agentProvider === "mistral"
                                            ? "Mistral"
                                            : item.agentProvider === "together"
                                              ? "Together AI"
                                              : item.agentProvider ===
                                                  "fireworks"
                                                ? "Fireworks"
                                                : item.agentProvider})
                                </span>
                              {/if}
                            </div>
                          {:else}
                            <span class="text-muted-foreground">-</span>
                          {/if}
                        </td>
                        <td class="px-4 py-3 text-muted-foreground">
                          {new Date(
                            item.updatedAt || item.createdAt,
                          ).toLocaleString()}
                        </td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>

              <!-- Pagination -->
              {#if pagination}
                <Pagination
                  {currentPage}
                  totalPages={pagination.totalPages}
                  totalItems={pagination.total}
                  pageSize={pagination.pageSize}
                  loading={historyLoading}
                  onPageChange={goToPage}
                />
              {/if}
            {/if}
          {/if}
        </Card>

    <!-- Footer -->
    <Footer />
  </div>
</div>

<!-- How It Works Modal -->
<HowItWorksModal open={showHowItWorks} onClose={() => showHowItWorks = false} />
