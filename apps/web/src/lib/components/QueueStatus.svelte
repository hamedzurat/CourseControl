<script lang="ts">
  import { ShieldAlert } from '@lucide/svelte';

  import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import { meStore } from '$lib/stores/me';
  import { userQueue } from '$lib/stores/ws';
  import { sendUserAction } from '$lib/ws/user-ws';

  const user = $derived($meStore?.user);
  const queue = $derived($userQueue);

  let myPos = $state<number | null>(null);

  $effect(() => {
    if (!user || !queue.length) {
      myPos = null;
      return;
    }
    const idx = queue.findIndex((q) => q.id === user.id);
    myPos = idx === -1 ? null : idx + 1;
  });

  function leaveQueue() {
    sendUserAction('queue:leave');
  }
</script>

{#if myPos !== null}
  <Alert class="border-blue-500/50 bg-blue-500/10 text-blue-700 dark:text-blue-300">
    <ShieldAlert class="h-4 w-4" />
    <AlertTitle class="flex items-center gap-2">
      You are in queue
      <Badge variant="default" class="bg-blue-600 hover:bg-blue-700">
        Position: #{myPos}
      </Badge>
    </AlertTitle>
    <AlertDescription class="mt-2 flex items-center justify-between">
      <p class="text-xs opacity-90">
        Please wait while we process your request. You will be automatically processed when it's your turn.
      </p>
      <Button variant="outline" size="sm" class="h-7 text-xs" onclick={leaveQueue}>Leave Queue</Button>
    </AlertDescription>
  </Alert>
{/if}
