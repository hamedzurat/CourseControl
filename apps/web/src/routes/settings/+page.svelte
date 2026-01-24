<script lang="ts">
  import { onMount } from 'svelte';

  import { goto } from '$app/navigation';

  import { apiFetch } from '$lib/api';
  import { authClient } from '$lib/auth';
  import ModeToggle from '$lib/components/ModeToggle.svelte';
  import { Button } from '$lib/components/ui/button';
  import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
  import { Input } from '$lib/components/ui/input';
  import { Separator } from '$lib/components/ui/separator';
  import { authStore } from '$lib/stores/auth';
  import { clearMe, loadMe, meStore } from '$lib/stores/me';
  import { wsLog, wsStatus } from '$lib/stores/ws';
  import { closeUserWs, ensureUserWsConnected } from '$lib/ws/user-ws';

  const status = $derived($wsStatus);
  const log = $derived($wsLog);
  const me = $derived($meStore);
  let auth = $state(authStore.get());

  let toast = $state<string | null>(null);

  onMount(() => {
    loadMe().catch(() => {});
  });

  async function copyToken() {
    const token = auth?.token ?? '';
    if (!token) return;
    await navigator.clipboard.writeText(token);
    toast = 'Token copied';
    setTimeout(() => (toast = null), 1200);
  }

  function reconnectWs() {
    closeUserWs();
    ensureUserWsConnected();
    toast = 'WebSocket reconnect requested';
    setTimeout(() => (toast = null), 1200);
  }

  async function clearCaches() {
    // keep this conservative: only keys we created
    localStorage.removeItem('cc_relation_v1');
    localStorage.removeItem('cc_state_v1');
    localStorage.removeItem('cc_chat_active_peer');
    toast = 'Local caches cleared';
    setTimeout(() => (toast = null), 1200);
  }

  async function logout() {
    try {
      await apiFetch('/auth/sign-out', { method: 'POST' });
    } catch {}

    closeUserWs();
    clearMe();
    authStore.set(null as any); // if you already have logoutLocal(), call that instead

    await goto('/login');
  }

  let ott = $state<string>('');
  let ottError = $state<string | null>(null);
  let ottBusy = $state(false);

  async function generateOneTimeToken() {
    ottError = null;
    ottBusy = true;
    try {
      // Better Auth one-time token plugin
      const res: any = await authClient.oneTimeToken.generate();
      // most implementations return { token } (and sometimes { expiresAt })
      ott = String(res?.data?.token ?? '');
      if (!ott) throw new Error('No token returned');
    } catch (e: any) {
      ottError = e?.message ?? 'Failed to generate token';
      ott = '';
    } finally {
      ottBusy = false;
    }
  }

  async function copyOtt() {
    if (!ott) return;
    await navigator.clipboard.writeText(ott);
    toast = 'One-time token copied';
    setTimeout(() => (toast = null), 1200);
  }
</script>

<div class="mx-auto w-full max-w-4xl space-y-6 px-4 py-6">
  <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
    <div class="space-y-1">
      <h1 class="text-2xl font-semibold">Settings</h1>
      <p class="text-sm text-muted-foreground">Account, theme, and connection tools.</p>
    </div>

    <div class="flex flex-wrap items-center gap-2">
      <ModeToggle />
      <Button variant="outline" onclick={reconnectWs}>Reconnect WS</Button>
      <Button variant="outline" onclick={clearCaches}>Clear caches</Button>
      <Button variant="destructive" onclick={logout}>Logout</Button>
    </div>
  </div>

  {#if toast}
    <div class="text-sm text-muted-foreground">{toast}</div>
  {/if}

  <Card>
    <CardHeader>
      <CardTitle>Account</CardTitle>
    </CardHeader>
    <CardContent class="space-y-4">
      <div class="grid gap-3 sm:grid-cols-2">
        <div class="space-y-1">
          <div class="text-xs text-muted-foreground">Role</div>
          <div class="text-sm">{me?.user?.role ?? auth?.user?.role ?? '-'}</div>
        </div>

        <div class="space-y-1">
          <div class="text-xs text-muted-foreground">Email</div>
          <div class="text-sm">{me?.user?.email ?? auth?.user?.email ?? '-'}</div>
        </div>

        <div class="space-y-1 sm:col-span-2">
          <div class="text-xs text-muted-foreground">User ID</div>
          <div class="text-sm break-all">{me?.user?.id ?? auth?.user?.id ?? '-'}</div>
        </div>
      </div>

      <Separator />

      <div class="flex flex-wrap gap-2">
        <Button variant="outline" onclick={() => loadMe()} disabled={!auth}>Refresh /me</Button>
        <Button variant="outline" onclick={copyToken} disabled={!auth?.token}>Copy App JWT</Button>
      </div>
    </CardContent>
  </Card>

  <Card>
    <CardHeader>
      <CardTitle>One-time token</CardTitle>
    </CardHeader>
    <CardContent class="space-y-4">
      <p class="text-sm text-muted-foreground">Generate a token for logging in on another device (demo-friendly).</p>

      <div class="flex flex-wrap gap-2">
        <Button variant="outline" onclick={generateOneTimeToken} disabled={ottBusy}>
          {ottBusy ? 'Generating…' : 'Generate'}
        </Button>
        <Button variant="outline" onclick={copyOtt} disabled={!ott}>Copy token</Button>
      </div>

      {#if ott}
        <div class="space-y-2">
          <div class="text-xs text-muted-foreground">Token</div>
          <Input readonly value={ott} />
          <div class="text-xs text-muted-foreground">
            Use it on <code>/login</code> (token login).
          </div>
        </div>
      {/if}

      {#if ottError}
        <div class="text-sm text-destructive">{ottError}</div>
      {/if}
    </CardContent>
  </Card>
</div>
