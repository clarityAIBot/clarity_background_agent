<script lang="ts">
  import { browser } from "$app/environment";
  import Badge from "$lib/components/ui/badge.svelte";
  import Button from "$lib/components/ui/button.svelte";
  import SourceLink from "$lib/components/SourceLink.svelte";
  import { formatStatus } from "$lib/utils/cn";
  import { getHandoverUrl, type HandoverUrlResponse, type RequestDetail } from "$lib/api";
  import {
    SessionView,
    MessageTimeline,
    formatDuration,
    formatCost,
    formatThreadForLLM,
  } from "./task-detail";

  interface Props {
    detail: RequestDetail;
    onBack: () => void;
    onRefresh?: () => void;
    isRefreshing?: boolean;
  }

  let { detail, onBack, onRefresh, isRefreshing = false }: Props = $props();

  // Track when detail was last updated (reactive to detail changes)
  let lastUpdatedAt = $state<Date>(new Date());

  // View mode toggle: 'messages' or 'session'
  type ViewMode = "messages" | "session";
  let viewMode = $state<ViewMode>("messages");

  // Reference to SessionView component
  let sessionViewRef:
    | { loadSessionData: () => Promise<void>; reset: () => void }
    | undefined = $state();

  // Switch view mode
  function switchViewMode(mode: ViewMode) {
    viewMode = mode;
    // Note: SessionView auto-loads via $effect when mounted, no need to manually call
  }

  // Track current request ID to prevent unnecessary view resets
  let currentRequestId = $state<string | null>(null);

  // Update timestamp whenever detail changes
  $effect(() => {
    if (detail) {
      lastUpdatedAt = new Date();

      // Only reset view if switching to a different request
      if (detail.request.requestId !== currentRequestId) {
        currentRequestId = detail.request.requestId;
        viewMode = "messages";
        // Reset session view when detail changes
        if (sessionViewRef) {
          sessionViewRef.reset();
        }
      }
    }
  });

  // Copy thread state
  let threadCopied = $state(false);
  let showCurlPopover = $state(false);
  let curlLoading = $state(false);
  let handoverData = $state<HandoverUrlResponse | null>(null);
  let copiedField = $state<string | null>(null);

  async function copyThread() {
    if (!browser) return;
    try {
      const formattedThread = formatThreadForLLM(detail);
      await navigator.clipboard.writeText(formattedThread);
      threadCopied = true;
      setTimeout(() => (threadCopied = false), 2000);
    } catch {
      console.error("Failed to copy thread");
    }
  }

  async function openCurlPopover() {
    showCurlPopover = !showCurlPopover;
    if (!showCurlPopover || handoverData) return;

    curlLoading = true;
    try {
      handoverData = await getHandoverUrl(detail.request.requestId);
    } catch {
      handoverData = null;
    } finally {
      curlLoading = false;
    }
  }

  function getMarkdownCurl(): string {
    if (!handoverData) return "";
    return `command -v claude >/dev/null || { echo "Error: Claude Code CLI not installed. Install from https://claude.ai/code"; exit 1; } && curl -sL "${handoverData.url}" -o task-handover.md && claude "$(cat task-handover.md)"`;
  }

  function getSessionCurl(): string {
    if (!handoverData?.sessionUrl || !handoverData.sessionId) return "";
    const repoName = detail.request.repo?.split("/").pop() || "";
    const sid = handoverData.sessionId;
    // Find Claude projects dir matching repo name, fall back to pwd-based path
    return `command -v claude >/dev/null || { echo "Error: Claude Code CLI not installed. Install from https://claude.ai/code"; exit 1; }; DIR=$(find ~/.claude/projects -maxdepth 1 -type d -name "*-${repoName}" 2>/dev/null | head -1); DIR=\${DIR:-~/.claude/projects/$(pwd | tr '/.' '-')}; mkdir -p "$DIR" && curl -sL "${handoverData.sessionUrl}" -o "$DIR/${sid}.jsonl" && claude --resume ${sid}`;
  }

  async function copyToClip(text: string, field: string) {
    if (!browser) return;
    try {
      await navigator.clipboard.writeText(text);
      copiedField = field;
      setTimeout(() => (copiedField = null), 2000);
    } catch {
      console.error("Failed to copy");
    }
  }

  // Reset signed URL only when switching to a different task
  let handoverRequestId = $state<string | null>(null);
  $effect(() => {
    const rid = detail.request.requestId;
    if (rid !== handoverRequestId) {
      handoverRequestId = rid;
      handoverData = null;
      showCurlPopover = false;
    }
  });
