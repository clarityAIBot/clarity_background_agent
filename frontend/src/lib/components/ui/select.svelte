<script lang="ts">
  import { cn } from '$lib/utils/cn';
  import type { HTMLSelectAttributes } from 'svelte/elements';
  import type { Snippet } from 'svelte';

  interface SelectOption {
    value: string;
    label: string;
  }

  interface Props extends Omit<HTMLSelectAttributes, 'class'> {
    class?: string;
    value?: string;
    options?: SelectOption[];
    placeholder?: string;
    children?: Snippet;
  }

  let {
    class: className,
    value = $bindable(''),
    options = [],
    placeholder = '-- Not Selected --',
    children,
    ...restProps
  }: Props = $props();
</script>

<select
  class={cn(
    'flex h-10 w-full rounded-md border border-input bg-slate-800 px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
    value ? 'text-white' : 'text-slate-400',
    className
  )}
  bind:value
  {...restProps}
>
  <option value="" class="bg-slate-800 text-slate-400">{placeholder}</option>
  {#if children}
    {@render children()}
  {:else}
    {#each options.filter(o => o.value) as option}
      <option value={option.value} class="bg-slate-800 text-white">{option.label}</option>
    {/each}
  {/if}
</select>
