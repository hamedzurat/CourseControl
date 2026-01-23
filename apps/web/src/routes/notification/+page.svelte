<script lang="ts">
  import { onMount } from 'svelte';

  import { createNotification, pollNotifications, type NotificationItem } from '$lib/api/index.ts';
  import { Button } from '$lib/components/ui/button';
  import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
  import { Input } from '$lib/components/ui/input';
  import * as Select from '$lib/components/ui/select/index.js';
  import { Separator } from '$lib/components/ui/separator';
  import { Textarea } from '$lib/components/ui/textarea';
  import { meStore } from '$lib/stores/me'; // your nanostore (persistent) for /me

  const me = $derived($meStore); // { user: { id, email, role }, ... } based on your /me

  let items = $state<NotificationItem[]>([]);
  let sinceMs = $state<number | undefined>(undefined);
  let loading = $state(false);
  let error = $state<string | null>(null);

  // create form (faculty/admin only)
  const canCreate = $derived(me?.user?.role === 'faculty' || me?.user?.role === 'admin');

  const audienceModes = [
    { value: 'everyone', label: 'Everyone' },
    { value: 'role', label: 'By role' },
    { value: 'user', label: 'Specific user' },
  ] as const;

  const roles = [
    { value: 'student', label: 'Students' },
    { value: 'faculty', label: 'Faculties' },
    { value: 'admin', label: 'Admins' },
  ] as const;

  let audienceMode = $state<(typeof audienceModes)[number]['value']>('everyone');
  let audienceRole = $state<(typeof roles)[number]['value']>('student');
  let audienceUserId = $state('');

  let title = $state('');
  let body = $state('');

  const audienceModeLabel = $derived(audienceModes.find((x) => x.value === audienceMode)?.label ?? 'Audience');

  const audienceRoleLabel = $derived(roles.find((x) => x.value === audienceRole)?.label ?? 'Role');

  function formatTime(ms: number) {
    return new Intl.DateTimeFormat(undefined, {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(ms));
  }

  async function refresh() {
    loading = true;
    error = null;
    try {
      const res = await pollNotifications(sinceMs);
      // API returns newest->oldest, then reverses; we’ll just append safely by id
      const seen = new Set(items.map((x) => x.id));
      const merged = [...items];
      for (const n of res.items) if (!seen.has(n.id)) merged.push(n);
      merged.sort((a, b) => a.createdAtMs - b.createdAtMs);

      items = merged;
      sinceMs = res.nowMs; // move cursor forward
    } catch (e: any) {
      // if backend returns 429 once-per-minute, show friendly message
      const msg = e?.message ?? 'Failed to poll notifications';
      error = msg;
    } finally {
      loading = false;
    }
  }

  async function submitCreate() {
    error = null;

    const t = title.trim();
    const b = body.trim();
    if (!t || !b) {
      error = 'Title and body are required.';
      return;
    }

    const payload: any = { title: t, body: b, audienceRole: null, audienceUserId: null };

    if (audienceMode === 'role') payload.audienceRole = audienceRole;
    if (audienceMode === 'user') payload.audienceUserId = audienceUserId.trim() || null;

    try {
      await createNotification(payload);
      title = '';
      body = '';
      // after creating, pull immediately
      await refresh();
    } catch (e: any) {
      error = e?.message ?? 'Failed to create notification';
    }
  }

  onMount(async () => {
    await refresh();

    const t = setInterval(() => {
      // backend enforces once-per-minute; we match it
      refresh();
    }, 60_000);

    return () => clearInterval(t);
  });
</script>

<div class="mx-auto w-full max-w-5xl space-y-6 p-6">
  <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
    <div class="space-y-1">
      <h1 class="text-2xl font-semibold">Notifications</h1>
      <p class="text-sm text-muted-foreground">
        Auto-refreshes every 60s. Your websocket stays connected in the background.
      </p>
    </div>

    <div class="flex gap-2">
      <Button variant="outline" disabled={loading} onclick={refresh}>
        {loading ? 'Refreshing...' : 'Refresh'}
      </Button>
    </div>
  </div>

  {#if error}
    <Card>
      <CardContent class="pt-6">
        <div class="text-sm text-destructive">{error}</div>
      </CardContent>
    </Card>
  {/if}

  {#if canCreate}
    <Card>
      <CardHeader>
        <CardTitle>Create notification</CardTitle>
      </CardHeader>
      <CardContent class="space-y-4">
        <div class="grid gap-3 sm:grid-cols-2">
          <div class="space-y-2">
            <div class="text-sm font-medium">Audience</div>

            <Select.Root type="single" name="audienceMode" bind:value={audienceMode}>
              <Select.Trigger class="w-full">
                {audienceModeLabel}
              </Select.Trigger>
              <Select.Content>
                <Select.Group>
                  <Select.Label>Send to</Select.Label>
                  {#each audienceModes as m (m.value)}
                    <Select.Item value={m.value} label={m.label}>
                      {m.label}
                    </Select.Item>
                  {/each}
                </Select.Group>
              </Select.Content>
            </Select.Root>
          </div>

          {#if audienceMode === 'role'}
            <div class="space-y-2">
              <div class="text-sm font-medium">Role</div>

              <Select.Root type="single" name="audienceRole" bind:value={audienceRole}>
                <Select.Trigger class="w-full">
                  {audienceRoleLabel}
                </Select.Trigger>
                <Select.Content>
                  <Select.Group>
                    <Select.Label>Roles</Select.Label>
                    {#each roles as r (r.value)}
                      <Select.Item value={r.value} label={r.label}>
                        {r.label}
                      </Select.Item>
                    {/each}
                  </Select.Group>
                </Select.Content>
              </Select.Root>
            </div>
          {:else if audienceMode === 'user'}
            <div class="space-y-2">
              <div class="text-sm font-medium">User ID</div>
              <Input placeholder="u_stu_1 / u_fac_1 / ..." bind:value={audienceUserId} />
              <div class="text-xs text-muted-foreground">
                MVP: paste the userId exactly (from seed/admin debug pages).
              </div>
            </div>
          {:else}
            <div class="space-y-2">
              <div class="text-sm font-medium">Scope</div>
              <div class="text-sm text-muted-foreground">This will broadcast to everyone.</div>
            </div>
          {/if}
        </div>

        <Separator />

        <div class="grid gap-3">
          <div class="space-y-2">
            <div class="text-sm font-medium">Title</div>
            <Input placeholder="Short title" bind:value={title} />
          </div>

          <div class="space-y-2">
            <div class="text-sm font-medium">Body</div>
            <Textarea rows={5} placeholder="Write the announcement..." bind:value={body} />
          </div>

          <div class="flex justify-end">
            <Button disabled={loading} onclick={submitCreate}>Send</Button>
          </div>
        </div>
      </CardContent>
    </Card>
  {/if}

  <Card>
    <CardHeader>
      <CardTitle>Recent</CardTitle>
    </CardHeader>
    <CardContent class="space-y-4">
      {#if items.length === 0}
        <div class="text-sm text-muted-foreground">No notifications.</div>
      {:else}
        <div class="space-y-3">
          {#each items as n (n.id)}
            <div class="space-y-2 rounded-xl border p-4">
              <div class="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                <div class="min-w-0">
                  <div class="font-medium">{n.title}</div>
                  <div class="text-xs text-muted-foreground">
                    {formatTime(n.createdAtMs)}
                    <span class="mx-2">•</span>
                    by <span class="font-mono">{n.createdByUserId}</span>
                  </div>
                </div>
                <div class="text-xs text-muted-foreground">
                  {#if n.audienceUserId}
                    To: <span class="font-mono">{n.audienceUserId}</span>
                  {:else if n.audienceRole}
                    To: {n.audienceRole}
                  {:else}
                    To: everyone
                  {/if}
                </div>
              </div>
              <div class="text-sm whitespace-pre-wrap">{n.body}</div>
            </div>
          {/each}
        </div>
      {/if}
    </CardContent>
  </Card>
</div>
