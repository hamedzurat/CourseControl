<script lang="ts">
  import { onMount } from 'svelte';

  import { dev } from '$app/environment';

  let {
    siteKey,
    onToken,
  }: {
    siteKey: string;
    onToken: (token: string) => void;
  } = $props();

  let container = $state<HTMLDivElement>();
  let widgetId: string | null = null;
  let status = $state<'loading' | 'ready' | 'verified' | 'error'>('loading');
  let errorMsg = $state('');

  onMount(() => {
    // In dev mode with test keys, auto-pass to avoid CSP issues
    if (dev && siteKey.startsWith('0x00000000000000000000000000000')) {
      status = 'verified';
      onToken('dev-bypass-token');
      return;
    }

    // Load Turnstile script
    if (!document.getElementById('cf-turnstile-script')) {
      const script = document.createElement('script');
      script.id = 'cf-turnstile-script';
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      document.head.appendChild(script);
    }

    const poll = setInterval(() => {
      const ts = (window as any).turnstile;
      if (!ts || widgetId !== null) return;

      try {
        widgetId = ts.render(container, {
          sitekey: siteKey,
          callback: (token: string) => {
            status = 'verified';
            onToken(token);
          },
          'error-callback': () => {
            status = 'error';
            errorMsg = 'Captcha failed to load. Please refresh.';
          },
          'expired-callback': () => {
            status = 'loading';
          },
        });
        status = 'ready';
      } catch (e: any) {
        status = 'error';
        errorMsg = e.message || 'Failed to initialize captcha';
      }
      clearInterval(poll);
    }, 100);

    // Timeout after 10s
    const timeout = setTimeout(() => {
      if (status === 'loading') {
        status = 'error';
        errorMsg = 'Captcha timed out. Check CSP settings.';
        clearInterval(poll);
      }
    }, 10000);

    return () => {
      clearInterval(poll);
      clearTimeout(timeout);
      if (widgetId !== null) {
        (window as any).turnstile?.remove(widgetId);
      }
    };
  });
</script>

<div class="rounded-lg border p-3">
  <div class="text-sm font-medium">Captcha</div>

  {#if status === 'verified'}
    <div class="mt-2 flex items-center gap-2 text-sm text-green-600">
      <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
      </svg>
      Verified
    </div>
  {:else if status === 'error'}
    <div class="mt-2 text-sm text-red-600">{errorMsg}</div>
  {:else}
    <div class="mt-2" bind:this={container}></div>
    <div class="mt-2 text-xs text-muted-foreground">Complete the captcha to continue.</div>
  {/if}
</div>
