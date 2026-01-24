<script lang="ts">
  import { onMount } from 'svelte';

  import { apiFetch } from '$lib/api';
  import QueuePanel from '$lib/components/QueuePanel.svelte';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
  import * as ContextMenu from '$lib/components/ui/context-menu';
  import { Progress } from '$lib/components/ui/progress';
  import { Separator } from '$lib/components/ui/separator';
  import * as Sheet from '$lib/components/ui/sheet';
  import { loadMe, meStore, type MePayload } from '$lib/stores/me';
  import { placementStatus, seatStatus, userQueue } from '$lib/stores/ws';
  import { ensureUserWsConnected, sendUserAction } from '$lib/ws/user-ws';

  // --- Types ---
  type FacultyMini = { id: string; name: string; email: string; image?: string | null };

  type RelationSection = {
    id: number;
    sectionNumber: string;
    maxSeats: number;
    timeslotMask: number;
    faculty?: FacultyMini | null;
    room?: string | null;
  };

  type RelationSubject = {
    id: number;
    code: string;
    name: string;
    credits?: number;
    type?: string;
    sections: RelationSection[];
  };

  type RelationJson = {
    generatedAtMs: number;
    subjects: RelationSubject[];
  };

  // --- State ---
  let me = $state<MePayload | null>(null);
  let relation = $state<RelationJson | null>(null);

  // Reactive Stores
  let lastStatus = $derived($placementStatus);
  let lastSeat = $derived($seatStatus);
  let currentQueue = $derived($userQueue);

  // Sheet
  let sheetOpen = $state(false);
  let active = $state<{ subjectId: number; sectionId: number } | null>(null);

  // --- Parsing Helpers ---
  const dayNames = ['Sat', 'Sun', 'Tue', 'Wed'] as const;

  function bitIndices(mask: number) {
    const out: number[] = [];
    for (let i = 0; i < 24; i++) if (mask & (1 << i)) out.push(i);
    return out;
  }

  function isLabSubject(s: RelationSubject) {
    if (typeof s.type === 'string') return s.type.toLowerCase().includes('lab');
    return false;
  }

  function classifyLab(mask: number): { day: number; rowPair: number } | null {
    const bits = bitIndices(mask);
    if (bits.length === 0) return null;
    const sorted = [...bits].sort((a, b) => a - b);
    const startBit = sorted[0];
    const day = Math.floor(startBit / 6);
    const inDayIndex = startBit % 6;
    return { day, rowPair: Math.floor(inDayIndex / 2) };
  }

  function classifyTheory(mask: number): { pair: 'ST' | 'SW'; row: number } | null {
    const bits = bitIndices(mask);
    if (!bits.length) return null;
    const hasSat = bits.some((b) => b >= 0 && b <= 5);
    const hasSun = bits.some((b) => b >= 6 && b <= 11);
    const hasTue = bits.some((b) => b >= 12 && b <= 17);
    const hasWed = bits.some((b) => b >= 18 && b <= 23);

    if (hasSat) return { pair: 'ST', row: bits.find((b) => b >= 0 && b <= 5)! % 6 };
    if (hasTue) return { pair: 'ST', row: (bits.find((b) => b >= 12 && b <= 17)! - 12) % 6 };
    if (hasSun) return { pair: 'SW', row: (bits.find((b) => b >= 6 && b <= 11)! - 6) % 6 };
    if (hasWed) return { pair: 'SW', row: (bits.find((b) => b >= 18 && b <= 23)! - 18) % 6 };
    return null;
  }

  function timeLabelForSection(subject: RelationSubject, sec: RelationSection) {
    if (isLabSubject(subject)) {
      const c = classifyLab(sec.timeslotMask);
      if (!c) return `Mask ${sec.timeslotMask}`;
      return `${dayNames[c.day]} • Lab block ${c.rowPair + 1}`;
    }
    const t = classifyTheory(sec.timeslotMask);
    if (!t) return `Mask ${sec.timeslotMask}`;
    return t.pair === 'ST' ? `Sat+Tue • Slot ${t.row + 1}` : `Sun+Wed • Slot ${t.row + 1}`;
  }

  // --- Derived Data ---
  const enrolledSubjectIds = $derived.by(() => {
    const fromStatus = lastStatus?.data?.enrolledSubjectIds;
    if (fromStatus?.length) return fromStatus.map(Number);
    return lastSeat ? Object.keys(lastSeat).map(Number) : [];
  });

  const enrolledSubjects = $derived.by(() => {
    const ids = new Set(enrolledSubjectIds);
    const subs = relation?.subjects ?? [];
    return subs.filter((s) => ids.has(Number(s.id)));
  });

  const theorySubjects = $derived.by(() => enrolledSubjects.filter((s) => !isLabSubject(s)));
  const labSubjects = $derived.by(() => enrolledSubjects.filter((s) => isLabSubject(s)));

  const theorySTSubjects = $derived.by(() =>
    theorySubjects.filter((s) => s.sections.some((sec) => classifyTheory(sec.timeslotMask)?.pair === 'ST')),
  );

  const theorySWSubjects = $derived.by(() =>
    theorySubjects.filter((s) => s.sections.some((sec) => classifyTheory(sec.timeslotMask)?.pair === 'SW')),
  );

  const labSubjectsByDay = $derived.by(() => {
    const out: RelationSubject[][] = [[], [], [], []];
    for (const s of labSubjects) {
      const days = new Set<number>();
      for (const sec of s.sections) {
        const c = classifyLab(sec.timeslotMask);
        if (c) days.add(c.day);
      }
      for (const d of days) if (d >= 0 && d <= 3) out[d].push(s);
    }
    return out;
  });

  const selectedBySubject = $derived.by(() => {
    const m = new Map<number, number>();
    for (const sel of lastStatus?.data?.selections ?? []) {
      m.set(Number(sel.subjectId), Number(sel.sectionId));
    }
    return m;
  });

  function findSubject(subjectId: number) {
    return (relation?.subjects ?? []).find((s) => Number(s.id) === Number(subjectId)) ?? null;
  }

  function findSection(subjectId: number, sectionId: number) {
    const subj = findSubject(subjectId);
    return subj?.sections?.find((x) => Number(x.id) === Number(sectionId)) ?? null;
  }

  const selectedSections = $derived.by(() => {
    const arr: Array<{ subjectId: number; sectionId: number; mask: number }> = [];
    for (const [subjectId, sectionId] of selectedBySubject) {
      const sec = findSection(subjectId, sectionId);
      if (sec) arr.push({ subjectId, sectionId, mask: sec.timeslotMask ?? 0 });
    }
    return arr;
  });

  function conflictsWithSelected(subjectId: number, section: RelationSection) {
    const mask = section.timeslotMask ?? 0;
    if (!mask) return false;
    for (const s of selectedSections) {
      if (s.subjectId === subjectId) continue;
      if ((mask & s.mask) !== 0) return true;
    }
    return false;
  }

  const seatBySectionId = $derived.by(() => {
    const m = new Map<number, { seatsLeft: number; maxSeats: number }>();
    const subjectsMap = lastSeat ?? {};
    for (const sid of Object.keys(subjectsMap)) {
      if (typeof subjectsMap[sid] !== 'object') continue;
      const secs = subjectsMap[sid]?.sections ?? {};
      for (const secId of Object.keys(secs)) {
        m.set(Number(secId), {
          seatsLeft: Number(secs[secId].seats ?? 0),
          maxSeats: Number(secs[secId].maxSeats ?? 0),
        });
      }
    }
    return m;
  });

  function seatsLeft(sectionId: number) {
    return seatBySectionId.get(sectionId)?.seatsLeft ?? null;
  }

  function groupForSubject(subjectId: number) {
    return (lastStatus?.data?.groups ?? []).find((g: any) => Number(g.subjectId) === Number(subjectId)) ?? null;
  }

  function isGroupLeader(g: any) {
    const myId = me?.user?.id;
    return myId && String(g?.leaderUserId) === String(myId);
  }

  function queueForSection(sectionId: number) {
    return (
      currentQueue.find((it) => {
        const p = it.payload ?? {};
        const target = p.sectionId ?? p.section_id ?? p.toSectionId ?? p.to_section_id ?? 0;
        return Number(target) === Number(sectionId);
      }) ?? null
    );
  }

  function queueForSubject(subjectId: number) {
    return (
      currentQueue.find((it) => {
        const p = it.payload ?? {};
        const target = p.subjectId ?? p.subject_id ?? 0;
        return Number(target) === Number(subjectId);
      }) ?? null
    );
  }

  // --- Core State Logic ---
  type CardState = 'available' | 'selected' | 'pending' | 'full' | 'conflict' | 'in_queue' | 'group_locked';

  function resolveState(
    subject: RelationSubject,
    sec: RelationSection,
  ): { state: CardState; reason: string; icon: string } {
    const subjectId = Number(subject.id);
    const sectionId = Number(sec.id);
    const g = groupForSubject(subjectId);

    const q = queueForSection(sectionId) ?? queueForSubject(subjectId);
    if (q && (q.status === 'queued' || q.status === 'running')) {
      return q.status === 'running'
        ? { state: 'pending', reason: 'Action in progress...', icon: '🕒' }
        : { state: 'in_queue', reason: 'Action queued...', icon: '⏳' };
    }

    const selId = selectedBySubject.get(subjectId);
    const isSelected = selId === sectionId;

    if (isSelected) {
      return { state: 'selected', reason: 'You are enrolled in this section.', icon: '✅' };
    }

    if (g && !isGroupLeader(g)) {
      return { state: 'group_locked', reason: 'Locked by your group leader.', icon: '👥' };
    }

    const left = seatsLeft(sectionId);
    if (left !== null && left <= 0) {
      return { state: 'full', reason: 'No seats remaining.', icon: '🔒' };
    }

    if (conflictsWithSelected(subjectId, sec)) {
      return { state: 'conflict', reason: 'Conflicts with another selection.', icon: '🚫' };
    }

    return { state: 'available', reason: 'Available to take.', icon: '•' };
  }

  function stateClass(s: CardState) {
    const base = 'h-8 px-2 text-xs rounded-md border w-full justify-between gap-2 transition-colors';

    if (s === 'selected')
      return (
        base +
        ' bg-emerald-600 text-white hover:bg-emerald-700 dark:bg-emerald-700 dark:hover:bg-emerald-600 border-emerald-600'
      );
    if (s === 'group_locked')
      return (
        base +
        ' bg-purple-600 text-white hover:bg-purple-700 dark:bg-purple-700 dark:hover:bg-purple-600 border-purple-600'
      );
    if (s === 'pending') return base + ' bg-yellow-500 text-black border-yellow-500';
    if (s === 'in_queue') return base + ' bg-blue-600 text-white border-blue-600';
    if (s === 'full') return base + ' bg-red-600 text-white border-red-600 opacity-90';
    if (s === 'conflict') return base + ' bg-muted text-muted-foreground line-through opacity-70 cursor-not-allowed';

    return base + ' bg-background hover:bg-accent hover:text-accent-foreground';
  }

  // --- Actions & UI ---
  function openSheet(subjectId: number, sectionId: number) {
    active = { subjectId, sectionId };
    sheetOpen = true;
  }

  const activeSubject = $derived.by(() => (active ? findSubject(active.subjectId) : null));
  const activeSection = $derived.by(() =>
    active && activeSubject ? findSection(active.subjectId, active.sectionId) : null,
  );
  const activeState = $derived.by(() =>
    activeSubject && activeSection ? resolveState(activeSubject, activeSection) : null,
  );
  const activeSeatsLeft = $derived.by(() => (active ? seatsLeft(active.sectionId) : null));
  const activeMaxSeats = $derived.by(() => {
    if (!activeSection) return null;
    return Number(seatBySectionId.get(activeSection.id)?.maxSeats ?? activeSection.maxSeats ?? 0);
  });
  const activeSeatPct = $derived.by(() => {
    if (typeof activeSeatsLeft !== 'number' || !activeMaxSeats) return 0;
    const taken = Math.max(0, activeMaxSeats - activeSeatsLeft);
    return Math.max(0, Math.min(100, Math.round((taken / activeMaxSeats) * 100)));
  });

  function canActNow() {
    return lastStatus?.phase === 'selection';
  }

  function actionAvailability(subject: RelationSubject, sec: RelationSection) {
    const subjectId = Number(subject.id);
    const sectionId = Number(sec.id);
    const g = groupForSubject(subjectId);
    const selId = selectedBySubject.get(subjectId);
    const isSelected = selId === sectionId;
    const { state } = resolveState(subject, sec);
    const allow = canActNow();

    const amLeader = g && isGroupLeader(g);

    return {
      canTake: allow && !g && !selId && state === 'available',
      canChangeTo: allow && !g && !!selId && !isSelected && state === 'available',
      canDrop: allow && !g && !!selId && isSelected,

      canGroupTake: amLeader && allow && !selId && state === 'available',
      canGroupChangeTo: amLeader && allow && !!selId && !isSelected && state === 'available',
      canGroupDrop: amLeader && allow && !!selId && isSelected,
    };
  }

  function doTake(sectionId: number) {
    if (canActNow()) sendUserAction('take', { sectionId });
  }
  function doChange(toSectionId: number) {
    if (canActNow()) sendUserAction('change', { toSectionId });
  }
  function doDrop(subjectId: number) {
    if (canActNow()) sendUserAction('drop', { subjectId });
  }

  function doGroupTake(groupId: number, sectionId: number) {
    if (canActNow()) sendUserAction('group_take', { groupId, sectionId });
  }
  function doGroupChange(groupId: number, toSectionId: number) {
    if (canActNow()) sendUserAction('group_change', { groupId, toSectionId });
  }
  function doGroupDrop(groupId: number, subjectId: number) {
    if (canActNow()) sendUserAction('group_drop', { groupId, subjectId });
  }

  // --- Grid Helpers ---
  function theoryCellSections(pair: 'ST' | 'SW', subj: RelationSubject, row: number) {
    return subj.sections.filter((sec) => {
      const c = classifyTheory(sec.timeslotMask);
      return c && c.pair === pair && c.row === row;
    });
  }

  function labCellSections(day: number, subj: RelationSubject, rowPair: number) {
    return subj.sections.filter((sec) => {
      const c = classifyLab(sec.timeslotMask);
      return c && c.day === day && c.rowPair === rowPair;
    });
  }

  onMount(() => {
    ensureUserWsConnected();
    const unMe = meStore.listen((v) => (me = v));
    loadMe().catch(() => {});

    (async () => {
      relation = await apiFetch<RelationJson>('/relation.json');
    })().catch(() => {});

    return () => unMe();
  });
