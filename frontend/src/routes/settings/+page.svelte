<script lang="ts">
  import { browser } from "$app/environment";
  import Button from "$lib/components/ui/button.svelte";
  import Card from "$lib/components/ui/card.svelte";
  import Input from "$lib/components/ui/input.svelte";
  import Select from "$lib/components/ui/select.svelte";
  import NavButton from "$lib/components/ui/nav-button.svelte";
  import Footer from "$lib/components/ui/footer.svelte";
  import ConfigCard from "$lib/components/ConfigCard.svelte";
  import LoadingSpinner from "$lib/components/ui/loading-spinner.svelte";
  import UsersManagement from "$lib/components/UsersManagement.svelte";
  import {
    getAllStatus,
    getGitHubSetupUrl,
    getSlackSetupUrl,
    getLLMSetupUrl,
    getSystemDefaults,
    updateSystemDefaults,
    getLLMStatus,
    type StatusResponse,
    type SystemDefaultsConfig,
    type LLMStatus,
  } from "$lib/api";
  import { authStore } from "$lib/stores/auth.svelte";
  import Badge from "$lib/components/ui/badge.svelte";

  let status = $state<StatusResponse | null>(null);
  let systemDefaults = $state<SystemDefaultsConfig | null>(null);
  let llmStatus = $state<LLMStatus | null>(null);
  let loading = $state(false);
  let saving = $state(false);
  let success = $state(false);
  let error = $state("");
  let activeTab = $state<'integrations' | 'defaults' | 'auth' | 'users'>('integrations');

  // Initialize tab from URL on mount
  $effect(() => {
    if (browser) {
      const params = new URLSearchParams(window.location.search);
      const tabParam = params.get('tab');
      if (tabParam && ['integrations', 'defaults', 'auth', 'users'].includes(tabParam)) {
        activeTab = tabParam as 'integrations' | 'defaults' | 'auth' | 'users';
      }
    }
  });

  // Listen to browser back/forward button (popstate event)
  $effect(() => {
    if (browser) {
      const handlePopState = () => {
        const params = new URLSearchParams(window.location.search);
        const tabParam = params.get('tab');
        if (tabParam && ['integrations', 'defaults', 'auth', 'users'].includes(tabParam)) {
          activeTab = tabParam as 'integrations' | 'defaults' | 'auth' | 'users';
        } else {
          activeTab = 'integrations';
        }
      };

      window.addEventListener('popstate', handlePopState);
      return () => window.removeEventListener('popstate', handlePopState);
    }
  });

  // Update URL when tab changes (use replaceState to avoid polluting history)
  function setActiveTab(tab: 'integrations' | 'defaults' | 'auth' | 'users') {
    activeTab = tab;
    if (browser) {
      const url = new URL(window.location.href);
      url.searchParams.set('tab', tab);
      // Use replaceState instead of pushState to avoid creating history entries for each tab switch
      window.history.replaceState({}, '', url.toString());
    }
  }

  async function handleLogout() {
    await authStore.logout();
  }

  // Provider options with labels
  const allProviderOptions = [
    { value: 'anthropic', label: 'Anthropic (Claude)' },
    { value: 'openai', label: 'OpenAI' },
    { value: 'google', label: 'Google (Gemini)' },
    { value: 'groq', label: 'Groq' },
    { value: 'deepseek', label: 'DeepSeek' },
    { value: 'mistral', label: 'Mistral' },
    { value: 'together', label: 'Together AI' },
    { value: 'fireworks', label: 'Fireworks AI' }
  ];

  // Derived: Only show configured providers
  const configuredProviderOptions = $derived.by(() => {
    if (!llmStatus?.providers) return [];
    const providers = llmStatus.providers;
    return allProviderOptions.filter(opt => providers[opt.value as keyof typeof providers]);
  });

  // Form state for system defaults
  let formData = $state<Partial<SystemDefaultsConfig>>({
    defaultAgentType: 'claude-code',
    defaultAgentProvider: 'anthropic',
    defaultAgentModel: '',
    defaultRepository: '',
    defaultBranch: '',
    githubOrganizationName: '',
    customDefaultPrompt: '',
    auth: {
      allowedDomains: [],
      allowedEmails: [],
      defaultPolicyId: 'developer',
    },
  });

  // Temporary input fields for adding items to arrays
  let newDomain = $state('');
  let newEmail = $state('');

  // Helper functions to manage array fields
  function addDomain() {
    if (newDomain.trim() && !formData.auth?.allowedDomains?.includes(newDomain.trim())) {
      formData.auth = {
        ...formData.auth,
        allowedDomains: [...(formData.auth?.allowedDomains || []), newDomain.trim()]
      };
      newDomain = '';
    }
  }

  function removeDomain(domain: string) {
    formData.auth = {
      ...formData.auth,
      allowedDomains: formData.auth?.allowedDomains?.filter(d => d !== domain) || []
    };
  }

  function addEmail() {
    if (newEmail.trim() && !formData.auth?.allowedEmails?.includes(newEmail.trim())) {
      formData.auth = {
        ...formData.auth,
        allowedEmails: [...(formData.auth?.allowedEmails || []), newEmail.trim()]
      };
      newEmail = '';
    }
  }

  function removeEmail(email: string) {
    formData.auth = {
      ...formData.auth,
      allowedEmails: formData.auth?.allowedEmails?.filter(e => e !== email) || []
    };
  }

  // Derived states
  const githubConfigured = $derived(status?.installation?.appId ? true : false);
  const llmConfigured = $derived(status?.claude?.configured ? true : false);
  const slackConfigured = $derived(status?.slack?.configured ? true : false);
  const repositoryCount = $derived(status?.installation?.repositoryCount ?? 0);

  async function loadStatus() {
    console.log("[Settings] loadStatus called");
    try {
      loading = true;
      error = "";
      console.log("[Settings] Loading status...");
      status = await getAllStatus();
      console.log("[Settings] Status result:", status);
    } catch (e) {
      console.error("[Settings] Status load error:", e);
      error = e instanceof Error ? e.message : "Failed to load status";
    } finally {
      loading = false;
    }
  }

  async function loadDefaults() {
    try {
      console.log("[Settings] Loading defaults...");
      const defaultsResult = await getSystemDefaults();
      console.log("[Settings] Defaults result:", defaultsResult);

      systemDefaults = defaultsResult;

      // Populate form with current values
      formData = {
        defaultAgentType: defaultsResult.defaultAgentType || 'claude-code',
        defaultAgentProvider: defaultsResult.defaultAgentProvider || 'anthropic',
        defaultAgentModel: defaultsResult.defaultAgentModel || '',
        defaultRepository: defaultsResult.defaultRepository || '',
        defaultBranch: defaultsResult.defaultBranch || '',
        githubOrganizationName: defaultsResult.githubOrganizationName || '',
        customDefaultPrompt: defaultsResult.customDefaultPrompt || '',
        auth: {
          allowedDomains: defaultsResult.auth?.allowedDomains || [],
          allowedEmails: defaultsResult.auth?.allowedEmails || [],
          defaultPolicyId: defaultsResult.auth?.defaultPolicyId || 'developer',
        },
      };
    } catch (e) {
      console.error("[Settings] Failed to load defaults:", e);
      // Don't block page load for defaults error, just use defaults
    }
  }

  async function loadLLMStatus() {
    try {
      console.log("[Settings] Loading LLM status...");
      llmStatus = await getLLMStatus();
      console.log("[Settings] LLM status result:", llmStatus);
    } catch (e) {
      console.error("[Settings] Failed to load LLM status:", e);
    }
  }

  // Load data on mount (authentication is handled by layout)
  $effect(() => {
    if (browser) {
      loadStatus();
      loadDefaults();
      loadLLMStatus();
    }
  });

  async function handleSaveDefaults() {
    saving = true;
    error = "";
    success = false;

    try {
      await updateSystemDefaults(formData);
      systemDefaults = { ...systemDefaults, ...formData } as SystemDefaultsConfig;
      success = true;
      setTimeout(() => (success = false), 3000);
    } catch (e) {
      error = e instanceof Error ? e.message : "Failed to save settings";
    } finally {
      saving = false;
    }
  }
