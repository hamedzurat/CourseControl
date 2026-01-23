<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';

  import { goto } from '$app/navigation';

  import ModeToggle from '$lib/components/ModeToggle.svelte';
  import MultiSessionSwitcher from '$lib/components/MultiSessionSwitcher.svelte';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import { Separator } from '$lib/components/ui/separator';
  import { authStore, clearAuth } from '$lib/stores/auth';
  import { wsStatus } from '$lib/stores/ws';
  import { closeUserWs, ensureUserWsConnected } from '$lib/ws/user-ws';

  // nanostores interop: easiest is $ syntax via @nanostores/svelte if you use it.
  // If you don't have it yet, we keep it simple:
  let auth = authStore.get();
  let status = wsStatus.get();

  const un1 = authStore.listen((v) => (auth = v));
  const un2 = wsStatus.listen((v) => (status = v));

  onMount(() => {
    ensureUserWsConnected();
    return () => {
      un1();
      un2();
    };
  });

  function logout() {
    clearAuth();
    closeUserWs();
    goto('/');
  }

  $: role = auth?.user.role;
</script>

<nav class="w-full border-b">
  <div class="mx-auto max-w-6xl px-4 py-3">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="flex items-center gap-3">
        <a class="text-base font-semibold tracking-tight" href="/">CourseControl</a>

        <Separator orientation="vertical" class="h-5" />

        {#if status.state === 'connected'}
          <Badge variant="secondary">WS: connected</Badge>
        {:else if status.state === 'connecting'}
          <Badge variant="outline">WS: connecting</Badge>
        {:else if status.state === 'error'}
          <Badge variant="destructive">WS: error</Badge>
        {:else}
          <Badge variant="outline">WS: off</Badge>
        {/if}
      </div>

      <div class="flex flex-wrap items-center gap-2">
        {#if auth}
          <Badge variant="outline" class="mr-2">
            {auth.user.email} · {auth.user.role}
          </Badge>

          {#if role === 'student'}
            <Button variant="ghost"><a href="/student/dashboard">Dashboard</a></Button>
            <Button variant="ghost"><a href="/student/section-selection">Section Selection</a></Button>
            <Button variant="ghost"><a href="/student/group">group</a></Button>
            <Button variant="ghost"><a href="/student/swap">swap</a></Button>
          {:else if role === 'faculty'}
            <Button variant="ghost"><a href="/faculty/dashboard">Dashboard</a></Button>
          {:else if role === 'admin'}
            <Button variant="ghost"><a href="/admin/dashboard">Dashboard</a></Button>
            <Button variant="ghost"><a href="/admin/db">db</a></Button>
            <Button variant="ghost"><a href="/admin/sections">waarmup</a></Button>
          {/if}

          <Button variant="ghost"><a href="/help">Help</a></Button>

          <Button href="/all" variant="ghost">All</Button>
          <Button href="/notification" variant="ghost">Notifications</Button>
          <Button href="/chat" variant="ghost">chat</Button>
          <Button href="/settings" variant="ghost">settings</Button>

          <Button variant="outline" onclick={logout}>Logout</Button>
        {:else}
          <Button variant="outline"><a href="/login">Login</a></Button>
          <Button variant="ghost"><a href="/login/dev">Dev Login</a></Button>
        {/if}

        <div class="flex items-center gap-2">
          <MultiSessionSwitcher />
          <ModeToggle />
        </div>
      </div>
    </div>
  </div>
</nav>
