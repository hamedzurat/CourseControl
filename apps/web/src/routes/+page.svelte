<script lang="ts">
  import { BookOpen, Layers, RefreshCw, Search } from '@lucide/svelte';
  import { onMount } from 'svelte';
  import { fade, slide } from 'svelte/transition';

  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
  import { Input } from '$lib/components/ui/input';
  import * as Table from '$lib/components/ui/table/index.js';
  import { loadRelation, relationStore } from '$lib/stores/relation';
  import { loadState, stateStore } from '$lib/stores/state';
  import { formatTimeslot } from '$lib/utils/timeslot';

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

<div class="min-h-screen bg-background text-foreground transition-colors duration-300">
  <div class="mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
    <!-- Hero Section -->
    <div in:fade={{ duration: 300, delay: 100 }} class="mb-12 flex flex-col items-center space-y-6 text-center">
      <div class="space-y-2">
        <h1
          class="bg-linear-to-r from-primary to-accent bg-clip-text pb-2 text-4xl font-extrabold tracking-tight text-transparent sm:text-5xl md:text-6xl"
        >
          Course Control
        </h1>
        <p class="mx-auto max-w-2xl text-lg text-muted-foreground sm:text-xl">
          Browse all subjects, check seat availability, and find your perfect schedule.
        </p>
      </div>

      <!-- Search Bar -->
      <div class="relative mt-8 w-full max-w-2xl">
        <div class="relative">
          <Search class="absolute top-1/2 left-4 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by code, subject name, or faculty..."
            class="w-full rounded-2xl border-2 border-border/50 bg-card/50 py-6 pl-12 text-lg shadow-sm backdrop-blur-sm transition-all focus-visible:border-primary focus-visible:ring-primary/20"
            bind:value={q}
          />
        </div>
        <div class="absolute top-1/2 right-3 -translate-y-1/2">
          {#if loading}
            <RefreshCw class="h-5 w-5 animate-spin text-muted-foreground" />
          {/if}
        </div>
      </div>

      <div
        class="flex animate-in flex-wrap items-center justify-center gap-4 text-xs text-muted-foreground duration-700 fade-in slide-in-from-bottom-2"
      >
        {#if rel?.generatedAtMs}
          <span class="rounded-full border border-border/50 bg-muted px-2 py-1"
            >Relation Data: {new Date(rel.generatedAtMs).toLocaleTimeString()}</span
          >
        {/if}
        {#if stateWrap?.fetchedAtMs}
          <span class="rounded-full border border-border/50 bg-muted px-2 py-1"
            >Seats Updated: {new Date(stateWrap.fetchedAtMs).toLocaleTimeString()}</span
          >
        {/if}
        <Button
          variant="ghost"
          size="sm"
          onclick={refreshSeats}
          disabled={loading}
          class="ml-2 h-7 text-xs hover:bg-accent hover:text-accent-foreground"
        >
          <RefreshCw class="mr-2 h-3 w-3 {loading ? 'animate-spin' : ''}" />
          Refresh Seats
        </Button>
      </div>
    </div>

    {#if error}
      <div in:slide class="mx-auto mb-8 max-w-4xl">
        <Card class="border-destructive/50 bg-destructive/10">
          <CardContent class="flex items-center gap-3 pt-6 text-destructive">
            <div class="h-2 w-2 animate-pulse rounded-full bg-destructive"></div>
            {error}
          </CardContent>
        </Card>
      </div>
    {/if}

    <div class="mx-auto max-w-5xl space-y-6">
      {#if !rel}
        <div class="space-y-4 py-20 text-center text-muted-foreground">
          <div class="mb-4 flex justify-center">
            <div class="h-16 w-16 animate-pulse rounded-full bg-muted"></div>
          </div>
          <p>{loading ? 'Loading course data...' : 'No relation data available.'}</p>
        </div>
      {:else if subjects.length === 0}
        <div class="py-20 text-center text-muted-foreground">
          <p class="text-xl">No matching subjects found.</p>
          <p class="mt-2 text-sm">Try adjusting your search query.</p>
        </div>
      {:else}
        {#each subjects as sub (sub.id)}
          <div in:slide={{ duration: 300, axis: 'y' }} class="group">
            <Card
              class="overflow-hidden border-border/60 transition-all duration-300 hover:border-primary/50 hover:shadow-lg hover:shadow-primary/5"
            >
              <CardHeader class="border-b border-border/40 bg-muted/20 px-6 py-4">
                <div class="flex flex-wrap items-center justify-between gap-4">
                  <div class="flex items-center gap-4">
                    <div class="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <BookOpen class="h-5 w-5" />
                    </div>
                    <div>
                      <CardTitle class="flex items-center gap-3 text-xl font-bold tracking-tight">
                        <span class="font-mono text-primary uppercase">{sub.code}</span>
                        <span class="px-1 text-muted-foreground/30">|</span>
                        <span>{sub.name}</span>
                      </CardTitle>
                      <div class="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                        <span class="rounded bg-muted px-1.5 py-0.5 font-mono">ID: {sub.id}</span>
                        <span>&bull;</span>
                        <span class="font-medium text-foreground">{sub.credits} Credits</span>
                      </div>
                    </div>
                  </div>
                  <Badge variant="outline" class="bg-background/50 px-3 py-1 backdrop-blur">
                    <Layers class="mr-1.5 h-3.5 w-3.5" />
                    {sub.sections.length} Sections
                  </Badge>
                </div>
              </CardHeader>

              <CardContent class="p-0">
                <div class="overflow-x-auto">
                  <Table.Table>
                    <Table.TableHeader class="bg-muted/10">
                      <Table.TableRow class="hover:bg-transparent">
                        <Table.TableHead class="w-[100px] pl-6">Section</Table.TableHead>
                        <Table.TableHead>Faculty</Table.TableHead>
                        <Table.TableHead>Timeslot</Table.TableHead>
                        <Table.TableHead class="text-center">Availability</Table.TableHead>
                        <Table.TableHead class="pr-6 text-right">Max</Table.TableHead>
                      </Table.TableRow>
                    </Table.TableHeader>

                    <Table.TableBody>
                      {#each sub.sections as sec (sec.id)}
                        {@const left = seatsLeft(sec.id)}
                        <Table.TableRow class="transition-colors hover:bg-muted/40">
                          <Table.TableCell class="pl-6 font-medium text-foreground">
                            {sec.sectionNumber}
                            <div class="mt-0.5 font-mono text-[0.65rem] text-muted-foreground">#{sec.id}</div>
                          </Table.TableCell>
                          <Table.TableCell>
                            {#if sec.faculty}
                              <div class="text-sm font-medium">{sec.faculty.name}</div>
                              <div class="text-xs text-muted-foreground opacity-80">{sec.faculty.email}</div>
                            {:else}
                              <span class="text-xs text-muted-foreground italic">TBA</span>
                            {/if}
                          </Table.TableCell>
                          <Table.TableCell>
                            <Badge variant="secondary" class="border-0 bg-muted/50 text-xs font-normal">
                              {formatTimeslot(sec.timeslotMask)}
                            </Badge>
                          </Table.TableCell>
                          <Table.TableCell class="text-center">
                            <Badge
                              variant={left === 0 ? 'destructive' : 'outline'}
                              class="{left > 0
                                ? 'border-emerald-200 bg-emerald-500/10 text-emerald-600 dark:border-emerald-800 dark:text-emerald-400'
                                : ''} font-bold"
                            >
                              {left} left
                            </Badge>
                          </Table.TableCell>
                          <Table.TableCell class="pr-6 text-right text-muted-foreground">
                            {sec.maxSeats}
                          </Table.TableCell>
                        </Table.TableRow>
                      {/each}
                    </Table.TableBody>
                  </Table.Table>
                </div>
              </CardContent>
            </Card>
          </div>
        {/each}
      {/if}
    </div>
  </div>
</div>
