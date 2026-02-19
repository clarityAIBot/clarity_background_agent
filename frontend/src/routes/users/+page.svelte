<script lang="ts">
  import { browser } from "$app/environment";
  import Button from "$lib/components/ui/button.svelte";
  import Card from "$lib/components/ui/card.svelte";
  import Input from "$lib/components/ui/input.svelte";
  import NavButton from "$lib/components/ui/nav-button.svelte";
  import Footer from "$lib/components/ui/footer.svelte";
  import LoadingSpinner from "$lib/components/ui/loading-spinner.svelte";
  import Badge from "$lib/components/ui/badge.svelte";
  import {
    getUsers,
    getUserStats,
    getPolicies,
    updateUserStatus,
    assignPolicyToUser,
    removePolicyFromUser,
    type User,
    type UserStats,
    type Policy,
  } from "$lib/api";
  import { authStore } from "$lib/stores/auth.svelte";

  let users = $state<User[]>([]);
  let stats = $state<UserStats | null>(null);
  let availablePolicies = $state<Policy[]>([]);
  let loading = $state(false);
  let error = $state("");
  let success = $state("");
  let searchQuery = $state("");
  let statusFilter = $state<'active' | 'inactive' | ''>("");

  // Modal state
  let selectedUser = $state<User | null>(null);
  let showPolicyModal = $state(false);
  let selectedPolicyId = $state("");
  let processingAction = $state(false);

  async function handleLogout() {
    await authStore.logout();
  }

  async function loadData() {
    try {
      loading = true;
      error = "";

      const [usersResponse, statsResponse, policiesResponse] = await Promise.all([
        getUsers({ search: searchQuery || undefined, status: statusFilter || undefined }),
        getUserStats(),
        getPolicies(),
      ]);

      users = usersResponse.users;
      stats = statsResponse;
      availablePolicies = policiesResponse.policies;
    } catch (e) {
      error = e instanceof Error ? e.message : "Failed to load data";
    } finally {
      loading = false;
    }
  }

  async function handleStatusToggle(user: User) {
    try {
      processingAction = true;
      error = "";
      success = "";

      const newStatus = user.status === 'active' ? 'inactive' : 'active';
      await updateUserStatus(user.id, newStatus);

      success = `User ${user.email} is now ${newStatus}`;
      await loadData();

      setTimeout(() => (success = ""), 3000);
    } catch (e) {
      error = e instanceof Error ? e.message : "Failed to update user status";
    } finally {
      processingAction = false;
    }
  }


  function openPolicyModal(user: User) {
    selectedUser = user;
    selectedPolicyId = "";
    showPolicyModal = true;
  }

  function closePolicyModal() {
    showPolicyModal = false;
    selectedUser = null;
    selectedPolicyId = "";
  }

  async function handleAssignPolicy() {
    if (!selectedUser || !selectedPolicyId) return;

    try {
      processingAction = true;
      error = "";
      success = "";

      await assignPolicyToUser(selectedUser.id, selectedPolicyId, undefined, authStore.user?.id);

      success = `Policy assigned to ${selectedUser.email}`;
      closePolicyModal();
      await loadData();

      setTimeout(() => (success = ""), 3000);
    } catch (e) {
      error = e instanceof Error ? e.message : "Failed to assign policy";
    } finally {
      processingAction = false;
    }
  }

  async function handleRemovePolicy(user: User, policyId: string) {
    if (!confirm('Are you sure you want to remove this policy?')) return;

    try {
      processingAction = true;
      error = "";
      success = "";

      await removePolicyFromUser(user.id, policyId);

      success = `Policy removed from ${user.email}`;
      await loadData();

      setTimeout(() => (success = ""), 3000);
    } catch (e) {
      error = e instanceof Error ? e.message : "Failed to remove policy";
    } finally {
      processingAction = false;
    }
  }

  function formatDate(dateStr: string | null): string {
    if (!dateStr) return 'Never';
    return new Date(dateStr).toLocaleString();
  }

  // Load data on mount
  $effect(() => {
    if (browser) {
      loadData();
    }
  });

  // Reload when filters change
  $effect(() => {
    if (browser && (searchQuery !== undefined || statusFilter !== undefined)) {
      const debounce = setTimeout(() => {
        loadData();
      }, 300);
      return () => clearTimeout(debounce);
    }
  });
</script>

