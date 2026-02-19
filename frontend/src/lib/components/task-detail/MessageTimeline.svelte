<script lang="ts">
  import Badge from "$lib/components/ui/badge.svelte";
  import type { RequestMessage } from "$lib/api";
  import { marked } from "marked";
  import {
    formatDuration,
    formatCost,
    formatRelativeTime,
    getMessageIcon,
    getMessageColor,
    getMessageBgColor,
    formatMessageType,
    isAgentActivity
  } from "./utils";

  // Configure marked for safe rendering
  marked.setOptions({
    breaks: true,
    gfm: true,
  });

  // Render markdown to HTML
  function renderMarkdown(content: string): string {
    try {
      return marked.parse(content) as string;
    } catch {
      return content;
    }
  }

  interface Props {
    messages: RequestMessage[];
  }

  let { messages }: Props = $props();

  // Expand/collapse state for tool outputs
  let expandedMessages = $state<Set<number>>(new Set());

  function toggleExpand(id: number) {
    const newSet = new Set(expandedMessages);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    expandedMessages = newSet;
  }
</script>

{#if messages.length === 0}
  <div class="text-center py-12 text-muted-foreground">
    No messages recorded for this task yet.
  </div>
{:else}
  <div class="relative">
    <!-- Timeline line -->
    <div class="absolute left-6 top-0 bottom-0 w-px bg-gradient-to-b from-slate-700 via-slate-700 to-transparent"></div>

    <!-- Messages -->
    <div class="space-y-4">
      {#each messages as message (message.id)}
        <div class="relative pl-14">
          <!-- Timeline dot -->
          <div class="absolute left-4 w-5 h-5 rounded-full flex items-center justify-center {getMessageBgColor(message.type)} border">
            <svg class="w-3 h-3 {getMessageColor(message.type)}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d={getMessageIcon(message.type)} />
            </svg>
          </div>

          <!-- Message card -->
          <div class="rounded-lg border {getMessageBgColor(message.type)} p-4 {isAgentActivity(message.type) ? 'ml-4' : ''}">
            <!-- Message header -->
            <div class="flex items-center justify-between mb-2">
              <div class="flex items-center gap-2">
                <span class="text-xs font-medium {getMessageColor(message.type)}">
                  {formatMessageType(message.type)}
                </span>
                {#if message.actorName && message.actorName !== "Clarity AI"}
                  <span class="text-xs text-muted-foreground">by</span>
                  <span class="text-xs font-medium text-slate-300">
                    {message.actorName}
                  </span>
                {/if}
                {#if message.source && message.source !== "system"}
                  <span class="text-xs px-1.5 py-0.5 rounded {message.source === 'slack' ? 'bg-purple-500/20 text-purple-400' : message.source === 'github' ? 'bg-slate-700 text-slate-300' : 'bg-cyan-500/20 text-cyan-400'}">
                    {message.source}
                  </span>
                {:else if message.metadata?.triggeredBy}
                  <span class="text-xs px-1.5 py-0.5 rounded {message.metadata.triggeredBy === 'slack' ? 'bg-purple-500/20 text-purple-400' : message.metadata.triggeredBy === 'github' ? 'bg-slate-700 text-slate-300' : 'bg-cyan-500/20 text-cyan-400'}">
                    via {message.metadata.triggeredBy}
                  </span>
                {/if}
                {#if message.metadata?.toolName}
                  <code class="text-xs px-1.5 py-0.5 rounded bg-slate-800 text-cyan-400">
                    {message.metadata.toolName}
                  </code>
                {/if}
              </div>
              <span class="text-xs text-muted-foreground">
                {formatRelativeTime(message.createdAt)}
              </span>
            </div>

            <!-- Message content -->
            {#if message.type === "agent_tool_call" && message.metadata?.toolInput}
              <div class="space-y-2">
                <div class="text-sm text-slate-300">{message.content}</div>
                <button onclick={() => toggleExpand(message.id)} class="text-xs text-cyan-400 hover:underline">
                  {expandedMessages.has(message.id) ? "Hide input" : "Show input"}
                </button>
                {#if expandedMessages.has(message.id)}
                  <pre class="text-xs bg-slate-900 rounded p-2 overflow-x-auto max-h-48 overflow-y-auto">{JSON.stringify(message.metadata.toolInput, null, 2)}</pre>
                {/if}
              </div>
            {:else if message.type === "agent_tool_result" && message.metadata?.toolOutput}
              <div class="space-y-2">
                {#if message.metadata.toolDurationMs}
                  <span class="text-xs text-muted-foreground">
                    Completed in {formatDuration(message.metadata.toolDurationMs)}
                  </span>
                {/if}
                <button onclick={() => toggleExpand(message.id)} class="text-xs text-cyan-400 hover:underline block">
                  {expandedMessages.has(message.id) ? "Hide output" : "Show output"}
                </button>
                {#if expandedMessages.has(message.id)}
                  <pre class="text-xs bg-slate-900 rounded p-2 overflow-x-auto max-h-64 overflow-y-auto whitespace-pre-wrap">{message.metadata.toolOutput}</pre>
                {/if}
              </div>
            {:else if message.type === "agent_file_change"}
              <div class="space-y-2">
                <div class="flex items-center gap-2">
                  <Badge variant={message.metadata?.fileAction === "created" ? "success" : message.metadata?.fileAction === "deleted" ? "destructive" : "secondary"}>
                    {message.metadata?.fileAction || "modified"}
                  </Badge>
                  <code class="text-sm text-cyan-400">{message.metadata?.filePath || message.content}</code>
                </div>
                {#if message.metadata?.diffPreview}
                  <button onclick={() => toggleExpand(message.id)} class="text-xs text-cyan-400 hover:underline">
                    {expandedMessages.has(message.id) ? "Hide diff" : "Show diff"}
                  </button>
                  {#if expandedMessages.has(message.id)}
                    <pre class="text-xs bg-slate-900 rounded p-2 overflow-x-auto max-h-64 overflow-y-auto font-mono">{message.metadata.diffPreview}</pre>
                  {/if}
                {/if}
              </div>
            {:else if message.type === "agent_terminal"}
              <div class="space-y-2">
                <div class="flex items-center gap-2">
                  <code class="text-sm text-emerald-400 bg-slate-900 px-2 py-1 rounded">$ {message.metadata?.command || message.content}</code>
                  {#if message.metadata?.exitCode !== undefined}
                    <Badge variant={message.metadata.exitCode === 0 ? "success" : "destructive"}>
                      exit {message.metadata.exitCode}
                    </Badge>
                  {/if}
                </div>
                {#if message.metadata?.stdout || message.metadata?.stderr}
                  <button onclick={() => toggleExpand(message.id)} class="text-xs text-cyan-400 hover:underline">
                    {expandedMessages.has(message.id) ? "Hide output" : "Show output"}
                  </button>
                  {#if expandedMessages.has(message.id)}
                    {#if message.metadata?.stdout}
                      <pre class="text-xs bg-slate-900 rounded p-2 overflow-x-auto max-h-48 overflow-y-auto text-green-400">{message.metadata.stdout}</pre>
                    {/if}
                    {#if message.metadata?.stderr}
                      <pre class="text-xs bg-slate-900 rounded p-2 overflow-x-auto max-h-48 overflow-y-auto text-red-400">{message.metadata.stderr}</pre>
                    {/if}
                  {/if}
                {/if}
              </div>
            {:else if message.type === "error"}
              <div class="space-y-2">
                {#if message.metadata?.errorCode}
                  <Badge variant="destructive">{message.metadata.errorCode}</Badge>
                {/if}
                <div class="text-sm text-red-300 whitespace-pre-wrap">
                  {message.content}
                </div>
                {#if message.metadata?.errorStack}
                  <button onclick={() => toggleExpand(message.id)} class="text-xs text-cyan-400 hover:underline">
                    {expandedMessages.has(message.id) ? "Hide stack trace" : "Show stack trace"}
                  </button>
                  {#if expandedMessages.has(message.id)}
                    <pre class="text-xs bg-slate-900 rounded p-2 overflow-x-auto max-h-48 overflow-y-auto text-red-400">{message.metadata.errorStack}</pre>
                  {/if}
                {/if}
              </div>
            {:else if message.type === "pr_created" || message.type === "pr_updated"}
              <div class="space-y-2">
                <div class="text-sm text-green-300">{message.content}</div>
                {#if message.metadata?.durationMs || message.metadata?.costCents}
                  <div class="flex items-center gap-4 text-xs text-muted-foreground">
                    {#if message.metadata?.durationMs}
                      <span>Duration: {formatDuration(message.metadata.durationMs)}</span>
                    {/if}
                    {#if message.metadata?.costCents}
                      <span>Cost: {formatCost(message.metadata.costCents)}</span>
                    {/if}
                  </div>
                {/if}
              </div>
            {:else}
              <div class="text-sm text-slate-300 prose prose-sm prose-invert max-w-none prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0 prose-pre:bg-slate-900 prose-code:text-cyan-400 prose-code:bg-slate-800 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:before:content-none prose-code:after:content-none">
                {@html renderMarkdown(message.content)}
              </div>
            {/if}
          </div>
        </div>
      {/each}
    </div>
  </div>
{/if}
