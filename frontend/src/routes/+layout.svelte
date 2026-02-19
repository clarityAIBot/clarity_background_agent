<script lang="ts">
  import '../app.css';
  import { browser } from "$app/environment";
  import LoginPage from "$lib/components/LoginPage.svelte";
  import { authStore } from "$lib/stores/auth.svelte";

  let { children } = $props();

  // Initialize auth store on mount
  $effect(() => {
    if (browser) {
      authStore.init();
    }
  });
</script>

<div class="min-h-screen bg-background">
  {#if authStore.loading}
    <!-- Loading state while checking auth -->
    <div class="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex items-center justify-center">
      <div class="flex flex-col items-center gap-4">
        <div class="w-12 h-12 border-4 border-purple-600 border-t-transparent rounded-full animate-spin"></div>
        <p class="text-muted-foreground">Loading...</p>
      </div>
    </div>
  {:else if authStore.isAuthenticated}
    {@render children()}
  {:else}
    <LoginPage />
  {/if}
</div>
