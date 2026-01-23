<script lang="ts">
  import { onMount } from 'svelte';

  import { apiFetch } from '$lib/api';
  import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
  import * as Select from '$lib/components/ui/select/index.js';
  import * as Table from '$lib/components/ui/table/index.js';
  import { requireRole } from '$lib/guards';

  type TablesResp = { tables: string[] };
  type RowsResp = { table: string; limit: number; offset: number; rows: any[] };

  let tables = $state<string[]>([]);
  let table = $state<string>('');
  let limit = $state<number>(100);
  let offset = $state<number>(0);

  let rows = $state<any[]>([]);
  let loadingTables = $state(false);
  let loadingRows = $state(false);
  let error = $state('');

  const limitOptions = [
    { value: '50', label: '50' },
    { value: '100', label: '100' },
    { value: '200', label: '200' },
    { value: '500', label: '500' },
  ];

  const tableTriggerContent = $derived(table || 'Select a table');
  const limitTriggerContent = $derived(String(limit));

  async function loadTables() {
    loadingTables = true;
    error = '';
    try {
      const data = await apiFetch<TablesResp>('/admin/db');
      tables = data.tables ?? [];
      if (!table && tables[0]) table = tables[0];
    } catch (e: any) {
      error = e?.message ?? 'Failed to load tables';
    } finally {
      loadingTables = false;
    }
  }

  async function loadRows() {
    if (!table) return;
    loadingRows = true;
    error = '';
    try {
      const data = await apiFetch<RowsResp>(`/admin/db/${encodeURIComponent(table)}?limit=${limit}&offset=${offset}`);
      rows = data.rows ?? [];
    } catch (e: any) {
      error = e?.message ?? 'Failed to load rows';
    } finally {
      loadingRows = false;
    }
  }

  function resetPagination() {
    offset = 0;
  }

  async function onTableChange(next: string) {
    table = next;
    resetPagination();
    await loadRows();
  }

  async function onLimitChange(next: string) {
    limit = Number(next);
    resetPagination();
    await loadRows();
  }

  async function nextPage() {
    offset += limit;
    await loadRows();
  }

  async function prevPage() {
    offset = Math.max(0, offset - limit);
    await loadRows();
  }

  async function refresh() {
    await loadRows();
  }

  onMount(async () => {
    if (!requireRole('admin')) return;
    await loadTables();
    await loadRows();
  });
</script>

<div class="space-y-6">
  <div class="space-y-1">
    <h1 class="text-2xl font-semibold">DB Table Browser</h1>
    <p class="text-sm text-muted-foreground">Inspect D1 tables for debugging. Use pagination to avoid huge payloads.</p>
  </div>

  {#if error}
    <Alert variant="destructive">
      <AlertTitle>Error</AlertTitle>
      <AlertDescription>{error}</AlertDescription>
    </Alert>
  {/if}

  <Card>
    <CardHeader class="space-y-2">
      <CardTitle class="text-lg">Controls</CardTitle>
      <CardDescription>Pick a table and browse rows.</CardDescription>
    </CardHeader>

    <CardContent class="space-y-5">
      <div class="grid gap-4 md:grid-cols-3">
        <div class="space-y-2">
          <div class="text-sm font-medium">Table</div>

          <Select.Root type="single" name="table" value={table} onValueChange={(v: string) => onTableChange(v)}>
            <Select.Trigger class="w-full">
              {tableTriggerContent}
            </Select.Trigger>

            <Select.Content>
              <Select.Group>
                <Select.Label>Tables</Select.Label>
                {#each tables as t (t)}
                  <Select.Item value={t} label={t}>
                    {t}
                  </Select.Item>
                {/each}
              </Select.Group>
            </Select.Content>
          </Select.Root>
        </div>

        <div class="space-y-2">
          <div class="text-sm font-medium">Limit</div>

          <Select.Root type="single" name="limit" value={String(limit)} onValueChange={(v: string) => onLimitChange(v)}>
            <Select.Trigger class="w-full">
              {limitTriggerContent}
            </Select.Trigger>

            <Select.Content>
              <Select.Group>
                <Select.Label>Rows per page</Select.Label>
                {#each limitOptions as opt (opt.value)}
                  <Select.Item value={opt.value} label={opt.label}>
                    {opt.label}
                  </Select.Item>
                {/each}
              </Select.Group>
            </Select.Content>
          </Select.Root>
        </div>

        <div class="space-y-2">
          <div class="text-sm font-medium">Pagination</div>
          <div class="flex flex-wrap gap-2">
            <Button variant="outline" onclick={prevPage} disabled={loadingRows || offset === 0}>Prev</Button>
            <Button variant="outline" onclick={nextPage} disabled={loadingRows}>Next</Button>
            <Button onclick={refresh} disabled={loadingRows}>Refresh</Button>
          </div>

          <div class="text-sm text-muted-foreground">
            <span>Offset: </span><Badge variant="secondary">{offset}</Badge>
            <span class="ml-3">Showing up to </span><Badge variant="secondary">{limit}</Badge>
          </div>
        </div>
      </div>

      <div class="rounded-lg border p-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="text-sm font-medium">
            {#if table}{table}{/if}
          </div>
          <div class="text-xs text-muted-foreground">
            {#if loadingRows}Loading…{/if}
          </div>
        </div>

        <div class="mt-3 overflow-auto">
          {#if rows.length === 0}
            <div class="py-8 text-center text-sm text-muted-foreground">No rows (or table empty).</div>
          {:else}
            <!-- very simple table: columns derived from first row keys -->
            {@const cols = Object.keys(rows[0] ?? {})}

            <Table.Table class="min-w-[900px]">
              <Table.TableHeader>
                <Table.TableRow>
                  {#each cols as c (c)}
                    <Table.TableHead class="whitespace-nowrap">{c}</Table.TableHead>
                  {/each}
                </Table.TableRow>
              </Table.TableHeader>

              <Table.TableBody>
                {#each rows as r, i (i)}
                  <Table.TableRow>
                    {#each cols as c (c)}
                      <Table.TableCell class="align-top">
                        <div class="max-w-[320px] text-sm wrap-break-word">
                          {String(r?.[c] ?? '')}
                        </div>
                      </Table.TableCell>
                    {/each}
                  </Table.TableRow>
                {/each}
              </Table.TableBody>
            </Table.Table>
          {/if}
        </div>
      </div>
    </CardContent>
  </Card>
</div>
