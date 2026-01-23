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
  import { placementStatus, swapInvites, userQueue } from '$lib/stores/ws';
  import { ensureUserWsConnected, sendUserAction } from '$lib/ws/user-ws';

  // --- Types ---
  type RelationSubject = {
    id: number;
    code: string;
    name: string;
    type?: string;
    sections: Array<{ id: number; sectionNumber: string; timeslotMask: number; maxSeats: number; faculty?: any }>;
  };
  type RelationJson = { generatedAtMs: number; subjects: RelationSubject[] };

  // --- State ---
  let me = $state<MePayload | null>(null);
  let rel = $state<RelationJson | null>(null);

  // Reactive Stores
  let wsStudent = $derived($placementStatus);
  let currentQueue = $derived($userQueue);
  let latestSwapInvites = $derived($swapInvites);

  // UI Local State
  let banner = $state<{ kind: 'ok' | 'error' | 'info'; text: string } | null>(null);
  let creating = $state(false);

  // Join Inputs
  let joinCode = $state('');
  let giveSelectionKey = $state(''); // "subjectId:sectionId"
  let wantSectionIdStr = $state('');

  // Invite Logic
  let inviteCountStr = $state('3');
  // Track which swap card initiated the invite generation to show codes locally
  let invitingSwapId = $state<number | null>(null);

  // --- Derived Helpers ---
  const phase = $derived.by(() => wsStudent?.phase ?? 'unknown');

  const enrolledSubjectIds = $derived.by(() => {
    const ids = wsStudent?.enrolledSubjectIds;
    return Array.isArray(ids) ? (ids as number[]) : [];
  });

  const selections = $derived.by(() => (Array.isArray(wsStudent?.selections) ? wsStudent.selections : []));
  const swaps = $derived.by(() => (Array.isArray(wsStudent?.swaps) ? wsStudent.swaps : []));
  const queue = $derived(currentQueue);

  // Relation Helpers
  function subjectById(subjectId: number) {
    return (rel?.subjects ?? []).find((s) => Number(s.id) === Number(subjectId)) ?? null;
  }

  function sectionById(sectionId: number) {
    for (const s of rel?.subjects ?? []) {
      const sec = s.sections.find((x) => Number(x.id) === Number(sectionId));
      if (sec) return { subject: s, section: sec };
    }
    return null;
  }

  function myUserId() {
    return me?.user?.id ?? '';
  }
  function isLeader(s: any) {
    return s.leaderUserId === myUserId();
  }

  // Dropdown Logic
  const giveOptions = $derived.by(() => {
    return selections.map((sel: any) => {
      const subjectId = Number(sel.subjectId);
      const sectionId = Number(sel.sectionId);
      const subj = subjectById(subjectId);
      const sec = subj?.sections?.find((x) => Number(x.id) === sectionId);

      const label = subj
        ? `${subj.code} — give ${sec?.sectionNumber ?? sectionId}`
        : `Subject ${subjectId} — give ${sectionId}`;

      return { value: `${subjectId}:${sectionId}`, label };
    });
  });

  const giveTrigger = $derived.by(() => {
    const hit = giveOptions.find((x: { value: string; label: string }) => x.value === giveSelectionKey);
    return hit?.label ?? 'Pick what you will give';
  });

  const wantOptions = $derived.by(() => {
    if (!giveSelectionKey) return [];
    const [sidStr] = giveSelectionKey.split(':');
    const subjectId = Number(sidStr);
    const subj = subjectById(subjectId);
    if (!subj) return [];

    return subj.sections.map((sec) => ({
      value: String(sec.id),
      label: `want ${sec.sectionNumber}`,
    }));
  });

  const wantTrigger = $derived.by(() => {
    const hit = wantOptions.find((x: { value: string; label: string }) => x.value === wantSectionIdStr);
    return hit?.label ?? 'Pick what you want';
  });

  function canSwapActions() {
    return phase === 'swap';
  }

  // --- Feedback ---
  function setOk(text: string) {
    banner = { kind: 'ok', text };
    setTimeout(() => (banner = null), 2500);
  }
  function setErr(text: string) {
    banner = { kind: 'error', text };
    setTimeout(() => (banner = null), 3500);
  }

  // --- Actions ---
  function doCreate() {
    if (!canSwapActions()) return;
    creating = true;
    try {
      sendUserAction('swap_create', {});
      setOk('Swap create requested.');
    } catch (e: any) {
      setErr(e?.message ?? 'WS error');
    } finally {
      creating = false;
    }
  }

  function doInvite(swapId: number) {
    if (!canSwapActions()) return;
    const count = Number(inviteCountStr);

    if (!Number.isFinite(swapId) || swapId <= 0) return setErr('Invalid swap ID');
    if (!Number.isFinite(count) || count <= 0) return setErr('count required');

    invitingSwapId = swapId; // Mark this swap as the one expecting codes
    sendUserAction('swap_invite', { swapId, count });
    setOk('Invite generation requested.');
  }

  function doJoin() {
    if (!canSwapActions()) return;
    const code = joinCode.trim();
    if (!code) return setErr('invite code required');
    if (!giveSelectionKey) return setErr('pick a give section');
    if (!wantSectionIdStr) return setErr('pick a want section');

    const [sidStr, giveSecStr] = giveSelectionKey.split(':');
    const giveSectionId = Number(giveSecStr);
    const wantSectionId = Number(wantSectionIdStr);

    if (!Number.isFinite(giveSectionId)) return setErr('invalid give section');
    if (!Number.isFinite(wantSectionId)) return setErr('invalid want section');

    const wantMeta = sectionById(wantSectionId);
    const giveMeta = sectionById(giveSectionId);
    if (wantMeta && giveMeta && wantMeta.subject.id !== giveMeta.subject.id) {
      return setErr('want must be in the same subject as give');
    }

    sendUserAction('swap_join', { code, giveSectionId, wantSectionId });
    setOk('Join/Update participation requested.');
    joinCode = '';
  }

  function doExec(swapId: number) {
    if (!canSwapActions()) return;
    if (!Number.isFinite(swapId) || swapId <= 0) return setErr('swapId required');
    sendUserAction('swap_exec', { swapId });
    setOk('Execute requested (leader only).');
  }

  function doCancel(queueId: string) {
    sendUserAction('cancel', { queueId });
  }
  function doCancelAll() {
    sendUserAction('cancel_all');
  }

  // --- Mount ---
  onMount(() => {
    ensureUserWsConnected();
    const unMe = meStore.listen((v) => (me = v));
    loadMe().catch(() => {});

    (async () => {
      rel = await apiFetch<RelationJson>('/relation.json');
    })().catch(() => {});

    return () => unMe();
  });
