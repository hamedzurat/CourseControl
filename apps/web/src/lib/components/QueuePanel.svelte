<script lang="ts">
  import { Activity, AlertCircle, CheckCircle2, Clock, Loader2, Trash2, X } from '@lucide/svelte';
  import { slide } from 'svelte/transition';

  import { Button } from '$lib/components/ui/button';
  import { ScrollArea } from '$lib/components/ui/scroll-area';
  import { userQueue } from '$lib/stores/ws';
  import { sendUserAction } from '$lib/ws/user-ws';

  let queue = $derived([...$userQueue].reverse());

  function doCancel(queueId: string) {
    sendUserAction('cancel', { queueId });
  }

  function doCancelAll() {
    sendUserAction('cancel_all');
  }

  const statusConfig = {
    queued: { icon: Clock, color: 'text-amber-500', bg: 'bg-amber-500/10', animate: false },
    processing: { icon: Loader2, color: 'text-blue-500', bg: 'bg-blue-500/10', animate: true },
    completed: { icon: CheckCircle2, color: 'text-emerald-500', bg: 'bg-emerald-500/10', animate: false },
    failed: { icon: AlertCircle, color: 'text-destructive', bg: 'bg-destructive/10', animate: false },
  };
</script>

<div class="flex h-full flex-col overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm">
  <div class="flex items-center justify-between border-b bg-muted/40 px-3 py-2">
    <div class="flex items-center gap-2">
      <Activity class="h-3.5 w-3.5 text-muted-foreground" />
      <h3 class="text-xs font-semibold tracking-wider text-muted-foreground uppercase">Activity Queue</h3>
      {#if queue.length > 0}
        <span class="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold text-primary">
          {queue.length}
        </span>
      {/if}
    </div>
    {#if queue.some((i) => i.status === 'queued')}
      <Button
        variant="ghost"
        size="icon"
        class="h-6 w-6 text-muted-foreground transition-colors hover:text-destructive"
        onclick={doCancelAll}
        title="Cancel All"
      >
        <Trash2 class="h-3.5 w-3.5" />
      </Button>
    {/if}
  </div>

  <ScrollArea class="h-[200px] flex-1">
    <div class="space-y-1 p-2">
      {#if queue.length === 0}
        <div class="flex h-32 flex-col items-center justify-center gap-2 text-muted-foreground/40 select-none">
          <Clock class="h-8 w-8 opacity-20" />
          <p class="text-[10px] font-medium tracking-widest uppercase">No recent activity</p>
        </div>
      {:else}
        {#each queue as item (item.id)}
          {@const config = statusConfig[item.status as keyof typeof statusConfig] || statusConfig.queued}
          {@const Icon = config.icon}

          <div
            class="group relative flex items-start gap-3 rounded-md border border-transparent p-2 transition-all hover:border-border/50 hover:bg-muted/50"
            transition:slide={{ axis: 'y', duration: 200 }}
          >
            <!-- Status Icon -->
            <div
              class={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${config.bg} ${config.color}`}
            >
              <Icon class={`h-3 w-3 ${config.animate ? 'animate-spin' : ''}`} />
            </div>

            <!-- Content -->
            <div class="flex min-w-0 flex-1 flex-col gap-0.5">
              <div class="flex items-center justify-between gap-2">
                <span class="truncate text-xs leading-none font-medium capitalize">
                  {item.action.replace(/_/g, ' ')}
                </span>
                <span class="shrink-0 text-[10px] text-muted-foreground tabular-nums">
                  {new Date(item.createdAtMs).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  })}
                </span>
              </div>

              <div class="flex items-center justify-between gap-2">
                <span class="flex items-center gap-1.5 text-[10px] leading-none text-muted-foreground capitalize">
                  {item.status}
                  {#if item.error}
                    <span class="font-medium text-destructive">• {item.error.code}</span>
                  {/if}
                </span>
              </div>
            </div>

            <!-- Action -->
            {#if item.status === 'queued'}
              <Button
                variant="ghost"
                size="icon"
                class="absolute top-1/2 right-2 h-6 w-6 -translate-y-1/2 text-muted-foreground opacity-0 transition-all group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive"
                onclick={() => doCancel(item.id)}
              >
                <X class="h-3 w-3" />
              </Button>
            {/if}
          </div>
        {/each}
      {/if}
    </div>
  </ScrollArea>
</div>
