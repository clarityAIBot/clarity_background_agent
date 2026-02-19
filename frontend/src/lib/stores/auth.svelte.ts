import { getAuthMe, logoutGoogle, type AuthUser } from '$lib/api';

// Auth store using Svelte 5 runes
export const authStore = (() => {
  let user = $state<AuthUser | null>(null);
  let loading = $state(true);
  let isAuthenticated = $state(false);

  return {
    get user() {
      return user;
    },
    get loading() {
      return loading;
    },
    get isAuthenticated() {
      return isAuthenticated;
    },

    async init() {
      try {
        loading = true;
        const result = await getAuthMe();
        if (result.authenticated && result.user) {
          user = result.user;
          isAuthenticated = true;
        } else {
          user = null;
          isAuthenticated = false;
        }
      } catch (error) {
        console.error('[Auth] Failed to fetch user:', error);
        user = null;
        isAuthenticated = false;
      } finally {
        loading = false;
      }
    },

    async logout() {
      try {
        await logoutGoogle();
        user = null;
        isAuthenticated = false;
        // Reload to clear any state
        window.location.href = '/';
      } catch (error) {
        console.error('[Auth] Logout failed:', error);
      }
    },

    // Called after successful OAuth callback
    async refresh() {
      await this.init();
    }
  };
})();