</script>

<div class="mx-auto w-full max-w-7xl space-y-4 p-4">
  <Card>
    <CardContent class="py-4">
      <div class="space-y-1">
        <div class="text-lg font-semibold">Section Selection</div>
        <div class="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span>Phase:</span>
          <Badge variant="outline">{lastStatus?.phase ?? 'unknown'}</Badge>
          <Separator orientation="vertical" class="h-4" />
          <span>Relation:</span>
          <Badge variant="secondary">{relation?.subjects?.length ?? 0}</Badge>
          <span>Enrolled:</span>
          <Badge variant="secondary">{enrolledSubjects.length}</Badge>
        </div>
        <div class="text-xs text-muted-foreground">
          States: Available, Selected (green), Pending (yellow), In queue (blue), Full (red), Conflict (gray),
          Group-locked (purple).
        </div>
      </div>
    </CardContent>
  </Card>

  <Card>
    <CardHeader class="pb-2">
      <CardTitle class="text-base">Theory</CardTitle>
    </CardHeader>
    <CardContent class="space-y-4">
      <Card>
        <CardHeader class="pb-2"><CardTitle class="text-sm">Sat + Tue</CardTitle></CardHeader>
        <CardContent>
          {#if theorySTSubjects.length === 0}
            <div class="py-2 text-sm text-muted-foreground">No theory subjects in Sat+Tue.</div>
          {:else}
            <div class="overflow-auto">
              <div
                class="grid min-w-[560px] gap-2"
                style="grid-template-columns: 64px repeat({theorySTSubjects.length}, minmax(180px, 1fr));"
              >
                <div class="p-2 text-xs font-medium text-muted-foreground">Slot</div>
                {#each theorySTSubjects as subj (subj.id)}
                  <div class="p-2">
                    <div class="text-sm font-medium">{subj.code}</div>
                    <div class="text-xs text-muted-foreground">{subj.name}</div>
                  </div>
                {/each}

                {#each [0, 1, 2, 3, 4, 5] as row}
                  <div class="p-2 text-sm font-medium">{row + 1}</div>
                  {#each theorySTSubjects as subj (subj.id)}
                    <div class="min-h-[54px] rounded-lg border p-2">
                      <div class="flex flex-row gap-1">
                        {#each theoryCellSections('ST', subj, row) as sec (sec.id)}
                          {@const st = resolveState(subj, sec)}
                          {@const avail = actionAvailability(subj, sec)}
                          {@const group = groupForSubject(subj.id)}
                          <ContextMenu.Root>
                            <ContextMenu.Trigger>
                              <Button
                                variant="outline"
                                class={stateClass(st.state)}
                                onclick={() => openSheet(subj.id, sec.id)}
                              >
                                <span class="truncate">{sec.sectionNumber}</span>
                                <span class="ml-auto tabular-nums opacity-90"
                                  >{seatsLeft(sec.id) === null ? '—' : seatsLeft(sec.id)}</span
                                >
                              </Button>
                            </ContextMenu.Trigger>
                            <ContextMenu.Content>
                              <ContextMenu.Label>{subj.code} — {sec.sectionNumber}</ContextMenu.Label>
                              <ContextMenu.Separator />
                              <ContextMenu.Item disabled>State: {st.icon} {st.state}</ContextMenu.Item>
                              <ContextMenu.Separator />
                              {#if group}
                                <ContextMenu.Item
                                  disabled={!avail.canGroupTake}
                                  onSelect={() => doGroupTake(Number(group.id ?? group.groupId), sec.id)}
                                  >group_take</ContextMenu.Item
                                >
                                <ContextMenu.Item
                                  disabled={!avail.canGroupChangeTo}
                                  onSelect={() => doGroupChange(Number(group.id ?? group.groupId), sec.id)}
                                  >group_change → this</ContextMenu.Item
                                >
                                <ContextMenu.Item
                                  disabled={!avail.canGroupDrop}
                                  onSelect={() => doGroupDrop(Number(group.id ?? group.groupId), subj.id)}
                                  >group_drop (selected)</ContextMenu.Item
                                >
                              {:else}
                                <ContextMenu.Item disabled={!avail.canTake} onSelect={() => doTake(sec.id)}
                                  >take</ContextMenu.Item
                                >
                                <ContextMenu.Item disabled={!avail.canChangeTo} onSelect={() => doChange(sec.id)}
                                  >change → this</ContextMenu.Item
                                >
                                <ContextMenu.Item disabled={!avail.canDrop} onSelect={() => doDrop(subj.id)}
                                  >drop (selected)</ContextMenu.Item
                                >
                              {/if}
                            </ContextMenu.Content>
                          </ContextMenu.Root>
                        {/each}
                      </div>
                    </div>
                  {/each}
                {/each}
              </div>
            </div>
          {/if}
        </CardContent>
      </Card>

      <Card>
        <CardHeader class="pb-2"><CardTitle class="text-sm">Sun + Wed</CardTitle></CardHeader>
        <CardContent>
          {#if theorySWSubjects.length === 0}
            <div class="py-2 text-sm text-muted-foreground">No theory subjects in Sun+Wed.</div>
          {:else}
            <div class="overflow-auto">
              <div
                class="grid min-w-[560px] gap-2"
                style="grid-template-columns: 64px repeat({theorySWSubjects.length}, minmax(180px, 1fr));"
              >
                <div class="p-2 text-xs font-medium text-muted-foreground">Slot</div>
                {#each theorySWSubjects as subj (subj.id)}
                  <div class="p-2">
                    <div class="text-sm font-medium">{subj.code}</div>
                    <div class="text-xs text-muted-foreground">{subj.name}</div>
                  </div>
                {/each}

                {#each [0, 1, 2, 3, 4, 5] as row}
                  <div class="p-2 text-sm font-medium">{row + 1}</div>
                  {#each theorySWSubjects as subj (subj.id)}
                    <div class="min-h-[54px] rounded-lg border p-2">
                      <div class="flex flex-row gap-1">
                        {#each theoryCellSections('SW', subj, row) as sec (sec.id)}
                          {@const st = resolveState(subj, sec)}
                          {@const avail = actionAvailability(subj, sec)}
                          {@const group = groupForSubject(subj.id)}
                          <ContextMenu.Root>
                            <ContextMenu.Trigger>
                              <Button
                                variant="outline"
                                class={stateClass(st.state)}
                                onclick={() => openSheet(subj.id, sec.id)}
                              >
                                <span class="truncate">{sec.sectionNumber}</span>
                                <span class="ml-auto tabular-nums opacity-90"
                                  >{seatsLeft(sec.id) === null ? '—' : seatsLeft(sec.id)}</span
                                >
                              </Button>
                            </ContextMenu.Trigger>
                            <ContextMenu.Content>
                              <ContextMenu.Label>{subj.code} — {sec.sectionNumber}</ContextMenu.Label>
                              <ContextMenu.Separator />
                              <ContextMenu.Item disabled>State: {st.icon} {st.state}</ContextMenu.Item>
                              <ContextMenu.Separator />
                              {#if group}
                                <ContextMenu.Item
                                  disabled={!avail.canGroupTake}
                                  onSelect={() => doGroupTake(Number(group.id ?? group.groupId), sec.id)}
                                  >group_take</ContextMenu.Item
                                >
                                <ContextMenu.Item
                                  disabled={!avail.canGroupChangeTo}
                                  onSelect={() => doGroupChange(Number(group.id ?? group.groupId), sec.id)}
                                  >group_change → this</ContextMenu.Item
                                >
                                <ContextMenu.Item
                                  disabled={!avail.canGroupDrop}
                                  onSelect={() => doGroupDrop(Number(group.id ?? group.groupId), subj.id)}
                                  >group_drop (selected)</ContextMenu.Item
                                >
                              {:else}
                                <ContextMenu.Item disabled={!avail.canTake} onSelect={() => doTake(sec.id)}
                                  >take</ContextMenu.Item
                                >
                                <ContextMenu.Item disabled={!avail.canChangeTo} onSelect={() => doChange(sec.id)}
                                  >change → this</ContextMenu.Item
                                >
                                <ContextMenu.Item disabled={!avail.canDrop} onSelect={() => doDrop(subj.id)}
                                  >drop (selected)</ContextMenu.Item
                                >
                              {/if}
                            </ContextMenu.Content>
                          </ContextMenu.Root>
                        {/each}
                      </div>
                    </div>
                  {/each}
                {/each}
              </div>
            </div>
          {/if}
        </CardContent>
      </Card>
    </CardContent>
  </Card>

  <Card>
    <CardHeader class="pb-2">
      <CardTitle class="text-base">Lab</CardTitle>
    </CardHeader>
    <CardContent class="space-y-4">
      {#each [0, 1, 2, 3] as dayIdx}
        <Card>
          <CardHeader class="pb-2"><CardTitle class="text-sm">{dayNames[dayIdx]}</CardTitle></CardHeader>
          <CardContent>
            {#if labSubjectsByDay[dayIdx].length === 0}
              <div class="py-2 text-sm text-muted-foreground">No lab subjects on {dayNames[dayIdx]}.</div>
            {:else}
              <div class="overflow-auto">
                <div
                  class="grid min-w-[560px] gap-2"
                  style="grid-template-columns: 64px repeat({labSubjectsByDay[dayIdx].length}, minmax(180px, 1fr));"
                >
                  <div class="p-2 text-xs font-medium text-muted-foreground">Pair</div>
                  {#each labSubjectsByDay[dayIdx] as subj (subj.id)}
                    <div class="p-2">
                      <div class="text-sm font-medium">{subj.code}</div>
                      <div class="text-xs text-muted-foreground">{subj.name}</div>
                    </div>
                  {/each}

                  {#each [0, 1, 2] as rowPair}
                    <div class="p-2 text-sm font-medium">{rowPair + 1}</div>
                    {#each labSubjectsByDay[dayIdx] as subj (subj.id)}
                      <div class="min-h-[54px] rounded-lg border p-2">
                        <div class="flex flex-row gap-1">
                          {#each labCellSections(dayIdx, subj, rowPair) as sec (sec.id)}
                            {@const st = resolveState(subj, sec)}
                            {@const avail = actionAvailability(subj, sec)}
                            {@const group = groupForSubject(subj.id)}
                            <ContextMenu.Root>
                              <ContextMenu.Trigger>
                                <Button
                                  variant="outline"
                                  class={stateClass(st.state)}
                                  onclick={() => openSheet(subj.id, sec.id)}
                                >
                                  <span class="truncate">{sec.sectionNumber}</span>
                                  <span class="ml-auto tabular-nums opacity-90"
                                    >{seatsLeft(sec.id) === null ? '—' : seatsLeft(sec.id)}</span
                                  >
                                </Button>
                              </ContextMenu.Trigger>
                              <ContextMenu.Content>
                                <ContextMenu.Label>{subj.code} — {sec.sectionNumber}</ContextMenu.Label>
                                <ContextMenu.Separator />
                                <ContextMenu.Item disabled>State: {st.icon} {st.state}</ContextMenu.Item>
                                <ContextMenu.Separator />
                                {#if group}
                                  <ContextMenu.Item
                                    disabled={!avail.canGroupTake}
                                    onSelect={() => doGroupTake(Number(group.id ?? group.groupId), sec.id)}
                                    >group_take</ContextMenu.Item
                                  >
                                  <ContextMenu.Item
                                    disabled={!avail.canGroupChangeTo}
                                    onSelect={() => doGroupChange(Number(group.id ?? group.groupId), sec.id)}
                                    >group_change → this</ContextMenu.Item
                                  >
                                  <ContextMenu.Item
                                    disabled={!avail.canGroupDrop}
                                    onSelect={() => doGroupDrop(Number(group.id ?? group.groupId), subj.id)}
                                    >group_drop (selected)</ContextMenu.Item
                                  >
                                {:else}
                                  <ContextMenu.Item disabled={!avail.canTake} onSelect={() => doTake(sec.id)}
                                    >take</ContextMenu.Item
                                  >
                                  <ContextMenu.Item disabled={!avail.canChangeTo} onSelect={() => doChange(sec.id)}
                                    >change → this</ContextMenu.Item
                                  >
                                  <ContextMenu.Item disabled={!avail.canDrop} onSelect={() => doDrop(subj.id)}
                                    >drop (selected)</ContextMenu.Item
                                  >
                                {/if}
                              </ContextMenu.Content>
                            </ContextMenu.Root>
                          {/each}
                        </div>
                      </div>
                    {/each}
                  {/each}
                </div>
              </div>
            {/if}
          </CardContent>
        </Card>
      {/each}
    </CardContent>
  </Card>

  <QueuePanel />

  <Sheet.Root bind:open={sheetOpen}>
    <Sheet.Content side="bottom" class="p-0">
      <div class="space-y-3 p-4">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="space-y-1">
            <div class="text-base font-semibold">
              {activeSubject?.code} — {activeSection?.sectionNumber}
              <span class="ml-2 text-sm text-muted-foreground">
                seats left: {active ? (seatsLeft(active.sectionId) ?? '—') : '—'}
              </span>
            </div>
            <div class="text-sm text-muted-foreground">
              {activeSubject?.name}
              {#if activeSection?.faculty?.name}
                • {activeSection.faculty.name}
              {/if}
            </div>
          </div>

          {#if activeState}
            <Badge variant="outline">
              {activeState.icon}
              {activeState.state}
            </Badge>
          {/if}
        </div>

        <Separator />

        {#if activeState}
          <div class="text-sm">
            <span class="font-medium">State meaning:</span>
            <span class="ml-2 text-muted-foreground">{activeState.reason}</span>
          </div>
        {/if}

        <div class="grid gap-3 md:grid-cols-3">
          <div class="space-y-2 rounded-lg border p-3">
            <div class="text-sm font-medium">Seats</div>
            <div class="flex items-center justify-between text-sm">
              <span class="text-muted-foreground">Left</span>
              <span class="font-medium">{activeSeatsLeft ?? '—'}</span>
            </div>
            <div class="flex items-center justify-between text-sm">
              <span class="text-muted-foreground">Max</span>
              <span class="font-medium">{activeMaxSeats ?? '—'}</span>
            </div>
            <Progress value={activeSeatPct} />
          </div>

          <div class="space-y-2 rounded-lg border p-3">
            <div class="text-sm font-medium">Time</div>
            <div class="text-sm text-muted-foreground">
              {#if activeSubject && activeSection}
                {timeLabelForSection(activeSubject, activeSection)}
              {:else}
                —
              {/if}
            </div>
            <div class="text-xs break-all text-muted-foreground">
              mask: {activeSection?.timeslotMask ?? '—'}
            </div>
          </div>

          <div class="space-y-2 rounded-lg border p-3">
            <div class="text-sm font-medium">Other</div>
            <div class="text-sm text-muted-foreground">
              Section ID: <span class="font-mono text-foreground">{active?.sectionId ?? '—'}</span>
            </div>
            <div class="text-sm text-muted-foreground">
              Subject ID: <span class="font-mono text-foreground">{active?.subjectId ?? '—'}</span>
            </div>
          </div>
        </div>

        <div class="text-xs text-muted-foreground">
          Actions are only on right-click (context menu). Drop is only enabled when you right-click the currently
          selected section card.
        </div>
      </div>
    </Sheet.Content>
  </Sheet.Root>
</div>
