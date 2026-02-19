<script lang="ts">
  import Card from "$lib/components/ui/card.svelte";
  import Button from "$lib/components/ui/button.svelte";
  import Footer from "$lib/components/ui/footer.svelte";
  import HowItWorksContent from "$lib/components/ui/how-it-works-content.svelte";
  import { startGoogleLogin, getAuthStatus } from "$lib/api";
  import { browser } from "$app/environment";

  let error = $state("");
  let googleOAuthEnabled = $state(false);
  let loadingAuthStatus = $state(true);

  // Check URL for error parameter
  $effect(() => {
    if (browser) {
      const params = new URLSearchParams(window.location.search);
      const errorParam = params.get('error');

      if (errorParam) {
        // Decode and format error message
        const decodedError = decodeURIComponent(errorParam);

        // Make error messages more user-friendly
        if (decodedError.includes('not allowed to login')) {
          error = "Your email or domain is not authorized to access this application. Please contact your administrator.";
        } else if (decodedError === 'no_code') {
          error = "Authentication failed. No authorization code received from Google.";
        } else if (decodedError === 'invalid_state') {
          error = "Authentication failed. Invalid security token. Please try again.";
        } else if (decodedError === 'access_denied') {
          error = "You denied access to your Google account. Please try again.";
        } else {
          error = `Authentication failed: ${decodedError}`;
        }

        // Clear error from URL without reload
        window.history.replaceState({}, '', window.location.pathname);
      }
    }
  });

  // Check if Google OAuth is configured on mount
  $effect(() => {
    if (browser) {
      getAuthStatus()
        .then(status => {
          googleOAuthEnabled = status.googleOAuthConfigured;
          loadingAuthStatus = false;
        })
        .catch(err => {
          console.error('[Login] Failed to check auth status:', err);
          loadingAuthStatus = false;
        });
    }
  });

  function handleGoogleLogin() {
    startGoogleLogin();
  }
</script>

<div
  class="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex flex-col"
>
  <div class="flex-1 flex items-center justify-center px-4 sm:px-6 lg:px-8 py-12">
    <div class="w-full max-w-md">
      <!-- Logo and Title -->
      <div class="text-center mb-8 mt-8 sm:mt-12">
        <div class="flex items-center justify-center gap-3 sm:gap-4 mb-4">
          <img
            src="/clarity_logo.svg"
            alt="Clarity AI Logo"
            class="w-12 h-12 sm:w-14 sm:h-14 lg:w-16 lg:h-16"
          />
          <h1
            class="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight bg-gradient-to-r from-purple-600 via-violet-600 to-cyan-500 bg-clip-text text-transparent"
          >
            Clarity AI
          </h1>
        </div>
        <p class="text-muted-foreground text-base sm:text-lg">
          AI-powered development assistant
        </p>
      </div>

      <!-- Login Card -->
      <Card class="p-6 sm:p-8">
        <h2 class="text-xl font-semibold text-center mb-2">Welcome</h2>
        <p class="text-muted-foreground text-sm text-center mb-6">
          Sign in to access the dashboard and configuration pages.
        </p>

        {#if error}
          <div
            class="mb-4 p-3 rounded-lg border border-red-500/50 bg-red-500/10 text-red-400 text-sm"
          >
            {error}
          </div>
        {/if}

        <div class="space-y-4">
          {#if loadingAuthStatus}
            <!-- Loading -->
            <div class="flex justify-center py-4">
              <div class="w-8 h-8 border-4 border-purple-600 border-t-transparent rounded-full animate-spin"></div>
            </div>
          {:else if googleOAuthEnabled}
            <!-- Google Sign In Button -->
            <Button
              onclick={handleGoogleLogin}
              class="w-full h-11 bg-white hover:bg-gray-100 text-gray-900 border border-gray-300 flex items-center justify-center gap-3"
            >
              <svg class="w-5 h-5" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                />
              </svg>
              Sign in with Google
            </Button>
          {:else}
            <!-- OAuth not configured -->
            <div class="text-center py-6 text-muted-foreground">
              <p class="mb-2">Google OAuth is not configured.</p>
              <p class="text-sm">Please contact your administrator to set up authentication.</p>
            </div>
          {/if}
        </div>
      </Card>

      <!-- How It Works Section -->
      <Card class="mt-6 p-5 sm:p-6">
        <h2 class="text-lg font-semibold text-center mb-4">How It Works</h2>
        <HowItWorksContent />
      </Card>
    </div>
  </div>

  <!-- Footer -->
  <div class="container mx-auto px-4 sm:px-6 lg:px-8 pb-6">
    <Footer />
  </div>
</div>
