<script lang="ts">
  type IconType = 'back' | 'settings' | 'info' | 'home' | 'logout' | 'none';

  interface Props {
    href?: string;
    label?: string;
    hideLabel?: boolean;
    onclick?: () => void;
    icon?: IconType;
    class?: string;
    variant?: 'default' | 'danger';
  }

  let { href, label, hideLabel = false, onclick, icon = 'none', class: className = "", variant = 'default' }: Props = $props();

  const baseClass = "flex items-center gap-1 sm:gap-1.5 text-xs sm:text-sm transition-colors px-1.5 sm:px-2.5 py-1 sm:py-1.5 rounded-md sm:rounded-lg border bg-slate-900/50";
  const variantClass = $derived(variant === 'danger'
    ? "text-red-400 hover:text-red-300 border-red-500/30 hover:border-red-500/50 hover:bg-red-500/10"
    : "text-muted-foreground hover:text-white border-slate-700/50 hover:border-slate-600 hover:bg-slate-800/50");
</script>

{#snippet iconSvg()}
  {#if icon === 'back'}
    <svg class="w-3.5 h-3.5 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
    </svg>
  {:else if icon === 'settings'}
    <svg class="w-3.5 h-3.5 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  {:else if icon === 'info'}
    <svg class="w-3.5 h-3.5 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  {:else if icon === 'home'}
    <svg class="w-3.5 h-3.5 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
    </svg>
  {:else if icon === 'logout'}
    <svg class="w-3.5 h-3.5 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
    </svg>
  {/if}
{/snippet}

{#if href}
  <a
    {href}
    class="{baseClass} {variantClass} {className}"
  >
    {@render iconSvg()}
    {#if label}
      <span class={hideLabel ? "hidden sm:inline" : ""}>{label}</span>
    {/if}
  </a>
{:else}
  <button
    {onclick}
    class="{baseClass} {variantClass} {className}"
  >
    {@render iconSvg()}
    {#if label}
      <span class={hideLabel ? "hidden sm:inline" : ""}>{label}</span>
    {/if}
  </button>
{/if}
