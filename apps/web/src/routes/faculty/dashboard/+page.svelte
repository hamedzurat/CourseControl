<script lang="ts">
  import { onMount } from 'svelte';

  import { Button } from '$lib/components/ui/button';
  import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
  import * as Table from '$lib/components/ui/table/index.js';
  import { loadMe, meStore } from '$lib/stores/me';
  import { loadRelation, relationStore } from '$lib/stores/relation';
  import { facultyStatus, seatStatus } from '$lib/stores/ws';
  import { ensureUserWsConnected } from '$lib/ws/user-ws';

  // --- State ---
  // Use derived signals for Svelte 5 reactivity
  const fStatus = $derived($facultyStatus);
  const relation = $derived($relationStore);
  const seats = $derived($seatStatus); // Live seat map from WS
  const me = $derived($meStore);

  let loading = $state(false);
  let error = $state<string | null>(null);

  // --- Helpers ---

  /** * Finds Subject and Section details from relation.json
   * relation = { subjects: [ { sections: [...] } ] }
   */
  function getSectionDetail(sectionId: number) {
    if (!relation?.subjects) return null;

    for (const subj of relation.subjects) {
      const sec = subj.sections.find((s: any) => Number(s.id) === Number(sectionId));
      if (sec) {
        return { subject: subj, section: sec };
      }
    }
    return null;
  }

  /**
   * Finds Live Seat Count from WebSocket Store
   * seats = { "101": { sections: { "1011": { seats: 1, ... } } } }
   */
  function getSeatInfo(subjectId: number, sectionId: number) {
    if (!seats) return null;

    // 1. Find the subject object in the seat map
    const subjectData = seats[String(subjectId)] || seats[subjectId];
    if (!subjectData?.sections) return null;

    // 2. Find the specific section
    const secData = subjectData.sections[String(sectionId)] || subjectData.sections[sectionId];
    return secData;
  }

  // --- Derived List ---
  const taughtSectionRows = $derived.by(() => {
    // We treat this as number[] to satisfy TS
    const ids = (fStatus?.taughtSectionIds ?? []) as number[];

    // FIX: Added explicit type (id: number)
    return ids
      .map((id: number) => {
        const detail = getSectionDetail(id);
        if (!detail) return null;

        const seatInfo = getSeatInfo(detail.subject.id, id);

        return {
          id,
          subjectCode: detail.subject.code,
          sectionNumber: detail.section.sectionNumber,
          timeslotMask: detail.section.timeslotMask,
          seatsLeft: seatInfo?.seats ?? '—',
          maxSeats: seatInfo?.maxSeats ?? detail.section.maxSeats ?? '—',
        };
      })
      .filter(Boolean);
  });

  // --- Lifecycle ---
  async function bootstrap() {
    loading = true;
    error = null;
    try {
      ensureUserWsConnected();
      await Promise.all([loadRelation(), loadMe()]);
    } catch (e: any) {
      error = e?.message ?? 'Failed to load data';
    } finally {
      loading = false;
    }
  }

  function refresh() {
    // Re-connect WS to force a status push
    ensureUserWsConnected();
    loadRelation(); // Refresh static data
  }

  onMount(() => {
    bootstrap();
  });
</script>

<div class="mx-auto w-full max-w-5xl space-y-6 p-6">
  <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
    <div class="space-y-1">
      <h1 class="text-2xl font-semibold">Faculty dashboard</h1>
      {#if fStatus?.faculty}
        <div class="text-sm text-muted-foreground">
          <span class="font-medium text-foreground">{fStatus.faculty.name}</span>
          <span class="mx-1">·</span>
          {fStatus.faculty.email}
        </div>
      {:else if me?.user}
        <p class="text-sm text-muted-foreground">{me.user.email} (Loading details...)</p>
      {:else}
        <p class="text-sm text-muted-foreground">Connecting...</p>
      {/if}
    </div>

    <div class="flex gap-2">
      <Button variant="outline" onclick={refresh} disabled={loading}>
        {loading ? 'Refreshing...' : 'Refresh Data'}
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

  <Card>
    <CardHeader class="space-y-2">
      <CardTitle>My taught sections</CardTitle>
      <div class="text-xs text-muted-foreground">Live seat updates from WebSocket</div>
    </CardHeader>

    <CardContent>
      {#if !fStatus}
        <div class="py-4 text-sm text-muted-foreground">
          Waiting for status... If this takes too long, try refreshing.
        </div>
      {:else if taughtSectionRows.length === 0}
        <div class="py-4 text-sm text-muted-foreground">
          You are not assigned to any sections in the current relation data.
        </div>
      {:else}
        <div class="overflow-x-auto">
          <Table.Table class="min-w-[800px]">
            <Table.TableHeader>
              <Table.TableRow>
                <Table.TableHead>Subject</Table.TableHead>
                <Table.TableHead>Section</Table.TableHead>
                <Table.TableHead>Timeslot</Table.TableHead>
                <Table.TableHead>Seats</Table.TableHead>
                <Table.TableHead class="text-right">Section ID</Table.TableHead>
              </Table.TableRow>
            </Table.TableHeader>

            <Table.TableBody>
              {#each taughtSectionRows as row (row?.id)}
                <Table.TableRow>
                  <Table.TableCell class="font-medium">
                    {row?.subjectCode}
                  </Table.TableCell>
                  <Table.TableCell>
                    {row?.sectionNumber}
                  </Table.TableCell>
                  <Table.TableCell class="font-mono text-sm text-muted-foreground">
                    {row?.timeslotMask ?? '—'}
                  </Table.TableCell>
                  <Table.TableCell>
                    <span class="font-medium">{row?.seatsLeft}</span>
                    <span class="text-muted-foreground"> / {row?.maxSeats}</span>
                  </Table.TableCell>
                  <Table.TableCell class="text-right font-mono text-xs">
                    {row?.id}
                  </Table.TableCell>
                </Table.TableRow>
              {/each}
            </Table.TableBody>
          </Table.Table>
        </div>
      {/if}
    </CardContent>
  </Card>

  {#if fStatus?.subjects?.length}
    <Card>
      <CardHeader>
        <CardTitle>My subjects</CardTitle>
      </CardHeader>
      <CardContent class="space-y-2">
        <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {#each fStatus.subjects as sub (sub.id)}
            <div class="flex flex-col justify-center rounded-xl border p-4">
              <div class="font-medium">{sub.code}</div>
              <div class="truncate text-sm text-muted-foreground" title={sub.name}>{sub.name}</div>
            </div>
          {/each}
        </div>
      </CardContent>
    </Card>
  {/if}
</div>
