<script lang="ts">
  import { onMount } from 'svelte';

  import { Button } from '$lib/components/ui/button';
  import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
  import { requireRole } from '$lib/guards';

  onMount(() => {
    requireRole('admin');
  });
</script>

<div class="space-y-6">
  <div class="space-y-1">
    <h1 class="text-2xl font-semibold">Admin</h1>
    <p class="text-sm text-muted-foreground">Debug tools for D1 + backend state.</p>
  </div>

  <div class="grid gap-4 sm:grid-cols-2">
    <Card>
      <CardHeader class="space-y-2">
        <CardTitle class="text-lg">DB Tables</CardTitle>
        <CardDescription>Browse and inspect rows from any D1 table.</CardDescription>
      </CardHeader>
      <CardContent>
        <Button href="/admin/db" class="w-full">Open Table Browser</Button>
      </CardContent>
    </Card>

    <Card>
      <CardHeader class="space-y-2">
        <CardTitle class="text-lg">More tools later</CardTitle>
        <CardDescription>We’ll add notifications creator, seed viewer, etc.</CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="outline" class="w-full" href="/help">Help</Button>
      </CardContent>
    </Card>
  </div>
</div>
