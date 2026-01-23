<script lang="ts">
  import { onMount } from 'svelte';

  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
  import { Input } from '$lib/components/ui/input';
  import * as Table from '$lib/components/ui/table/index.js';
  import { loadRelation, relationStore, type RelationPayload } from '$lib/stores/relation';
  import { loadState, stateStore } from '$lib/stores/state';

  const rel = $derived($relationStore);

  // stateStore DOES have a wrapper ({ fetchedAtMs, data }), so this remains valid
  const stateWrap = $derived($stateStore);
  const st = $derived(stateWrap?.data);

  let q = $state('');
  let loading = $state(false);
  let error = $state<string | null>(null);

  function seatsLeft(sectionId: number) {
    // Optional chaining handles cases where state isn't loaded yet
    const hit = st?.sections?.[String(sectionId)] ?? st?.sections?.[sectionId];
    return hit?.seatsLeft ?? hit?.left ?? 0;
  }

  async function bootstrap() {
    loading = true;
    error = null;
    try {
      // FIX 3: loadRelation expects a boolean (force=true), not an object
      await loadRelation(true);
      await loadState({ force: true });
    } catch (e: any) {
      error = e?.message ?? 'Failed to load';
    } finally {
      loading = false;
    }
  }

  async function refreshSeats() {
    loading = true;
    error = null;
    try {
      await loadState({ force: true });
    } catch (e: any) {
      error = e?.message ?? 'Failed to refresh seats';
    } finally {
      loading = false;
    }
  }

  const subjects = $derived.by(() => {
    const arr = rel?.subjects ?? [];
    const query = q.trim().toLowerCase();
    if (!query) return arr;

    return arr.filter((s) => {
      // 1. Check Subject Code or Name
      if (s.code.toLowerCase().includes(query) || s.name.toLowerCase().includes(query)) {
        return true;
      }

      // 2. If not found in Subject, check if ANY section matches the query
      return s.sections.some(
        (sec) =>
          sec.sectionNumber.toLowerCase().includes(query) ||
          String(sec.id).includes(query) ||
          sec.faculty.name?.toLowerCase().includes(query) ||
          sec.faculty.email?.toLowerCase().includes(query),
      );
    });
  });

  onMount(() => {
    bootstrap();
  });
</script>

<div class="mx-auto w-full max-w-6xl space-y-6 p-6">
  <div class="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
    <div class="space-y-1">
      <h1 class="text-2xl font-semibold">All subjects</h1>
      <p class="text-sm text-muted-foreground">
        One card per subject. Sections from <code>/relation.json</code>. Seats-left from <code>/state.json</code>.
      </p>

      <div class="space-x-4 text-xs text-muted-foreground">
        {#if rel?.generatedAtMs}
          <span>relation gen: {new Date(rel.generatedAtMs).toLocaleTimeString()}</span>
        {/if}
        {#if stateWrap?.fetchedAtMs}
          <span>state fetched: {new Date(stateWrap.fetchedAtMs).toLocaleTimeString()}</span>
        {/if}
      </div>
    </div>

    <div class="flex flex-wrap items-center gap-2">
      <div class="w-full sm:w-[320px]">
        <Input placeholder="Search by code or name…" bind:value={q} />
      </div>
      <Button variant="outline" onclick={refreshSeats} disabled={loading}>
        {loading ? 'Refreshing…' : 'Refresh seats'}
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

  {#if !rel}
    <Card>
      <CardContent class="pt-6">
        <div class="text-sm text-muted-foreground">
          {loading ? 'Loading…' : 'No relation data loaded.'}
        </div>
      </CardContent>
    </Card>
  {:else if subjects.length === 0}
    <Card>
      <CardContent class="pt-6">
        <div class="text-sm text-muted-foreground">No matching subjects.</div>
      </CardContent>
    </Card>
  {:else}
    <div class="space-y-4">
      {#each subjects as sub (sub.id)}
        <Card>
          <CardHeader class="space-y-2">
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div class="min-w-0">
                <CardTitle class="text-lg">
                  {sub.code} — {sub.name}
                </CardTitle>
                <div class="text-xs text-muted-foreground">
                  ID: <span class="font-mono">{sub.id}</span>
                  <span class="mx-2">•</span>
                  Credits: {sub.credits}
                </div>
              </div>

              <Badge variant="secondary">Sections: {sub.sections.length}</Badge>
            </div>
          </CardHeader>

          <CardContent>
            <div class="overflow-x-auto">
              <Table.Table class="min-w-[980px]">
                <Table.TableHeader>
                  <Table.TableRow>
                    <Table.TableHead>Section</Table.TableHead>
                    <Table.TableHead>Faculty</Table.TableHead>
                    <Table.TableHead>Timeslot</Table.TableHead>
                    <Table.TableHead>Seats left</Table.TableHead>
                    <Table.TableHead>Max</Table.TableHead>
                    <Table.TableHead class="text-right">Section ID</Table.TableHead>
                  </Table.TableRow>
                </Table.TableHeader>

                <Table.TableBody>
                  {#each sub.sections as sec (sec.id)}
                    {@const left = seatsLeft(sec.id)}
                    <Table.TableRow>
                      <Table.TableCell class="font-medium">{sec.sectionNumber}</Table.TableCell>
                      <Table.TableCell>
                        <div class="text-sm">{sec.faculty.name}</div>
                        <div class="text-xs text-muted-foreground">{sec.faculty.email}</div>
                      </Table.TableCell>
                      <Table.TableCell class="text-sm text-muted-foreground">
                        {sec.timeslotMask}
                      </Table.TableCell>
                      <Table.TableCell>
                        <Badge variant={left === 0 ? 'destructive' : 'secondary'}>
                          {left}
                        </Badge>
                      </Table.TableCell>
                      <Table.TableCell class="text-sm text-muted-foreground">
                        {sec.maxSeats}
                      </Table.TableCell>
                      <Table.TableCell class="text-right font-mono text-xs">{sec.id}</Table.TableCell>
                    </Table.TableRow>
                  {/each}
                </Table.TableBody>
              </Table.Table>
            </div>
          </CardContent>
        </Card>
      {/each}
    </div>
  {/if}
</div>
