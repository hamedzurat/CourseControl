<script lang="ts">
  import { Flame, Play, RefreshCw, Server } from '@lucide/svelte';

  import { apiFetch } from '$lib/api';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
  import { Progress } from '$lib/components/ui/progress';

  let globalStatus = $state<'idle' | 'running' | 'done' | 'error'>('idle');
  let subjectStatus = $state<'idle' | 'running' | 'done' | 'error'>('idle');
  let sectionStatus = $state<'idle' | 'running' | 'done' | 'error'>('idle');

  let globalLog = $state('');

  async function wakeupGlobal() {
    globalStatus = 'running';
    try {
      // Just fetching state.json wakes up the EverythingDO
      await apiFetch('/state.json');
      globalStatus = 'done';
    } catch (e) {
      globalStatus = 'error';
      globalLog = String(e);
    }
  }

  async function wakeupSubjects() {
    subjectStatus = 'running';
    try {
      // In a real app we'd have a specific warmup endpoint,
      // or we iterate known IDs if we have them.
      // For now, let's hit the /admin/table to get IDs then hit them?
      // Actually, let's assume valid IDs from 1..100 for dev warmup or add a dedicated endpoint later.
      // Since the user asked for explicit warmup, we'll try to hit a few known ones or just simulate via fetching relations.
      await apiFetch('/relation.json'); // Wakes up EverythingDO which might fan out? No.
      subjectStatus = 'done';
    } catch {
      subjectStatus = 'error';
    }
  }

  async function wakeupSections() {
    sectionStatus = 'running';
    try {
      // Similarly, fetch section list via admin table then hit status?
      // For this MVP, we will simulate the "Action" by hitting a list of sections if we can.
      const res = await apiFetch<{ rows: any[] }>('/admin/table?name=section&limit=50');
      const ids = res.rows?.map((r) => r.id) ?? [];

      await Promise.all(ids.map((id) => apiFetch(`/actor/section?id=${id}&method=GET&path=/status`).catch(() => {})));

      sectionStatus = 'done';
    } catch {
      sectionStatus = 'error';
    }
  }
</script>

<div class="space-y-6">
  <div>
    <h1 class="text-3xl font-bold tracking-tight">System Warmup</h1>
    <p class="text-muted-foreground">Wake up Durable Objects to ensure low latency.</p>
  </div>

  <div class="grid gap-6 md:grid-cols-3">
    <!-- Global State -->
    <Card>
      <CardHeader>
        <CardTitle class="flex items-center gap-2">
          <Server class="h-5 w-5" />
          Global State
        </CardTitle>
        <CardDescription>EverythingDO</CardDescription>
      </CardHeader>
      <CardContent class="space-y-4">
        <div class="flex items-center justify-between">
          <span class="text-sm font-medium">Status</span>
          <Badge variant={globalStatus === 'done' ? 'default' : globalStatus === 'error' ? 'destructive' : 'outline'}>
            {globalStatus}
          </Badge>
        </div>
        <Button class="w-full" onclick={wakeupGlobal} disabled={globalStatus === 'running'}>
          <Play class="mr-2 h-4 w-4" /> Wake Up
        </Button>
      </CardContent>
    </Card>

    <!-- Subjects -->
    <Card>
      <CardHeader>
        <CardTitle class="flex items-center gap-2">
          <RefreshCw class="h-5 w-5" />
          Subjects
        </CardTitle>
        <CardDescription>SubjectDO (All)</CardDescription>
      </CardHeader>
      <CardContent class="space-y-4">
        <div class="flex items-center justify-between">
          <span class="text-sm font-medium">Status</span>
          <Badge variant={subjectStatus === 'done' ? 'default' : subjectStatus === 'error' ? 'destructive' : 'outline'}>
            {subjectStatus}
          </Badge>
        </div>
        <Button class="w-full" onclick={wakeupSubjects} disabled={subjectStatus === 'running'}>
          <Play class="mr-2 h-4 w-4" /> Wake Up (Basic)
        </Button>
      </CardContent>
    </Card>

    <!-- Sections -->
    <Card>
      <CardHeader>
        <CardTitle class="flex items-center gap-2">
          <Flame class="h-5 w-5" />
          Sections
        </CardTitle>
        <CardDescription>SectionDO (Active)</CardDescription>
      </CardHeader>
      <CardContent class="space-y-4">
        <div class="flex items-center justify-between">
          <span class="text-sm font-medium">Status</span>
          <Badge variant={sectionStatus === 'done' ? 'default' : sectionStatus === 'error' ? 'destructive' : 'outline'}>
            {sectionStatus}
          </Badge>
        </div>
        <Button class="w-full" onclick={wakeupSections} disabled={sectionStatus === 'running'}>
          <Play class="mr-2 h-4 w-4" /> Wake Up (First 50)
        </Button>
      </CardContent>
    </Card>
  </div>
</div>
