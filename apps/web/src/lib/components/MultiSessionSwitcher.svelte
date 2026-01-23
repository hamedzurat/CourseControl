<script lang="ts">
  import { onMount } from 'svelte';

  import { authClient } from '$lib/auth-client';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import * as Select from '$lib/components/ui/select/index.js';

  type DeviceSession = {
    sessionToken: string;
    user?: { id?: string; email?: string; name?: string };
    expiresAt?: string | number;
    createdAt?: string | number;
  };

  let sessions = $state<DeviceSession[]>([]);
  let loading = $state(false);
  let selectedToken = $state('');

  function labelFor(s: DeviceSession) {
    const email = s.user?.email ?? '';
    const name = s.user?.name ?? '';
    const token = s.sessionToken ? s.sessionToken.slice(0, 8) : '';
    return email || name ? `${email || name}` : `session ${token}`;
  }

  const triggerContent = $derived(() => {
    const cur = sessions.find((x) => x.sessionToken === selectedToken);
    return cur ? `Session: ${labelFor(cur)}` : 'Switch session';
  });

  async function refresh() {
    loading = true;
    try {
      // docs: listDeviceSessions() :contentReference[oaicite:4]{index=4}
      const { data, error } = await authClient.multiSession.listDeviceSessions();
      if (error) {
        sessions = [];
        return;
      }

      // be tolerant about response shape
      const arr = (data as any)?.sessions ?? (data as any)?.data ?? (Array.isArray(data) ? data : []);

      sessions = Array.isArray(arr) ? arr : [];
      // keep selection stable if possible
      if (sessions.length && !selectedToken) selectedToken = sessions[0].sessionToken;
    } finally {
      loading = false;
    }
  }

  async function setActive(token: string) {
    if (!token) return;

    // docs: setActive({ sessionToken }) :contentReference[oaicite:5]{index=5}
    const { error } = await authClient.multiSession.setActive({ sessionToken: token });
    if (error) return;

    // simplest + most reliable for your app state (meStore/ws/etc):
    // reload so /me + ws connect under the newly active cookie/session.
    location.reload();
  }

  onMount(() => {
    refresh().catch(() => {});
  });
</script>

<div class="flex items-center gap-2">
  <Select.Root
    type="single"
    name="multiSession"
    value={selectedToken}
    onValueChange={(v: string) => {
      selectedToken = v;
      setActive(v).catch(() => {});
    }}
    disabled={loading}
  >
    <Select.Trigger class="w-[220px]">
      {triggerContent}
    </Select.Trigger>

    <Select.Content>
      <Select.Group>
        <Select.Label>Device sessions</Select.Label>

        {#if sessions.length === 0}
          <div class="px-2 py-2 text-sm text-muted-foreground">No sessions found.</div>
        {:else}
          {#each sessions as s (s.sessionToken)}
            <Select.Item value={s.sessionToken} label={labelFor(s)}>
              <div class="flex w-full items-center justify-between gap-2">
                <span class="truncate">{labelFor(s)}</span>
                <Badge variant="secondary" class="shrink-0">
                  {s.sessionToken.slice(0, 6)}
                </Badge>
              </div>
            </Select.Item>
          {/each}
        {/if}
      </Select.Group>
    </Select.Content>
  </Select.Root>

  <Button variant="outline" class="h-9 px-3" onclick={refresh} disabled={loading}>
    {#if loading}…{:else}↻{/if}
  </Button>
</div>
