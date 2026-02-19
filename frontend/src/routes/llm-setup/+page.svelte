<script lang="ts">
  import Button from "$lib/components/ui/button.svelte";
  import Card from "$lib/components/ui/card.svelte";
  import Input from "$lib/components/ui/input.svelte";
  import Badge from "$lib/components/ui/badge.svelte";
  import NavButton from "$lib/components/ui/nav-button.svelte";
  import Footer from "$lib/components/ui/footer.svelte";
  import {
    setLLMConfig,
    getLLMStatus,
    deleteLLMConfig,
    type LLMSetupRequest,
    type LLMStatus,
  } from "$lib/api";
  import { browser } from "$app/environment";

  // Provider configuration
  const PROVIDERS = [
    {
      id: "anthropic",
      name: "Anthropic",
      description: "Claude models (Claude 3.5 Sonnet, Opus, etc.)",
      field: "anthropic_api_key" as keyof LLMSetupRequest,
      prefix: "sk-ant-",
      placeholder: "sk-ant-api03-...",
      url: "https://console.anthropic.com/",
      gradient: "from-orange-400 to-orange-600",
      primary: true,
    },
    {
      id: "openai",
      name: "OpenAI",
      description: "GPT-4, GPT-4o, o1 models",
      field: "openai_api_key" as keyof LLMSetupRequest,
      prefix: "sk-",
      placeholder: "sk-...",
      url: "https://platform.openai.com/api-keys",
      gradient: "from-green-400 to-emerald-600",
    },
    {
      id: "google",
      name: "Google",
      description: "Gemini models",
      field: "google_api_key" as keyof LLMSetupRequest,
      prefix: null,
      placeholder: "AIza...",
      url: "https://aistudio.google.com/apikey",
      gradient: "from-blue-400 to-blue-600",
    },
    {
      id: "groq",
      name: "Groq",
      description: "Fast inference (Llama, Mixtral)",
      field: "groq_api_key" as keyof LLMSetupRequest,
      prefix: "gsk_",
      placeholder: "gsk_...",
      url: "https://console.groq.com/keys",
      gradient: "from-purple-400 to-purple-600",
    },
    {
      id: "deepseek",
      name: "DeepSeek",
      description: "DeepSeek Coder, Chat models",
      field: "deepseek_api_key" as keyof LLMSetupRequest,
      prefix: "sk-",
      placeholder: "sk-...",
      url: "https://platform.deepseek.com/api_keys",
      gradient: "from-cyan-400 to-cyan-600",
    },
    {
      id: "mistral",
      name: "Mistral",
      description: "Mistral Large, Codestral",
      field: "mistral_api_key" as keyof LLMSetupRequest,
      prefix: null,
      placeholder: "...",
      url: "https://console.mistral.ai/api-keys/",
      gradient: "from-amber-400 to-amber-600",
    },
    {
      id: "together",
      name: "Together AI",
      description: "Open-source models hosting",
      field: "together_api_key" as keyof LLMSetupRequest,
      prefix: null,
      placeholder: "...",
      url: "https://api.together.xyz/settings/api-keys",
      gradient: "from-rose-400 to-rose-600",
    },
    {
      id: "fireworks",
      name: "Fireworks AI",
      description: "Fast model inference",
      field: "fireworks_api_key" as keyof LLMSetupRequest,
      prefix: "fw_",
      placeholder: "fw_...",
      url: "https://fireworks.ai/api-keys",
      gradient: "from-red-400 to-red-600",
    },
  ] as const;

  // State
  let apiKeys = $state<Record<string, string>>({});
  let saving = $state(false);
  let success = $state(false);
  let error = $state("");
  let loading = $state(true);
  let llmStatus = $state<LLMStatus | null>(null);
  let configuredProviders = $state<string[]>([]);
  let expandedProvider = $state<string | null>(null);

  $effect(() => {
    if (!browser) return;

    // Load current LLM status
    (async () => {
      try {
        const status = await getLLMStatus();
        llmStatus = status;
      } catch (e) {
        console.error("[LLMSetup] Failed to get status:", e);
      } finally {
        loading = false;
      }
    })();
  });

  function isProviderConfigured(providerId: string): boolean {
    if (!llmStatus?.providers) return false;
    return llmStatus.providers[providerId as keyof typeof llmStatus.providers] ?? false;
  }

  function getConfiguredCount(): number {
    if (!llmStatus?.providers) return 0;
    return Object.values(llmStatus.providers).filter(Boolean).length;
  }

  function toggleProvider(providerId: string) {
    expandedProvider = expandedProvider === providerId ? null : providerId;
  }

  function validateKey(providerId: string, key: string): string | null {
    const provider = PROVIDERS.find((p) => p.id === providerId);
    if (!provider || !key.trim()) return null;

    if (provider.prefix && !key.startsWith(provider.prefix)) {
      return `API key must start with "${provider.prefix}"`;
    }
    return null;
  }

  async function handleSaveProvider(providerId: string) {
    const key = apiKeys[providerId];
    if (!key?.trim()) return;

    const validationError = validateKey(providerId, key);
    if (validationError) {
      error = validationError;
      return;
    }

    saving = true;
    error = "";

    try {
      const provider = PROVIDERS.find((p) => p.id === providerId);
      if (!provider) return;

      const config: LLMSetupRequest = {
        [provider.field]: key,
      };

      const result = await setLLMConfig(config);
      configuredProviders = result.configuredProviders;

      // Refresh status
      const status = await getLLMStatus();
      llmStatus = status;

      // Clear input and collapse
      apiKeys[providerId] = "";
      expandedProvider = null;
      success = true;
      setTimeout(() => (success = false), 3000);
    } catch (e) {
      error = e instanceof Error ? e.message : "Failed to save API key";
    } finally {
      saving = false;
    }
  }

  async function handleDeleteProvider(providerId: string) {
    if (!confirm(`Are you sure you want to remove the ${providerId} API key?`)) {
      return;
    }

    saving = true;
    error = "";

    try {
      await deleteLLMConfig(providerId);

      // Refresh status
      const status = await getLLMStatus();
      llmStatus = status;
    } catch (e) {
      error = e instanceof Error ? e.message : "Failed to delete API key";
    } finally {
      saving = false;
    }
  }

