<script lang="ts">
  import { onMount } from 'svelte';

  import { apiFetch } from '$lib/api/fetch';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
  import { Input } from '$lib/components/ui/input';
  import * as Select from '$lib/components/ui/select/index.js';
  import { Separator } from '$lib/components/ui/separator';
  import { loadMe, meStore, type MePayload } from '$lib/stores/me';
  import { groupInvites, placementStatus } from '$lib/stores/ws';
  import { ensureUserWsConnected, sendUserAction } from '$lib/ws/user-ws';

  type Relation = {
    subjects: Array<{
      id: number;
      code: string;
      name: string;
      type?: string;
      credits?: number;
      sections: any[];
    }>;
  };

  // --- STATE ---
  let me = $state<MePayload | null>(null);
  let rel = $state<Relation | null>(null);

  // --- REACTIVE STORES ---
  // We use the placementStatus store, which holds the student data
  let wsStatus = $derived($placementStatus);
  let latestInvites = $derived($groupInvites);

  // Local UI state
  let createSubjectId = $state<number | null>(null);
  let joinCode = $state('');
  let inviteCount = $state('3');
  let banner = $state<{ kind: 'ok' | 'error' | 'info'; text: string } | null>(null);

  // Track which group we just clicked "Generate" for
  let invitingGroupId = $state<number | null>(null);
  // --- DERIVED HELPERS ---

  // Extract data from the raw status payload safely
  const wsData = $derived.by(() => wsStatus?.data ?? {});

  const enrolledSubjectIds = $derived.by(() => {
    const ids = wsData.enrolledSubjectIds;
    return Array.isArray(ids) ? (ids as number[]) : [];
  });

  const groups = $derived.by(() => {
    const g = wsData.groups;
    return Array.isArray(g) ? g : [];
  });

  const enrolledSubjects = $derived.by(() => {
    const all = rel?.subjects ?? [];
    const set = new Set(enrolledSubjectIds);
    return all.filter((s) => set.has(Number(s.id)));
  });

  const createOptions = $derived.by(() =>
    enrolledSubjects.map((s) => ({ value: String(s.id), label: `${s.code} — ${s.name}` })),
  );

  const createTriggerContent = $derived.by(() => {
    const sid = createSubjectId;
    if (!sid) return 'Pick a subject';
    const s = enrolledSubjects.find((x) => x.id === sid);
    return s ? `${s.code} — ${s.name}` : 'Pick a subject';
  });

  // --- FUNCTIONS ---

  function subjectLabel(subjectId: number) {
    const s = (rel?.subjects ?? []).find((x) => x.id === subjectId);
    return s ? `${s.code} — ${s.name}` : `Subject ${subjectId}`;
  }

  function myUserId() {
    return me?.user?.id ?? '';
  }

  function isLeader(g: any) {
    return String(g?.leaderUserId ?? '') === String(myUserId());
  }

  function groupForSubject(subjectId: number) {
    return groups.find((g: any) => Number(g?.subjectId) === Number(subjectId)) ?? null;
  }

  function setOk(text: string) {
    banner = { kind: 'ok', text };
    setTimeout(() => (banner = null), 2500);
  }
  function setErr(text: string) {
    banner = { kind: 'error', text };
    setTimeout(() => (banner = null), 3500);
  }

  // --- ACTIONS ---

  function doCreate() {
    if (!createSubjectId) return;
    if (groupForSubject(createSubjectId)) return;

    sendUserAction('group_create', { subjectId: createSubjectId });
    setOk('Group create requested.');
  }

  function doJoin() {
    const code = joinCode.trim();
    if (!code) return;

    sendUserAction('group_join', { code });
    joinCode = '';
    setOk('Join requested.');
  }

  function doInvite(groupId: number) {
    const count = Number(inviteCount);
    if (!Number.isFinite(count) || count <= 0) return;

    // Set this group as the active one for displaying codes
    invitingGroupId = groupId;

    sendUserAction('group_invite', { groupId, count });
    setOk('Invite generation requested.');
  }

  function doLeave(groupId: number) {
    sendUserAction('group_leave', { groupId });
    setOk('Leave requested.');
  }

  function doDisband(groupId: number) {
    sendUserAction('group_disband', { groupId });
    setOk('Disband requested.');
  }

  onMount(() => {
    ensureUserWsConnected();
    const unMe = meStore.listen((v) => (me = v));
    loadMe().catch(() => {});

    (async () => {
      rel = await apiFetch<Relation>('/relation.json');
    })().catch(() => {});

    return () => {
      unMe();
    };
  });
