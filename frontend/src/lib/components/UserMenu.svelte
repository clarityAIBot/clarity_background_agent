<script lang="ts">
  import { authStore } from "$lib/stores/auth.svelte";

  let showMenu = $state(false);

  function toggleMenu() {
    showMenu = !showMenu;
  }

  function closeMenu() {
    showMenu = false;
  }

  async function handleLogout() {
    await authStore.logout();
    closeMenu();
  }

  // Close menu when clicking outside
  function handleClickOutside(event: MouseEvent) {
    const target = event.target as HTMLElement;
    if (showMenu && !target.closest('.user-menu')) {
      closeMenu();
    }
  }
</script>

<svelte:window onclick={handleClickOutside} />

<div class="user-menu relative">
  {#if authStore.user}
    <!-- User Menu -->
    <button
      onclick={toggleMenu}
      class="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-slate-800/50 transition-colors"
      aria-label="User menu"
    >
      {#if authStore.user.pictureUrl}
        <img
          src={authStore.user.pictureUrl}
          alt={authStore.user.name || authStore.user.email}
          class="w-8 h-8 rounded-full"
        />
      {:else}
        <div class="w-8 h-8 rounded-full bg-purple-600 flex items-center justify-center text-sm font-semibold">
          {authStore.user.name?.[0]?.toUpperCase() || authStore.user.email[0].toUpperCase()}
        </div>
      {/if}
      <span class="hidden sm:block text-sm font-medium max-w-[150px] truncate">
        {authStore.user.name || authStore.user.email}
      </span>
      <svg
        class="w-4 h-4 text-muted-foreground transition-transform {showMenu ? 'rotate-180' : ''}"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
      </svg>
    </button>

    {#if showMenu}
      <div
        class="absolute right-0 mt-2 w-64 rounded-lg border border-slate-800 bg-slate-900/95 backdrop-blur-sm shadow-xl z-50"
      >
        <!-- User Info -->
        <div class="px-4 py-3 border-b border-slate-800">
          <div class="flex items-center gap-3">
            {#if authStore.user.pictureUrl}
              <img
                src={authStore.user.pictureUrl}
                alt={authStore.user.name || authStore.user.email}
                class="w-10 h-10 rounded-full"
              />
            {:else}
              <div class="w-10 h-10 rounded-full bg-purple-600 flex items-center justify-center font-semibold">
                {authStore.user.name?.[0]?.toUpperCase() || authStore.user.email[0].toUpperCase()}
              </div>
            {/if}
            <div class="flex-1 min-w-0">
              {#if authStore.user.name}
                <div class="text-sm font-medium truncate">{authStore.user.name}</div>
              {/if}
              <div class="text-xs text-muted-foreground truncate">{authStore.user.email}</div>
            </div>
          </div>
          {#if authStore.user.isSuperAdmin}
            <div class="mt-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-400 text-xs font-medium">
              <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
              </svg>
              Super Admin
            </div>
          {/if}
        </div>

        <!-- Menu Items -->
        <div class="py-2">
          <button
            onclick={handleLogout}
            class="w-full px-4 py-2 text-left text-sm hover:bg-slate-800/50 transition-colors flex items-center gap-2 text-red-400"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            Sign Out
          </button>
        </div>
      </div>
    {/if}
  {/if}
</div>
