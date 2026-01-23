<script lang="ts">
  import './layout.css';

  import { ModeWatcher } from 'mode-watcher';

  import Navbar from '$lib/components/Navbar.svelte';
  import { authStore } from '$lib/stores/auth';
  import { clearMe, loadMe } from '$lib/stores/me';
  import { closeUserWs, ensureUserWsConnected } from '$lib/ws/user-ws';

  let { children } = $props();

  let auth = $state(authStore.get());
  authStore.listen((v) => (auth = v));

  $effect(() => {
    if (!auth) {
      clearMe();
      closeUserWs();
      return;
    }

    // logged in
    ensureUserWsConnected();
    loadMe().catch(() => {
      // if /me fails, keep app alive; pages can show "failed to load"
    });
  });
</script>

<ModeWatcher />
<Navbar />

<main class="mx-auto max-w-6xl px-4 py-6">
  {@render children?.()}
</main>