<div class="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
  <div class="container mx-auto py-6 sm:py-8 lg:py-12 px-4 sm:px-6 lg:px-8">
    <!-- Header -->
    <div class="relative text-center mb-6 sm:mb-8 lg:mb-12">
      <!-- Back Button (Top Left) -->
      <div class="absolute left-0 top-0">
        <NavButton onclick={() => history.back()} icon="back" label="Back" />
      </div>

      <!-- Logout Button (Top Right) -->
      <div class="absolute right-0 top-0">
        <NavButton onclick={handleLogout} icon="logout" label="Logout" hideLabel variant="danger" />
      </div>

      <h1 class="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight mb-2 sm:mb-3 bg-gradient-to-r from-purple-400 via-violet-400 to-cyan-400 bg-clip-text text-transparent">
        Users Management
      </h1>
      <p class="text-muted-foreground text-base sm:text-lg">
        Manage user access and permissions
      </p>
    </div>

    {#if loading && !users.length}
      <LoadingSpinner />
    {:else}
      <!-- Success Banner -->
      {#if success}
        <Card class="p-4 mb-6 border-green-500/50 bg-green-500/5">
          <div class="flex items-center gap-3">
            <svg class="w-5 h-5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
            </svg>
            <span class="text-green-400">{success}</span>
          </div>
        </Card>
      {/if}

      <!-- Error Banner -->
      {#if error}
        <Card class="p-4 mb-6 border-red-500/50 bg-red-500/5">
          <div class="flex items-center gap-3">
            <svg class="w-5 h-5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
            <span class="text-red-400">{error}</span>
          </div>
        </Card>
      {/if}

      <!-- Stats Cards -->
      {#if stats}
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <Card class="p-4">
            <div class="text-sm text-muted-foreground mb-1">Total Users</div>
            <div class="text-2xl font-bold">{stats.total}</div>
          </Card>
          <Card class="p-4">
            <div class="text-sm text-muted-foreground mb-1">Active</div>
            <div class="text-2xl font-bold text-green-400">{stats.active}</div>
          </Card>
          <Card class="p-4">
            <div class="text-sm text-muted-foreground mb-1">Inactive</div>
            <div class="text-2xl font-bold text-gray-400">{stats.inactive}</div>
          </Card>
          <Card class="p-4">
            <div class="text-sm text-muted-foreground mb-1">Super Admins</div>
            <div class="text-2xl font-bold text-purple-400">{stats.superAdmins}</div>
          </Card>
        </div>
      {/if}

      <!-- Filters -->
      <Card class="p-4 mb-6">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label for="search" class="block text-sm font-medium mb-2">Search</label>
            <Input
              id="search"
              placeholder="Search by email or name..."
              bind:value={searchQuery}
              class="w-full"
            />
          </div>
          <div>
            <label for="status" class="block text-sm font-medium mb-2">Status Filter</label>
            <select
              id="status"
              bind:value={statusFilter}
              class="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-white focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 outline-none"
            >
              <option value="">All Statuses</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
        </div>
      </Card>

      <!-- Users List -->
      <div class="space-y-4">
        {#each users as user}
          <Card class="p-6 hover:border-slate-600 transition-colors">
            <div class="flex flex-col lg:flex-row lg:items-center gap-4">
              <!-- User Info -->
              <div class="flex items-center gap-4 flex-1">
                {#if user.pictureUrl}
                  <img
                    src={user.pictureUrl}
                    alt={user.name || user.email}
                    class="w-12 h-12 rounded-full"
                  />
                {:else}
                  <div class="w-12 h-12 rounded-full bg-gradient-to-br from-purple-500 to-cyan-500 flex items-center justify-center text-white font-medium text-lg">
                    {(user.name || user.email).charAt(0).toUpperCase()}
                  </div>
                {/if}
                <div class="flex-1 min-w-0">
                  <div class="font-medium text-lg">{user.name || 'Unknown'}</div>
                  <div class="text-sm text-muted-foreground">{user.email}</div>
                  <div class="flex items-center gap-2 mt-2">
                    {#if user.status === 'active'}
                      <Badge variant="success">Active</Badge>
                    {:else}
                      <Badge variant="secondary">Inactive</Badge>
                    {/if}
                    {#if user.isSuperAdmin}
                      <Badge variant="warning">Super Admin</Badge>
                    {/if}
                  </div>
                </div>
              </div>

              <!-- Policies & Last Login -->
              <div class="flex-1 space-y-3">
                <div>
                  <div class="text-xs text-muted-foreground mb-2 font-medium uppercase">Policies</div>
                  <div class="flex flex-wrap gap-2">
                    {#each user.policies || [] as policy}
                      <span class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm bg-cyan-500/20 text-cyan-400">
                        {policy.policyName}
                        <button
                          onclick={() => handleRemovePolicy(user, policy.policyId)}
                          disabled={processingAction}
                          class="hover:text-red-400 transition-colors"
                          aria-label="Remove policy"
                          title="Remove policy"
                        >
                          <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </span>
                    {/each}
                    <button
                      onclick={() => openPolicyModal(user)}
                      disabled={processingAction}
                      class="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-sm bg-slate-700 hover:bg-slate-600 transition-colors"
                      title="Assign policy"
                    >
                      <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
                      </svg>
                      Add Policy
                    </button>
                  </div>
                </div>
                <div>
                  <div class="text-xs text-muted-foreground font-medium uppercase">Last Login</div>
                  <div class="text-sm mt-1">{formatDate(user.lastLoginAt)}</div>
                </div>
              </div>

              <!-- Actions -->
              <div class="flex flex-col gap-2 lg:min-w-[160px]">
                <button
                  onclick={() => handleStatusToggle(user)}
                  disabled={processingAction}
                  class="px-4 py-2 text-sm rounded-lg bg-slate-700 hover:bg-slate-600 transition-colors disabled:opacity-50 font-medium"
                  title={user.status === 'active' ? 'Deactivate user' : 'Activate user'}
                >
                  {user.status === 'active' ? 'Deactivate' : 'Activate'}
                </button>
              </div>
            </div>
          </Card>
        {/each}

        {#if users.length === 0}
          <Card class="p-12">
            <div class="text-center">
              <svg class="w-16 h-16 mx-auto mb-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
              <p class="text-muted-foreground text-lg">No users found</p>
              <p class="text-muted-foreground text-sm mt-2">Try adjusting your search or filter criteria</p>
            </div>
          </Card>
        {/if}
      </div>
    {/if}

    <!-- Footer -->
    <Footer />
  </div>
</div>

<!-- Policy Assignment Modal -->
{#if showPolicyModal && selectedUser}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4" onclick={closePolicyModal}>
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <Card class="max-w-md w-full p-6 shadow-2xl" onclick={(e) => e.stopPropagation()}>
      <div class="flex items-center justify-between mb-6">
        <h2 class="text-xl font-bold">Assign Policy</h2>
        <button
          onclick={closePolicyModal}
          class="p-1 hover:bg-slate-700 rounded-lg transition-colors"
          aria-label="Close modal"
          title="Close"
        >
          <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div class="mb-4 p-3 rounded-lg bg-slate-800 border border-slate-700">
        <div class="text-sm text-muted-foreground">Assigning to</div>
        <div class="font-medium mt-1">{selectedUser.name || selectedUser.email}</div>
      </div>

      <div class="mb-6">
        <label for="policySelect" class="block text-sm font-medium mb-2">Select Policy</label>
        <select
          id="policySelect"
          bind:value={selectedPolicyId}
          class="w-full px-4 py-2.5 rounded-lg bg-slate-800 border border-slate-700 text-white focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 outline-none transition-all"
        >
          <option value="">-- Select a policy --</option>
          {#each availablePolicies.filter(p => !selectedUser?.policies?.find(up => up.policyId === p.id)) as policy}
            <option value={policy.id}>{policy.name}{policy.description ? ` - ${policy.description}` : ''}</option>
          {/each}
        </select>
        {#if availablePolicies.filter(p => !selectedUser?.policies?.find(up => up.policyId === p.id)).length === 0}
          <p class="text-sm text-muted-foreground mt-2">No more policies available to assign</p>
        {/if}
      </div>

      <div class="flex gap-3 justify-end">
        <Button variant="secondary" onclick={closePolicyModal} disabled={processingAction}>
          Cancel
        </Button>
        <Button onclick={handleAssignPolicy} disabled={!selectedPolicyId || processingAction}>
          {processingAction ? 'Assigning...' : 'Assign Policy'}
        </Button>
      </div>
    </Card>
  </div>
{/if}
