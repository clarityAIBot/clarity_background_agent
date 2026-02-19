<script lang="ts">
  import { browser } from "$app/environment";
  import Button from "$lib/components/ui/button.svelte";
  import Card from "$lib/components/ui/card.svelte";
  import Badge from "$lib/components/ui/badge.svelte";
  import NavButton from "$lib/components/ui/nav-button.svelte";
  import {
    getGitHubStatus,
    deleteGitHubApp,
    getSystemDefaults,
    getSettingsUrl,
    type Repository,
  } from "$lib/api";

  // Compute URLs from browser origin
  const origin = $derived(browser ? window.location.origin : "");
  const webhookUrl = $derived(`${origin}/webhooks/github`);

  let loading = $state(true);
  let configured = $state(false);
  let repoCount = $state(0);
  let repositories = $state<Repository[]>([]);
  let appId = $state<string | undefined>(undefined);

  // Success state from OAuth callback redirect
  let justCreated = $state(false);
  let createdAppName = $state<string | undefined>(undefined);
  let installUrl = $state<string | undefined>(undefined);

  // Delete state
  let showDeleteConfirm = $state(false);
  let deleting = $state(false);
  let deleteError = $state<string | undefined>(undefined);
  let deletedAppId = $state<string | undefined>(undefined);

  // Organization selection for app creation
  let selectedOrg = $state<string>("personal");
  let organizations = $state<string[]>(["personal"]);

  // Load organization from system defaults
  async function loadOrganizations() {
    try {
      const defaults = await getSystemDefaults();
      if (defaults.githubOrganizationName && defaults.githubOrganizationName.trim()) {
        // Add the configured org if not already present
        const orgName = defaults.githubOrganizationName.trim();
        if (!organizations.includes(orgName)) {
          organizations = ["personal", orgName];
        }
      }
    } catch (e) {
      console.error("[GitHubSetup] Failed to load system defaults:", e);
    }
  }

  // Compute GitHub App creation URL based on selected org
  const githubAppUrl = $derived(
    selectedOrg === "personal"
      ? "https://github.com/settings/apps/new"
      : `https://github.com/organizations/${selectedOrg}/settings/apps/new`,
  );

  $effect(() => {
    if (!browser) return;

    // Load organizations from system defaults
    loadOrganizations();

    // Check for success callback from OAuth
    const urlParams = new URLSearchParams(window.location.search);
    const success = urlParams.get("success");
    if (success === "true") {
      justCreated = true;
      appId = urlParams.get("app_id") || undefined;
      createdAppName = urlParams.get("app_name") || undefined;
      installUrl = urlParams.get("install_url") || undefined;
      loading = false;

      // Clean up URL params
      const cleanUrl = new URL(window.location.href);
      cleanUrl.search = "";
      window.history.replaceState({}, "", cleanUrl.toString());
      return; // Don't need to fetch status, just show success page
    }

    (async () => {
      try {
        const status = await getGitHubStatus();
        configured = status.configured;
        repoCount = status.repositoryCount || 0;
        repositories = status.repositories || [];
        appId = status.appId; // Always update appId from server
      } catch (e) {
        console.error("[GitHubSetup] Failed to load status:", e);
      } finally {
        loading = false;
      }
    })();
  });

  const manifest = $derived.by(() => {
    if (!origin) return "";
    const appManifest = {
      name: "Clarity AI",
      url: origin,
      hook_attributes: {
        url: webhookUrl,
      },
      redirect_url: `${origin}/api/gh-callback`,
      callback_urls: [`${origin}/api/gh-callback`],
      setup_url: origin,
      public: false,
      default_permissions: {
        contents: "write",
        metadata: "read",
        pull_requests: "write",
        issues: "write",
      },
      default_events: ["issues"],
    };
    return JSON.stringify(appManifest);
  });

  function goHome() {
    window.location.href = "/";
  }

  async function handleDelete() {
    deleting = true;
    deleteError = undefined;

    try {
      const result = await deleteGitHubApp();
      deletedAppId = result.appId || appId; // Store the deleted appId for the message
      configured = false;
      justCreated = false;
      showDeleteConfirm = false;
      appId = undefined; // Clear appId to fully reset state
      repoCount = 0;
    } catch (e) {
      deleteError = e instanceof Error ? e.message : "Failed to delete";
    } finally {
      deleting = false;
    }
  }
