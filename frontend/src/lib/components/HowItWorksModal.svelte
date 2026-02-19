<script lang="ts">
  import HowItWorksContent from "$lib/components/ui/how-it-works-content.svelte";

  interface Props {
    open: boolean;
    onClose: () => void;
  }

  let { open, onClose }: Props = $props();
</script>

{#if open}
  <div
    class="fixed inset-0 z-50 flex items-center justify-center p-4"
    role="dialog"
    aria-modal="true"
    aria-labelledby="how-it-works-title"
  >
    <!-- Backdrop -->
    <button
      class="absolute inset-0 bg-black/60 backdrop-blur-sm"
      onclick={onClose}
      aria-label="Close modal"
    ></button>

    <!-- Modal Content -->
    <div
      class="relative bg-slate-900 border border-slate-700 rounded-xl shadow-2xl max-w-lg w-full max-h-[85vh] overflow-y-auto"
    >
      <!-- Header -->
      <div
        class="sticky top-0 bg-slate-900 border-b border-slate-700 px-5 py-4 flex items-center justify-between"
      >
        <h2 id="how-it-works-title" class="text-lg font-semibold text-white">
          How It Works
        </h2>
        <button
          onclick={onClose}
          class="text-muted-foreground hover:text-white transition-colors p-1 rounded-lg hover:bg-slate-800"
          aria-label="Close"
        >
          <svg
            class="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>

      <!-- Body -->
      <div class="px-5 py-4">
        <HowItWorksContent />
      </div>

      <!-- Footer -->
      <div class="border-t border-slate-700 px-5 py-3">
        <button
          onclick={onClose}
          class="w-full text-sm text-muted-foreground hover:text-white py-2 rounded-lg hover:bg-slate-800 transition-colors"
        >
          Got it
        </button>
      </div>
    </div>
  </div>
{/if}