</script>

<div class="mx-auto w-full max-w-6xl space-y-6 px-4 py-6">
  <div class="space-y-1">
    <h1 class="text-2xl font-semibold">Swap</h1>
    <p class="text-sm text-muted-foreground">
      Swap is only active in <Badge variant="outline">swap</Badge> phase. You can participate in multiple swaps at once.
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

  <div class="flex flex-wrap items-center gap-2">
    <Badge variant="secondary">phase: {phase}</Badge>
    <Badge variant="secondary">enrolled: {enrolledSubjectIds.length}</Badge>
    <Badge variant="secondary">swaps: {swaps.length}</Badge>
  </div>

  {#if phase !== 'swap'}
    <Card>
      <CardContent class="py-6 text-sm text-muted-foreground">
        Swap actions are disabled because phase is <Badge variant="outline">{phase}</Badge>.
      </CardContent>
    </Card>
  {/if}

  <div class="grid gap-6 md:grid-cols-2">
    <Card class="h-fit">
      <CardHeader>
        <CardTitle>Join a Swap</CardTitle>
        <CardDescription>Join using an invite code from a leader.</CardDescription>
      </CardHeader>
      <CardContent class="space-y-4">
        <Input placeholder="Invite code (e.g. SWP-123...)" bind:value={joinCode} />

        <div class="space-y-2">
          <Select.Root type="single" name="giveSelection" bind:value={giveSelectionKey}>
            <Select.Trigger class="w-full">{giveTrigger}</Select.Trigger>
            <Select.Content>
              <Select.Group>
                <Select.Label>I will Give (Current Selections)</Select.Label>
                {#each giveOptions as opt (opt.value)}
                  <Select.Item value={opt.value} label={opt.label}>{opt.label}</Select.Item>
                {/each}
              </Select.Group>
            </Select.Content>
          </Select.Root>
        </div>

        <div class="space-y-2">
          <Select.Root type="single" name="wantSection" bind:value={wantSectionIdStr} disabled={!giveSelectionKey}>
            <Select.Trigger class="w-full">{wantTrigger}</Select.Trigger>
            <Select.Content>
              <Select.Group>
                <Select.Label>I Want (Same Subject)</Select.Label>
                {#each wantOptions as opt (opt.value)}
                  <Select.Item value={opt.value} label={opt.label}>{opt.label}</Select.Item>
                {/each}
              </Select.Group>
            </Select.Content>
          </Select.Root>
        </div>

        <Button class="w-full" onclick={doJoin} disabled={!canSwapActions()}>Join / Update Participation</Button>
      </CardContent>
    </Card>

    <Card class="h-fit">
      <CardHeader>
        <CardTitle>Create New Swap</CardTitle>
        <CardDescription>Start a new swap group. You will become the leader.</CardDescription>
      </CardHeader>
      <CardContent>
        <Button class="w-full" onclick={doCreate} disabled={!canSwapActions() || creating}>
          {creating ? 'Creating...' : 'Create New Swap'}
        </Button>
      </CardContent>
    </Card>
  </div>

  <Separator />

  <div class="space-y-4">
    <h2 class="text-xl font-semibold tracking-tight">My Swaps</h2>

    {#if swaps.length === 0}
      <div class="text-sm text-muted-foreground italic">You are not participating in any swaps yet.</div>
    {:else}
      <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {#each swaps as s (s.id)}
          <Card>
            <CardHeader class="pb-3">
              <div class="flex items-center justify-between">
                <CardTitle class="text-base">Swap #{s.id}</CardTitle>
                {#if isLeader(s)}
                  <Badge>Leader</Badge>
                {:else}
                  <Badge variant="secondary">Member</Badge>
                {/if}
              </div>
              <CardDescription
                >Status: <span class="font-medium text-foreground capitalize">{s.status}</span></CardDescription
              >
            </CardHeader>

            <CardContent class="space-y-4">
              {#if isLeader(s)}
                <div class="space-y-3 pt-2">
                  <div class="flex gap-2">
                    <Select.Root type="single" name="inviteCount" bind:value={inviteCountStr}>
                      <Select.Trigger class="h-9 w-[80px]">
                        {inviteCountStr}
                      </Select.Trigger>
                      <Select.Content>
                        <Select.Item value="1" label="1">1</Select.Item>
                        <Select.Item value="3" label="3">3</Select.Item>
                        <Select.Item value="5" label="5">5</Select.Item>
                        <Select.Item value="10" label="10">10</Select.Item>
                      </Select.Content>
                    </Select.Root>
                    <Button variant="secondary" size="sm" class="flex-1" onclick={() => doInvite(Number(s.id))}>
                      Gen. Invites
                    </Button>
                  </div>

                  <Button variant="destructive" size="sm" class="w-full" onclick={() => doExec(Number(s.id))}>
                    Execute Swap
                  </Button>
                </div>

                {#if invitingSwapId === s.id && latestSwapInvites.length > 0}
                  <div class="rounded-md bg-muted/50 p-2 text-xs">
                    <div class="mb-1 font-medium text-muted-foreground">New Codes:</div>
                    <div class="flex flex-wrap gap-1.5">
                      {#each latestSwapInvites as c}
                        <Badge variant="outline" class="cursor-text bg-background font-mono text-[10px] select-all"
                          >{c}</Badge
                        >
                      {/each}
                    </div>
                  </div>
                {/if}
              {/if}

              {#if s.participants && s.participants.length}
                <Separator />
                <div class="space-y-2 text-xs">
                  <div class="font-medium text-muted-foreground">Participants: {s.participants.length}</div>
                </div>
              {/if}
            </CardContent>
          </Card>
        {/each}
      </div>
    {/if}
  </div>

  <Card>
    <CardHeader class="flex flex-row items-center justify-between pb-2">
      <div>
        <CardTitle class="text-base">Queue</CardTitle>
        <CardDescription>Recent actions.</CardDescription>
      </div>
      {#if queue.some((i) => i.status === 'queued')}
        <Button variant="outline" size="sm" class="h-7 text-xs" onclick={doCancelAll}>Cancel All</Button>
      {/if}
    </CardHeader>
    <CardContent>
      {#if queue.length === 0}
        <div class="py-2 text-sm text-muted-foreground">Queue is empty.</div>
      {:else}
        <div class="grid gap-2">
          {#each queue as item (item.id)}
            <div class="relative space-y-1 rounded-lg border p-3">
              <div class="flex flex-wrap items-center justify-between gap-2 pr-8">
                <div class="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{item.action}</Badge>
                  <Badge variant="secondary">{item.status}</Badge>
                  {#if item.error}<Badge variant="destructive">{item.error.code}</Badge>{/if}
                </div>
                <div class="text-xs text-muted-foreground">
                  {new Date(item.createdAtMs).toLocaleTimeString()}
                </div>
              </div>

              {#if item.status === 'queued'}
                <Button
                  variant="ghost"
                  size="icon"
                  class="absolute top-2 right-2 h-6 w-6 text-muted-foreground hover:text-foreground"
                  onclick={() => doCancel(item.id)}
                  title="Cancel"
                >
                  <span class="text-xs">✕</span>
                </Button>
              {/if}

              {#if item.error?.message}
                <div class="text-xs text-destructive">{item.error.message}</div>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </CardContent>
  </Card>
</div>
