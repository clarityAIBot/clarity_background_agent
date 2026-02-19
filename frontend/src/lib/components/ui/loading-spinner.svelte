<script lang="ts">
  interface Props {
    size?: "sm" | "md" | "lg";
    class?: string;
  }

  let { size = "md", class: className = "" }: Props = $props();

  const sizeClasses = {
    sm: "h-5 w-5",
    md: "h-8 w-8",
    lg: "h-12 w-12"
  };
</script>

<div class="flex justify-center py-12 {className}">
  <div
    class="animate-spin rounded-full border-b-2 border-primary {sizeClasses[size]}"
  ></div>
</div>