</script>

<div class="space-y-4 sm:space-y-6">
  <!-- Header with back button -->
  <div class="space-y-3">
    <!-- Top row: Back button and action buttons -->
    <div class="flex items-center justify-between gap-2">
      <Button variant="ghost" size="sm" onclick={onBack}>
        <svg
          class="w-4 h-4 mr-1"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M15 19l-7-7 7-7"
          />
        </svg>
        Back
      </Button>
      <div class="flex items-center gap-1 sm:gap-2">
        {#if onRefresh}
          <button
            onclick={onRefresh}
            disabled={isRefreshing}
            class="flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1 sm:py-1.5 text-xs sm:text-sm rounded-md bg-slate-800 hover:bg-slate-700 transition-colors text-slate-300 disabled:opacity-50 disabled:cursor-not-allowed"
            title="Refresh task details"
          >
            <svg
              class="w-3.5 h-3.5 sm:w-4 sm:h-4 {isRefreshing
                ? 'animate-spin'
                : ''}"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
            <span class="hidden sm:inline"
              >{isRefreshing ? "Refreshing..." : "Refresh"}</span
            >
          </button>
        {/if}
        <button
          onclick={copyThread}
          class="flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1 sm:py-1.5 text-xs sm:text-sm rounded-md bg-slate-800 hover:bg-slate-700 transition-colors text-slate-300"
          title="Copy thread as LLM-friendly prompt for handover"
        >
          {#if threadCopied}
            <svg
              class="w-3.5 h-3.5 sm:w-4 sm:h-4 text-green-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M5 13l4 4L19 7"
              />
            </svg>
            <span class="text-green-400 hidden sm:inline">Copied!</span>
          {:else}
            <svg
              class="w-3.5 h-3.5 sm:w-4 sm:h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
              />
            </svg>
            <span class="hidden sm:inline">Copy Thread</span>
          {/if}
        </button>
        <!-- Run Locally button with curl popover -->
        <div class="relative">
          <button
            onclick={openCurlPopover}
            class="flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1 sm:py-1.5 text-xs sm:text-sm rounded-md bg-slate-800 hover:bg-slate-700 transition-colors text-slate-300"
            title="Get curl command to run this task locally with Claude Code"
          >
            <svg class="w-3.5 h-3.5 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <span class="hidden sm:inline">Run Locally</span>
          </button>
          {#if showCurlPopover}
            <!-- Backdrop to close popover -->
            <button
              class="fixed inset-0 z-40"
              onclick={() => { showCurlPopover = false; }}
              aria-label="Close"
            ></button>
            <div class="absolute right-0 top-full mt-2 z-50 w-[480px] bg-slate-900 border border-slate-700 rounded-lg shadow-xl p-4 space-y-4">
              {#if curlLoading}
                <div class="bg-black/50 p-3 rounded-lg text-xs text-muted-foreground animate-pulse">Generating signed URLs...</div>
              {:else if !handoverData}
                <div class="text-xs text-red-400">Failed to generate signed URLs. Close and try again.</div>
              {:else}
                <!-- Option 1: Session Resume (preferred, shown first if available) -->
                {#if handoverData.hasSession && handoverData.sessionUrl}
                  <div>
                    <p class="text-sm text-slate-300 mb-1.5 font-medium flex items-center gap-1.5">
                      <svg class="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                      Resume Session
                    </p>
                    <p class="text-xs text-muted-foreground mb-2">Downloads the full agent session and resumes it with <code class="text-cyan-400">claude --resume</code>. Includes all context and tool history.</p>
                    <div class="relative">
                      <pre class="bg-black/50 p-3 rounded-lg font-mono text-xs text-cyan-400 overflow-x-auto whitespace-pre-wrap break-all">{getSessionCurl()}</pre>
                      <button
                        onclick={() => copyToClip(getSessionCurl(), 'session')}
                        class="absolute top-1.5 right-1.5 px-2 py-1 text-xs rounded bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors"
                      >
                        {copiedField === 'session' ? "Copied!" : "Copy"}
                      </button>
                    </div>
                  </div>
                  <div class="border-t border-slate-700/50"></div>
                {/if}

                <!-- Option 2: Markdown Handover -->
                <div>
                  <p class="text-sm text-slate-300 mb-1.5 font-medium flex items-center gap-1.5">
                    <svg class="w-4 h-4 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                    Context Handover
                  </p>
                  <p class="text-xs text-muted-foreground mb-2">Downloads a markdown summary and starts a new Claude session with full task context.</p>
                  <div class="relative">
                    <pre class="bg-black/50 p-3 rounded-lg font-mono text-xs text-cyan-400 overflow-x-auto whitespace-pre-wrap break-all">{getMarkdownCurl()}</pre>
                    <button
                      onclick={() => copyToClip(getMarkdownCurl(), 'markdown')}
                      class="absolute top-1.5 right-1.5 px-2 py-1 text-xs rounded bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors"
                    >
                      {copiedField === 'markdown' ? "Copied!" : "Copy"}
                    </button>
                  </div>
                </div>
              {/if}
              <p class="text-xs text-muted-foreground">
                Run in your repo directory. Links expire in 1 hour. Requires <a href="https://claude.ai/code" target="_blank" class="text-cyan-400 hover:underline">Claude Code CLI</a>.
              </p>
            </div>
          {/if}
        </div>
        <Badge
          variant={detail.request.status === "completed" ||
          detail.request.status === "pr_created"
            ? "success"
            : detail.request.status === "error" ||
                detail.request.status === "cancelled"
              ? "destructive"
              : "secondary"}
        >
          {formatStatus(detail.request.status)}
        </Badge>
      </div>
    </div>

    <!-- Title and metadata -->
    <div>
      <h2 class="text-lg sm:text-xl font-semibold line-clamp-2 sm:truncate">
        {detail.request.title || "Untitled Task"}
      </h2>
      <div
        class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs sm:text-sm text-muted-foreground mt-1"
      >
        <span class="font-mono"
          >{detail.request.requestId.substring(0, 12)}...</span
        >
        <span class="hidden sm:inline">|</span>
        <span>{detail.request.repo}</span>
        {#if detail.request.issueNumber}
          <span class="hidden sm:inline">|</span>
          <a
            href={detail.request.issueUrl || "#"}
            target="_blank"
            class="text-cyan-400 hover:underline"
          >
            #{detail.request.issueNumber}
          </a>
        {/if}
      </div>
    </div>
  </div>

  <!-- Stats bar -->
  <div
    class="flex flex-wrap items-center gap-6 p-4 rounded-lg bg-slate-900/50 border border-slate-800"
  >
    <!-- Source/Origin -->
    <div class="flex items-center gap-2">
      <SourceLink
        origin={detail.request.origin}
        slackChannelId={detail.request.slackChannelId}
        slackThreadTs={detail.request.slackThreadTs}
        issueUrl={detail.request.issueUrl}
      />
    </div>
    <!-- Agent Type -->
    {#if detail.request.agentType}
      <div class="flex items-center gap-2">
        {#if detail.request.agentType === "claude-code"}
          <svg
            class="w-4 h-4 text-orange-400"
            viewBox="0 0 24 24"
            fill="currentColor"
            ><path
              d="m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z"
            /></svg
          >
          <span class="text-sm font-medium text-orange-400">Claude Code</span>
        {:else}
          <svg class="w-4 h-4 text-cyan-400" viewBox="0 0 24 24" fill="none"
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
          <span class="text-sm font-medium text-cyan-400">OpenCode</span>
        {/if}
        {#if detail.request.agentProvider}
          <span class="text-xs text-muted-foreground">
            ({detail.request.agentProvider === "openai"
              ? "OpenAI"
              : detail.request.agentProvider === "google"
                ? "Google"
                : detail.request.agentProvider === "groq"
                  ? "Groq"
                  : detail.request.agentProvider === "deepseek"
                    ? "DeepSeek"
                    : detail.request.agentProvider === "mistral"
                      ? "Mistral"
                      : detail.request.agentProvider === "together"
                        ? "Together AI"
                        : detail.request.agentProvider === "fireworks"
                          ? "Fireworks"
                          : detail.request.agentProvider === "anthropic"
                            ? "Anthropic"
                            : detail.request.agentProvider})
          </span>
        {/if}
      </div>
    {/if}
    <div class="flex items-center gap-2">
      <svg
        class="w-4 h-4 text-muted-foreground"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
      <span class="text-sm text-muted-foreground">Duration:</span>
      <span class="text-sm font-medium"
        >{formatDuration(detail.request.totalDurationMs)}</span
      >
    </div>
    <div class="flex items-center gap-2">
      <svg
        class="w-4 h-4 text-muted-foreground"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
      <span class="text-sm text-muted-foreground">Cost:</span>
      <span class="text-sm font-medium"
        >{formatCost(detail.request.totalCostCents)}</span
      >
    </div>
    <div class="flex items-center gap-2">
      <svg
        class="w-4 h-4 text-muted-foreground"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
        />
      </svg>
      <span class="text-sm text-muted-foreground">Messages:</span>
      <span class="text-sm font-medium">{detail.messages.length}</span>
    </div>
    <div class="flex items-center gap-2">
      <svg
        class="w-4 h-4 text-muted-foreground"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
        />
      </svg>
      <span class="text-sm text-muted-foreground">Last updated:</span>
      <span class="text-sm font-medium"
        >{lastUpdatedAt.toLocaleTimeString()}</span
      >
    </div>
    {#if detail.request.prUrl}
      <a
        href={detail.request.prUrl}
        target="_blank"
        class="ml-auto flex items-center gap-2 px-3 py-1.5 rounded-md bg-green-500/20 text-green-400 hover:bg-green-500/30 transition-colors text-sm"
      >
        <svg
          class="w-4 h-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
          />
        </svg>
        View PR #{detail.request.prNumber}
      </a>
    {/if}
  </div>

  <!-- View Mode Toggle -->
  <div class="flex items-center gap-2">
    <div class="flex rounded-lg bg-slate-900/50 border border-slate-800 p-1">
      <button
        onclick={() => switchViewMode("messages")}
        class="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md transition-colors {viewMode ===
        'messages'
          ? 'bg-slate-700 text-white'
          : 'text-slate-400 hover:text-slate-300'}"
      >
        <svg
          class="w-4 h-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
          />
        </svg>
        Messages
      </button>
      <button
        onclick={() => switchViewMode("session")}
        class="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md transition-colors {viewMode ===
        'session'
          ? 'bg-slate-700 text-white'
          : 'text-slate-400 hover:text-slate-300'}"
      >
        <svg
          class="w-4 h-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4"
          />
        </svg>
        Session
      </button>
    </div>
  </div>

  <!-- Content based on view mode -->
  {#if viewMode === "session"}
    <SessionView
      bind:this={sessionViewRef}
      requestId={detail.request.requestId}
    />
  {:else}
    <MessageTimeline messages={detail.messages} />
  {/if}
</div>
