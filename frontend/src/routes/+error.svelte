<script lang="ts">
  import { page } from '$app/stores';
</script>

<div class="min-h-screen bg-slate-950 flex items-center justify-center p-4">
  <div class="text-center">
    <h1 class="text-4xl font-bold text-red-500 mb-4">Error {$page.status}</h1>
    <p class="text-slate-400 mb-6">{$page.error?.message || 'Something went wrong'}</p>
    <a href="/" class="text-cyan-400 hover:underline">← Back to Home</a>
  </div>
</div>
