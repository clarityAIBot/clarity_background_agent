<script lang="ts">
  interface Props {
    currentPage: number;
    totalPages: number;
    totalItems: number;
    pageSize: number;
    loading?: boolean;
    onPageChange: (page: number) => void;
  }

  let { currentPage, totalPages, totalItems, pageSize, loading = false, onPageChange }: Props = $props();

  function goToPage(page: number) {
    if (page < 1 || page > totalPages) return;
    onPageChange(page);
  }
</script>

{#if totalPages > 1}
  <div class="flex flex-col sm:flex-row items-center justify-between gap-4 mt-6 pt-4 border-t border-slate-800">
    <div class="text-sm text-muted-foreground">
      Showing {(currentPage - 1) * pageSize + 1} - {Math.min(currentPage * pageSize, totalItems)} of {totalItems} tasks
    </div>
    <div class="flex items-center gap-2">
      <button
        onclick={() => goToPage(1)}
        disabled={currentPage === 1 || loading}
        aria-label="First page"
        class="px-3 py-1.5 text-sm rounded-lg border border-slate-700 hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
        </svg>
      </button>
      <button
        onclick={() => goToPage(currentPage - 1)}
        disabled={currentPage === 1 || loading}
        aria-label="Previous page"
        class="px-3 py-1.5 text-sm rounded-lg border border-slate-700 hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
        </svg>
      </button>
      <span class="px-3 py-1.5 text-sm">
        Page {currentPage} of {totalPages}
      </span>
      <button
        onclick={() => goToPage(currentPage + 1)}
        disabled={currentPage === totalPages || loading}
        aria-label="Next page"
        class="px-3 py-1.5 text-sm rounded-lg border border-slate-700 hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
        </svg>
      </button>
      <button
        onclick={() => goToPage(totalPages)}
        disabled={currentPage === totalPages || loading}
        aria-label="Last page"
        class="px-3 py-1.5 text-sm rounded-lg border border-slate-700 hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 5l7 7-7 7M5 5l7 7-7 7" />
        </svg>
      </button>
    </div>
  </div>
{/if}
