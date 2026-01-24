<script lang="ts">
  import { BookOpen, ChevronDown, ChevronUp, Users } from '@lucide/svelte';
  import { onMount } from 'svelte';

  import { apiFetch } from '$lib/api';
  import { Avatar, AvatarFallback, AvatarImage } from '$lib/components/ui/avatar';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
  import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '$lib/components/ui/collapsible';
  import { facultyStatus, seatStatus } from '$lib/stores/ws';
  import { formatTimeslot } from '$lib/utils/timeslot';

  let status = $derived($facultyStatus);
  let seats = $derived($seatStatus);

  let subjects = $derived(status?.subjects ?? []);
  let taughtSectionIds = $derived<number[]>(status?.taughtSectionIds ?? []);

  // Local state for expanded rosters
  let expandedRows = $state<Record<number, boolean>>({});
  let rosters = $state<Record<number, { studentUserId: string; joinedAtMs: number; name?: string }[]>>({});
  let loadingRoster = $state<Record<number, boolean>>({});

  function toggleRow(sectionId: number) {
    const next = !expandedRows[sectionId];
    expandedRows[sectionId] = next;
    if (next && !rosters[sectionId]) {
      loadRoster(sectionId);
    }
  }

  async function loadRoster(sectionId: number) {
    loadingRoster[sectionId] = true;
    try {
      // Hit the SectionDO via the HTTP proxy
      const res = await apiFetch<any>(`/actor/section?id=${sectionId}&method=GET&path=/status`);
      rosters[sectionId] = res.members ?? [];
    } catch (e) {
      console.error(e);
    } finally {
      loadingRoster[sectionId] = false;
    }
  }

  // Derive display list
  // We need to map subjects -> sections and filter by `taughtSectionIds`.
  // The `seats` store has the latest `maxSeats` and `seatsLeft`.
  // `subjects` from `status` has static metadata (code, name).

  // Actually, facultyStatus.subjects contains the metadata for subjects the faculty teaches.
  // We can iterate that.

  function getSectionInfo(subjectId: number, sectionId: number) {
    // Try to find live data first
    const subjectData = seats[subjectId];
    const sectionLive = subjectData?.sections?.[sectionId];

    if (sectionLive) {
      return {
        // So `seats` in `seatStatus` is seatsLeft.
        seatsLeft: sectionLive.seats,
        maxSeats: sectionLive.maxSeats,
      };
    }
    return null;
  }
</script>

<div class="space-y-6">
  <div>
    <h1 class="text-3xl font-bold tracking-tight">Faculty Dashboard</h1>
    <p class="text-muted-foreground">Manage your sections and view real-time enrollment.</p>
  </div>

  {#if subjects.length === 0}
    <Card>
      <CardContent class="pt-6">
        <p class="text-sm text-muted-foreground">You are not assigned to any sections yet.</p>
      </CardContent>
    </Card>
  {/if}

  <div class="grid gap-6">
    {#each subjects as sub (sub.id)}
      <!-- We don't have the section list in `sub` directly from `facultyStatus`? 
            Let's check `faculty.ts`. 
            `buildFacultyInfo` returns `subjects` array (id, code, name).
            It does NOT return the list of sections per subject.
            BUT `seatStatus` (KV) has the list of sections for each subject.
            So we iterate `seats[sub.id].sections` filtering by `taughtSectionIds`.
        -->
      {@const subjectLive = seats[sub.id]}
      <!-- Fix spread type error by casting v to any -->
      {@const relevantSections = Object.entries(subjectLive?.sections ?? {})
        .map(([k, v]) => ({ id: Number(k), ...(v as any) }))
        .filter((s) => taughtSectionIds.includes(s.id))
        .sort((a, b) => a.id - b.id)}

      {#if relevantSections.length > 0}
        <Card>
          <CardHeader>
            <CardTitle>{sub.code}: {sub.name}</CardTitle>
            <CardDescription>{relevantSections.length} section(s) assigned</CardDescription>
          </CardHeader>
          <CardContent class="grid gap-4">
            {#each relevantSections as sec (sec.id)}
              {@const info = getSectionInfo(sub.id, sec.id)}
              {@const isOpen = expandedRows[sec.id]}

              <div class="rounded-lg border p-4">
                <div class="flex items-center justify-between">
                  <div>
                    <div class="text-lg font-semibold">Section {sec.id}</div>
                    <div class="text-sm text-muted-foreground">
                      <!-- If we had timeslot in KV, we'd show it. currently KV payload might not have it. Start simple. -->
                      Enrolled:
                      <span class="font-medium text-foreground">
                        {sec.maxSeats - sec.seats} / {sec.maxSeats}
                      </span>
                    </div>
                  </div>

                  <Button variant="ghost" size="sm" onclick={() => toggleRow(sec.id)}>
                    {#if isOpen}
                      <ChevronUp class="mr-2 h-4 w-4" /> Hide Roster
                    {:else}
                      <ChevronDown class="mr-2 h-4 w-4" /> View Roster
                    {/if}
                  </Button>
                </div>

                {#if isOpen}
                  <div class="mt-4 border-t pt-4">
                    {#if loadingRoster[sec.id]}
                      <div class="text-sm text-muted-foreground">Loading roster...</div>
                    {:else if rosters[sec.id]?.length === 0}
                      <div class="text-sm text-muted-foreground">No students enrolled.</div>
                    {:else}
                      <div class="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
                        {#each rosters[sec.id] as student}
                          <div class="flex items-center gap-2 rounded-md border p-2">
                            <Avatar class="h-8 w-8">
                              <AvatarImage
                                src={`https://api.dicebear.com/9.x/thumbs/svg?seed=${student.studentUserId}`}
                              />
                              <AvatarFallback>ST</AvatarFallback>
                            </Avatar>
                            <div class="overflow-hidden">
                              <div class="truncate text-sm font-medium">{student.name || student.studentUserId}</div>
                              <div class="text-xs text-muted-foreground">
                                Joined {new Date(student.joinedAtMs).toLocaleTimeString()}
                              </div>
                            </div>
                          </div>
                        {/each}
                      </div>
                    {/if}
                  </div>
                {/if}
              </div>
            {/each}
          </CardContent>
        </Card>
      {/if}
    {/each}
  </div>
</div>
