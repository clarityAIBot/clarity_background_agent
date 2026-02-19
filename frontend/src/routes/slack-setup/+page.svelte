<script lang="ts">
  import { browser } from "$app/environment";
  import Button from "$lib/components/ui/button.svelte";
  import Card from "$lib/components/ui/card.svelte";
  import Input from "$lib/components/ui/input.svelte";
  import Badge from "$lib/components/ui/badge.svelte";
  import NavButton from "$lib/components/ui/nav-button.svelte";
  import Footer from "$lib/components/ui/footer.svelte";
  import {
    saveSlackCredentials,
    getSlackStatus,
    deleteSlackConfig,
  } from "$lib/api";

  let signingSecret = $state("");
  let botToken = $state("");
  let saving = $state(false);
  let saveSuccess = $state(false);
  let saveError = $state("");
  let copied = $state(false);
  let alreadyConfigured = $state(false);
  let loading = $state(true);

  // Delete state
  let showDeleteConfirm = $state(false);
  let deleting = $state(false);
  let deleteError = $state<string | undefined>(undefined);
  let deleted = $state(false);

  // Compute URLs from browser origin
  const origin = $derived(browser ? window.location.origin : "");
  const slashCommandUrl = $derived(`${origin}/slack/command`);
  const interactivityUrl = $derived(`${origin}/slack/interactivity`);
  const eventsUrl = $derived(`${origin}/slack/events`);
  const callbackUrl = $derived(`${origin}/slack-setup/callback`);

  const manifestJson = $derived.by(() => {
    if (!origin) return "";
    const manifest = {
      display_information: {
        name: "Clarity AI Bot",
        description:
          "AI-powered feature request and code generation via Clarity AI",
        background_color: "#4A154B",
      },
      features: {
        bot_user: {
          display_name: "Clarity AI",
          always_online: true,
        },
        slash_commands: [
          {
            command: "/clarity-feature",
            url: slashCommandUrl,
            description: "Submit a feature request for Clarity AI to implement",
            usage_hint: "[optional: description]",
            should_escape: false,
          },
        ],
      },
      oauth_config: {
        redirect_urls: [callbackUrl],
        scopes: {
          bot: [
            "app_mentions:read",
            "channels:history",
            "chat:write",
            "chat:write.public",
            "commands",
            "files:read",
            "groups:history",
            "im:history",
            "reactions:read",
            "reactions:write",
            "users:read",
            "users:read.email",
          ],
        },
      },
      settings: {
        event_subscriptions: {
          request_url: eventsUrl,
          bot_events: [
            "app_mention",
            "message.channels",
            "message.groups",
            "message.im",
          ],
        },
        interactivity: {
          is_enabled: true,
          request_url: interactivityUrl,
        },
        org_deploy_enabled: false,
        socket_mode_enabled: false,
        token_rotation_enabled: false,
      },
    };
    return JSON.stringify(manifest, null, 2);
  });

  $effect(() => {
    if (!browser) return;

    (async () => {
      try {
        const status = await getSlackStatus();
        alreadyConfigured = status.configured;
      } catch (e) {
        // Ignore errors - just show the setup form
        console.error("[SlackSetup] Failed to get status:", e);
      } finally {
        loading = false;
      }
    })();
  });

  async function copyManifest() {
    await navigator.clipboard.writeText(manifestJson);
    copied = true;
    setTimeout(() => (copied = false), 2000);
  }

  async function saveCredentials() {
    if (!signingSecret || !botToken) {
      saveError = "Please fill in both fields.";
      return;
    }

    if (!botToken.startsWith("xoxb-")) {
      saveError = 'Bot token should start with "xoxb-"';
      return;
    }

    saving = true;
    saveError = "";

    try {
      await saveSlackCredentials(signingSecret, botToken);
      saveSuccess = true;
      signingSecret = "";
      botToken = "";
      alreadyConfigured = true;
    } catch (e) {
      saveError =
        e instanceof Error ? e.message : "Network error. Please try again.";
    } finally {
      saving = false;
    }
  }

  function reconfigure() {
    alreadyConfigured = false;
    saveSuccess = false;
  }

  async function handleDelete() {
    deleting = true;
    deleteError = undefined;

    try {
      await deleteSlackConfig();
      deleted = true;
      alreadyConfigured = false;
      showDeleteConfirm = false;
    } catch (e) {
      deleteError = e instanceof Error ? e.message : "Failed to delete";
    } finally {
      deleting = false;
    }
  }

  function startFresh() {
    deleted = false;
  }
</script>

<div
  class="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950"
