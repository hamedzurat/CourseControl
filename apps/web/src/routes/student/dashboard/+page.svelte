<script lang="ts">
  import { onMount } from 'svelte';

  import { apiFetch } from '$lib/api/fetch';
  import { Badge } from '$lib/components/ui/badge';
  import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
  import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '$lib/components/ui/table';
  import { loadMe, meStore } from '$lib/stores/me';
  import { loadPhase, phaseStore } from '$lib/stores/phase';
  import { loadRelation, relationStore } from '$lib/stores/relation';
  import { placementStatus } from '$lib/stores/ws';
  import { ensureUserWsConnected } from '$lib/ws/user-ws';

  // --- State ---
  let me = $state(meStore.get());
  let phase = $state(phaseStore.get());
  let relation = $state(relationStore.get());

  // WebSocket State
  let wsStudent = $derived($placementStatus);

  let latestNotif = $state<any | null>(null);
  let nowMs = $state(Date.now());
  let loading = $state(true);

  // Sync local state with stores
  $effect(() => {
    const u = meStore.subscribe((v) => (me = v));
    return u;
  });
  $effect(() => {
    const u = phaseStore.subscribe((v) => (phase = v));
    return u;
  });
  $effect(() => {
    const u = relationStore.subscribe((v) => (relation = v));
    return u;
  });

  onMount(() => {
    // 1. Start the clock immediately (Synchronous)
    // This allows us to return the cleanup function correctly below.
    const t = setInterval(() => (nowMs = Date.now()), 1000);

    // 2. Run the async data loading (Fire-and-forget)
    (async () => {
      loading = true;
      try {
        ensureUserWsConnected();
        await Promise.all([loadMe(), loadPhase(), loadRelation()]);

        const polled = await apiFetch<{ items: any[] }>('/notification/poll?sinceMs=0');
        latestNotif = polled.items?.length ? polled.items[polled.items.length - 1] : null;
      } catch (e) {
        console.error('Dashboard load error:', e);
      } finally {
        loading = false;
      }
    })();

    // 3. Return the cleanup function synchronously
    return () => clearInterval(t);
  });

  // Derived: Combine WS selections with Relation data for display
  const selectionRows = $derived.by(() => {
    const rel = relation;
    // Prefer WS data (live), fallback to me profile (static/stale)
    const rawSelections = wsStudent?.data?.selections ?? me?.selections ?? [];

    if (!rel) return [];

    const subjById = new Map(rel.subjects.map((s) => [Number(s.id), s]));
    const out: any[] = [];

    for (const sel of rawSelections) {
      const subjectId = Number(sel.subjectId ?? sel.subject_id ?? sel.subject);
      const sectionId = Number(sel.sectionId ?? sel.section_id ?? sel.section);

      const subj = subjById.get(subjectId);
      const sec = subj?.sections?.find((x) => Number(x.id) === sectionId);

      out.push({
        subjectId,
        subjectCode: subj?.code ?? `#${subjectId}`,
        subjectName: subj?.name ?? 'Unknown subject',
        subjectType: subj?.type ?? 'unknown',
        sectionId,
        sectionNumber: sec?.sectionNumber ?? `#${sectionId}`,
        facultyName: sec?.faculty?.name ?? sec?.faculty?.id ?? '—',
        timeslotMask: sec?.timeslotMask ?? null,
      });
    }

    return out;
  });

  function nextEvent() {
    const s = phase?.schedule;
    if (!s) return null;

    const candidates = [
      { at: s.selectionStartMs, label: 'Selection starts' },
      { at: s.selectionEndMs, label: 'Selection ends' },
      { at: s.swapStartMs, label: 'Swap starts' },
      { at: s.swapEndMs, label: 'Swap ends' },
    ].filter((x) => x.at > nowMs);

    return candidates.length ? candidates[0] : null;
  }

  const next = $derived(nextEvent());

  function fmtDelta(ms: number) {
    const d = Math.max(0, ms);
    const s = Math.floor(d / 1000);
    const hh = String(Math.floor(s / 3600)).padStart(2, '0');
    const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  }
</script>

<div class="mx-auto w-full max-w-5xl space-y-6 p-4">
  <div class="grid gap-4 md:grid-cols-2">
    <Card>
      <CardHeader>
        <CardTitle>Me</CardTitle>
      </CardHeader>
      <CardContent class="space-y-2">
        {#if me?.user}
          <div class="text-sm">
            <div class="font-medium">{me.user.email}</div>
            <div class="text-muted-foreground">{me.user.id}</div>
          </div>
          <div class="flex gap-2">
            <Badge variant="secondary">{me.user.role}</Badge>
            {#if me?.profile?.trimesterId}
              <Badge variant="outline">Trimester {me.profile.trimesterId}</Badge>
            {/if}
          </div>
        {:else if loading}
          <div class="text-sm text-muted-foreground">Loading…</div>
        {:else}
          <div class="text-sm text-muted-foreground">Not logged in</div>
        {/if}
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle>Time</CardTitle>
      </CardHeader>
      <CardContent class="space-y-2">
        <div class="text-sm">
          <div class="font-medium">{new Date(nowMs).toLocaleString()}</div>
          <div class="text-muted-foreground">Phase: {phase?.phase ?? '—'}</div>
        </div>

        {#if next}
          <div class="rounded-md border p-3">
            <div class="text-sm font-medium">{next.label}</div>
            <div class="text-2xl font-semibold tabular-nums">{fmtDelta(next.at - nowMs)}</div>
          </div>
        {:else}
          <div class="text-sm text-muted-foreground">No upcoming event.</div>
        {/if}
      </CardContent>
    </Card>
  </div>

  <Card>
    <CardHeader>
      <CardTitle>Latest notification</CardTitle>
    </CardHeader>
    <CardContent>
      {#if latestNotif}
        <div class="space-y-1">
          <div class="font-medium">{latestNotif.title}</div>
          <div class="text-sm text-muted-foreground">{latestNotif.body}</div>
        </div>
      {:else}
        <div class="text-sm text-muted-foreground">No notifications.</div>
      {/if}
    </CardContent>
  </Card>

  <Card>
    <CardHeader>
      <CardTitle>My sections (Live)</CardTitle>
    </CardHeader>
    <CardContent>
      {#if selectionRows.length === 0}
        <div class="text-sm text-muted-foreground">No sections selected yet.</div>
      {:else}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Subject</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Section</TableHead>
              <TableHead>Faculty</TableHead>
              <TableHead class="text-right">TimeslotMask</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {#each selectionRows as r (r.subjectId + ':' + r.sectionId)}
              <TableRow>
                <TableCell>
                  <div class="font-medium">{r.subjectCode}</div>
                  <div class="text-xs text-muted-foreground">{r.subjectName}</div>
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{r.subjectType}</Badge>
                </TableCell>
                <TableCell>{r.sectionNumber}</TableCell>
                <TableCell>{r.facultyName}</TableCell>
                <TableCell class="text-right font-mono text-xs">{r.timeslotMask ?? '—'}</TableCell>
              </TableRow>
            {/each}
          </TableBody>
        </Table>
      {/if}
    </CardContent>
  </Card>
</div>
