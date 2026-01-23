<script lang="ts">
  import { onMount } from 'svelte';

  import { apiFetch } from '$lib/api/fetch';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
  import { Input } from '$lib/components/ui/input';
  import * as Table from '$lib/components/ui/table/index.js';
  import { loadRelation, relationStore } from '$lib/stores/relation';

  let relation = $state<any | null>(relationStore.get());
  $effect(() => {
    const u = relationStore.subscribe((v) => (relation = v));
    return () => u();
  });

  let q = $state('');
  let loading = $state(false);
  let startingId = $state<number | null>(null);
  let last = $state<any | null>(null);
  let error = $state<string | null>(null);

  const rows = $derived.by(() => {
    const subjects = relation?.subjects ?? [];
    const out: any[] = [];
    for (const sub of subjects) {
      for (const sec of sub.sections ?? []) {
        out.push({
          subjectId: sub.id,
          subjectCode: sub.code,
          subjectName: sub.name,
          subjectType: sub.type ?? '—',
          sectionId: sec.id,
          sectionNumber: sec.sectionNumber,
          maxSeats: sec.maxSeats,
          timeslotMask: sec.timeslotMask,
          facultyName: sec.faculty?.name ?? sec.faculty?.id ?? '—',
          facultyEmail: sec.faculty?.email ?? '',
        });
      }
    }
    return out;
  });

  const filtered = $derived.by(() => {
    const query = q.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter((r) =>
      `${r.subjectCode} ${r.subjectName} ${r.subjectType} ${r.sectionNumber} ${r.sectionId} ${r.facultyName} ${r.facultyEmail}`
        .toLowerCase()
        .includes(query),
    );
  });

  async function refresh() {
    loading = true;
    error = null;
    try {
      await loadRelation(true);
    } catch (e: any) {
      error = e?.message ?? 'Failed to load relation.json';
    } finally {
      loading = false;
    }
  }

  async function startSectionDO(sectionId: number) {
    startingId = sectionId;
    last = null;
    error = null;
    try {
      const res = await apiFetch(`/admin/do/start?kind=section&id=${sectionId}`, { method: 'POST' });
      last = { sectionId, res };
    } catch (e: any) {
      error = e?.message ?? 'Failed to start DO';
    } finally {
      startingId = null;
    }
  }

  onMount(() => {
    refresh();
  });
</script>

<div class="mx-auto w-full max-w-6xl space-y-4 p-4">
  <div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
    <div class="space-y-1">
      <h1 class="text-2xl font-semibold">Admin: Start SectionDO</h1>
      <p class="text-sm text-muted-foreground">
        Uses <code>/relation.json</code>. Click “Start” to warm a SectionDO slowly.
      </p>
    </div>

    <div class="flex items-center gap-2">
      <Input class="w-[320px]" placeholder="Search…" bind:value={q} />
      <Button variant="outline" onclick={refresh} disabled={loading}>
        {loading ? 'Loading…' : 'Refresh'}
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

  {#if last}
    <Card>
      <CardHeader><CardTitle>Last start result</CardTitle></CardHeader>
      <CardContent>
        <div class="mb-2 text-sm text-muted-foreground">
          Section <span class="font-mono">{last.sectionId}</span>
        </div>
        <pre class="overflow-auto rounded-md border p-3 text-xs whitespace-pre-wrap">{JSON.stringify(
            last.res,
            null,
            2,
          )}</pre>
      </CardContent>
    </Card>
  {/if}

  <Card>
    <CardHeader>
      <CardTitle>Sections ({filtered.length})</CardTitle>
    </CardHeader>
    <CardContent>
      <div class="overflow-x-auto">
        <Table.Table class="min-w-[980px]">
          <Table.TableHeader>
            <Table.TableRow>
              <Table.TableHead>Subject</Table.TableHead>
              <Table.TableHead>Type</Table.TableHead>
              <Table.TableHead>Section</Table.TableHead>
              <Table.TableHead>Faculty</Table.TableHead>
              <Table.TableHead>Max</Table.TableHead>
              <Table.TableHead>Mask</Table.TableHead>
              <Table.TableHead class="text-right">Start</Table.TableHead>
            </Table.TableRow>
          </Table.TableHeader>

          <Table.TableBody>
            {#each filtered as r (r.sectionId)}
              <Table.TableRow>
                <Table.TableCell>
                  <div class="font-medium">{r.subjectCode}</div>
                  <div class="text-xs text-muted-foreground">{r.subjectName}</div>
                </Table.TableCell>

                <Table.TableCell>
                  <Badge variant="outline">{r.subjectType}</Badge>
                </Table.TableCell>

                <Table.TableCell>
                  <div class="font-medium">{r.sectionNumber}</div>
                  <div class="font-mono text-xs text-muted-foreground">{r.sectionId}</div>
                </Table.TableCell>

                <Table.TableCell>
                  <div class="text-sm">{r.facultyName}</div>
                  <div class="text-xs text-muted-foreground">{r.facultyEmail}</div>
                </Table.TableCell>

                <Table.TableCell>{r.maxSeats}</Table.TableCell>
                <Table.TableCell class="font-mono text-xs">{r.timeslotMask}</Table.TableCell>

                <Table.TableCell class="text-right">
                  <Button
                    variant="outline"
                    disabled={startingId === r.sectionId}
                    onclick={() => startSectionDO(r.sectionId)}
                  >
                    {startingId === r.sectionId ? 'Starting…' : 'Start'}
                  </Button>
                </Table.TableCell>
              </Table.TableRow>
            {/each}
          </Table.TableBody>
        </Table.Table>
      </div>
    </CardContent>
  </Card>
</div>
