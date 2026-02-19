<script lang="ts">
  interface Props {
    compact?: boolean;
  }

  let { compact = false }: Props = $props();
</script>

<!-- Trigger Methods -->
<h3 class="text-sm font-medium text-white mb-3">Trigger Methods</h3>

<div class="space-y-3 mb-4">
  <!-- @mention trigger -->
  <div class="bg-slate-800/50 rounded-lg p-3">
    <div class="flex items-center gap-2 mb-1">
      <span class="text-cyan-400 font-medium text-sm">@mention</span>
      <span class="text-xs text-emerald-400 bg-emerald-400/10 px-1.5 py-0.5 rounded">Recommended</span>
    </div>
    <p class="text-xs text-muted-foreground mb-2">
      Mention <code class="text-cyan-400 bg-slate-800 px-1 py-0.5 rounded text-xs">@clarity</code> anywhere in Slack with your request
    </p>
    {#if !compact}
      <div class="text-xs text-slate-400 space-y-1">
        <code class="block bg-slate-900 px-2 py-1 rounded">@clarity fix the login bug</code>
        <code class="block bg-slate-900 px-2 py-1 rounded">@clarity [repo=myapp] add dark mode</code>
        <code class="block bg-slate-900 px-2 py-1 rounded">@clarity help</code>
      </div>
    {/if}
  </div>

  <!-- Slash command trigger -->
  <div class="bg-slate-800/50 rounded-lg p-3">
    <div class="flex items-center gap-2 mb-1">
      <span class="text-cyan-400 font-medium text-sm">/clarity-feature</span>
    </div>
    <p class="text-xs text-muted-foreground">
      Opens a modal to select repository, type, and describe your request
    </p>
  </div>

  <!-- GitHub label trigger -->
  <div class="bg-slate-800/50 rounded-lg p-3">
    <div class="flex items-center gap-2 mb-1">
      <span class="text-cyan-400 font-medium text-sm">GitHub Issue</span>
    </div>
    <p class="text-xs text-muted-foreground">
      Add the <code class="text-cyan-400 bg-slate-800 px-1 py-0.5 rounded text-xs">clarity-ai</code> label to any GitHub issue
    </p>
  </div>
</div>

<!-- Workflow -->
<h3 class="text-sm font-medium text-white mb-3">Workflow</h3>
<ol class="text-muted-foreground space-y-2 list-decimal list-inside text-xs">
  <li>
    <span class="text-white font-medium">Clarifying questions</span> — AI analyzes your request and asks targeted questions
  </li>
  <li>
    <span class="text-white font-medium">Respond naturally</span> — Answer in thread or via buttons
  </li>
  <li>
    <span class="text-white font-medium">Auto-implementation</span> — AI agent creates a PR automatically
  </li>
</ol>

<!-- Status reactions -->
<div class="mt-4 pt-4 border-t border-slate-700">
  <h3 class="text-sm font-medium text-white mb-2">Status Reactions</h3>
  <div class="flex gap-4 text-xs text-muted-foreground">
    <span>⏳ Working</span>
    <span>✅ Completed</span>
    <span>❌ Failed</span>
  </div>
</div>

<div class="mt-4 pt-4 border-t border-slate-700">
  <p class="text-xs text-muted-foreground">
    <span class="text-purple-400">Multi-Provider:</span> Supports Anthropic, OpenAI, Google,
    Groq, DeepSeek, Mistral, Together AI, and Fireworks. Configure in <span class="text-white">Settings</span>.
  </p>
</div>