>
  <div class="container mx-auto max-w-2xl py-12 px-4">
    <!-- Header -->
    <div class="relative text-center mb-8">
      <div class="absolute left-0 top-0">
        <NavButton onclick={() => history.back()} icon="back" label="Back" />
      </div>
      <h1
        class="text-4xl font-bold tracking-tight mb-3 bg-gradient-to-r from-purple-400 via-fuchsia-500 to-purple-600 bg-clip-text text-transparent"
      >
        Slack App Setup
      </h1>
      <p class="text-muted-foreground">
        Configure Slack integration for Clarity AI feature requests
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
    {:else if deleted}
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
          Slack Disconnected
        </h2>
        <p class="text-muted-foreground mb-4">
          The Slack configuration has been removed from Clarity AI.
        </p>
        <div class="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4 mb-6 text-left">
          <p class="text-yellow-400 font-medium mb-2">Important: Delete the app from Slack</p>
          <p class="text-sm text-muted-foreground mb-3">
            To fully remove the integration, you should also delete the app from your Slack workspace:
          </p>
          <a
            href="https://api.slack.com/apps"
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center gap-2 text-cyan-400 hover:text-cyan-300 text-sm"
          >
            <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z"/>
            </svg>
            Go to Slack Apps Settings →
          </a>
        </div>
        <p class="text-sm text-muted-foreground mb-4">
          You can now set up a new Slack integration.
        </p>
        <Button onclick={startFresh}>
          Set Up New Slack Integration
        </Button>
      </Card>
    {:else if alreadyConfigured && !saveSuccess}
      <!-- Already Configured State -->
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
          Slack Connected!
        </h2>
        <p class="text-muted-foreground mb-6">
          Your Slack integration is set up and ready to use. You can use <code
            class="bg-black/30 px-2 py-1 rounded text-cyan-400"
            >@clarity</code
          > mentions or <code
            class="bg-black/30 px-2 py-1 rounded text-cyan-400"
            >/clarity-feature</code
          > in Slack.
        </p>
        <div class="flex gap-4 justify-center flex-wrap">
          <Button onclick={reconfigure} variant="secondary">
            Update Credentials
          </Button>
          <a href="/" class="inline-flex items-center justify-center px-4 py-2 bg-primary text-primary-foreground font-medium rounded-md hover:bg-primary/90 transition-colors">
            Go to Home Page →
          </a>
        </div>

        <!-- Delete Section -->
        <div class="mt-8 pt-6 border-t border-slate-700">
          {#if showDeleteConfirm}
            <div class="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
              <p class="text-red-400 font-medium mb-2">Are you sure?</p>
              <p class="text-sm text-muted-foreground mb-4">
                This will disconnect Slack from Clarity AI. You'll need to reconfigure to reconnect.
              </p>
              {#if deleteError}
                <p class="text-red-400 text-sm mb-3">{deleteError}</p>
              {/if}
              <div class="flex gap-3 justify-center">
                <Button
                  variant="secondary"
                  onclick={() => { showDeleteConfirm = false; deleteError = undefined; }}
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
              onclick={() => { showDeleteConfirm = true; }}
              class="text-red-400 hover:text-red-300 text-sm"
            >
              Delete Slack Configuration
            </button>
          {/if}
        </div>
      </Card>

      <!-- Show Endpoints for Reference -->
      <Card class="p-6">
        <h3 class="text-lg font-semibold mb-4">Your Endpoints</h3>
        <div class="space-y-4">
          <div>
            <p class="text-sm text-muted-foreground mb-1">Slash Command URL</p>
            <div
              class="bg-black/30 p-3 rounded-lg font-mono text-cyan-400 text-sm break-all"
            >
              {slashCommandUrl}
            </div>
          </div>
          <div>
            <p class="text-sm text-muted-foreground mb-1">
              Interactivity Request URL
            </p>
            <div
              class="bg-black/30 p-3 rounded-lg font-mono text-cyan-400 text-sm break-all"
            >
              {interactivityUrl}
            </div>
          </div>
          <div>
            <p class="text-sm text-muted-foreground mb-1">Events Request URL</p>
            <div
              class="bg-black/30 p-3 rounded-lg font-mono text-cyan-400 text-sm break-all"
            >
              {eventsUrl}
            </div>
          </div>
        </div>
      </Card>
    {:else}
      <!-- Endpoints -->
      <Card class="p-6 mb-6">
        <h3 class="text-lg font-semibold mb-4">Your Endpoints</h3>
        <div class="space-y-4">
          <div>
            <p class="text-sm text-muted-foreground mb-1">Slash Command URL</p>
            <div
              class="bg-black/30 p-3 rounded-lg font-mono text-cyan-400 text-sm break-all"
            >
              {slashCommandUrl}
            </div>
          </div>
          <div>
            <p class="text-sm text-muted-foreground mb-1">
              Interactivity Request URL
            </p>
            <div
              class="bg-black/30 p-3 rounded-lg font-mono text-cyan-400 text-sm break-all"
            >
              {interactivityUrl}
            </div>
          </div>
          <div>
            <p class="text-sm text-muted-foreground mb-1">Events Request URL</p>
            <div
              class="bg-black/30 p-3 rounded-lg font-mono text-cyan-400 text-sm break-all"
            >
              {eventsUrl}
            </div>
          </div>
          <div>
            <p class="text-sm text-muted-foreground mb-1">OAuth Redirect URL</p>
            <div
              class="bg-black/30 p-3 rounded-lg font-mono text-cyan-400 text-sm break-all"
            >
              {callbackUrl}
            </div>
          </div>
        </div>
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
              <p class="font-medium">Create Slack App</p>
              <p class="text-sm text-muted-foreground">
                Go to <a
                  href="https://api.slack.com/apps"
                  target="_blank"
                  class="text-cyan-400 hover:underline">api.slack.com/apps</a
                > and click "Create New App" → "From an app manifest"
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
              <p class="font-medium">Paste the Manifest</p>
              <p class="text-sm text-muted-foreground">
                Copy the JSON manifest below and paste it into the Slack app
                creation wizard.
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
              <p class="font-medium">Install to Workspace</p>
              <p class="text-sm text-muted-foreground">
                After creating the app, click "Install to Workspace" to
                authorize the bot.
              </p>
            </div>
          </div>
          <div class="flex gap-3">
            <div
              class="w-6 h-6 rounded-full bg-primary flex items-center justify-center text-xs font-bold shrink-0"
            >
              4
            </div>
            <div>
              <p class="font-medium">Copy Credentials</p>
              <p class="text-sm text-muted-foreground">
                From "Basic Information", copy the <strong
                  >Signing Secret</strong
                >. From "OAuth & Permissions", copy the
                <strong>Bot User OAuth Token</strong>.
              </p>
            </div>
          </div>
          <div class="flex gap-3">
            <div
              class="w-6 h-6 rounded-full bg-primary flex items-center justify-center text-xs font-bold shrink-0"
            >
              5
            </div>
            <div>
              <p class="font-medium">Save Credentials</p>
              <p class="text-sm text-muted-foreground">
                Enter your credentials in the form below to securely store them.
              </p>
            </div>
          </div>
          <div class="flex gap-3">
            <div
              class="w-6 h-6 rounded-full bg-primary flex items-center justify-center text-xs font-bold shrink-0"
            >
              6
            </div>
            <div>
              <p class="font-medium">Upload Custom Emoji</p>
              <p class="text-sm text-muted-foreground">
                Upload an animated loading emoji named <code class="bg-black/30 px-1.5 py-0.5 rounded text-cyan-400">clarity-loading</code> to your workspace.
                Go to <a
                  href="https://slack.com/customize/emoji"
                  target="_blank"
                  class="text-cyan-400 hover:underline">Customize Emoji</a
                > and upload the GIF with that name. This is used for progress reactions and status messages.
              </p>
              <a
                href="/clarity-loading.gif"
                download="clarity-loading.gif"
                class="inline-flex items-center gap-2 mt-2 px-3 py-1.5 bg-cyan-500/10 border border-cyan-500/30 rounded-lg text-cyan-400 hover:bg-cyan-500/20 text-sm transition-colors"
              >
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Download clarity-loading.gif
              </a>
            </div>
          </div>
        </div>
      </Card>

      <!-- Manifest -->
      <Card class="p-6 mb-6">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-lg font-semibold">App Manifest (JSON)</h3>
          <Button onclick={copyManifest} variant="secondary" class="text-sm">
            {copied ? "Copied!" : "Copy Manifest"}
          </Button>
        </div>
        <pre
          class="bg-black/50 p-4 rounded-lg font-mono text-sm text-muted-foreground overflow-x-auto max-h-80 overflow-y-auto">{manifestJson}</pre>
      </Card>

      <!-- Credentials Form -->
      <Card class="p-6 mb-6">
        <h3 class="text-lg font-semibold mb-4">Save Slack Credentials</h3>

        {#if saveSuccess}
          <div
            class="p-4 rounded-lg bg-green-500/10 border border-green-500/30 mb-4"
          >
            <p class="text-green-400 font-medium">
              Slack credentials saved successfully! You can now use
              /clarity-feature in Slack.
            </p>
          </div>
        {/if}

        <div class="space-y-4">
          <div>
            <label for="signing-secret" class="block text-sm font-medium mb-2">Signing Secret</label>
            <Input
              id="signing-secret"
              type="password"
              placeholder="Enter your Slack signing secret"
              bind:value={signingSecret}
            />
            <p class="text-xs text-muted-foreground mt-1">
              Found in Basic Information → App Credentials
            </p>
          </div>

          <div>
            <label for="bot-token" class="block text-sm font-medium mb-2"
              >Bot User OAuth Token</label
            >
            <Input
              id="bot-token"
              type="password"
              placeholder="xoxb-..."
              bind:value={botToken}
            />
            <p class="text-xs text-muted-foreground mt-1">
              Found in OAuth & Permissions → OAuth Tokens
            </p>
          </div>

          <Button
            onclick={saveCredentials}
            disabled={saving}
            class="w-full"
          >
            {saving ? "Saving..." : "Save Slack Credentials"}
          </Button>

          {#if saveError}
            <p class="text-destructive text-sm">{saveError}</p>
          {/if}
        </div>
      </Card>

      <!-- Note -->
      <Card class="p-4 border-yellow-500/30 bg-yellow-500/5">
        <p class="text-sm text-yellow-400">
          <strong>Note:</strong> Make sure your GitHub App is already set up before
          using Slack integration. The Slack bot uses the GitHub installation token
          to create issues.
        </p>
      </Card>
    {/if}

    <!-- Footer -->
    <Footer />
  </div>
</div>
