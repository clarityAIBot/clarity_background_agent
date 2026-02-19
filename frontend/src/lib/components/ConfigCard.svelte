<script lang="ts">
  import Card from "$lib/components/ui/card.svelte";
  import Badge from "$lib/components/ui/badge.svelte";
  import Button from "$lib/components/ui/button.svelte";
  import type { Snippet } from "svelte";

  interface Props {
    title: string;
    subtitle: string;
    configured: boolean;
    configuredLabel?: string;
    notConfiguredLabel?: string;
    buttonLabel: string;
    onConfigure: () => void;
    icon: Snippet;
  }

  let {
    title,
    subtitle,
    configured,
    configuredLabel = "Configured",
    notConfiguredLabel = "Not Configured",
    buttonLabel,
    onConfigure,
    icon
  }: Props = $props();
</script>

<Card class="p-4 sm:p-6">
  <div class="flex items-center justify-between mb-4">
    <div class="flex items-center gap-3">
      {@render icon()}
      <div>
        <h2 class="text-lg font-semibold">{title}</h2>
        <p class="text-xs text-muted-foreground">{subtitle}</p>
      </div>
    </div>
    {#if configured}
      <Badge variant="success">{configuredLabel}</Badge>
    {:else}
      <Badge variant="warning">{notConfiguredLabel}</Badge>
    {/if}
  </div>
  <Button onclick={onConfigure} class="w-full">
    {buttonLabel}
  </Button>
</Card>
