<script lang="ts">
  import { Bell, Loader2, RefreshCw } from '@lucide/svelte';
  import { onMount } from 'svelte';

  import { createNotification, pollNotifications, type NotificationItem } from '$lib/api/notifications';
  import { Button } from '$lib/components/ui/button';
  import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
  import { Input } from '$lib/components/ui/input';
  import * as Select from '$lib/components/ui/select/index.js';
  import { Separator } from '$lib/components/ui/separator';
  import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
    SheetTrigger,
  } from '$lib/components/ui/sheet';
  import { Tabs, TabsContent, TabsList, TabsTrigger } from '$lib/components/ui/tabs';
  import { Textarea } from '$lib/components/ui/textarea';
  import { meStore } from '$lib/stores/me';

  const me = $derived($meStore);

  let items = $state<NotificationItem[]>([]);
  let sinceMs = $state<number | undefined>(undefined);
  let loading = $state(false);
  let error = $state<string | null>(null);

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
      const seen = new Set(items.map((x) => x.id));
      const merged = [...items];
      for (const n of res.items) if (!seen.has(n.id)) merged.push(n);
      merged.sort((a, b) => b.createdAtMs - a.createdAtMs); // Show newest first in the sheet

      items = merged;
      sinceMs = res.nowMs;
    } catch (e: any) {
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
      await refresh();
    } catch (e: any) {
      error = e?.message ?? 'Failed to create notification';
    }
  }

  onMount(() => {
    refresh();
    const t = setInterval(() => {
      refresh();
    }, 60_000);
    return () => clearInterval(t);
  });
</script>

<Sheet>
  <SheetTrigger>
    {#snippet child({ props })}
      <Button variant="ghost" size="icon" class="relative" {...props}>
        <Bell class="h-5 w-5" />
        {#if items.length > 0}
          <span class="absolute top-1 right-1 flex h-2.5 w-2.5">
            <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75"></span>
            <span class="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500"></span>
          </span>
        {/if}
      </Button>
    {/snippet}
  </SheetTrigger>
  <SheetContent class="flex h-full w-full flex-col overflow-hidden sm:w-[500px]">
    <SheetHeader>
      <SheetTitle class="flex items-center justify-between">
        <span>Notifications</span>
        <Button variant="ghost" size="icon" disabled={loading} onclick={refresh}>
          {#if loading}
            <Loader2 class="h-4 w-4 animate-spin" />
          {:else}
            <RefreshCw class="h-4 w-4" />
          {/if}
        </Button>
      </SheetTitle>
      <SheetDescription>Latest updates and announcements.</SheetDescription>
    </SheetHeader>

    {#if error}
      <div class="mt-2 rounded-md bg-destructive/10 p-4 text-sm text-destructive">
        {error}
      </div>
    {/if}

    <div class="-mx-6 flex-1 overflow-y-auto px-6 py-4">
      {#if canCreate}
        <Tabs value="list" class="w-full">
          <TabsList class="mb-4 grid w-full grid-cols-2">
            <TabsTrigger value="list">Inbox</TabsTrigger>
            <TabsTrigger value="create">Create</TabsTrigger>
          </TabsList>

          <TabsContent value="list" class="space-y-4">
            {#if items.length === 0}
              <div class="py-8 text-center text-muted-foreground">No notifications yet.</div>
            {:else}
              {#each items as n (n.id)}
                <div class="flex flex-col gap-2 rounded-lg border bg-card p-4 text-card-foreground shadow-sm">
                  <div class="flex items-start justify-between gap-2">
                    <div class="leading-none font-semibold tracking-tight">{n.title}</div>
                    <span class="text-xs whitespace-nowrap text-muted-foreground">{formatTime(n.createdAtMs)}</span>
                  </div>
                  <div class="text-xs text-muted-foreground">
                    From: <span class="font-mono">{n.createdByUserId || 'System'}</span>
                    {#if n.audienceUserId}
                      • To: <span class="font-mono">{n.audienceUserId}</span>
                    {:else if n.audienceRole}
                      • To: {n.audienceRole}
                    {/if}
                  </div>
                  <div class="mt-1 text-sm whitespace-pre-wrap">{n.body}</div>
                </div>
              {/each}
            {/if}
          </TabsContent>

          <TabsContent value="create">
            <div class="space-y-4">
              <div class="space-y-2">
                <div class="text-sm font-medium">Audience</div>
                <Select.Root type="single" name="audienceMode" bind:value={audienceMode}>
                  <Select.Trigger class="w-full">
                    {audienceModeLabel}
                  </Select.Trigger>
                  <Select.Content>
                    <Select.Group>
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
                  <Input placeholder="u_stu_1" bind:value={audienceUserId} />
                </div>
              {/if}

              <Separator />

              <div class="space-y-2">
                <div class="text-sm font-medium">Title</div>
                <Input placeholder="Subject" bind:value={title} />
              </div>

              <div class="space-y-2">
                <div class="text-sm font-medium">Body</div>
                <Textarea rows={5} placeholder="Message content..." bind:value={body} />
              </div>

              <Button class="w-full" disabled={loading} onclick={submitCreate}>
                {loading ? 'Sending...' : 'Send Notification'}
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      {:else}
        <!-- Student/Generic View (No Tabs) -->
        <div class="space-y-4">
          {#if items.length === 0}
            <div class="py-8 text-center text-muted-foreground">No notifications yet.</div>
          {:else}
            {#each items as n (n.id)}
              <div class="flex flex-col gap-2 rounded-lg border bg-card p-4 text-card-foreground shadow-sm">
                <div class="flex items-start justify-between gap-2">
                  <div class="leading-none font-semibold tracking-tight">{n.title}</div>
                  <span class="text-xs whitespace-nowrap text-muted-foreground">{formatTime(n.createdAtMs)}</span>
                </div>
                <div class="text-xs text-muted-foreground">
                  From: <span class="font-mono">{n.createdByUserId || 'System'}</span>
                </div>
                <div class="mt-1 text-sm whitespace-pre-wrap">{n.body}</div>
              </div>
            {/each}
          {/if}
        </div>
      {/if}
    </div>
  </SheetContent>
</Sheet>
