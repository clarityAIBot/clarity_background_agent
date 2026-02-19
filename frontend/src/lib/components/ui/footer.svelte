<script lang="ts">
  interface Props {
    class?: string;
  }

  let { class: className = "" }: Props = $props();
</script>

<footer
  class="text-center py-6 sm:py-8 mt-6 sm:mt-8 text-muted-foreground text-xs sm:text-sm {className}"
>
  <p>
    Made with ❤️ from <span
      class="bg-gradient-to-r from-purple-600 via-violet-600 to-cyan-500 bg-clip-text text-transparent font-semibold"
      >Clarity</span
    >
  </p>
</footer>
