<script lang="ts">
  import { Activity, Database, Server, Users } from '@lucide/svelte';
  import { onMount } from 'svelte';

  import { apiFetch } from '$lib/api';
  import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';

  let phase = $state<any>(null);
  let stats = $state<any>(null);

  async function load() {
    phase = await apiFetch('/phase').catch(() => null);
    // Future: authentic stats endpoint
    stats = {
      users: (await apiFetch<{ rows: any[] }>('/admin/table?name=user&limit=1')).rows?.length ?? 0, // rough check if table works
      sections: (await apiFetch<{ rows: any[] }>('/admin/table?name=section&limit=1')).rows?.length ?? 0,
    };
  }

  onMount(load);
</script>

<div class="space-y-6">
  <div class="flex items-center justify-between">
    <h1 class="text-3xl font-bold tracking-tight">Admin Dashboard</h1>
  </div>

  <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
    <Card>
      <CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle class="text-sm font-medium">System Phase</CardTitle>
        <Activity class="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div class="text-2xl font-bold capitalize">{phase?.phase ?? 'Unknown'}</div>
        <p class="text-xs text-muted-foreground">Global Lifecycle State</p>
      </CardContent>
    </Card>

    <Card>
      <CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle class="text-sm font-medium">Database Connection</CardTitle>
        <Database class="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        {#if stats}
          <div class="text-2xl font-bold text-green-600">Online</div>
          <p class="text-xs text-muted-foreground">D1 / Durable Objects Active</p>
        {:else}
          <div class="text-2xl font-bold text-yellow-600">Checking...</div>
        {/if}
      </CardContent>
    </Card>

    <Card>
      <CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle class="text-sm font-medium">Active Users</CardTitle>
        <Users class="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <!-- Mock stats for now, real stats would need a specific endpoint -->
        <div class="text-2xl font-bold">--</div>
        <p class="text-xs text-muted-foreground">Connected via WebSocket</p>
      </CardContent>
    </Card>

    <Card>
      <CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle class="text-sm font-medium">Infrastructure</CardTitle>
        <Server class="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div class="text-2xl font-bold">Cloudflare</div>
        <p class="text-xs text-muted-foreground">Workers + DO + D1</p>
      </CardContent>
    </Card>
  </div>
</div>
