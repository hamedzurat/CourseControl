<script lang="ts">
  import { onMount } from 'svelte';

  import { apiFetch } from '$lib/api/fetch';
  import { Button } from '$lib/components/ui/button';
  import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
  import { Input } from '$lib/components/ui/input';
  import * as Select from '$lib/components/ui/select/index.js';
  import { Separator } from '$lib/components/ui/separator';
  import { Tabs, TabsContent, TabsList, TabsTrigger } from '$lib/components/ui/tabs';
  import { wsLog, wsStatus } from '$lib/stores/ws';

  const status = $derived($wsStatus);
  const log = $derived($wsLog);

  let tables = $state<string[]>([]);
  let selectedTable = $state<string>('');
  let limit = $state('100');

  let tableRows = $state<any[] | null>(null);
  let tableErr = $state<string | null>(null);
  let loading = $state(false);

  let phaseJson = $state<any>(null);
  let relationJson = $state<any>(null);
  let stateJson = $state<any>(null);

  const tableTrigger = $derived(selectedTable || 'Select a table');

  async function loadTables() {
    const res = await apiFetch<{ tables: string[] }>('/admin/tables');
    tables = res.tables ?? [];
    if (!selectedTable && tables[0]) selectedTable = tables[0];
  }

  async function loadTable() {
    tableErr = null;
    tableRows = null;
    loading = true;
    try {
      const qs = new URLSearchParams({ name: selectedTable, limit: limit || '100' });
      const res = await apiFetch<{ rows: any[] }>(`/admin/table?${qs.toString()}`);
      tableRows = res.rows ?? [];
    } catch (e: any) {
      tableErr = e?.message ?? 'Failed to load table';
    } finally {
      loading = false;
    }
  }

  async function refreshJson() {
    phaseJson = await apiFetch('/phase').catch((e: any) => ({ error: e?.message ?? 'failed' }));
    relationJson = await apiFetch('/relation.json').catch((e: any) => ({ error: e?.message ?? 'failed' }));
    stateJson = await apiFetch('/state.json').catch((e: any) => ({ error: e?.message ?? 'failed' }));
  }

  onMount(async () => {
    await loadTables().catch((e: any) => (tableErr = e?.message ?? 'Failed to load tables'));
    await refreshJson();
  });
</script>

<div class="mx-auto w-full max-w-6xl space-y-6 px-4 py-6">
  <div class="space-y-1">
    <h1 class="text-2xl font-semibold">Admin Debug</h1>
    <p class="text-sm text-muted-foreground">WS: {status.state}</p>
  </div>

  <Tabs value="d1">
    <TabsList>
      <TabsTrigger value="d1">D1</TabsTrigger>
      <TabsTrigger value="json">JSON</TabsTrigger>
      <TabsTrigger value="ws">WS</TabsTrigger>
    </TabsList>

    <TabsContent value="d1">
      <Card>
        <CardHeader><CardTitle>D1 Table Viewer</CardTitle></CardHeader>
        <CardContent class="space-y-4">
          <div class="grid gap-3 sm:grid-cols-3">
            <div class="space-y-1 sm:col-span-2">
              <div class="text-xs text-muted-foreground">Table</div>

              <Select.Root type="single" name="table" bind:value={selectedTable}>
                <Select.Trigger class="w-full">{tableTrigger}</Select.Trigger>
                <Select.Content>
                  <Select.Group>
                    <Select.Label>Tables</Select.Label>
                    {#each tables as t (t)}
                      <Select.Item value={t} label={t}>{t}</Select.Item>
                    {/each}
                  </Select.Group>
                </Select.Content>
              </Select.Root>
            </div>

            <div class="space-y-1">
              <div class="text-xs text-muted-foreground">Limit</div>
              <Input bind:value={limit} inputmode="numeric" />
            </div>
          </div>

          <div class="flex flex-wrap gap-2">
            <Button onclick={loadTable} disabled={!selectedTable || loading}>
              {loading ? 'Loading...' : 'Load'}
            </Button>
            <Button
              variant="outline"
              onclick={() => {
                tableRows = null;
                tableErr = null;
              }}
            >
              Clear
            </Button>
          </div>

          {#if tableErr}
            <div class="text-sm text-destructive">{tableErr}</div>
          {/if}

          {#if tableRows}
            <Separator />
            <div class="overflow-auto rounded-md border p-3">
              <pre class="text-xs leading-relaxed whitespace-pre-wrap">{JSON.stringify(tableRows, null, 2)}</pre>
            </div>
          {/if}
        </CardContent>
      </Card>
    </TabsContent>

    <TabsContent value="json">
      <div class="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle>/phase</CardTitle></CardHeader>
          <CardContent class="space-y-3">
            <Button variant="outline" onclick={refreshJson}>Refresh all</Button>
            <div class="overflow-auto rounded-md border p-3">
              <pre class="text-xs leading-relaxed whitespace-pre-wrap">{JSON.stringify(phaseJson, null, 2)}</pre>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>/relation.json</CardTitle></CardHeader>
          <CardContent>
            <div class="overflow-auto rounded-md border p-3">
              <pre class="text-xs leading-relaxed whitespace-pre-wrap">{JSON.stringify(relationJson, null, 2)}</pre>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>/state.json</CardTitle></CardHeader>
          <CardContent>
            <div class="overflow-auto rounded-md border p-3">
              <pre class="text-xs leading-relaxed whitespace-pre-wrap">{JSON.stringify(stateJson, null, 2)}</pre>
            </div>
          </CardContent>
        </Card>
      </div>
    </TabsContent>

    <TabsContent value="ws">
      <Card>
        <CardHeader><CardTitle>WebSocket Log (last 50)</CardTitle></CardHeader>
        <CardContent>
          <div class="overflow-auto rounded-md border p-3">
            <pre class="text-xs leading-relaxed whitespace-pre-wrap">{JSON.stringify(log, null, 2)}</pre>
          </div>
        </CardContent>
      </Card>
    </TabsContent>
  </Tabs>
</div>
