<script lang="ts">
  import { onMount } from 'svelte';
  import Button from '$lib/components/ui/button.svelte';
  import Card from '$lib/components/ui/card.svelte';
  import Badge from '$lib/components/ui/badge.svelte';
  import { getAllStatus, type StatusResponse } from '$lib/api';

  let status = $state<StatusResponse | null>(null);
  let error = $state('');
  let loading = $state(true);

  onMount(async () => {
    try {
      status = await getAllStatus();
    } catch (e) {
      error = 'Failed to load status.';
    } finally {
      loading = false;
    }
  });

  function goHome() {
    window.location.href = '/';
  }

  function goToSetup() {
    window.location.href = '/gh-setup';
  }
</script>

<div class="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
  <div class="container mx-auto max-w-2xl py-12 px-4">
    <!-- Header -->
    <div class="text-center mb-8">
      <h1 class="text-4xl font-bold tracking-tight mb-3 text-white">
        GitHub Status
      </h1>
      <p class="text-muted-foreground">View your GitHub App installation status</p>
    </div>

    {#if loading}
      <div class="flex justify-center py-12">
        <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    {:else if error}
      <Card class="p-6 border-destructive/50 bg-destructive/5">
        <p class="text-destructive">{error}</p>
        <Button onclick={goHome} class="mt-4">
          ← Back to Home
        </Button>
      </Card>
    {:else}
      <!-- Installation Status -->
      <Card class="p-6 mb-6">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-lg font-semibold">GitHub App</h3>
          {#if status?.installation?.appId}
            <Badge variant="success">Connected</Badge>
          {:else}
            <Badge variant="warning">Not Connected</Badge>
          {/if}
        </div>

        {#if status?.installation}
          <div class="space-y-3">
            <div class="flex justify-between py-2 border-b border-border/50">
              <span class="text-muted-foreground">App ID</span>
              <span class="font-mono">{status.installation.appId}</span>
            </div>
            {#if status.installation.owner}
              <div class="flex justify-between py-2 border-b border-border/50">
                <span class="text-muted-foreground">Owner</span>
                <span>{status.installation.owner}</span>
              </div>
            {/if}
            <div class="flex justify-between py-2 border-b border-border/50">
              <span class="text-muted-foreground">Repositories</span>
              <span>{status.installation.repositoryCount || 0}</span>
            </div>
            {#if status.installation.repositories && status.installation.repositories.length > 0}
              <div class="py-2">
                <span class="text-muted-foreground block mb-2">Repository List</span>
                <div class="flex flex-wrap gap-2">
                  {#each status.installation.repositories as repo}
                    <span class="px-2 py-1 bg-secondary rounded text-sm font-mono">{repo.name}</span>
                  {/each}
                </div>
              </div>
            {/if}
            {#if status.installation.webhookCount}
              <div class="flex justify-between py-2 border-b border-border/50">
                <span class="text-muted-foreground">Webhooks Received</span>
                <span>{status.installation.webhookCount}</span>
              </div>
            {/if}
            {#if status.installation.lastWebhookAt}
              <div class="flex justify-between py-2 border-b border-border/50">
                <span class="text-muted-foreground">Last Webhook</span>
                <span>{new Date(status.installation.lastWebhookAt).toLocaleString()}</span>
              </div>
            {/if}
            <div class="flex justify-between py-2">
              <span class="text-muted-foreground">Credentials</span>
              {#if status.installation.hasCredentials}
                <Badge variant="success">Configured</Badge>
              {:else}
                <Badge variant="warning">Missing</Badge>
              {/if}
            </div>
          </div>
        {:else}
          <p class="text-muted-foreground">No GitHub App installation found.</p>
          <Button onclick={goToSetup} class="mt-4">
            Setup GitHub App →
          </Button>
        {/if}
      </Card>

      <!-- Claude Status -->
      <Card class="p-6 mb-6">
        <div class="flex items-center justify-between">
          <h3 class="text-lg font-semibold">Claude API</h3>
          {#if status?.claude?.configured}
            <Badge variant="success">Configured</Badge>
          {:else}
            <Badge variant="warning">Not Configured</Badge>
          {/if}
        </div>
      </Card>

      <!-- Slack Status -->
      <Card class="p-6 mb-6">
        <div class="flex items-center justify-between">
          <h3 class="text-lg font-semibold">Slack Integration</h3>
          {#if status?.slack?.configured}
            <Badge variant="success">Connected</Badge>
          {:else}
            <Badge variant="warning">Not Connected</Badge>
          {/if}
        </div>
      </Card>
    {/if}

    <!-- Footer -->
    <div class="text-center mt-8">
      <button onclick={goHome} class="text-muted-foreground hover:text-foreground text-sm">
        ← Back to Home
      </button>
    </div>
  </div>
</div>
