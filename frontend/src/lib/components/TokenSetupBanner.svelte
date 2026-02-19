<script lang="ts">
  import Card from "$lib/components/ui/card.svelte";
  import Button from "$lib/components/ui/button.svelte";

  interface Props {
    onSaveToken: (token: string) => void;
  }

  let { onSaveToken }: Props = $props();

  let tokenInput = $state("");

  function handleSave() {
    if (!tokenInput.trim()) return;
    onSaveToken(tokenInput.trim());
    tokenInput = "";
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === "Enter") {
      handleSave();
    }
  }
</script>

<Card class="p-4 sm:p-6 mb-6 sm:mb-8 border-yellow-500/50 bg-yellow-500/5">
  <h3 class="text-yellow-400 font-semibold mb-2 text-base sm:text-lg">
    Setup Token Required
  </h3>
  <p class="text-muted-foreground text-xs sm:text-sm mb-3 sm:mb-4">
    Enter your setup token to access configuration pages. This will be
    stored locally in your browser.
  </p>
  <div class="flex flex-col sm:flex-row gap-2 sm:gap-3">
    <input
      type="password"
      placeholder="Enter your SETUP_SECRET token"
      bind:value={tokenInput}
      onkeydown={handleKeydown}
      class="flex-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    />
    <Button onclick={handleSave} class="w-full sm:w-auto">Save Token</Button>
  </div>
</Card>
