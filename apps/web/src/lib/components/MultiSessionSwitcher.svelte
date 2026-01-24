<script lang="ts">
  import { onMount } from 'svelte';

  import { authClient } from '$lib/auth';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import * as Select from '$lib/components/ui/select';

  type DeviceSession = {
    token: string;
    user?: { id?: string; email?: string; name?: string };
    expiresAt?: string | number | Date;
    createdAt?: string | number | Date;
  };

  let sessions = $state<DeviceSession[]>([]);
  let loading = $state(false);
  let selectedToken = $state('');
  let initialToken = $state('');

  function labelFor(s: DeviceSession) {
    const email = s.user?.email ?? '';
    const name = s.user?.name ?? '';
    const token = s.token ? s.token.slice(0, 8) : '';
    return email || name ? `${email || name}` : `session ${token}`;
  }

  const currentSession = $derived(sessions.find((x) => x.token === selectedToken));
  const triggerContent = $derived(currentSession ? `Session: ${labelFor(currentSession)}` : 'Switch session');

  async function refresh() {
    loading = true;
    try {
      const [listRes, currentRes] = await Promise.all([
        authClient.multiSession.listDeviceSessions(),
        authClient.getSession(),
      ]);

      const { data, error } = listRes;

      let list: DeviceSession[] = [];
      if (!error && data) {
        list = (data as any)?.sessions ?? (data as any)?.data ?? (Array.isArray(data) ? data : []);
      }

      // Map potential sessionToken -> token if strictly typed or inconsistent
      list = list.map((s: any) => ({
        ...s,
        token: s.token || s.sessionToken,
      }));

      // Ensure current session is in the list
      if (currentRes.data?.session) {
        const currentToken = currentRes.data.session.token;
        const exists = list.find((s) => s.token === currentToken);
        if (!exists) {
          list.push({
            token: currentToken,
            user: currentRes.data.user,
            expiresAt: currentRes.data.session.expiresAt,
            createdAt: currentRes.data.session.createdAt,
          });
        }

        // If we haven't selected a token yet, select the current one
        if (!selectedToken) {
          selectedToken = currentToken;
          initialToken = currentToken;
        }
      }

      sessions = list;

      // Fallback selection if still nothing selected but list has items
      if (sessions.length && !selectedToken) {
        selectedToken = sessions[0].token;
        initialToken = sessions[0].token;
      }
    } finally {
      loading = false;
    }
  }

  async function setActive(token: string) {
    if (!token) return;

    const { error } = await authClient.multiSession.setActive({ sessionToken: token });
    if (error) return;

    location.reload();
  }

  // Detect user-initiated selection changes
  $effect(() => {
    if (selectedToken && initialToken && selectedToken !== initialToken) {
      setActive(selectedToken).catch(() => {});
    }
  });

  onMount(() => {
    refresh().catch(() => {});
  });
</script>

<div class="flex items-center gap-2">
  <Select.Root type="single" name="multiSession" bind:value={selectedToken} disabled={loading}>
    <Select.Trigger class="w-[220px]">
      {triggerContent}
    </Select.Trigger>

    <Select.Content>
      <Select.Group>
        <Select.Label>Device sessions</Select.Label>

        {#if sessions.length === 0}
          <div class="px-2 py-2 text-sm text-muted-foreground">No sessions found.</div>
        {:else}
          {#each sessions as s (s.token)}
            <Select.Item value={s.token} label={labelFor(s) + ' (' + s.token.slice(0, 6) + ')'} />
          {/each}
        {/if}
      </Select.Group>
    </Select.Content>
  </Select.Root>

  <Button variant="outline" class="h-9 px-3" onclick={refresh} disabled={loading}>
    {#if loading}…{:else}↻{/if}
  </Button>
</div>
