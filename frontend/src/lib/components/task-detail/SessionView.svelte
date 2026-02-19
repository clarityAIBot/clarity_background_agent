<script lang="ts">
  import pako from "pako";
  import Badge from "$lib/components/ui/badge.svelte";
  import { formatBytes } from "$lib/utils/cn";
  import {
    getRequestSessionWithBlob,
    type SessionResponse,
  } from "$lib/api";
  import { formatRelativeTime } from "./utils";
  import { marked } from "marked";

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
    requestId: string;
  }

  let { requestId }: Props = $props();

  // Session data (lazy loaded)
  let sessionData = $state<SessionResponse | null>(null);
  let sessionLoading = $state(false);
  let sessionError = $state<string | null>(null);
  // Track which request ID we have currently loaded to prevent unnecessary reloads
  let loadedRequestId = $state<string | null>(null);

  // Session content (decoded blob)
  let sessionContent = $state<Array<Record<string, unknown>> | null>(null);
  let sessionContentError = $state<string | null>(null);

  // Expanded entries for tool calls
  let expandedTools = $state<Set<string>>(new Set());

  // View mode: 'conversation' or 'raw'
  let viewMode = $state<'conversation' | 'raw'>('conversation');

  function toggleToolExpand(toolId: string) {
    const newSet = new Set(expandedTools);
    if (newSet.has(toolId)) {
      newSet.delete(toolId);
    } else {
      newSet.add(toolId);
    }
    expandedTools = newSet;
  }

  // Extract text content from message content array
  function extractTextContent(content: unknown): string {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      const textParts = content
        .filter((item: any) => item.type === 'text')
        .map((item: any) => item.text);
      if (textParts.length > 0) {
        return textParts.join('\n');
      }
      // If no text type items, check for other string content
      const stringParts = content
        .filter((item: any) => typeof item === 'string');
      if (stringParts.length > 0) {
        return stringParts.join('\n');
      }
    }
    // Try to extract from object with text property
    if (content && typeof content === 'object' && 'text' in content) {
      return String((content as any).text);
    }
    return '';
  }

  // Extract tool uses from message content
  function extractToolUses(content: unknown): Array<{ id: string; name: string; input: unknown }> {
    if (!Array.isArray(content)) return [];
    return content
      .filter((item: any) => item.type === 'tool_use')
      .map((item: any) => ({
        id: item.id || crypto.randomUUID(),
        name: item.name,
        input: item.input
      }));
  }

  // Extract tool results from message content
  function extractToolResults(content: unknown): Array<{ id: string; result: unknown }> {
    if (!Array.isArray(content)) return [];
    return content
      .filter((item: any) => item.type === 'tool_result')
      .map((item: any) => ({
        id: item.tool_use_id || crypto.randomUUID(),
        result: item.content
      }));
  }

  // Parse session entries into conversation format
  function parseConversation(entries: Array<Record<string, unknown>>) {
    const messages: Array<{
      type: 'user' | 'assistant' | 'system' | 'tool_result' | 'result';
      content: string;
      toolUses?: Array<{ id: string; name: string; input: unknown; result?: unknown; isError?: boolean }>;
      toolResults?: Array<{ id: string; result: unknown }>;
      raw: Record<string, unknown>;
      subtype?: string;
      sessionId?: string;
      costUsd?: number;
      numTurns?: number;
    }> = [];

    // First pass: collect all tool results by tool_use_id for pairing
    const toolResultsMap = new Map<string, { result: unknown; isError?: boolean }>();
    for (const entry of entries) {
      if (entry.type === 'user') {
        const msg = entry.message as Record<string, unknown> | undefined;
        const msgContent = msg?.content;
        if (Array.isArray(msgContent)) {
          for (const item of msgContent) {
            if ((item as any).type === 'tool_result' && (item as any).tool_use_id) {
              toolResultsMap.set((item as any).tool_use_id, {
                result: (item as any).content,
                isError: (item as any).is_error
              });
            }
          }
        }
      }
    }

    for (const entry of entries) {
      const entryType = entry.type as string;

      if (entryType === 'user') {
        // User message - handle multiple possible formats
        const msg = entry.message as Record<string, unknown> | undefined;
        const msgContent = msg?.content;

        // Check if this is a tool_result message (internal SDK message, not actual user input)
        if (Array.isArray(msgContent)) {
          const hasToolResult = msgContent.some((item: any) => item.type === 'tool_result');
          if (hasToolResult) {
            // Skip tool result messages - they're paired with tool calls now
            continue;
          }
        }

        let textContent = '';
        if (msgContent) {
          textContent = extractTextContent(msgContent);
        } else if (typeof msg === 'string') {
          textContent = msg;
        } else if (entry.content) {
          // Content might be at entry level
          textContent = extractTextContent(entry.content);
        }

        // Skip empty user messages
        if (!textContent.trim()) {
          continue;
        }

        messages.push({
          type: 'user',
          content: textContent,
          raw: entry
        });
      } else if (entryType === 'assistant') {
        // Assistant message
        const msg = entry.message as Record<string, unknown> | undefined;
        const content = msg?.content;
        const text = extractTextContent(content);
        const toolUses = extractToolUses(content);

        // Pair tool uses with their results
        const toolUsesWithResults = toolUses.map(tool => {
          const resultData = toolResultsMap.get(tool.id);
          return {
            ...tool,
            result: resultData?.result,
            isError: resultData?.isError
          };
        });

        messages.push({
          type: 'assistant',
          content: text,
          toolUses: toolUsesWithResults.length > 0 ? toolUsesWithResults : undefined,
          raw: entry
        });
      } else if (entryType === 'system') {
        // System message (init, etc.)
        const subtype = entry.subtype as string | undefined;
        const sessionId = entry.session_id as string | undefined;
        messages.push({
          type: 'system',
          content: subtype === 'init' ? 'Session initialized' : (entry.message as string) || 'System event',
          subtype,
          sessionId,
          raw: entry
        });
      } else if (entryType === 'result') {
        // Final result
        const costUsd = entry.total_cost_usd as number | undefined;
        const numTurns = entry.num_turns as number | undefined;
        messages.push({
          type: 'result',
          content: 'Execution completed',
          costUsd,
          numTurns,
          raw: entry
        });
      }
    }

    return messages;
  }

  let conversationMessages = $derived(sessionContent ? parseConversation(sessionContent) : []);

  // Load session data with blob content in one call
  export async function loadSessionData() {
    sessionLoading = true;
    sessionError = null;
    sessionContent = null;
    sessionContentError = null;

    try {
      // Load everything in one call (with blob)
      const response = await getRequestSessionWithBlob(requestId);
      sessionData = response;

      // Parse blob content if available
      if (response.hasSession && response.session?.blob) {
        try {
          // Decode base64 to binary
          const binaryString = atob(response.session.blob);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }

          // Decompress gzip using pako
          const decompressed = pako.inflate(bytes, { to: "string" });

          // Parse JSONL (each line is a JSON object)
          const lines = decompressed.trim().split("\n");
          const parsed = lines.map((line, index) => {
            try {
              return JSON.parse(line);
            } catch {
              return { _parseError: true, _line: index + 1, _raw: line };
            }
          });

          sessionContent = parsed;
        } catch (error) {
          sessionContentError =
            error instanceof Error
              ? error.message
              : "Failed to decompress session content";
        }
      }
    } catch (error) {
      sessionError =
        error instanceof Error ? error.message : "Failed to load session";
    } finally {
      sessionLoading = false;
    }
  }

  // Download session as JSONL file
  function downloadSession() {
    if (!sessionContent) return;

    // Convert back to JSONL format
    const jsonlContent = sessionContent
      .map(entry => JSON.stringify(entry))
      .join('\n');

    // Create and download file
    const blob = new Blob([jsonlContent], { type: 'application/jsonl' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `session-${requestId}.jsonl`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // Reset when requestId changes
  export function reset() {
    sessionData = null;
    sessionError = null;
    sessionContent = null;
    sessionContentError = null;
    expandedTools = new Set();
    loadedRequestId = null;
  }

  // Auto-load session data when component mounts or requestId changes
  $effect(() => {
    if (requestId && requestId !== loadedRequestId) {
      // Reset and load fresh data
      sessionData = null;
      sessionError = null;
      sessionContent = null;
      sessionContentError = null;
      expandedTools = new Set();
      sessionLoading = false;

      // Update the loaded ID immediately to prevent re-entry
      loadedRequestId = requestId;

      loadSessionData();
    }
  });
</script>

<div class="rounded-lg border border-slate-800 bg-slate-900/50 p-6">
  {#if sessionLoading}
    <div class="flex items-center justify-center py-12">
      <svg
        class="w-6 h-6 text-slate-400 animate-spin"
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
      <span class="ml-2 text-slate-400">Loading session data...</span>
    </div>
  {:else if sessionError}
    <div class="text-center py-12">
      <svg
        class="w-12 h-12 text-red-400 mx-auto mb-3"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
      <p class="text-red-400">{sessionError}</p>
    </div>
  {:else if sessionData && !sessionData.hasSession}
    <div class="text-center py-12">
      <svg
        class="w-12 h-12 text-slate-600 mx-auto mb-3"
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
      <p class="text-slate-400">No session data available for this task.</p>
      <p class="text-sm text-slate-500 mt-1">
        Session data is stored for tasks processed after session persistence was
        enabled.
      </p>
    </div>
  {:else if sessionData && sessionData.session}
    <div class="space-y-6">
      <!-- Session Header with Stats -->
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div class="p-2 rounded-lg bg-violet-500/20">
            <svg
              class="w-5 h-5 text-violet-400"
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
          </div>
          <div>
            <h3 class="text-lg font-medium">Agent Session</h3>
            <div class="flex items-center gap-3 text-xs text-slate-500">
              <span>{formatBytes(sessionData.session.blobSizeBytes)}</span>
              <span>•</span>
              <span>{formatRelativeTime(sessionData.session.createdAt)}</span>
              <span>•</span>
              <span class="font-mono">{sessionData.session.sessionId.slice(0, 8)}...</span>
            </div>
          </div>
        </div>

        <!-- Agent Type Badge and Download -->
        <div class="flex items-center gap-2">
          <!-- Download button -->
          <button
            onclick={downloadSession}
            class="flex items-center gap-1.5 px-2 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-300 transition-colors"
            title="Download session as JSONL"
          >
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/>
            </svg>
            <span class="text-xs">Download</span>
          </button>

          {#if sessionData.session.agentType === "claude-code"}
            <div class="flex items-center gap-1.5 px-2 py-1 rounded-full bg-orange-500/20">
              <svg class="w-3.5 h-3.5 text-orange-400" viewBox="0 0 24 24" fill="currentColor">
                <path d="m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z"/>
              </svg>
              <span class="text-xs font-medium text-orange-400">Claude Code</span>
            </div>
          {:else}
            <div class="flex items-center gap-1.5 px-2 py-1 rounded-full bg-cyan-500/20">
              <svg class="w-3.5 h-3.5 text-cyan-400" viewBox="0 0 24 24" fill="none">
                <path d="M8 10L10.5 12.5L8 15M13 10H16M13 12.5H16M13 15H16" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                <rect x="3" y="3" width="18" height="18" rx="3" stroke="currentColor" stroke-width="2"/>
              </svg>
              <span class="text-xs font-medium text-cyan-400">OpenCode</span>
            </div>
          {/if}
        </div>
      </div>

      <!-- Session Content Section -->
      <div class="border-t border-slate-700 pt-6">
        <div class="flex items-center justify-between mb-4">
          <div class="flex items-center gap-2">
            <h4 class="text-sm font-medium text-slate-300">Conversation</h4>
            {#if sessionContent}
              <span class="text-xs text-slate-500">({conversationMessages.length} messages)</span>
            {/if}
          </div>
          {#if sessionContent}
            <!-- View mode toggle -->
            <div class="flex rounded-md bg-slate-800 p-0.5">
              <button
                onclick={() => viewMode = 'conversation'}
                class="px-2 py-1 text-xs rounded {viewMode === 'conversation' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-slate-300'}"
              >
                Chat
              </button>
              <button
                onclick={() => viewMode = 'raw'}
                class="px-2 py-1 text-xs rounded {viewMode === 'raw' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-slate-300'}"
              >
                Raw
              </button>
            </div>
          {/if}
        </div>

        {#if sessionContentError}
          <div class="p-4 rounded-lg bg-red-500/10 border border-red-500/20">
            <p class="text-sm text-red-400">{sessionContentError}</p>
          </div>
        {:else if sessionContent && viewMode === 'conversation'}
          <!-- Conversation View -->
          <div class="space-y-4 overflow-y-auto pr-2">
            {#each conversationMessages as msg, index}
              {#if msg.type === 'system'}
                <!-- System message -->
                <div class="flex justify-center">
                  <div class="px-3 py-1.5 rounded-full bg-slate-800/50 border border-slate-700">
                    <span class="text-xs text-slate-500">
                      {msg.subtype === 'init' ? '🚀 Session started' : msg.content}
                      {#if msg.sessionId}
                        <span class="font-mono ml-1">({msg.sessionId.slice(0, 8)}...)</span>
                      {/if}
                    </span>
                  </div>
                </div>
              {:else if msg.type === 'user'}
                <!-- User message -->
                <div class="flex gap-3">
                  <div class="flex-shrink-0 w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center">
                    <svg class="w-4 h-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/>
                    </svg>
                  </div>
                  <div class="flex-1 min-w-0">
                    <div class="text-xs text-blue-400 font-medium mb-1">User</div>
                    <div class="p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
                      <p class="text-sm text-slate-300 whitespace-pre-wrap">{msg.content || '(empty message)'}</p>
                    </div>
                  </div>
                </div>
              {:else if msg.type === 'assistant'}
                <!-- Assistant message -->
                <div class="flex gap-3">
                  <div class="flex-shrink-0 w-8 h-8 rounded-full bg-orange-500/20 flex items-center justify-center">
                    <svg class="w-4 h-4 text-orange-400" viewBox="0 0 24 24" fill="currentColor">
                      <path d="m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z"/>
                    </svg>
                  </div>
                  <div class="flex-1 min-w-0">
                    <div class="text-xs text-orange-400 font-medium mb-1">Claude</div>
                    <div class="space-y-2">
                      {#if msg.content}
                        <div class="p-3 rounded-lg bg-slate-800/50 border border-slate-700 prose prose-sm prose-invert max-w-none prose-p:my-1 prose-pre:my-2 prose-code:text-orange-300 prose-code:bg-slate-800 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-pre:bg-slate-900 prose-pre:border prose-pre:border-slate-700">
                          {@html renderMarkdown(msg.content)}
                        </div>
                      {/if}
                      {#if msg.toolUses && msg.toolUses.length > 0}
                        {#each msg.toolUses as tool}
                          <div class="rounded-lg bg-slate-800/30 border {tool.isError ? 'border-red-500/30' : 'border-slate-700'} overflow-hidden">
                            <button
                              onclick={() => toggleToolExpand(tool.id)}
                              class="w-full flex items-center gap-2 px-3 py-2 hover:bg-slate-800/50 transition-colors text-left"
                            >
                              <svg class="w-4 h-4 {tool.isError ? 'text-red-400' : 'text-purple-400'}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/>
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
                              </svg>
                              <span class="text-xs font-medium {tool.isError ? 'text-red-400' : 'text-purple-400'}">{tool.name}</span>
                              {#if tool.isError}
                                <span class="text-xs px-1.5 py-0.5 rounded bg-red-500/20 text-red-400">error</span>
                              {:else if tool.result !== undefined}
                                <span class="text-xs px-1.5 py-0.5 rounded bg-green-500/20 text-green-400">✓</span>
                              {/if}
                              <svg class="w-3 h-3 text-slate-500 ml-auto transition-transform {expandedTools.has(tool.id) ? 'rotate-180' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/>
                              </svg>
                            </button>
                            {#if expandedTools.has(tool.id)}
                              <div class="border-t border-slate-700 p-2 space-y-2">
                                <div>
                                  <div class="text-xs text-slate-500 mb-1">Input</div>
                                  <pre class="text-xs bg-slate-900 rounded p-2 overflow-x-auto max-h-32 overflow-y-auto text-slate-400">{JSON.stringify(tool.input, null, 2)}</pre>
                                </div>
                                {#if tool.result !== undefined}
                                  <div>
                                    <div class="text-xs {tool.isError ? 'text-red-400' : 'text-slate-500'} mb-1">{tool.isError ? 'Error' : 'Result'}</div>
                                    <pre class="text-xs bg-slate-900 rounded p-2 overflow-x-auto max-h-32 overflow-y-auto {tool.isError ? 'text-red-400' : 'text-slate-400'}">{typeof tool.result === 'string' ? tool.result : JSON.stringify(tool.result, null, 2)}</pre>
                                  </div>
                                {/if}
                              </div>
                            {/if}
                          </div>
                        {/each}
                      {/if}
                    </div>
                  </div>
                </div>
              {:else if msg.type === 'result'}
                <!-- Result message -->
                <div class="flex justify-center">
                  <div class="px-4 py-2 rounded-lg bg-green-500/10 border border-green-500/20">
                    <div class="flex items-center gap-3 text-xs">
                      <span class="text-green-400 font-medium">✓ Complete</span>
                      {#if msg.numTurns}
                        <span class="text-slate-500">{msg.numTurns} turns</span>
                      {/if}
                      {#if msg.costUsd}
                        <span class="text-slate-500">${msg.costUsd.toFixed(4)}</span>
                      {/if}
                    </div>
                  </div>
                </div>
              {/if}
            {/each}
          </div>
        {:else if sessionContent && viewMode === 'raw'}
          <!-- Raw JSON View -->
          <div class="space-y-2 overflow-y-auto">
            {#each sessionContent as entry, index}
              <div class="rounded-lg bg-slate-800/50 border border-slate-700 overflow-hidden">
                <button
                  onclick={() => toggleToolExpand(`raw-${index}`)}
                  class="w-full flex items-center justify-between p-3 hover:bg-slate-800/70 transition-colors text-left"
                >
                  <div class="flex items-center gap-2">
                    <span class="text-xs font-mono text-slate-500">#{index + 1}</span>
                    {#if entry.type}
                      <Badge variant="secondary">{entry.type}</Badge>
                    {/if}
                  </div>
                  <svg class="w-4 h-4 text-slate-400 transition-transform {expandedTools.has(`raw-${index}`) ? 'rotate-180' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/>
                  </svg>
                </button>
                {#if expandedTools.has(`raw-${index}`)}
                  <div class="border-t border-slate-700 p-3">
                    <pre class="text-xs bg-slate-900 rounded p-3 overflow-x-auto max-h-96 overflow-y-auto whitespace-pre-wrap text-slate-300">{JSON.stringify(entry, null, 2)}</pre>
                  </div>
                {/if}
              </div>
            {/each}
          </div>
          <div class="mt-3 text-xs text-slate-500 text-center">
            {sessionContent.length} entries in session
          </div>
        {/if}
      </div>
    </div>
  {:else}
    <!-- Initial state before any data loads -->
    <div class="flex items-center justify-center py-12">
      <svg class="w-6 h-6 text-slate-400 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
      </svg>
      <span class="ml-2 text-slate-400">Loading session data...</span>
    </div>
  {/if}
</div>
