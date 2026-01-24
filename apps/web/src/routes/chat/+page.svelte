<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { Card } from '$lib/components/ui/card';
  import { Input } from '$lib/components/ui/input';
  import { ScrollArea } from '$lib/components/ui/scroll-area';
  import { Separator } from '$lib/components/ui/separator';
  import { chatActiveMessages, chatActivePeerId, chatAddOut, chatOpen, chatPeersSorted } from '$lib/stores/chat';
  import { meStore } from '$lib/stores/me';
  import { userWsSend } from '$lib/ws/user-ws';

  const me = $derived($meStore);

  let peerInput = $state('');
  let draft = $state('');

  const activePeer = $derived($chatActivePeerId || '');

  function startPeer() {
    const id = peerInput.trim();
    if (!id) return;
    chatOpen(id);
    peerInput = '';
  }

  function send() {
    const toUserId = activePeer.trim();
    const text = draft.trim();
    if (!toUserId || !text) return;

    // optimistic UI
    chatAddOut(toUserId, text);

    // IMPORTANT: match your DO "action" envelope
    const ok = userWsSend({
      type: 'action',
      id: crypto.randomUUID(),
      action: 'message',
      payload: { toUserId, text },
    });

    // if ws wasn't open, keep the draft so user can retry
    if (!ok) {
      // revert optimistic add by just re-adding later is annoying; MVP: show draft back
      draft = text;
      return;
    }

    draft = '';
  }

  function onDraftKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  function fmt(t: number) {
    try {
      return new Date(t).toLocaleString();
    } catch {
      return '';
    }
  }
</script>

<div class="mx-auto w-full max-w-6xl space-y-4 p-6">
  <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
    <div class="space-y-1">
      <div class="text-2xl font-semibold">Chat</div>
      <div class="text-sm text-muted-foreground">Start by typing a userId.</div>
    </div>
    <div class="text-xs text-muted-foreground">
      {me?.user?.id} • {me?.user?.role}
    </div>
  </div>

  <div class="grid gap-4 lg:grid-cols-[320px_1fr]">
    <!-- Left: peers -->
    <Card class="p-3">
      <div class="space-y-3">
        <div class="text-sm font-medium">Open chat</div>

        <div class="flex gap-2">
          <Input
            placeholder="userId (e.g. u_stu_1)"
            bind:value={peerInput}
            onkeydown={(e: KeyboardEvent) => e.key === 'Enter' && startPeer()}
          />
          <Button onclick={startPeer}>Open</Button>
        </div>

        <Separator />

        <div class="text-sm font-medium">Recent</div>

        <ScrollArea class="h-[420px] pr-2">
          <div class="space-y-1">
            {#if $chatPeersSorted.length === 0}
              <div class="py-2 text-sm text-muted-foreground">No chats yet.</div>
            {:else}
              {#each $chatPeersSorted as peerId (peerId)}
                <button
                  class="w-full rounded-md px-2 py-2 text-left hover:bg-muted"
                  class:font-semibold={peerId === $chatActivePeerId}
                  onclick={() => chatOpen(peerId)}
                >
                  <div class="truncate">{peerId}</div>
                </button>
              {/each}
            {/if}
          </div>
        </ScrollArea>
      </div>
    </Card>

    <!-- Right: conversation -->
    <Card class="p-3">
      <div class="space-y-3">
        <div class="text-sm font-medium">
          {#if activePeer}
            Conversation: <span class="font-semibold">{activePeer}</span>
          {:else}
            Pick a conversation
          {/if}
        </div>

        <Separator />

        <ScrollArea class="h-[420px] pr-2">
          <div class="space-y-3">
            {#if !activePeer}
              <div class="py-2 text-sm text-muted-foreground">Open a chat from the left.</div>
            {:else if $chatActiveMessages.length === 0}
              <div class="py-2 text-sm text-muted-foreground">No messages yet.</div>
            {:else}
              {#each $chatActiveMessages as m (m.id)}
                <div class="space-y-1">
                  <div class="flex items-center justify-between gap-3">
                    <div class="text-xs text-muted-foreground">
                      {m.dir === 'out' ? 'You →' : '← Them'}
                      {m.peerUserId}
                    </div>
                    <div class="text-xs text-muted-foreground">{fmt(m.atMs)}</div>
                  </div>

                  <div class="rounded-lg border p-3 text-sm whitespace-pre-wrap" class:bg-muted={m.dir === 'in'}>
                    {m.text}
                  </div>
                </div>
              {/each}
            {/if}
          </div>
        </ScrollArea>

        <Separator />

        <div class="flex gap-2">
          <Input
            placeholder={activePeer ? 'Type a message…' : 'Open a chat first…'}
            bind:value={draft}
            disabled={!activePeer}
            onkeydown={onDraftKeydown}
          />
          <Button disabled={!activePeer || !draft.trim()} onclick={send}>Send</Button>
        </div>

        <div class="text-xs text-muted-foreground">Enter = send • Shift+Enter = newline</div>
      </div>
    </Card>
  </div>
</div>