</script>

<div
  class="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950"
>
  <div class="container mx-auto max-w-2xl py-12 px-4">
    <!-- Header -->
    <div class="relative text-center mb-8">
      <!-- Back Button (Top Left) -->
      <div class="absolute left-0 top-0">
        <NavButton onclick={() => history.back()} icon="back" label="Back" />
      </div>

      <h1 class="text-4xl font-bold tracking-tight mb-3 text-white">
        GitHub App Setup
      </h1>
      <p class="text-muted-foreground">
        Configure GitHub webhook integration for Clarity AI
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
    {:else if justCreated}
      <!-- Just Created - Show Install Button -->
      <Card class="p-8 text-center border-green-500/50 bg-green-500/5 mb-6">
        <div
          class="w-16 h-16 mx-auto mb-4 rounded-full bg-green-500/20 flex items-center justify-center"
        >
          <svg
            class="w-8 h-8 text-green-500"
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
        </div>
        <h2 class="text-2xl font-semibold text-green-400 mb-2">
          GitHub App Created!
        </h2>
        <div class="flex items-center justify-center gap-2 mb-4">
          {#if createdAppName}
            <Badge variant="secondary">{createdAppName}</Badge>
          {/if}
          {#if appId}
            <Badge variant="outline">App ID: {appId}</Badge>
          {/if}
        </div>
        <p class="text-muted-foreground mb-6">
          Your GitHub App has been created successfully. Now install it on your
          repositories to start receiving webhooks.
        </p>
        {#if installUrl}
          <a
            href={installUrl}
            class="inline-flex items-center justify-center gap-2 px-6 py-3 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-lg transition-colors"
          >
            <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <path
                d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"
              />
            </svg>
            Install App on Repositories
          </a>
        {/if}
      </Card>
    {:else if deletedAppId}
      <!-- Deleted State -->
      <Card class="p-8 text-center border-yellow-500/50 bg-yellow-500/5 mb-6">
        <div
          class="w-16 h-16 mx-auto mb-4 rounded-full bg-yellow-500/20 flex items-center justify-center"
        >
          <svg
            class="w-8 h-8 text-yellow-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
        </div>
        <h2 class="text-2xl font-semibold text-yellow-400 mb-2">
          GitHub App Disconnected
        </h2>
        <p class="text-muted-foreground mb-4">
          The GitHub app configuration has been removed from Clarity AI.
        </p>
        <div
          class="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4 mb-6 text-left"
        >
          <p class="text-yellow-400 font-medium mb-2">
            Important: Delete the app from GitHub
          </p>
          <p class="text-sm text-muted-foreground mb-3">
            To fully remove the app, you must also delete it from your GitHub
            settings:
          </p>
          <a
            href="https://github.com/settings/apps"
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center gap-2 text-cyan-400 hover:text-cyan-300 text-sm"
          >
            <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path
                d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"
              />
            </svg>
            Go to GitHub Apps Settings →
          </a>
        </div>
        <p class="text-sm text-muted-foreground mb-4">
          You can now create a new GitHub App to reconnect.
        </p>
        <Button
          onclick={() => {
            deletedAppId = undefined;
          }}
        >
          Create New GitHub App
        </Button>
      </Card>
    {:else if configured}
      <!-- Configured State -->
      <Card class="p-8 text-center border-green-500/50 bg-green-500/5 mb-6">
        <div
          class="w-16 h-16 mx-auto mb-4 rounded-full bg-green-500/20 flex items-center justify-center"
        >
          <svg
            class="w-8 h-8 text-green-500"
            fill="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"
            />
          </svg>
        </div>
        <h2 class="text-2xl font-semibold text-green-400 mb-2">
          GitHub Connected!
        </h2>
        <div class="flex items-center justify-center gap-2 mb-4">
          <Badge variant="success">App ID: {appId}</Badge>
          <Badge variant={repoCount > 0 ? "secondary" : "warning"}>{repoCount} repositories</Badge>
        </div>

        <!-- Repository List -->
        <div class="mb-6">
          {#if repositories.length > 0}
            <div class="bg-slate-800/50 rounded-lg p-4 mb-4">
              <h3 class="text-sm font-medium text-muted-foreground mb-3">Connected Repositories</h3>
              <div class="space-y-2">
                {#each repositories as repo}
                  <a
                    href="https://github.com/{repo.fullName}"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="flex items-center gap-2 text-sm text-cyan-400 hover:text-cyan-300 transition-colors"
                  >
                    <svg class="w-4 h-4 shrink-0" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                    </svg>
                    <span>{repo.fullName}</span>
                  </a>
                {/each}
              </div>
            </div>
          {:else}
            <div class="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4 mb-4">
              <div class="flex items-start gap-3">
                <svg class="w-5 h-5 text-yellow-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <div class="text-left">
                  <p class="text-yellow-400 font-medium text-sm">No repositories configured</p>
                  <p class="text-xs text-muted-foreground">
                    Install the GitHub App on repositories to start using Clarity AI.
                  </p>
                </div>
              </div>
            </div>
          {/if}

          <!-- Always show Configure Repositories link -->
          <a
            href={appId ? `https://github.com/settings/installations` : "https://github.com/apps"}
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center gap-2 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white font-medium rounded-lg transition-colors text-sm"
          >
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
            {repositories.length > 0 ? "Add More Repositories" : "Configure Repositories"}
          </a>
        </div>

        <div class="flex gap-4 justify-center flex-wrap">
          <form
            action="https://github.com/settings/apps/new"
            method="post"
            id="update-github-app"
          >
            <input type="hidden" name="manifest" value={manifest} />
            <Button type="submit" variant="secondary">
              Update Configuration
            </Button>
          </form>
          <Button onclick={goHome}>Go to Home Page →</Button>
        </div>

        <!-- Delete Section -->
        <div class="mt-8 pt-6 border-t border-slate-700">
          {#if showDeleteConfirm}
            <div class="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
              <p class="text-red-400 font-medium mb-2">Are you sure?</p>
              <p class="text-sm text-muted-foreground mb-4">
                This will disconnect the GitHub app from Clarity AI. You'll need
                to create a new app to reconnect.
              </p>
              {#if deleteError}
                <p class="text-red-400 text-sm mb-3">{deleteError}</p>
              {/if}
              <div class="flex gap-3 justify-center">
                <Button
                  variant="secondary"
                  onclick={() => {
                    showDeleteConfirm = false;
                    deleteError = undefined;
                  }}
                  disabled={deleting}
                >
                  Cancel
                </Button>
                <button
                  onclick={handleDelete}
                  disabled={deleting}
                  class="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-medium rounded-lg transition-colors"
                >
                  {deleting ? "Deleting..." : "Yes, Delete"}
                </button>
              </div>
            </div>
          {:else}
            <button
              onclick={() => {
                showDeleteConfirm = true;
              }}
              class="text-red-400 hover:text-red-300 text-sm"
            >
              Delete GitHub App
            </button>
          {/if}
        </div>
      </Card>
    {:else}
      <!-- Setup UI -->
      <!-- Webhook URL -->
      <Card class="p-6 mb-6">
        <h3 class="text-lg font-semibold mb-3">Your Webhook URL</h3>
        <div
          class="bg-black/30 p-3 rounded-lg font-mono text-cyan-400 text-sm break-all"
        >
          {webhookUrl || "Loading..."}
        </div>
        <p class="text-muted-foreground text-sm mt-2">
          This URL will receive GitHub webhook events once setup is complete.
        </p>
      </Card>

      <!-- Steps -->
      <Card class="p-6 mb-6">
        <h3 class="text-lg font-semibold mb-4">Setup Steps</h3>
        <div class="space-y-4">
          <div class="flex gap-3">
            <div
              class="w-6 h-6 rounded-full bg-primary flex items-center justify-center text-xs font-bold shrink-0"
            >
              1
            </div>
            <div>
              <p class="font-medium">Create GitHub App</p>
              <p class="text-sm text-muted-foreground">
                Click the button below to create a pre-configured GitHub App
                with all necessary permissions and webhook settings.
              </p>
            </div>
          </div>
          <div class="flex gap-3">
            <div
              class="w-6 h-6 rounded-full bg-primary flex items-center justify-center text-xs font-bold shrink-0"
            >
              2
            </div>
            <div>
              <p class="font-medium">Choose Account</p>
              <p class="text-sm text-muted-foreground">
                Select which GitHub account or organization should own the app.
              </p>
            </div>
          </div>
          <div class="flex gap-3">
            <div
              class="w-6 h-6 rounded-full bg-primary flex items-center justify-center text-xs font-bold shrink-0"
            >
              3
            </div>
            <div>
              <p class="font-medium">Install App</p>
              <p class="text-sm text-muted-foreground">
                After creation, you'll be guided to install the app on your
                repositories.
              </p>
            </div>
          </div>
        </div>
      </Card>

      <!-- Organization Selector -->
      <Card class="p-6 mb-6">
        <h3 class="text-lg font-semibold mb-3">Select Account</h3>
        <p class="text-sm text-muted-foreground mb-4">
          Choose which GitHub account or organization should own the app.
        </p>
        <div class="flex flex-wrap gap-2">
          {#each organizations as org}
            <button
              type="button"
              onclick={() => {
                selectedOrg = org;
              }}
              class="px-4 py-2 rounded-lg border transition-colors {selectedOrg ===
              org
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-transparent border-slate-600 hover:border-slate-400 text-slate-300'}"
            >
              {org === "personal" ? "Personal Account" : org}
            </button>
          {/each}
        </div>
        {#if organizations.length === 1}
          <div class="mt-4 flex items-center gap-2 text-sm text-yellow-400 border border-yellow-500/50 bg-yellow-500/10 rounded-lg px-3 py-2">
            <svg class="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>
              Want to install on an organization?
              <a href={getSettingsUrl()} class="underline hover:text-yellow-300">Configure your GitHub Organization in Settings</a>
            </span>
          </div>
        {/if}
      </Card>

      <!-- Create App Button -->
      <div class="text-center mb-6">
        <form action={githubAppUrl} method="post" id="github-app-form">
          <input type="hidden" name="manifest" value={manifest} />
          <Button
            type="submit"
            class="px-8 py-3 text-lg bg-green-600 hover:bg-green-700"
          >
            Create GitHub App {selectedOrg !== "personal"
              ? `for ${selectedOrg}`
              : ""}
          </Button>
        </form>
      </div>

      <!-- Configuration Details -->
      <Card class="p-6 mb-6">
        <details>
          <summary
            class="cursor-pointer font-semibold text-cyan-400 hover:text-cyan-300"
          >
            App Configuration Details
          </summary>
          <div
            class="mt-4 bg-black/30 p-4 rounded-lg font-mono text-sm text-muted-foreground"
          >
            <pre class="whitespace-pre-wrap">
Permissions:
- Repository contents: write
- Repository metadata: read
- Pull requests: write
- Issues: write

Webhook Events:
- issues
- installation events (automatically enabled)

Webhook URL: {webhookUrl}
            </pre>
          </div>
        </details>
      </Card>
    {/if}
  </div>
</div>