</script>

<div
  class="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950"
>
  <div class="container mx-auto py-6 sm:py-8 lg:py-12 px-4 sm:px-6 lg:px-8">
    <!-- Header -->
    <div class="relative text-center mb-6 sm:mb-8 lg:mb-12">
      <!-- Back Button (Top Left) -->
      <div class="absolute left-0 top-0">
        <NavButton onclick={() => history.back()} icon="back" label="Back" />
      </div>

      <!-- Logout Button (Top Right) -->
      <div class="absolute right-0 top-0">
        <NavButton onclick={handleLogout} icon="logout" label="Logout" hideLabel variant="danger" />
      </div>

      <h1
        class="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight mb-2 sm:mb-3 bg-gradient-to-r from-purple-400 via-violet-400 to-cyan-400 bg-clip-text text-transparent"
      >
        Settings
      </h1>
      <p class="text-muted-foreground text-base sm:text-lg">
        Configure integrations and system defaults for Clarity AI
      </p>
    </div>

    {#if loading}
      <LoadingSpinner />
    {:else}
      <!-- Success Banner -->
      {#if success}
        <Card class="p-4 mb-6 border-green-500/50 bg-green-500/5">
          <div class="flex items-center gap-3">
            <svg
              class="w-5 h-5 text-green-500"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M5 13l4 4L19 7"
              />
            </svg>
            <span class="text-green-400">Settings saved successfully!</span>
          </div>
        </Card>
      {/if}

      <!-- Error Banner -->
      {#if error}
        <Card class="p-4 mb-6 border-red-500/50 bg-red-500/5">
          <div class="flex items-center gap-3">
            <svg
              class="w-5 h-5 text-red-500"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
            <span class="text-red-400">{error}</span>
          </div>
        </Card>
      {/if}

      <!-- Tabs Navigation -->
      <div class="max-w-6xl mx-auto mb-6">
        <div class="border-b border-slate-700">
          <nav class="flex gap-1 overflow-x-auto">
            <button
              onclick={() => setActiveTab('integrations')}
              class="px-4 py-3 font-medium text-sm whitespace-nowrap transition-colors border-b-2 {activeTab === 'integrations' ? 'border-cyan-500 text-cyan-400' : 'border-transparent text-muted-foreground hover:text-white'}"
            >
              <div class="flex items-center gap-2">
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 4a2 2 0 114 0v1a1 1 0 001 1h3a1 1 0 011 1v3a1 1 0 01-1 1h-1a2 2 0 100 4h1a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1v-1a2 2 0 10-4 0v1a1 1 0 01-1 1H7a1 1 0 01-1-1v-3a1 1 0 00-1-1H4a2 2 0 110-4h1a1 1 0 001-1V7a1 1 0 011-1h3a1 1 0 001-1V4z" />
                </svg>
                Integrations
              </div>
            </button>
            <button
              onclick={() => setActiveTab('defaults')}
              class="px-4 py-3 font-medium text-sm whitespace-nowrap transition-colors border-b-2 {activeTab === 'defaults' ? 'border-cyan-500 text-cyan-400' : 'border-transparent text-muted-foreground hover:text-white'}"
            >
              <div class="flex items-center gap-2">
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                System Defaults
              </div>
            </button>
            <button
              onclick={() => setActiveTab('auth')}
              class="px-4 py-3 font-medium text-sm whitespace-nowrap transition-colors border-b-2 {activeTab === 'auth' ? 'border-cyan-500 text-cyan-400' : 'border-transparent text-muted-foreground hover:text-white'}"
            >
              <div class="flex items-center gap-2">
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
                Authentication
              </div>
            </button>
            <button
              onclick={() => setActiveTab('users')}
              class="px-4 py-3 font-medium text-sm whitespace-nowrap transition-colors border-b-2 {activeTab === 'users' ? 'border-cyan-500 text-cyan-400' : 'border-transparent text-muted-foreground hover:text-white'}"
            >
              <div class="flex items-center gap-2">
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
                Users
              </div>
            </button>
          </nav>
        </div>
      </div>

      <!-- Integrations Tab -->
      {#if activeTab === 'integrations'}
      <div class="mb-6 sm:mb-8 max-w-6xl mx-auto">
        <h2 class="text-lg sm:text-xl font-semibold mb-4">Integrations</h2>
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <!-- LLM Config Card -->
          <ConfigCard
            title="LLM Providers"
            subtitle="Multi-provider API keys"
            configured={llmConfigured}
            buttonLabel="Configure LLM"
            onConfigure={() => (window.location.href = getLLMSetupUrl())}
          >
            {#snippet icon()}
              <div class="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-cyan-500 flex items-center justify-center">
                <svg class="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
                </svg>
              </div>
            {/snippet}
          </ConfigCard>

          <!-- GitHub Card -->
          <ConfigCard
            title="GitHub"
            subtitle={githubConfigured ? `${repositoryCount} repos` : "Connect repos"}
            configured={githubConfigured}
            configuredLabel="Connected"
            notConfiguredLabel="Not Connected"
            buttonLabel="Configure GitHub"
            onConfigure={() => (window.location.href = getGitHubSetupUrl())}
          >
            {#snippet icon()}
              <svg class="w-10 h-10" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
              </svg>
            {/snippet}
          </ConfigCard>

          <!-- Slack Card -->
          <ConfigCard
            title="Slack"
            subtitle="Slash commands"
            configured={slackConfigured}
            configuredLabel="Connected"
            notConfiguredLabel="Not Connected"
            buttonLabel="Configure Slack"
            onConfigure={() => (window.location.href = getSlackSetupUrl())}
          >
            {#snippet icon()}
              <svg class="w-10 h-10" viewBox="0 0 24 24" fill="currentColor">
                <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z" />
              </svg>
            {/snippet}
          </ConfigCard>
        </div>
      </div>
      {/if}

      <!-- System Defaults Tab -->
      {#if activeTab === 'defaults'}
      <Card class="p-4 sm:p-6 mb-6 sm:mb-8 max-w-6xl mx-auto">
        <h2 class="text-lg sm:text-xl font-semibold mb-4 sm:mb-6">System Defaults</h2>

        <div class="space-y-4 sm:space-y-6">
          <!-- Default Agent Settings -->
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label for="agentType" class="block text-sm font-medium mb-2">Default Agent</label>
              <Select
                id="agentType"
                bind:value={formData.defaultAgentType}
                options={[
                  { value: 'claude-code', label: 'Claude Code' },
                  { value: 'opencode', label: 'OpenCode' }
                ]}
                placeholder="Select an agent..."
                class="w-full"
              />
              <p class="text-xs text-muted-foreground mt-1">Agent to use for processing requests</p>
            </div>

            <div>
              <label for="agentProvider" class="block text-sm font-medium mb-2">Default Provider</label>
              {#if configuredProviderOptions.length > 0}
                <Select
                  id="agentProvider"
                  bind:value={formData.defaultAgentProvider}
                  options={configuredProviderOptions}
                  placeholder="Select a provider..."
                  class="w-full"
                />
              {:else}
                <div class="flex h-10 w-full items-center rounded-md border border-yellow-500/50 bg-yellow-500/10 px-3 py-2 text-sm text-yellow-400">
                  <a href={getLLMSetupUrl()} class="hover:underline">Please configure LLM providers first</a>
                </div>
              {/if}
              <p class="text-xs text-muted-foreground mt-1">LLM provider for the agent</p>
            </div>
          </div>

          <div>
            <label for="agentModel" class="block text-sm font-medium mb-2">Default Model (Optional)</label>
            <Input
              id="agentModel"
              placeholder="e.g., claude-sonnet-4-5-20250514"
              bind:value={formData.defaultAgentModel}
              class="w-full"
            />
            <p class="text-xs text-muted-foreground mt-1">Specific model to use (leave empty for provider default)</p>
          </div>

          <!-- Default Repository Settings -->
          <div class="border-t border-slate-700 pt-4 sm:pt-6">
            <h3 class="text-base sm:text-lg font-medium mb-4">Default Repository</h3>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label for="defaultRepo" class="block text-sm font-medium mb-2">Default Repository</label>
                {#if status?.installation?.repositories && status.installation.repositories.filter(r => r.fullName).length > 0}
                  <Select
                    id="defaultRepo"
                    bind:value={formData.defaultRepository}
                    options={status.installation.repositories.filter(r => r.fullName).map(repo => ({ value: repo.fullName, label: repo.fullName }))}
                    placeholder="-- Not Selected --"
                    class="w-full"
                  />
                {:else}
                  <Input
                    id="defaultRepo"
                    placeholder="e.g., owner/repo-name"
                    bind:value={formData.defaultRepository}
                    class="w-full"
                  />
                  <p class="text-xs text-yellow-500 mt-1">Connect GitHub to see available repositories</p>
                {/if}
                <p class="text-xs text-muted-foreground mt-1">Used when no repo is specified in Slack requests</p>
              </div>

              <div>
                <label for="defaultBranch" class="block text-sm font-medium mb-2">Default Branch</label>
                <Input
                  id="defaultBranch"
                  placeholder="e.g., main"
                  bind:value={formData.defaultBranch}
                  class="w-full"
                />
                <p class="text-xs text-muted-foreground mt-1">Base branch for new PRs</p>
              </div>
            </div>
          </div>

          <!-- Organization Settings -->
          <div class="border-t border-slate-700 pt-4 sm:pt-6">
            <h3 class="text-base sm:text-lg font-medium mb-4">Organization</h3>
            <div>
              <label for="githubOrg" class="block text-sm font-medium mb-2">GitHub Organization</label>
              <Input
                id="githubOrg"
                placeholder="e.g., your-org-name"
                bind:value={formData.githubOrganizationName}
                class="w-full"
              />
              <p class="text-xs text-muted-foreground mt-1">GitHub organization for repository selection</p>
            </div>
          </div>

          <!-- Custom Prompt -->
          <div class="border-t border-slate-700 pt-4 sm:pt-6">
            <h3 class="text-base sm:text-lg font-medium mb-4">Custom Default Prompt</h3>
            <div>
              <label for="customPrompt" class="block text-sm font-medium mb-2">System Prompt Prefix</label>
              <textarea
                id="customPrompt"
                placeholder="Enter custom instructions that will be prepended to all agent requests..."
                bind:value={formData.customDefaultPrompt}
                rows={8}
                class="w-full min-h-[120px] px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-white focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 outline-none resize-y font-mono text-sm"
              ></textarea>
              <p class="text-xs text-muted-foreground mt-1">Drag the bottom-right corner to resize. Custom instructions prepended to all agent requests (e.g., coding standards, guidelines)</p>
            </div>
          </div>

          <!-- Save Button -->
          <div class="flex justify-end pt-4">
            <Button onclick={handleSaveDefaults} disabled={saving}>
              {saving ? "Saving..." : "Save Settings"}
            </Button>
          </div>
        </div>
      </Card>
      {/if}

      <!-- Authentication Tab -->
      {#if activeTab === 'auth'}
      <Card class="p-4 sm:p-6 mb-6 sm:mb-8 max-w-6xl mx-auto">
        <div class="flex items-center gap-3 mb-4 sm:mb-6">
          <h2 class="text-lg sm:text-xl font-semibold">Authentication Settings</h2>
        </div>
        <p class="text-sm text-muted-foreground mb-6">
          Configure who can login and their default permissions.
        </p>

        <div class="space-y-4 sm:space-y-6">
          <!-- Allowed Domains -->
          <div class="border-t border-slate-700 pt-4 sm:pt-6">
            <h3 class="text-base sm:text-lg font-medium mb-2">Allowed Domains</h3>
            <p class="text-xs text-muted-foreground mb-4">
              Restrict login to users from specific Google Workspace domains. Leave empty to allow all domains.
            </p>

            <!-- Domain tags -->
            <div class="flex flex-wrap gap-2 mb-3">
              {#each formData.auth?.allowedDomains || [] as domain}
                <span class="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-cyan-500/20 text-cyan-400 text-sm">
                  {domain}
                  <button
                    type="button"
                    onclick={() => removeDomain(domain)}
                    class="hover:text-red-400 transition-colors"
                  >
                    <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </span>
              {/each}
              {#if (formData.auth?.allowedDomains?.length || 0) === 0}
                <span class="text-sm text-muted-foreground italic">All domains allowed</span>
              {/if}
            </div>

            <!-- Add domain input -->
            <div class="flex gap-2">
              <Input
                placeholder="e.g., cleartax.in"
                bind:value={newDomain}
                onkeydown={(e: KeyboardEvent) => e.key === 'Enter' && (e.preventDefault(), addDomain())}
                class="flex-1"
              />
              <Button onclick={addDomain} variant="secondary">Add</Button>
            </div>
          </div>

          <!-- Allowed Emails -->
          <div class="border-t border-slate-700 pt-4 sm:pt-6">
            <h3 class="text-base sm:text-lg font-medium mb-2">Allowed Emails</h3>
            <p class="text-xs text-muted-foreground mb-4">
              Allow specific email addresses regardless of domain restrictions. Useful for contractors or external users.
            </p>

            <!-- Email tags -->
            <div class="flex flex-wrap gap-2 mb-3">
              {#each formData.auth?.allowedEmails || [] as email}
                <span class="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-green-500/20 text-green-400 text-sm">
                  {email}
                  <button
                    type="button"
                    onclick={() => removeEmail(email)}
                    class="hover:text-red-400 transition-colors"
                  >
                    <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </span>
              {/each}
              {#if (formData.auth?.allowedEmails?.length || 0) === 0}
                <span class="text-sm text-muted-foreground italic">No additional emails</span>
              {/if}
            </div>

            <!-- Add email input -->
            <div class="flex gap-2">
              <Input
                placeholder="e.g., contractor@gmail.com"
                bind:value={newEmail}
                onkeydown={(e: KeyboardEvent) => e.key === 'Enter' && (e.preventDefault(), addEmail())}
                class="flex-1"
              />
              <Button onclick={addEmail} variant="secondary">Add</Button>
            </div>
          </div>

          <!-- Default Policy -->
          <div class="border-t border-slate-700 pt-4 sm:pt-6">
            <h3 class="text-base sm:text-lg font-medium mb-2">Default Policy</h3>
            <p class="text-xs text-muted-foreground mb-4">
              Policy assigned to new users by default. Admins can change individual user policies later.
            </p>
            <Select
              id="defaultPolicy"
              bind:value={formData.auth!.defaultPolicyId}
              options={[
                { value: 'developer', label: 'Developer - Repo access only (Recommended)' },
                { value: 'admin', label: 'Admin - Configure access only' },
                { value: 'super_admin', label: 'Super Admin - Full access' }
              ]}
              class="w-full max-w-md"
            />
          </div>

          <!-- Save Button -->
          <div class="flex justify-end pt-4">
            <Button onclick={handleSaveDefaults} disabled={saving}>
              {saving ? "Saving..." : "Save Auth Settings"}
            </Button>
          </div>
        </div>
      </Card>
      {/if}

      <!-- Users Tab -->
      {#if activeTab === 'users'}
      <div class="mb-6 sm:mb-8 max-w-6xl mx-auto">
        <UsersManagement />
      </div>
      {/if}
    {/if}

    <!-- Footer -->
    <Footer />
  </div>
</div>