</script>

<div class="mx-auto w-full max-w-5xl space-y-6 px-4 py-6">
  <div class="space-y-1">
    <h1 class="text-2xl font-semibold">Groups</h1>
    <p class="text-sm text-muted-foreground">
      Create one group per enrolled subject, generate invite codes, or join using a code.
    </p>
  </div>

  {#if banner}
    <div
      class="rounded-lg border px-4 py-3 text-sm"
      class:border-green-600={banner.kind === 'ok'}
      class:border-red-600={banner.kind === 'error'}
    >
      {banner.text}
    </div>
  {/if}

  <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
    <Card>
      <CardHeader>
        <CardTitle>Create a group</CardTitle>
        <CardDescription>Only for subjects you’re enrolled in.</CardDescription>
      </CardHeader>
      <CardContent class="space-y-3">
        <Select.Root
          type="single"
          name="createSubject"
          value={createSubjectId ? String(createSubjectId) : ''}
          onValueChange={(v: string) => (createSubjectId = v ? Number(v) : null)}
        >
          <Select.Trigger class="w-full">
            {createTriggerContent}
          </Select.Trigger>
          <Select.Content>
            <Select.Group>
              <Select.Label>Enrolled subjects</Select.Label>
              {#each createOptions as opt (opt.value)}
                <Select.Item value={opt.value} label={opt.label} disabled={!!groupForSubject(Number(opt.value))}>
                  {opt.label}
                </Select.Item>
              {/each}
            </Select.Group>
          </Select.Content>
        </Select.Root>

        <Button class="w-full" onclick={doCreate} disabled={!createSubjectId || !!groupForSubject(createSubjectId)}>
          Create group
        </Button>

        {#if createSubjectId && groupForSubject(createSubjectId)}
          <p class="text-xs text-muted-foreground">You already have a group for this subject.</p>
        {/if}
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle>Join a group</CardTitle>
        <CardDescription>Paste an invite code from the group leader.</CardDescription>
      </CardHeader>
      <CardContent class="space-y-3">
        <Input placeholder="Invite code (e.g. ABCD23...)" bind:value={joinCode} />
        <Button class="w-full" onclick={doJoin} disabled={!joinCode.trim()}>Join with code</Button>
      </CardContent>
    </Card>
  </div>

  <Card>
    <CardHeader>
      <CardTitle>My groups</CardTitle>
      <CardDescription>Manage groups you’re a member of.</CardDescription>
    </CardHeader>
    <CardContent class="space-y-4">
      {#if !groups.length}
        <div class="text-sm text-muted-foreground">No groups yet.</div>
      {:else}
        <div class="space-y-3">
          {#each groups as g (g.groupId)}
            <!-- <div class="space-y-3 rounded-lg border p-4">
              <div class="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div class="space-y-1">
                  <div class="font-medium">
                    {subjectLabel(Number(g.subjectId))}
                  </div>
                  <div class="text-xs text-muted-foreground">
                    Group #{g.groupId}
                    {#if g.isLocked}
                      • locked{/if}
                    {#if g.leaderUserId}
                      • leader: {g.leaderUserId}{/if}
                  </div>
                </div>

                <div class="flex flex-wrap items-center gap-2">
                  {#if isLeader(g)}
                    <Badge>Leader</Badge>
                  {:else}
                    <Badge variant="secondary">Member</Badge>
                  {/if}
                  {#if g.isLocked}
                    <Badge variant="secondary">Locked</Badge>
                  {/if}
                </div>
              </div>

              <div class="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                {#if isLeader(g)}
                  <div class="flex flex-col gap-2 md:flex-row md:items-center">
                    <Select.Root type="single" name="inviteCount" bind:value={inviteCount}>
                      <Select.Trigger class="w-[140px]">
                        Invites: {inviteCount}
                      </Select.Trigger>
                      <Select.Content>
                        <Select.Group>
                          <Select.Label>Count</Select.Label>
                          <Select.Item value="1" label="1">1</Select.Item>
                          <Select.Item value="2" label="2">2</Select.Item>
                          <Select.Item value="3" label="3">3</Select.Item>
                          <Select.Item value="5" label="5">5</Select.Item>
                        </Select.Group>
                      </Select.Content>
                    </Select.Root>

                    <Button variant="secondary" onclick={() => doInvite(Number(g.groupId))}>Generate invites</Button>
                  </div>

                  <Button variant="destructive" onclick={() => doDisband(Number(g.groupId))}>Disband</Button>
                {:else}
                  <Button variant="destructive" onclick={() => doLeave(Number(g.groupId))}>Leave</Button>
                {/if}
              </div>
            </div> -->
            <div class="space-y-3 rounded-lg border p-4">
              <div class="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div class="space-y-1">
                  <div class="font-medium">
                    {subjectLabel(Number(g.subjectId))}
                  </div>
                  <div class="text-xs text-muted-foreground">
                    Group #{g.groupId}
                    {#if g.isLocked}
                      • locked{/if}
                    {#if g.leaderUserId}
                      • leader: {g.leaderUserId}{/if}
                  </div>
                </div>

                <div class="flex flex-wrap items-center gap-2">
                  {#if isLeader(g)}
                    <Badge>Leader</Badge>
                  {:else}
                    <Badge variant="secondary">Member</Badge>
                  {/if}
                  {#if g.isLocked}
                    <Badge variant="secondary">Locked</Badge>
                  {/if}
                </div>
              </div>

              <div class="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                {#if isLeader(g)}
                  <div class="flex flex-col gap-2 md:flex-row md:items-center">
                    <Select.Root type="single" name="inviteCount" bind:value={inviteCount}>
                      <Select.Trigger class="w-[140px]">
                        Invites: {inviteCount}
                      </Select.Trigger>
                      <Select.Content>
                        <Select.Group>
                          <Select.Label>Count</Select.Label>
                          <Select.Item value="1" label="1">1</Select.Item>
                          <Select.Item value="2" label="2">2</Select.Item>
                          <Select.Item value="3" label="3">3</Select.Item>
                          <Select.Item value="5" label="5">5</Select.Item>
                        </Select.Group>
                      </Select.Content>
                    </Select.Root>

                    <Button variant="secondary" onclick={() => doInvite(Number(g.groupId))}>Generate invites</Button>
                  </div>

                  <Button variant="destructive" onclick={() => doDisband(Number(g.groupId))}>Disband</Button>
                {:else}
                  <Button variant="destructive" onclick={() => doLeave(Number(g.groupId))}>Leave</Button>
                {/if}
              </div>

              {#if isLeader(g) && invitingGroupId === g.groupId && latestInvites.length > 0}
                <div class="rounded-md bg-muted/50 p-3">
                  <div class="mb-2 text-xs font-medium text-muted-foreground">New Invite Codes (Copy these):</div>
                  <div class="flex flex-wrap gap-2">
                    {#each latestInvites as code}
                      <Badge variant="outline" class="cursor-text bg-background font-mono select-all">
                        {code}
                      </Badge>
                    {/each}
                  </div>
                </div>
              {/if}

              {#if Array.isArray(g.members) && g.members.length}
                <Separator />
                <div class="space-y-2">
                  <div class="text-sm font-medium">Members</div>
                  <div class="flex flex-wrap gap-2">
                    {#each g.members as m (m)}
                      <Badge variant="secondary">{m}</Badge>
                    {/each}
                  </div>
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </CardContent>
  </Card>

  <Card>
    <CardHeader>
      <CardTitle>Debug</CardTitle>
      <CardDescription>Current student WS status payload.</CardDescription>
    </CardHeader>
    <CardContent>
      <pre class="overflow-auto rounded-lg border p-3 text-xs">{JSON.stringify(wsData, null, 2)}</pre>
    </CardContent>
  </Card>
</div>
