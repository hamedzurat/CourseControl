<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { Card } from '$lib/components/ui/card';
  import { Input } from '$lib/components/ui/input';
  import { ScrollArea } from '$lib/components/ui/scroll-area';
  import { Separator } from '$lib/components/ui/separator';
  import { authStore } from '$lib/stores/auth';
  import { chatActiveMessages, chatActivePeerId, chatAddOut, chatOpen, chatPeersSorted } from '$lib/stores/chat';
  import { meStore } from '$lib/stores/me';
  import { userWsSend } from '$lib/ws/user-ws';

  const me = $derived($meStore);

  let peerInput = $state('');
  let draft = $state('');

  const activePeer = $derived($chatActivePeerId || '');

  let userCache = $state<Record<string, { email: string; name: string }>>({});

  $effect(() => {
    const peers = $chatPeersSorted;
    const token = authStore.get()?.token;
    if (!token || !peers.length) return;

    const missing = peers.filter((id) => !userCache[id]);
    if (missing.length === 0) return;

    // batch resolve
    fetch('http://localhost:8787/user/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ userIds: missing }),
    }).then(async (r) => {
      if (r.ok) {
        const users = await r.json();
        const update: Record<string, any> = {};
        for (const u of users) {
          update[u.id] = { email: u.email, name: u.name };
        }
        userCache = { ...userCache, ...update };
      }
    });
  });

  async function startPeer() {
    const input = peerInput.trim();
    if (!input) return;

    let targetId = input;

    // Check if email
    if (input.includes('@')) {
      try {
        const token = authStore.get()?.token;
        const res = await fetch(`http://localhost:8787/user/lookup?email=${encodeURIComponent(input)}`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        if (!res.ok) {
          alert('User not found by email');
          return;
        }
        const user = await res.json();
        targetId = user.id;
        userCache = { ...userCache, [user.id]: { email: user.email, name: user.name } };
      } catch (e) {
        console.error(e);
        alert('Failed to lookup user');
        return;
      }
    }

    chatOpen(targetId);
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

  function resolveName(id: string) {
    return userCache[id]?.email ?? id;
  }
</script>

<div class="flex h-[calc(100vh-4rem)] w-full flex-col p-4 md:p-6">
  <div class="mx-auto flex h-full w-full max-w-7xl flex-col gap-4">
    <div class="flex flex-shrink-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div class="space-y-1">
        <div class="text-2xl font-semibold">Chat</div>
        <div class="text-sm text-muted-foreground">Start by typing an email or userId.</div>
      </div>
      <div class="text-xs text-muted-foreground">
        {me?.user?.id} • {me?.user?.role}
      </div>
    </div>

    <div class="grid flex-1 gap-4 overflow-hidden lg:grid-cols-[320px_1fr]">
      <!-- Left: peers -->
      <Card class="flex h-full flex-col p-3">
        <div class="flex flex-shrink-0 flex-col gap-3 pb-3">
          <div class="text-sm font-medium">Open chat</div>

          <div class="flex gap-2">
            <Input
              placeholder="email (fac1@uiu.bd)"
              bind:value={peerInput}
              onkeydown={(e: KeyboardEvent) => e.key === 'Enter' && startPeer()}
            />
            <Button onclick={startPeer}>Open</Button>
          </div>

          <Separator />

          <div class="text-sm font-medium">Recent</div>
        </div>

        <ScrollArea class="flex-1 pr-2">
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
                  <div class="truncate text-sm">{resolveName(peerId)}</div>
                  {#if !userCache[peerId]}<div class="truncate text-xs text-muted-foreground opacity-50">
                      {peerId}
                    </div>{/if}
                </button>
              {/each}
            {/if}
          </div>
        </ScrollArea>
      </Card>

      <!-- Right: conversation -->
      <Card class="flex h-full flex-col p-3">
        <div class="flex flex-shrink-0 flex-col gap-3 pb-3">
          <div class="text-sm font-medium">
            {#if activePeer}
              Conversation: <span class="font-semibold">{resolveName(activePeer)}</span>
            {:else}
              Pick a conversation
            {/if}
          </div>

          <Separator />
        </div>

        <ScrollArea class="flex-1 pr-2">
          <div class="space-y-3">
            {#if !activePeer}
              <div class="flex h-full items-center justify-center text-sm text-muted-foreground">
                Select a conversation from the left to start chatting.
              </div>
            {:else if $chatActiveMessages.length === 0}
              <div class="py-2 text-sm text-muted-foreground">No messages yet.</div>
            {:else}
              {#each $chatActiveMessages as m (m.id)}
                <div class="space-y-1">
                  <div class="flex items-center justify-between gap-3">
                    <div class="text-xs text-muted-foreground">
                      {m.dir === 'out' ? 'You →' : '← Them'}
                      {resolveName(m.peerUserId)}
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

        <div class="flex flex-shrink-0 flex-col gap-3 pt-3">
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
</div>
