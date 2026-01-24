<script lang="ts">
  import { onDestroy, onMount } from 'svelte';

  import { apiFetch } from '$lib/api';
  import QueuePanel from '$lib/components/QueuePanel.svelte';
  import { Badge } from '$lib/components/ui/badge';
  import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
  import { Progress } from '$lib/components/ui/progress';
  import { Separator } from '$lib/components/ui/separator';
  import { placementStatus, seatStatus } from '$lib/stores/ws';
  import { ensureUserWsConnected } from '$lib/ws/user-ws';

  type RelationSection = { id: number; sectionNumber: string; timeslotMask: number; maxSeats: number; faculty?: any };
  type RelationSubject = { id: number; code: string; name: string; type?: string; sections: RelationSection[] };
  type RelationJson = { generatedAtMs: number; subjects: RelationSubject[] };

  type PhaseSchedule = {
    selectionStartMs: number;
    selectionEndMs: number;
    swapStartMs: number;
    swapEndMs: number;
  };
  type PhaseResponse = {
    nowMs: number;
    phase: 'pre' | 'selection' | 'between' | 'swap' | 'post';
    schedule: PhaseSchedule | null;
  };

  let rel = $state<RelationJson | null>(null);
  let phaseData = $state<PhaseResponse | null>(null);
  let now = $state(Date.now());
  let timer: ReturnType<typeof setInterval> | null = null;

  let wsStatus = $derived($placementStatus);
  let seats = $derived($seatStatus);

  // Phase info from API or fallback to WS
  const phase = $derived(phaseData?.phase ?? wsStatus?.phase ?? 'unknown');

  // Compute phaseEndMs based on current phase and schedule
  const phaseEndMs = $derived.by(() => {
    const s = phaseData?.schedule;
    if (!s) return wsStatus?.phaseEndMs ?? 0;
    switch (phaseData?.phase) {
      case 'pre':
        return s.selectionStartMs;
      case 'selection':
        return s.selectionEndMs;
      case 'between':
        return s.swapStartMs;
      case 'swap':
        return s.swapEndMs;
      default:
        return 0;
    }
  });

  // Time remaining
  const timeLeft = $derived.by(() => {
    if (!phaseEndMs) return null;
    const diff = phaseEndMs - now;
    if (diff <= 0) return { h: 0, m: 0, s: 0, total: 0 };
    const s = Math.floor(diff / 1000) % 60;
    const m = Math.floor(diff / 60000) % 60;
    const h = Math.floor(diff / 3600000);
    return { h, m, s, total: diff };
  });

  const timeLeftStr = $derived.by(() => {
    if (!timeLeft) return '—';
    if (timeLeft.total <= 0) return 'Ended';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(timeLeft.h)}:${pad(timeLeft.m)}:${pad(timeLeft.s)}`;
  });

  // Selections from WS
  const selections = $derived.by(() => {
    const sels = wsStatus?.data?.selections ?? wsStatus?.selections ?? [];
    return Array.isArray(sels) ? sels : [];
  });

  // Enrich selections with subject/section metadata
  const enrichedSelections = $derived.by(() => {
    const r = rel;
    if (!r) return [];
    return selections.map((sel: any) => {
      const subjectId = Number(sel.subjectId);
      const sectionId = Number(sel.sectionId);
      const subj = r.subjects.find((s) => s.id === subjectId);
      const sec = subj?.sections.find((s) => s.id === sectionId);
      const seatInfo = seats?.[subjectId]?.sections?.[sectionId];
      return {
        subjectId,
        sectionId,
        subjectCode: subj?.code ?? `Sub ${subjectId}`,
        subjectName: subj?.name ?? '',
        sectionNumber: sec?.sectionNumber ?? `Sec ${sectionId}`,
        seatsLeft: seatInfo?.seats ?? null,
        maxSeats: seatInfo?.maxSeats ?? sec?.maxSeats ?? null,
      };
    });
  });

  onMount(() => {
    ensureUserWsConnected();
    apiFetch<RelationJson>('/relation.json')
      .then((r) => (rel = r))
      .catch(() => {});
    apiFetch<PhaseResponse>('/phase')
      .then((r) => (phaseData = r))
      .catch(() => {});
    timer = setInterval(() => (now = Date.now()), 1000);
  });

  onDestroy(() => {
    if (timer) clearInterval(timer);
  });
</script>

<div class="mx-auto w-full max-w-5xl space-y-6 px-4 py-6">
  <div class="space-y-1">
    <h1 class="text-2xl font-semibold">Student Dashboard</h1>
    <p class="text-sm text-muted-foreground">Overview of your current status and selections.</p>
  </div>

  <!-- Phase & Timer -->
  <Card>
    <CardHeader class="pb-2">
      <CardTitle class="text-base">Current Phase</CardTitle>
    </CardHeader>
    <CardContent>
      <div class="flex flex-wrap items-center gap-4">
        <div class="flex items-center gap-2">
          <span class="text-sm text-muted-foreground">Phase:</span>
          <Badge variant="outline" class="text-base capitalize">{phase}</Badge>
        </div>
        <Separator orientation="vertical" class="h-6" />
        <div class="flex items-center gap-2">
          <span class="text-sm text-muted-foreground">Time Left:</span>
          <span class="font-mono text-lg font-semibold">{timeLeftStr}</span>
        </div>
      </div>
      {#if timeLeft && timeLeft.total > 0}
        <div class="mt-3">
          <Progress value={100 - Math.min(100, (timeLeft.total / (30 * 60 * 1000)) * 100)} class="h-2" />
        </div>
      {/if}
    </CardContent>
  </Card>

  <!-- My Selections -->
  <Card>
    <CardHeader>
      <CardTitle>My Selections</CardTitle>
      <CardDescription>Sections you have selected via WebSocket status.</CardDescription>
    </CardHeader>
    <CardContent>
      {#if enrichedSelections.length === 0}
        <div class="py-4 text-sm text-muted-foreground">No selections yet.</div>
      {:else}
        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {#each enrichedSelections as sel (sel.sectionId)}
            <div class="space-y-2 rounded-lg border p-4">
              <div class="flex items-center justify-between">
                <div class="font-semibold">{sel.subjectCode}</div>
                <Badge variant="secondary">{sel.sectionNumber}</Badge>
              </div>
              <div class="text-sm text-muted-foreground">{sel.subjectName}</div>
              {#if sel.seatsLeft !== null}
                <div class="flex items-center justify-between text-xs">
                  <span class="text-muted-foreground">Seats:</span>
                  <span
                    class="font-medium"
                    class:text-green-600={sel.seatsLeft > 0}
                    class:text-red-600={sel.seatsLeft <= 0}
                  >
                    {sel.seatsLeft} / {sel.maxSeats ?? '?'}
                  </span>
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </CardContent>
  </Card>

  <QueuePanel />
</div>
