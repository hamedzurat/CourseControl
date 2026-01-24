<script lang="ts">
  import { onMount } from 'svelte';

  import { apiFetch } from '$lib/api';
  import QueuePanel from '$lib/components/QueuePanel.svelte';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
  import { Input } from '$lib/components/ui/input';
  import * as Select from '$lib/components/ui/select/index.js';
  import { Separator } from '$lib/components/ui/separator';
  import { loadMe, meStore, type MePayload } from '$lib/stores/me';
  import { placementStatus, swapInvites } from '$lib/stores/ws';
  import { ensureUserWsConnected, sendUserAction } from '$lib/ws/user-ws';

  type RelationSubject = {
    id: number;
    code: string;
    name: string;
    type?: string;
    sections: Array<{ id: number; sectionNumber: string; timeslotMask: number; maxSeats: number; faculty?: any }>;
  };
  type RelationJson = { generatedAtMs: number; subjects: RelationSubject[] };

  let me = $state<MePayload | null>(null);
  let rel = $state<RelationJson | null>(null);

  let wsStudent = $derived($placementStatus);
  let latestSwapInvites = $derived($swapInvites);

  let banner = $state<{ kind: 'ok' | 'error' | 'info'; text: string } | null>(null);
  let creating = $state(false);
  let joinCode = $state('');
  let giveSelectionKey = $state('');
  let wantSectionIdStr = $state('');
  let inviteCountStr = $state('3');
  let invitingSwapId = $state<number | null>(null);

  const phase = $derived.by(() => wsStudent?.phase ?? 'unknown');
  const enrolledSubjectIds = $derived.by(() => {
    const ids = wsStudent?.enrolledSubjectIds;
    return Array.isArray(ids) ? (ids as number[]) : [];
  });
  const selections = $derived.by(() => (Array.isArray(wsStudent?.selections) ? wsStudent.selections : []));
  const swaps = $derived.by(() => (Array.isArray(wsStudent?.swaps) ? wsStudent.swaps : []));

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

  const giveTrigger = $derived.by(
    () => giveOptions.find((x: any) => x.value === giveSelectionKey)?.label ?? 'Pick what you will give',
  );

  const wantOptions = $derived.by(() => {
    if (!giveSelectionKey) return [];
    const [sidStr] = giveSelectionKey.split(':');
    const subj = subjectById(Number(sidStr));
    if (!subj) return [];
    return subj.sections.map((sec) => ({ value: String(sec.id), label: `want ${sec.sectionNumber}` }));
  });

  const wantTrigger = $derived.by(
    () => wantOptions.find((x: any) => x.value === wantSectionIdStr)?.label ?? 'Pick what you want',
  );

  function canSwapActions() {
    return phase === 'swap';
  }
  function setOk(text: string) {
    banner = { kind: 'ok', text };
    setTimeout(() => (banner = null), 2500);
  }
  function setErr(text: string) {
    banner = { kind: 'error', text };
    setTimeout(() => (banner = null), 3500);
  }

  function doCreate() {
    if (!canSwapActions()) return;
    creating = true;
    sendUserAction('swap_create', {});
    setOk('Swap create requested.');
    creating = false;
  }

  function doInvite(swapId: number) {
    if (!canSwapActions()) return;
    const count = Number(inviteCountStr);
    if (!Number.isFinite(swapId) || swapId <= 0) return setErr('Invalid swap ID');
    if (!Number.isFinite(count) || count <= 0) return setErr('count required');
    invitingSwapId = swapId;
    sendUserAction('swap_invite', { swapId, count });
    setOk('Invite generation requested.');
  }

  function doJoin() {
    if (!canSwapActions()) return;
    const code = joinCode.trim();
    if (!code) return setErr('invite code required');
    if (!giveSelectionKey) return setErr('pick a give section');
    if (!wantSectionIdStr) return setErr('pick a want section');
    const [, giveSecStr] = giveSelectionKey.split(':');
    const giveSectionId = Number(giveSecStr);
    const wantSectionId = Number(wantSectionIdStr);
    if (!Number.isFinite(giveSectionId)) return setErr('invalid give section');
    if (!Number.isFinite(wantSectionId)) return setErr('invalid want section');
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

  onMount(() => {
    ensureUserWsConnected();
    const unMe = meStore.listen((v) => (me = v));
    loadMe().catch(() => {});
    apiFetch<RelationJson>('/relation.json')
      .then((r) => (rel = r))
      .catch(() => {});
    return () => unMe();
  });
</script>

<div class="mx-auto w-full max-w-6xl space-y-6 px-4 py-6">
  <div class="space-y-1">
    <h1 class="text-2xl font-semibold">Swap</h1>
    <p class="text-sm text-muted-foreground">Swap is only active in <Badge variant="outline">swap</Badge> phase.</p>
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
    <Card
      ><CardContent class="py-6 text-sm text-muted-foreground"
        >Swap actions are disabled because phase is <Badge variant="outline">{phase}</Badge>.</CardContent
      ></Card
    >
  {/if}

  <div class="grid gap-6 md:grid-cols-2">
    <Card class="h-fit">
      <CardHeader
        ><CardTitle>Join a Swap</CardTitle><CardDescription>Join using an invite code from a leader.</CardDescription
        ></CardHeader
      >
      <CardContent class="space-y-4">
        <Input placeholder="Invite code" bind:value={joinCode} />
        <Select.Root type="single" name="giveSelection" bind:value={giveSelectionKey}>
          <Select.Trigger class="w-full">{giveTrigger}</Select.Trigger>
          <Select.Content
            ><Select.Group
              ><Select.Label>I will Give</Select.Label>{#each giveOptions as opt (opt.value)}<Select.Item
                  value={opt.value}
                  label={opt.label}>{opt.label}</Select.Item
                >{/each}</Select.Group
            ></Select.Content
          >
        </Select.Root>
        <Select.Root type="single" name="wantSection" bind:value={wantSectionIdStr} disabled={!giveSelectionKey}>
          <Select.Trigger class="w-full">{wantTrigger}</Select.Trigger>
          <Select.Content
            ><Select.Group
              ><Select.Label>I Want</Select.Label>{#each wantOptions as opt (opt.value)}<Select.Item
                  value={opt.value}
                  label={opt.label}>{opt.label}</Select.Item
                >{/each}</Select.Group
            ></Select.Content
          >
        </Select.Root>
        <Button class="w-full" onclick={doJoin} disabled={!canSwapActions()}>Join / Update</Button>
      </CardContent>
    </Card>
    <Card class="h-fit">
      <CardHeader
        ><CardTitle>Create New Swap</CardTitle><CardDescription>Start a new swap group.</CardDescription></CardHeader
      >
      <CardContent
        ><Button class="w-full" onclick={doCreate} disabled={!canSwapActions() || creating}
          >{creating ? 'Creating...' : 'Create New Swap'}</Button
        ></CardContent
      >
    </Card>
  </div>

  <Separator />

  <div class="space-y-4">
    <h2 class="text-xl font-semibold">My Swaps</h2>
    {#if swaps.length === 0}
      <div class="text-sm text-muted-foreground italic">You are not participating in any swaps yet.</div>
    {:else}
      <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {#each swaps as s (s.id)}
          <Card>
            <CardHeader class="pb-3">
              <div class="flex items-center justify-between">
                <CardTitle class="text-base">Swap #{s.id}</CardTitle>{#if isLeader(s)}<Badge>Leader</Badge>{:else}<Badge
                    variant="secondary">Member</Badge
                  >{/if}
              </div>
              <CardDescription>Status: <span class="font-medium capitalize">{s.status}</span></CardDescription>
            </CardHeader>
            <CardContent class="space-y-4">
              {#if isLeader(s)}
                <div class="flex gap-2">
                  <Select.Root type="single" name="inviteCount" bind:value={inviteCountStr}
                    ><Select.Trigger class="h-9 w-[80px]">{inviteCountStr}</Select.Trigger><Select.Content
                      ><Select.Item value="1" label="1">1</Select.Item><Select.Item value="3" label="3">3</Select.Item
                      ><Select.Item value="5" label="5">5</Select.Item></Select.Content
                    ></Select.Root
                  >
                  <Button variant="secondary" size="sm" class="flex-1" onclick={() => doInvite(Number(s.id))}
                    >Gen. Invites</Button
                  >
                </div>
                <Button variant="destructive" size="sm" class="w-full" onclick={() => doExec(Number(s.id))}
                  >Execute Swap</Button
                >
                {#if invitingSwapId === s.id && latestSwapInvites.length > 0}
                  <div class="rounded-md bg-muted/50 p-2 text-xs">
                    <div class="mb-1 font-medium text-muted-foreground">New Codes:</div>
                    <div class="flex flex-wrap gap-1.5">
                      {#each latestSwapInvites as c}<Badge
                          variant="outline"
                          class="cursor-text bg-background font-mono text-[10px] select-all">{c}</Badge
                        >{/each}
                    </div>
                  </div>
                {/if}
              {/if}
              {#if s.participants?.length}<Separator />
                <div class="text-xs text-muted-foreground">Participants: {s.participants.length}</div>{/if}
            </CardContent>
          </Card>
        {/each}
      </div>
    {/if}
  </div>

  <QueuePanel />
</div>