</script>

<div
  class="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950"
>
  <div class="container mx-auto max-w-3xl py-6 sm:py-8 lg:py-12 px-4 sm:px-6 lg:px-8">
    <!-- Header -->
    <div class="relative text-center mb-6 sm:mb-8">
      <!-- Back Button (Top Left) -->
      <div class="absolute left-0 top-0">
        <NavButton onclick={() => history.back()} icon="back" label="Back" />
      </div>

      <h1
        class="text-3xl sm:text-4xl font-bold tracking-tight mb-2 sm:mb-3 bg-gradient-to-r from-purple-400 via-violet-400 to-cyan-400 bg-clip-text text-transparent"
      >
        LLM Configuration
      </h1>
      <p class="text-muted-foreground text-sm sm:text-base">
        Configure API keys for multiple LLM providers to power your AI agents
      </p>
    </div>

    {#if loading}
      <!-- Loading State -->
      <Card class="p-8 text-center">
        <div class="animate-pulse">
          <div class="w-16 h-16 mx-auto mb-4 rounded-full bg-slate-700"></div>
          <div class="h-6 bg-slate-700 rounded w-48 mx-auto mb-2"></div>
          <div class="h-4 bg-slate-700 rounded w-64 mx-auto"></div>
        </div>
      </Card>
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
            <span class="text-green-400">API key saved successfully!</span>
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

      <!-- Status Summary -->
      <Card class="p-4 mb-6 border-slate-700">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-3">
            <div
              class="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-cyan-500 flex items-center justify-center"
            >
              <svg
                class="w-5 h-5 text-white"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z"
                />
              </svg>
            </div>
            <div>
              <h2 class="font-semibold">Provider Status</h2>
              <p class="text-sm text-muted-foreground">
                {getConfiguredCount()} of {PROVIDERS.length} providers configured
              </p>
            </div>
          </div>
          {#if llmStatus?.configured}
            <Badge variant="success">Ready</Badge>
          {:else}
            <Badge variant="warning">Setup Required</Badge>
          {/if}
        </div>
      </Card>

      <!-- Info Box -->
      <Card class="p-4 mb-6 border-blue-500/30 bg-blue-500/5">
        <div class="flex gap-3">
          <svg
            class="w-5 h-5 text-blue-400 shrink-0 mt-0.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <div>
            <p class="text-blue-400 font-medium text-sm">Multi-Provider Support</p>
            <p class="text-muted-foreground text-sm">
              Configure multiple providers to use different models. At least one
              provider (Anthropic recommended) is required for AI processing.
            </p>
          </div>
        </div>
      </Card>

      <!-- Provider List -->
      <div class="space-y-3">
        {#each PROVIDERS as provider}
          <Card
            class="overflow-hidden border-slate-700 {isProviderConfigured(provider.id)
              ? 'border-green-500/30'
              : ''}"
          >
            <!-- Provider Header -->
            <button
              class="w-full p-4 flex items-center justify-between hover:bg-slate-800/50 transition-colors"
              onclick={() => toggleProvider(provider.id)}
            >
              <div class="flex items-center gap-3">
                <div
                  class="w-10 h-10 rounded-full bg-gradient-to-br {provider.gradient} flex items-center justify-center text-white font-bold text-sm"
                >
                  {provider.name.charAt(0)}
                </div>
                <div class="text-left">
                  <div class="flex items-center gap-2">
                    <span class="font-medium">{provider.name}</span>
                    {#if 'primary' in provider && provider.primary}
                      <span
                        class="text-xs px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-400"
                        >Recommended</span
                      >
                    {/if}
                  </div>
                  <p class="text-xs text-muted-foreground">
                    {provider.description}
                  </p>
                </div>
              </div>
              <div class="flex items-center gap-3">
                {#if isProviderConfigured(provider.id)}
                  <Badge variant="success">Configured</Badge>
                {/if}
                <svg
                  class="w-5 h-5 text-muted-foreground transition-transform {expandedProvider ===
                  provider.id
                    ? 'rotate-180'
                    : ''}"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
              </div>
            </button>

            <!-- Expanded Content -->
            {#if expandedProvider === provider.id}
              <div class="px-4 pb-4 pt-2 border-t border-slate-800">
                <div class="mb-3">
                  <p class="text-sm text-muted-foreground mb-2">
                    Get your API key from
                    <a
                      href={provider.url}
                      target="_blank"
                      class="text-cyan-400 hover:underline"
                      >{provider.name} Console</a
                    >
                  </p>
                </div>

                {#if isProviderConfigured(provider.id)}
                  <div
                    class="flex items-center justify-between p-3 bg-green-500/10 rounded-lg mb-3"
                  >
                    <div class="flex items-center gap-2">
                      <svg
                        class="w-4 h-4 text-green-500"
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
                      <span class="text-sm text-green-400"
                        >API key is configured</span
                      >
                    </div>
                    <button
                      onclick={() => handleDeleteProvider(provider.id)}
                      disabled={saving}
                      class="text-xs text-red-400 hover:text-red-300 px-2 py-1 rounded border border-red-400/50 hover:bg-red-400/10 transition-colors"
                    >
                      Remove
                    </button>
                  </div>
                {/if}

                <div class="space-y-3">
                  <Input
                    type="password"
                    placeholder={provider.placeholder}
                    bind:value={apiKeys[provider.id]}
                    class="w-full font-mono text-sm"
                  />
                  <Button
                    onclick={() => handleSaveProvider(provider.id)}
                    disabled={saving || !apiKeys[provider.id]?.trim()}
                    class="w-full"
                  >
                    {saving
                      ? "Saving..."
                      : isProviderConfigured(provider.id)
                        ? "Update API Key"
                        : "Save API Key"}
                  </Button>
                </div>
              </div>
            {/if}
          </Card>
        {/each}
      </div>

      <!-- Security Note -->
      <Card class="p-4 mt-6 border-green-500/30 bg-green-500/5">
        <div class="flex gap-3">
          <svg
            class="w-5 h-5 text-green-500 shrink-0 mt-0.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
            />
          </svg>
          <div>
            <p class="text-green-400 font-medium text-sm">Security</p>
            <p class="text-muted-foreground text-sm">
              All API keys are encrypted using AES-256-GCM before storage. Only
              your worker deployment can decrypt and use them.
            </p>
          </div>
        </div>
      </Card>
    {/if}

    <!-- Footer -->
    <Footer />
  </div>
</div>
